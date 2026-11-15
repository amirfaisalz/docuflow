import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { createWorkerApp } from "./app";
import { createRedisConnection, processingQueueName } from "./processing-queue";

let app: INestApplication;
let baseUrl: string;
const prisma = new PrismaClient();
const queue = new Queue(processingQueueName, { connection: createRedisConnection() });
const failedQueue = new Queue(`${processingQueueName}-failed`, { connection: createRedisConnection() });
let geminiMock: ReturnType<typeof createServer>;
let sourceMock: ReturnType<typeof createServer>;
let sourceBaseUrl: string;
let geminiResponseMode: "valid" | "invalid" = "valid";
const sourceAttempts = new Map<string, number>();

before(async () => {
  geminiMock = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> };
    const inputPart = parsed.contents[0].parts.find((part) => part.inlineData);
    if (request.method !== "POST" || request.url !== "/v1beta/models/test-model:generateContent?key=test-gemini-key" || !inputPart?.inlineData) {
      response.writeHead(400).end(JSON.stringify({ error: "unexpected Gemini request" }));
      return;
    }
    const payload = geminiResponseMode === "invalid"
      ? { extractedText: "Invoice text with invalid result", data: { invoiceNumber: 7 }, confidence: 1.5 }
      : {
        extractedText: "Invoice INV-2026-001 from Example Company. Total USD 1250.",
        data: { invoiceNumber: "INV-2026-001", vendor: "Example Company", invoiceDate: "2026-11-15", total: 1250, currency: "USD" },
        confidence: 0.96,
      };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 420, candidatesTokenCount: 37 } }));
  });
  await new Promise<void>((resolve) => geminiMock.listen(0, "127.0.0.1", resolve));
  const geminiAddress = geminiMock.address();
  assert.ok(geminiAddress && typeof geminiAddress !== "string");
  process.env.WEBHOOK_ENCRYPTION_KEY = "docuflow-webhook-test-encryption-key-32";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_API_BASE_URL = `http://127.0.0.1:${geminiAddress.port}/v1beta`;
  sourceMock = createServer((request, response) => {
    const path = request.url ?? "/";
    const attempts = (sourceAttempts.get(path) ?? 0) + 1;
    sourceAttempts.set(path, attempts);
    if (path.startsWith("/failed/")) {
      response.writeHead(503).end("temporarily unavailable");
      return;
    }
    if (path.startsWith("/retry/") && attempts === 1) {
      response.writeHead(503).end("temporarily unavailable");
      return;
    }
    response.writeHead(200, { "content-type": "application/pdf" }).end("Invoice INV-2026-001 from Example Company. Total USD 1250.");
  });
  await new Promise<void>((resolve) => sourceMock.listen(0, "127.0.0.1", resolve));
  const sourceAddress = sourceMock.address();
  assert.ok(sourceAddress && typeof sourceAddress !== "string");
  sourceBaseUrl = `http://127.0.0.1:${sourceAddress.port}`;
  process.env.DOCUMENT_SOURCE_BASE_URL = sourceBaseUrl;
  process.env.GEMINI_MODEL = "test-model";
  app = await createWorkerApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) => geminiMock.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => sourceMock.close((error) => error ? reject(error) : resolve()));
  delete process.env.DOCUMENT_SOURCE_BASE_URL;
  delete process.env.WEBHOOK_ENCRYPTION_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_BASE_URL;
  delete process.env.GEMINI_MODEL;
  await queue.obliterate({ force: true });
  await failedQueue.obliterate({ force: true });
  await failedQueue.close();
  await queue.close();
  await prisma.$disconnect();
});

test("GET /health reports worker service health", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "worker" });
});

