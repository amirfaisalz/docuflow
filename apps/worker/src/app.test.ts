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
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }));
  });
  await new Promise<void>((resolve) => geminiMock.listen(0, "127.0.0.1", resolve));
  const geminiAddress = geminiMock.address();
  assert.ok(geminiAddress && typeof geminiAddress !== "string");
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
  await new Promise<void>((resolve, reject) => source.close((error) => error ? reject(error) : resolve()));
});

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
