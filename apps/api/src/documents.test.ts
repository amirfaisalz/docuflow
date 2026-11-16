import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { createPrismaClient } from "@docuflow/database";
import { Queue } from "bullmq";
import { createApiApp } from "./app";
import { createRedisConnection, processingQueueName } from "./processing-queue";

const cloudName = "docuflow-test";
const apiKey = "test-cloudinary-key";
const apiSecret = "test-cloudinary-secret";
let cloudinary: Server;
let cloudinaryUrl: string;
let app: INestApplication;
let baseUrl: string;
const cloudAssets = new Map<string, { bytes: number; format: string; resource_type: string; public_id: string }>;
const prisma = createPrismaClient();
const processingQueue = new Queue(processingQueueName, { connection: createRedisConnection() });

before(async () => {
  cloudinary = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = decodeURIComponent(new URL(request.url ?? "/", cloudinaryUrl).pathname);
    if (request.method === "GET" && /^\/v1_1\/docuflow-test\/resources\/(image|raw)\/authenticated\//.test(path)) {
      if (request.headers.authorization !== `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`) {
        response.writeHead(401);
        response.end();
        return;
      }
      const publicId = decodeURIComponent(path.replace(/^\/v1_1\/docuflow-test\/resources\/(image|raw)\/authenticated\//, ""));
      const asset = cloudAssets.get(publicId);
      response.writeHead(asset ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(asset ?? { error: { message: "Not found" } }));
      return;
    }
    if (request.method === "POST" && /^\/v1_1\/docuflow-test\/(image|raw)\/upload$/.test(path)) {
      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const publicId = `${params.get("folder")}/${params.get("public_id")}`;
      const signature = params.get("signature") ?? "";
      const signedParams = Object.fromEntries([...params.entries()].filter(([key]) => !["file", "api_key", "signature"].includes(key)));
      const canonical = Object.entries(signedParams).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
      const expected = createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
      const file = params.get("file") ?? "";
      const match = /^data:application\/pdf;base64,(.+)$/.exec(file);
      if (params.get("api_key") !== apiKey || signature !== expected || params.get("type") !== "authenticated" || !match) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Invalid signed upload" }));
        return;
      }
      cloudAssets.set(publicId, {
        bytes: Buffer.from(match[1], "base64").length,
        format: "pdf",
        resource_type: path.includes("/raw/") ? "raw" : "image",
        public_id: publicId,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ public_id: publicId }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => cloudinary.listen(0, "127.0.0.1", resolve));
  const address = cloudinary.address();
  assert.ok(address && typeof address !== "string");
  cloudinaryUrl = `http://127.0.0.1:${address.port}`;
  process.env.CLOUDINARY_CLOUD_NAME = cloudName;
  process.env.CLOUDINARY_API_KEY = apiKey;
  process.env.CLOUDINARY_API_SECRET = apiSecret;
  process.env.CLOUDINARY_API_BASE_URL = cloudinaryUrl;
  app = await createApiApp();
  await app.listen(0, "127.0.0.1");
  const apiAddress = app.getHttpServer().address();
  assert.ok(apiAddress && typeof apiAddress !== "string");
  baseUrl = `http://127.0.0.1:${apiAddress.port}/api/v1`;
});

after(async () => {
  await app.close();
  await processingQueue.obliterate({ force: true });
  await processingQueue.close();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => cloudinary.close((error) => error ? reject(error) : resolve()));
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  delete process.env.CLOUDINARY_API_BASE_URL;
});

async function request(path: string, token?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createTenant(email: string) {
  const registration = await request("/auth/register", undefined, { email, password: "correct-horse-battery-staple" });
  assert.equal(registration.status, 201);
  const { accessToken } = await registration.json() as { accessToken: string };
  const organizationResponse = await request("/organizations", accessToken, { name: `Docs ${email}` });
  assert.equal(organizationResponse.status, 201);
  const organization = await organizationResponse.json() as { id: string };
  return { accessToken, organizationId: organization.id };
}

test("members request a signed Cloudinary upload, confirm verified assets, and list tenant documents", async () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenant = await createTenant(`docs-${nonce}@example.test`);
  const outsider = await createTenant(`outsider-${nonce}@example.test`);

  const uploadResponse = await request("/documents/upload-url", tenant.accessToken, {
    organizationId: tenant.organizationId,
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    size: 2048,
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json() as {
    document: { id: string; filename: string; mimeType: string; size: number; status: string };
    upload: { url: string; apiKey: string; params: Record<string, string> };
  };
  assert.equal(upload.document.filename, "invoice.pdf");
  assert.equal(upload.document.size, 2048);
  assert.equal(upload.document.status, "PENDING_UPLOAD");
  assert.equal(upload.upload.url, `${cloudinaryUrl}/v1_1/${cloudName}/raw/upload`);
  assert.equal(upload.upload.apiKey, apiKey);
  const { signature, ...signedParams } = upload.upload.params;
  const expectedSignature = createHash("sha1")
    .update(`${Object.entries(signedParams).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")}${apiSecret}`)
    .digest("hex");
  assert.equal(signature, expectedSignature);
  assert.equal(upload.upload.params.public_id, `${upload.document.id}.pdf`);
  assert.equal(upload.upload.params.folder, `docuflow/${tenant.organizationId}`);
  assert.equal(upload.upload.params.overwrite, "false");
  assert.equal(upload.upload.params.type, "authenticated");

  const beforeConfirmation = await request(`/documents/${upload.document.id}`, tenant.accessToken);
  assert.equal(beforeConfirmation.status, 200);
  assert.equal((await beforeConfirmation.json() as { status: string }).status, "PENDING_UPLOAD");

  const clientUploadParams = new URLSearchParams({
    ...upload.upload.params,
    api_key: upload.upload.apiKey,
    file: `data:application/pdf;base64,${Buffer.alloc(2048, "a").toString("base64")}`,
  });
  const storageUpload = await fetch(upload.upload.url, { method: "POST", body: clientUploadParams });
  assert.equal(storageUpload.status, 200, await storageUpload.clone().text());

  const confirmation = await request(`/documents/${upload.document.id}/complete-upload`, tenant.accessToken, {});
  assert.equal(confirmation.status, 200, await confirmation.clone().text());
  const confirmedDocument = await confirmation.json() as { id: string; status: string };
  assert.ok(["QUEUED", "PROCESSING", "COMPLETED"].includes(confirmedDocument.status));
  const duplicateConfirmation = await request(`/documents/${upload.document.id}/complete-upload`, tenant.accessToken, {});
  assert.equal(duplicateConfirmation.status, 200);
  assert.ok(["QUEUED", "PROCESSING", "COMPLETED"].includes((await duplicateConfirmation.json() as { status: string }).status));

  const documentJobsResponse = await request(`/documents/${upload.document.id}/jobs`, tenant.accessToken);
  assert.equal(documentJobsResponse.status, 200);
  const jobs = await documentJobsResponse.json() as Array<{ id: string; documentId: string; status: string }>;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].documentId, upload.document.id);
  assert.ok(["QUEUED", "PROCESSING", "COMPLETED"].includes(jobs[0].status));

  await processingQueue.remove(jobs[0].id);
  await prisma.processingJob.update({ where: { id: jobs[0].id }, data: { status: "FAILED", errorCode: "TEST_FAILURE", errorMessage: "retry test" } });
  await prisma.document.update({ where: { id: upload.document.id }, data: { status: "FAILED" } });
  await prisma.extractionResult.create({ data: { jobId: jobs[0].id, data: { invoiceNumber: "INV-2026-001", total: 1250 }, confidence: 0.94, extractedText: "Invoice INV-2026-001. Total USD 1250.", model: "gemini-2.5-flash" } });

  const jobResponse = await request(`/jobs/${jobs[0].id}`, tenant.accessToken);
  assert.equal(jobResponse.status, 200);
  const jobBody = await jobResponse.json() as { id: string; status: string; errorCode: string; result: { data: unknown; confidence: number; extractedText: string; model: string } };
  assert.equal(jobBody.id, jobs[0].id);
  assert.equal(jobBody.status, "FAILED");
  assert.equal(jobBody.errorCode, "TEST_FAILURE");
  assert.deepEqual(jobBody.result.data, { invoiceNumber: "INV-2026-001", total: 1250 });
  assert.equal(jobBody.result.confidence, 0.94);
  assert.equal(jobBody.result.extractedText, "Invoice INV-2026-001. Total USD 1250.");
  assert.equal(jobBody.result.model, "gemini-2.5-flash");

  const retryResponse = await request(`/jobs/${jobs[0].id}/retry`, tenant.accessToken, {});
  assert.equal(retryResponse.status, 202);
  assert.equal((await retryResponse.json() as { status: string }).status, "QUEUED");
  const retriedDocument = await request(`/documents/${upload.document.id}`, tenant.accessToken);
  assert.ok(["QUEUED", "PROCESSING", "COMPLETED"].includes((await retriedDocument.json() as { status: string }).status));

  const outsiderJobResponse = await request(`/jobs/${jobs[0].id}`, outsider.accessToken);
  assert.equal(outsiderJobResponse.status, 404);

  const listing = await request("/documents", tenant.accessToken);
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json() as Array<{ id: string }>).map(({ id }) => id), [upload.document.id]);

  const crossTenant = await request(`/documents/${upload.document.id}`, outsider.accessToken);
  assert.equal(crossTenant.status, 404);
});

