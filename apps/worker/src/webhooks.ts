import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { createLogger } from "@docuflow/observability";
import { isSafeWebhookUrl } from "@docuflow/shared";
import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "./processing-queue";

export const webhookQueueName = "docuflow-webhooks";
const supportedEvents = ["document.processing.completed", "document.processing.failed"];
const logger = createLogger({ service: "worker" });
const tracer = trace.getTracer("docuflow-worker");

function encryptionKey() {
  const value = process.env.WEBHOOK_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("WEBHOOK_ENCRYPTION_KEY (or a 32-character JWT_SECRET) is required");
  return createHash("sha256").update(value).digest();
}

function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export async function enqueueWebhookEvents(prisma: PrismaClient, queue: Queue, organizationId: string, eventType: string, data: Record<string, unknown>) {
  if (!supportedEvents.includes(eventType)) return;
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { organizationId, active: true, eventTypes: { has: eventType } }, select: { id: true } });
  for (const endpoint of endpoints) {
    const eventId = randomBytes(16).toString("hex");
    const payload = { id: eventId, type: eventType, createdAt: new Date().toISOString(), data: data as Prisma.InputJsonObject };
    const delivery = await prisma.webhookDelivery.create({ data: { endpointId: endpoint.id, eventId, eventType, payload } });
    await queue.add("deliver-webhook", { deliveryId: delivery.id }, { jobId: delivery.id, attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: true, removeOnFail: false });
  }
}

export function createWebhookWorker(prisma: PrismaClient) {
  return new Worker(webhookQueueName, async (job) => {
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: job.data.deliveryId as string }, include: { endpoint: true } });
    if (!delivery || delivery.status === "SENT" || !delivery.endpoint.active) {
      logger.debug("webhook.skipped", { deliveryId: job.data.deliveryId, reason: !delivery ? "missing" : delivery.status === "SENT" ? "already_sent" : "inactive" });
      return;
    }
    const startedAt = Date.now();
    return tracer.startActiveSpan("webhook.deliver", {
      attributes: {
        "messaging.system": "bullmq",
        "messaging.destination.name": webhookQueueName,
        "messaging.message.id": delivery.id,
        "docuflow.webhook.delivery_id": delivery.id,
        "docuflow.webhook.event_type": delivery.eventType,
        "docuflow.webhook.attempt": job.attemptsMade + 1,
      },
    }, async (span) => {
      let responseStatus: number | null = null;
      let error: string | null = null;
      try {
        // Re-check at delivery time (and resolve DNS in production) so a hostname
        // that later points at a private address cannot reach internal services.
        if (process.env.NODE_ENV === "production" && !(await isSafeWebhookUrl(delivery.endpoint.url, { resolveDns: true }))) {
          throw new Error("Webhook URL resolves to a disallowed address");
        }
        const secret = decryptSecret(delivery.endpoint.encryptedSigningSecret);
        const body = JSON.stringify(delivery.payload);
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHmac("sha256", secret).update(`${timestamp}.${delivery.eventId}.${body}`).digest("hex");
        const response = await fetch(delivery.endpoint.url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
          headers: { "content-type": "application/json", "user-agent": "DocuFlow-Webhooks/1.0", "x-docuflow-event": delivery.eventType, "x-docuflow-delivery": delivery.eventId, "x-docuflow-signature": `t=${timestamp},v1=${signature}` },
          body,
        });
        responseStatus = response.status;
        span.setAttribute("http.response.status_code", response.status);
        if (!response.ok) error = `Webhook endpoint returned HTTP ${response.status}`;
      } catch (cause) {
        error = cause instanceof Error ? cause.message.slice(0, 1000) : "Webhook request failed";
      }
      const attempt = job.attemptsMade + 1;
      const terminal = Boolean(error) && attempt >= (job.opts.attempts ?? 5);
      await prisma.$transaction(async (tx) => {
        await tx.webhookDeliveryAttempt.create({ data: { deliveryId: delivery.id, attempt, responseStatus, error } });
        await tx.webhookDelivery.update({ where: { id: delivery.id }, data: { attempts: attempt, responseStatus, lastError: error, status: error ? (terminal ? "FAILED" : "QUEUED") : "SENT" } });
      });
      const fields = {
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        attempt,
        responseStatus,
        durationMs: Date.now() - startedAt,
        endpointHost: new URL(delivery.endpoint.url).hostname,
      };
      if (!error) {
        span.setStatus({ code: SpanStatusCode.OK });
        logger.info("webhook.delivered", fields);
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error });
        logger.warn(terminal ? "webhook.failed" : "webhook.retrying", { ...fields, error });
      }
      span.end();
      if (error) throw new Error(error);
    });
  }, { connection: createRedisConnection(), concurrency: Number(process.env.WEBHOOK_CONCURRENCY ?? 5) });
}
