import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { createPrismaClient } from "@docuflow/database";
import { Queue } from "bullmq";
import { createApiApp } from "./app";
import { createRedisConnection, processingQueueName } from "./processing-queue";

let app: INestApplication;
let baseUrl: string;
let organizationId: string;
let accessToken: string;
const prisma = createPrismaClient();
const queue = new Queue(processingQueueName, { connection: createRedisConnection() });

before(async () => {
  process.env.JWT_SECRET ??= "docuflow-developer-test-secret-32-chars";
  app = await createApiApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `developer-${Date.now()}@example.test`, password: "correct-horse-battery-staple" }),
  });
  assert.equal(registration.status, 201);
  accessToken = (await registration.json() as { accessToken: string }).accessToken;
  const created = await fetch(`${baseUrl}/organizations`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ name: `Developer ${Date.now()}` }) });
  assert.equal(created.status, 201);
  organizationId = (await created.json() as { id: string }).id;
});

after(async () => {
  if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } });
  await app.close();
  await queue.close();
  await prisma.$disconnect();
});

async function request(path: string, options: { method?: string; token?: string; organization?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.organization ? { "x-organization-id": options.organization } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

test("API keys are only returned once, authenticate tenant APIs, and can be revoked", async () => {
  const created = await request("/api-keys", { method: "POST", token: accessToken, body: { organizationId, name: "Integration key" } });
  assert.equal(created.status, 201, await created.clone().text());
  const key = await created.json() as { id: string; secret: string; keyPrefix: string };
  assert.match(key.secret, /^df_live_/);
  assert.equal(key.keyPrefix, key.secret.slice(0, 16));
  const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
  assert.notEqual(stored.keyHash, key.secret);
  assert.equal(stored.keyHash.length, 64);

  const listed = await request("/api-keys", { token: accessToken, organization: organizationId });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json() as Array<Record<string, unknown>>;
  assert.equal(listedBody.length, 1);
  assert.equal("secret" in listedBody[0], false);

  const document = await prisma.document.create({ data: { organizationId, filename: "api-invoice.pdf", mimeType: "application/pdf", size: 12n, storageKey: `api-test/${Date.now()}.pdf`, status: "UPLOADED" } });
  const processed = await request(`/documents/${document.id}/process`, { method: "POST", token: key.secret, body: {} });
  assert.equal(processed.status, 202, await processed.clone().text());
  const job = await processed.json() as { id: string; status: string };
  assert.equal(job.status, "QUEUED");
  const status = await request(`/jobs/${job.id}`, { token: key.secret });
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { id: string }).id, job.id);

  const revoked = await request(`/api-keys/${key.id}`, { method: "DELETE", token: accessToken, organization: organizationId });
  assert.equal(revoked.status, 200);
  const denied = await request(`/jobs/${job.id}`, { token: key.secret });
  assert.equal(denied.status, 401);
});

test("key management requires an explicit organization scope", async () => {
  const listed = await request("/api-keys", { token: accessToken });
  assert.equal(listed.status, 400);
  const revoked = await request(`/api-keys/00000000-0000-0000-0000-000000000000`, { method: "DELETE", token: accessToken });
  assert.equal(revoked.status, 400);
  const webhooks = await request("/webhooks", { token: accessToken });
  assert.equal(webhooks.status, 400);
});

test("concurrent processing requests create exactly one job", async () => {
  const created = await request("/api-keys", { method: "POST", token: accessToken, body: { organizationId, name: "Concurrency key" } });
  assert.equal(created.status, 201);
  const key = await created.json() as { secret: string };
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const document = await prisma.document.create({
    data: { organizationId, filename: "concurrent.pdf", mimeType: "application/pdf", size: 12n, storageKey: `concurrency-test/${suffix}.pdf`, status: "UPLOADED" },
  });

  const responses = await Promise.all(Array.from({ length: 8 }, () => request(`/documents/${document.id}/process`, { method: "POST", token: key.secret, body: {} })));
  assert.ok(responses.every((response) => response.status === 202), responses.map((response) => response.status).join(","));
  const jobs = await Promise.all(responses.map(async (response) => await response.json() as { id: string }));
  assert.equal(new Set(jobs.map(({ id }) => id)).size, 1);
  assert.equal(await prisma.processingJob.count({ where: { documentId: document.id } }), 1);

  const queued = await queue.getJobs(["waiting"]);
  for (const job of queued.filter(({ data }) => data.documentId === document.id)) await job.remove();
});

test("usage summary is tenant scoped and webhooks protect endpoint secrets", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const document = await prisma.document.create({ data: { organizationId, filename: "usage.pdf", mimeType: "application/pdf", size: 12n, storageKey: `usage-test/${suffix}.pdf` } });
  const job = await prisma.processingJob.create({ data: { documentId: document.id } });
  await prisma.usageRecord.create({ data: { organizationId, jobId: job.id, inputTokens: 100, outputTokens: 25, processingDuration: 850 } });

  const usage = await request("/usage", { token: accessToken, organization: organizationId });
  assert.equal(usage.status, 200);
  const usageBody = await usage.json() as { totals: { processedDocuments: number; inputTokens: number; outputTokens: number; processingDurationMs: number } };
  assert.deepEqual(usageBody.totals, { processedDocuments: 1, inputTokens: 100, outputTokens: 25, processingDurationMs: 850 });

  const rejectedLocal = await request("/webhooks", { method: "POST", token: accessToken, body: { organizationId, url: "http://127.0.0.1:9000/hook", events: ["document.processing.completed"] } });
  assert.equal(rejectedLocal.status, 400);
  const webhookResponse = await request("/webhooks", { method: "POST", token: accessToken, body: { organizationId, url: "https://hooks.example.test/docuflow", events: ["document.processing.completed", "document.processing.failed"] } });
  assert.equal(webhookResponse.status, 201, await webhookResponse.clone().text());
  const webhook = await webhookResponse.json() as { id: string; signingSecret: string };
  assert.match(webhook.signingSecret, /^whsec_/);
  const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: webhook.id } });
  assert.notEqual(endpoint.encryptedSigningSecret, webhook.signingSecret);
  const endpoints = await request("/webhooks", { token: accessToken, organization: organizationId });
  assert.equal(endpoints.status, 200);
  assert.equal(JSON.stringify(await endpoints.json()).includes(webhook.signingSecret), false);
});
