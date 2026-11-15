import { after, before, test } from "node:test";
import assert from "node:assert/strict";
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

before(async () => {
  app = await createWorkerApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
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
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "worker.pdf", mimeType: "application/pdf", size: 100n, storageKey: `worker/${suffix}.pdf`, status: "QUEUED" } });
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
});

test("worker records terminal failures after exhausting its attempts", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Failed ${suffix}`, slug: `failed-${suffix}` } });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "failed.pdf", mimeType: "application/pdf", size: 100n, storageKey: `failed/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  process.env.WORKER_FAIL_ATTEMPTS = "5";
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
  assert.equal(result.errorCode, "PROCESSING_FAILED");
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).status, "FAILED");
  const failedJobs = await failedQueue.getJobs(["waiting"]);
  assert.ok(failedJobs.some((failedJob) => failedJob.data.jobId === record.id));
});

test("worker retries transient failures with backoff and persists eventual completion", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `Retry ${suffix}`, slug: `retry-${suffix}` } });
  const document = await prisma.document.create({ data: { organizationId: organization.id, filename: "retry.pdf", mimeType: "application/pdf", size: 100n, storageKey: `retry/${suffix}.pdf`, status: "QUEUED" } });
  const record = await prisma.processingJob.create({ data: { documentId: document.id } });
  process.env.WORKER_FAIL_ATTEMPTS = "1";
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
