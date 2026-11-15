import "reflect-metadata";
import { Controller, Get, Inject, Injectable, Module, OnApplicationShutdown, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { createLogger, errorFields } from "@docuflow/observability";
import { Job, Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { createRedisConnection, processingQueueName } from "./processing-queue";
import { processDocument, ProcessingError } from "./document-processing";
import { createWebhookWorker, enqueueWebhookEvents, webhookQueueName } from "./webhooks";
import { HealthService } from "./health";

const logger = createLogger({ service: "worker" });
const tracer = trace.getTracer("docuflow-worker");
const workerId = process.env.HOSTNAME ?? `worker-${process.pid}`;

@Controller("health")
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  live() {
    return this.health.live();
  }

  @Get("live")
  liveness() {
    return this.health.live();
  }

  @Get("ready")
  async readiness(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const report = await this.health.ready();
    if (report.status !== "ok") response.status(503);
    return { ...report, service: "worker" };
  }
}

@Injectable()
class ProcessingWorkerLifecycle implements OnApplicationShutdown {
  private readonly prisma = new PrismaClient();
  private readonly failedQueue = new Queue(`${processingQueueName}-failed`, { connection: createRedisConnection() });
  private readonly webhookQueue = new Queue(webhookQueueName, { connection: createRedisConnection() });
  private readonly webhookWorker = createWebhookWorker(this.prisma);
  private readonly worker = new Worker(processingQueueName, (job: Job<{ jobId: string; documentId: string }>) => this.processJob(job), { connection: createRedisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

  private async processJob(job: Job<{ jobId: string; documentId: string }>) {
    const { jobId, documentId } = job.data;
    // BullMQ increments attemptsStarted on every delivery, including stalled-job recovery,
    // while attemptsMade only counts completed failures. Use the former so a worker crash
    // does not leave the database row stuck in PROCESSING.
    const attempt = job.attemptsStarted || job.attemptsMade + 1;
    return tracer.startActiveSpan("document.process", {
      attributes: {
        "messaging.system": "bullmq",
        "messaging.destination.name": processingQueueName,
        "messaging.message.id": String(job.id ?? jobId),
        "docuflow.job.id": jobId,
        "docuflow.document.id": documentId,
        "docuflow.worker.id": workerId,
        "docuflow.job.attempt": attempt,
      },
    }, async (span) => {
      const startedAt = Date.now();
      logger.info("job.received", { workerId, jobId, documentId, attempt });
      try {
        await this.executeJob(job, startedAt, attempt);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : "Processing failed" });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async executeJob(job: Job<{ jobId: string; documentId: string }>, startedAt: number, attempt: number) {
    const { jobId, documentId } = job.data;
    const processing = await this.prisma.processingJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "PROCESSING"] }, attempts: { lt: attempt } },
      data: { status: "PROCESSING", attempts: attempt },
    });
    if (processing.count === 0) {
      logger.debug("job.skipped", { workerId, jobId, documentId, attempt, reason: "not claimable" });
      return;
    }
    try {
      await this.prisma.document.update({ where: { id: documentId }, data: { status: "PROCESSING" } });
      const document = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      const extraction = await processDocument({ storageKey: document.storageKey, mimeType: document.mimeType, filename: document.filename });
      const completed = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.processingJob.updateMany({
          where: { id: jobId, status: "PROCESSING", attempts: attempt },
          data: { status: "COMPLETED", errorCode: null, errorMessage: null },
        });
        if (claimed.count === 0) return false;
        await tx.extractionResult.upsert({
          where: { jobId },
          create: {
            jobId,
            data: extraction.data,
            confidence: extraction.confidence ?? null,
            extractedText: extraction.extractedText,
            model: extraction.model,
          },
          update: {
            data: extraction.data,
            confidence: extraction.confidence ?? null,
            extractedText: extraction.extractedText,
            model: extraction.model,
          },
        });
        await tx.usageRecord.upsert({
          where: { jobId },
          create: { organizationId: document.organizationId, jobId, inputTokens: extraction.inputTokens, outputTokens: extraction.outputTokens, processingDuration: Date.now() - startedAt },
          update: { inputTokens: extraction.inputTokens, outputTokens: extraction.outputTokens, processingDuration: Date.now() - startedAt },
        });
        await tx.document.update({ where: { id: documentId }, data: { status: "COMPLETED" } });
        return true;
      });
      if (!completed) {
        logger.warn("job.completed_stale", { workerId, jobId, documentId, attempt });
        return;
      }
      logger.info("job.completed", {
        workerId,
        jobId,
        documentId,
        organizationId: document.organizationId,
        durationMs: Date.now() - startedAt,
        inputTokens: extraction.inputTokens,
        outputTokens: extraction.outputTokens,
        model: extraction.model,
      });
      await enqueueWebhookEvents(this.prisma, this.webhookQueue, document.organizationId, "document.processing.completed", { documentId: document.id, jobId, status: "COMPLETED" })
        .catch((error: unknown) => logger.warn("webhook.enqueue.failed", { jobId, organizationId: document.organizationId, ...errorFields(error) }));
    } catch (error) {
      if (attempt >= (job.opts.attempts ?? 1)) {
        const message = error instanceof Error ? error.message : "Processing failed";
        const errorCode = error instanceof ProcessingError ? error.code : "PROCESSING_FAILED";
        const failed = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.processingJob.updateMany({
            where: { id: jobId, status: "PROCESSING", attempts: attempt },
            data: { status: "FAILED", errorCode, errorMessage: message.slice(0, 1000) },
          });
          if (claimed.count === 0) return false;
          await tx.document.updateMany({
            where: { id: documentId, status: { in: ["QUEUED", "PROCESSING"] } },
            data: { status: "FAILED" },
          });
          return true;
        });
        if (!failed) {
          logger.warn("job.failed_stale", { workerId, jobId, documentId, attempt, ...errorFields(error) });
          throw error;
        }
        await this.failedQueue.add("failed-document", { jobId, documentId, error: message }, { jobId: `${jobId}-${Date.now()}`, removeOnComplete: false });
        logger.error("job.terminally_failed", {
          workerId,
          jobId,
          documentId,
          attempt,
          durationMs: Date.now() - startedAt,
          errorCode,
          errorMessage: message,
          ...errorFields(error),
        });
        const document = await this.prisma.document.findUnique({ where: { id: documentId }, select: { organizationId: true } });
        if (document) {
          await enqueueWebhookEvents(this.prisma, this.webhookQueue, document.organizationId, "document.processing.failed", { documentId, jobId, status: "FAILED", errorCode })
            .catch((webhookError: unknown) => logger.warn("webhook.enqueue.failed", { jobId, organizationId: document.organizationId, ...errorFields(webhookError) }));
        }
      } else {
        logger.warn("job.retrying", { workerId, jobId, documentId, attempt, durationMs: Date.now() - startedAt, ...errorFields(error) });
      }
      throw error;
    }
  }

  async onApplicationShutdown() {
    await this.worker.close();
    await this.webhookWorker.close();
    await this.webhookQueue.close();
    await this.failedQueue.close();
    await this.prisma.$disconnect();
  }
}

@Module({ controllers: [HealthController], providers: [PrismaClient, HealthService, ProcessingWorkerLifecycle] })
class WorkerModule {}

export async function createWorkerApp() {
  const app = await NestFactory.create(WorkerModule, { logger: false });
  app.enableShutdownHooks();
  app.get(HealthService);
  return app;
}