test("processing worker executes a queued job once and updates persistent status", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Worker ${suffix}`, slug: `worker-${suffix}` } });
  const source = createServer((request, response) => {
    if (request.url !== `/worker/${suffix}.pdf`) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/pdf" }).end("Invoice INV-2026-001 from Example Company. Total USD 1250.");
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const sourceAddress = source.address();
  assert.ok(sourceAddress && typeof sourceAddress !== "string");
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "worker.pdf", mimeType: "application/pdf", size: 100n, storageKey: `http://127.0.0.1:${sourceAddress.port}/worker/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 3, backoff: { type: "exponential", delay: 100 } });

  const deadline = Date.now() + 10000;
  let result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  while (result.status !== "COMPLETED" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  }
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.attempts, 1);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).status, "COMPLETED");
  const extraction = await prisma.extractionResult.findUnique({ where: { jobId: record.id } });
  assert.deepEqual(extraction?.data, { invoiceNumber: "INV-2026-001", vendor: "Example Company", invoiceDate: "2026-11-15", total: 1250, currency: "USD" });
  assert.equal(extraction?.extractedText, "Invoice INV-2026-001 from Example Company. Total USD 1250.");
  assert.equal(extraction?.confidence, 0.96);
  assert.equal(extraction?.model, "test-model");
  const usage = await prisma.usageRecord.findUnique({ where: { jobId: record.id } });
  assert.equal(usage?.inputTokens, 420);
  assert.equal(usage?.outputTokens, 37);
  assert.ok((usage?.processingDuration ?? 0) >= 0);
  await new Promise<void>((resolve, reject) => source.close((error) => error ? reject(error) : resolve()));
});