test("document uploads reject unsupported types, invalid sizes, and unverified assets", async () => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenant = await createTenant(`validation-${nonce}@example.test`);

  const unsupported = await request("/documents/upload-url", tenant.accessToken, {
    organizationId: tenant.organizationId, filename: "notes.txt", mimeType: "text/plain", size: 100,
  });
  assert.equal(unsupported.status, 400);

  const oversized = await request("/documents/upload-url", tenant.accessToken, {
    organizationId: tenant.organizationId, filename: "large.pdf", mimeType: "application/pdf", size: 10 * 1024 * 1024 + 1,
  });
  assert.equal(oversized.status, 400);

  const uploadResponse = await request("/documents/upload-url", tenant.accessToken, {
    organizationId: tenant.organizationId, filename: "invoice.pdf", mimeType: "application/pdf", size: 2048,
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json() as {
    document: { id: string };
    upload: { url: string; apiKey: string; params: Record<string, string> };
  };
  const tamperedParams = { ...upload.upload.params, folder: "attacker-folder" };
  const storageUpload = await fetch(upload.upload.url, {
    method: "POST",
    body: new URLSearchParams({ ...tamperedParams, api_key: upload.upload.apiKey, file: `data:application/pdf;base64,${Buffer.alloc(2048).toString("base64")}` }),
  });
  assert.equal(storageUpload.status, 401);
  const mismatch = await request(`/documents/${upload.document.id}/complete-upload`, tenant.accessToken, {});
  assert.equal(mismatch.status, 400);
  assert.equal((await request(`/documents/${upload.document.id}`, tenant.accessToken).then((response) => response.json()) as { status: string }).status, "PENDING_UPLOAD");
});