test("completed processing meters usage once and delivers signed idempotent webhooks", async () => {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const webhookServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const webhookAddress = webhookServer.address();
  assert.ok(webhookAddress && typeof webhookAddress !== "string");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Webhook ${suffix}`, slug: `webhook-${suffix}` } });
  const endpoint = await prisma.webhookEndpoint.create({
    data: { organizationId: organization.id, url: `http://127.0.0.1:${webhookAddress.port}/docuflow`, eventTypes: ["document.processing.completed"], encryptedSigningSecret: encryptSecret("whsec_test_signing_secret") },
  });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "webhook.pdf", mimeType: "application/pdf", size: 100n, storageKey: `${sourceBaseUrl}/webhook/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 1 });

  const deadline = Date.now() + 10000;
  let delivery = await prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
  while ((!delivery || delivery.status !== "SENT") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    delivery = await prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
  }
  assert.equal(delivery?.status, "SENT");
  assert.equal(delivery?.eventType, "document.processing.completed");
  assert.equal(await prisma.usageRecord.count({ where: { jobId: record.id } }), 1);
  assert.equal(received.length, 1);
  const payload = JSON.parse(received[0].body) as { id: string; type: string; data: { jobId: string; documentId: string } };
  assert.equal(received[0].headers["x-docuflow-delivery"], payload.id);
  assert.equal(payload.type, "document.processing.completed");
  assert.equal(payload.data.jobId, record.id);
  assert.equal(payload.data.documentId, document.id);
  const signatureHeader = String(received[0].headers["x-docuflow-signature"]);
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signatureHeader);
  assert.ok(match);
  const expected = createHmac("sha256", "whsec_test_signing_secret").update(`${match![1]}.${payload.id}.${received[0].body}`).digest("hex");
  assert.equal(match![2], expected);
  assert.equal((await prisma.webhookDeliveryAttempt.count({ where: { deliveryId: delivery!.id } })), 1);
  await new Promise<void>((resolve, reject) => webhookServer.close((error) => error ? reject(error) : resolve()));
});

test("webhook delivery retries after a transient endpoint failure", async () => {
  let calls = 0;
  const webhookServer = createServer((_request, response) => {
    calls += 1;
    response.writeHead(calls === 1 ? 500 : 202).end();
  });
  await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const webhookAddress = webhookServer.address();
  assert.ok(webhookAddress && typeof webhookAddress !== "string");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Retry Webhook ${suffix}`, slug: `retry-webhook-${suffix}` } });
  const endpoint = await prisma.webhookEndpoint.create({
    data: { organizationId: organization.id, url: `http://127.0.0.1:${webhookAddress.port}/retry`, eventTypes: ["document.processing.completed"], encryptedSigningSecret: encryptSecret("whsec_retry_secret") },
  });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "retry-webhook.pdf", mimeType: "application/pdf", size: 100n, storageKey: `${sourceBaseUrl}/retry-webhook/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 1 });

  const deadline = Date.now() + 15000;
  let delivery = await prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
  while ((!delivery || delivery.status !== "SENT") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    delivery = await prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.id } });
  }
  assert.equal(delivery?.status, "SENT");
  assert.equal(delivery?.attempts, 2);
  assert.equal(calls, 2);
  const attempts = await prisma.webhookDeliveryAttempt.findMany({ where: { deliveryId: delivery!.id }, orderBy: { attempt: "asc" } });
  assert.deepEqual(attempts.map(({ attempt, responseStatus, error }) => ({ attempt, responseStatus, error })), [
    { attempt: 1, responseStatus: 500, error: "Webhook endpoint returned HTTP 500" },
    { attempt: 2, responseStatus: 202, error: null },
  ]);
  await new Promise<void>((resolve, reject) => webhookServer.close((error) => error ? reject(error) : resolve()));
});

function encryptSecret(secret: string) {
  const key = createHash("sha256").update(process.env.WEBHOOK_ENCRYPTION_KEY!).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

test("worker records terminal failures after exhausting its attempts", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Failed ${suffix}`, slug: `failed-${suffix}` } });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "failed.pdf", mimeType: "application/pdf", size: 100n, storageKey: `${sourceBaseUrl}/failed/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  const queueJob = await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 3, backoff: { type: "exponential", delay: 100 } });

  const deadline = Date.now() + 10000;
  let result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  let bullState = await queueJob.getState();
  while ((result.status !== "FAILED" || bullState !== "failed") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
    bullState = await queueJob.getState();
  }
  delete process.env.WORKER_FAIL_ATTEMPTS;
  assert.equal(bullState, "failed");
  assert.equal(result.status, "FAILED");
  assert.equal(result.attempts, 3);
  assert.equal(result.errorCode, "DOCUMENT_DOWNLOAD_FAILED");
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).status, "FAILED");
  assert.equal(await prisma.extractionResult.count({ where: { jobId: record.id } }), 0);
  const failedJobs = await failedQueue.getJobs(["waiting"]);
  assert.ok(failedJobs.some((failedJob) => failedJob.data.jobId === record.id));
});

test("worker retries invalid model output and records a terminal validation error", async () => {
  geminiResponseMode = "invalid";
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Invalid ${suffix}`, slug: `invalid-${suffix}` } });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "invalid.pdf", mimeType: "application/pdf", size: 100n, storageKey: `${sourceBaseUrl}/invalid/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 1 });

  const deadline = Date.now() + 10000;
  let result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  while (result.status !== "FAILED" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  }
  geminiResponseMode = "valid";
  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "INVALID_MODEL_RESPONSE");
  assert.equal(await prisma.extractionResult.count({ where: { jobId: record.id } }), 0);
});

test("worker retries transient failures with backoff and persists eventual completion", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Retry ${suffix}`, slug: `retry-${suffix}` } });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "retry.pdf", mimeType: "application/pdf", size: 100n, storageKey: `${sourceBaseUrl}/retry/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  await queue.add("process-document", { jobId: record.id, documentId: document.id }, { jobId: record.id, attempts: 3, backoff: { type: "exponential", delay: 100 } });

  const deadline = Date.now() + 10000;
  let result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  while ((result.status !== "COMPLETED" || result.attempts < 2) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = await prisma.processingJob.findUniqueOrThrow({ where: { id: record.id } });
  }
  delete process.env.WORKER_FAIL_ATTEMPTS;
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.attempts, 2);
});
