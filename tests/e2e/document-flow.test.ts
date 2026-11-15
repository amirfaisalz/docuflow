import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const cloudName = "docuflow-e2e";
const cloudinaryApiKey = "e2e-cloudinary-key";
const cloudinaryApiSecret = "e2e-cloudinary-secret";
const queueName = `docuflow-e2e-${suffix}`;

let api: INestApplication;
let worker: INestApplication;
let baseUrl: string;
let cloudinary: Server;
let cloudinaryUrl: string;
let gemini: Server;
let source: Server;
let sourceUrl: string;
const assets = new Map<string, { bytes: number; format: string; resource_type: string; public_id: string }>();

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  cloudinary = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = decodeURIComponent(new URL(request.url ?? "/", cloudinaryUrl).pathname);
    if (request.method === "GET" && /^\/v1_1\/docuflow-e2e\/resources\/(image|raw)\/authenticated\//.test(path)) {
      if (request.headers.authorization !== `Basic ${Buffer.from(`${cloudinaryApiKey}:${cloudinaryApiSecret}`).toString("base64")}`) {
        response.writeHead(401).end();
        return;
      }
      const publicId = decodeURIComponent(path.replace(/^\/v1_1\/docuflow-e2e\/resources\/(image|raw)\/authenticated\//, ""));
      const asset = assets.get(publicId);
      response.writeHead(asset ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(asset ?? { error: { message: "Not found" } }));
      return;
    }
    if (request.method === "POST" && /^\/v1_1\/docuflow-e2e\/(image|raw)\/upload$/.test(path)) {
      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const publicId = `${params.get("folder")}/${params.get("public_id")}`;
      const signature = params.get("signature") ?? "";
      const signedParams = Object.fromEntries([...params.entries()].filter(([key]) => !["file", "api_key", "signature"].includes(key)));
      const canonical = Object.entries(signedParams).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
      const expected = createHash("sha1").update(`${canonical}${cloudinaryApiSecret}`).digest("hex");
      const file = params.get("file") ?? "";
      const match = /^data:application\/pdf;base64,(.+)$/.exec(file);
      if (params.get("api_key") !== cloudinaryApiKey || signature !== expected || params.get("type") !== "authenticated" || !match) {
        response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Invalid signed upload" }));
        return;
      }
      assets.set(publicId, { bytes: Buffer.from(match[1], "base64").length, format: "pdf", resource_type: path.includes("/raw/") ? "raw" : "image", public_id: publicId });
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ public_id: publicId }));
      return;
    }
    response.writeHead(404).end();
  });
  cloudinaryUrl = await listen(cloudinary);

  gemini = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> };
    const input = parsed.contents[0].parts.find((part) => part.inlineData);
    if (request.method !== "POST" || request.url !== "/v1beta/models/test-e2e-model:generateContent?key=test-e2e-key" || !input?.inlineData || input.inlineData.data.length === 0) {
      response.writeHead(400).end(JSON.stringify({ error: "unexpected Gemini request" }));
      return;
    }
    const payload = {
      extractedText: "Invoice INV-E2E-001 from Example Company. Total USD 1250.",
      data: { invoiceNumber: "INV-E2E-001", vendor: "Example Company", invoiceDate: "2026-11-15", total: 1250, currency: "USD" },
      confidence: 0.97,
    };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 45 },
    }));
  });
  const geminiUrl = await listen(gemini);

  source = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/pdf" }).end("Invoice INV-E2E-001 from Example Company. Total USD 1250.");
  });
  sourceUrl = await listen(source);

  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/docuflow?schema=public",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: process.env.JWT_SECRET ?? "docuflow-local-test-secret-change-me-32chars",
    WEBHOOK_ENCRYPTION_KEY: "docuflow-e2e-webhook-encryption-key-32",
    PROCESSING_QUEUE_NAME: queueName,
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: cloudinaryApiKey,
    CLOUDINARY_API_SECRET: cloudinaryApiSecret,
    CLOUDINARY_API_BASE_URL: cloudinaryUrl,
    DOCUMENT_SOURCE_BASE_URL: sourceUrl,
    GEMINI_API_KEY: "test-e2e-key",
    GEMINI_API_BASE_URL: `${geminiUrl}/v1beta`,
    GEMINI_MODEL: "test-e2e-model",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "error",
  });

  const [{ createApiApp }, { createWorkerApp }] = await Promise.all([
    import("../../apps/api/src/app"),
    import("../../apps/worker/src/app"),
  ]);
  api = await createApiApp();
  await api.listen(0, "127.0.0.1");
  const address = api.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  worker = await createWorkerApp();
  await worker.listen(0, "127.0.0.1");
});

after(async () => {
  await api?.close();
  await worker?.close();
  await new Promise<void>((resolve, reject) => cloudinary.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => gemini.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => source.close((error) => error ? reject(error) : resolve()));
});

async function request(path: string, options: { token?: string; organizationId?: string; body?: unknown; method?: string } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.organizationId ? { "x-organization-id": options.organizationId } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return response;
}

async function createTenant(label: string) {
  const registration = await request("/api/v1/auth/register", { body: { email: `${label}-${suffix}@example.test`, password: "correct-horse-battery-staple" } });
  assert.equal(registration.status, 201);
  const { accessToken } = await registration.json() as { accessToken: string };
  const organizationResponse = await request("/api/v1/organizations", { token: accessToken, body: { name: `E2E ${label}` } });
  assert.equal(organizationResponse.status, 201);
  const organization = await organizationResponse.json() as { id: string };
  return { accessToken, organizationId: organization.id };
}

test("a document flows from upload through API-key processing, extraction, usage, and revocation", async () => {
  const tenant = await createTenant("e2e");
  const outsider = await createTenant("outsider");

  const keyResponse = await request("/api/v1/api-keys", { token: tenant.accessToken, body: { organizationId: tenant.organizationId, name: "E2E integration" } });
  assert.equal(keyResponse.status, 201);
  const apiKey = await keyResponse.json() as { id: string; secret: string; keyPrefix: string };
  assert.match(apiKey.secret, /^df_live_/);

  const uploadResponse = await request("/api/v1/documents/upload-url", {
    token: tenant.accessToken,
    body: { organizationId: tenant.organizationId, filename: "invoice.pdf", mimeType: "application/pdf", size: 1024 },
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json() as { document: { id: string }; upload: { url: string; apiKey: string; params: Record<string, string> } };
  const storageUpload = await fetch(upload.upload.url, {
    method: "POST",
    body: new URLSearchParams({ ...upload.upload.params, api_key: upload.upload.apiKey, file: `data:application/pdf;base64,${Buffer.alloc(1024, "a").toString("base64")}` }),
  });
  assert.equal(storageUpload.status, 200);

  const confirmation = await request(`/api/v1/documents/${upload.document.id}/complete-upload`, { token: tenant.accessToken, body: {} });
  assert.equal(confirmation.status, 200);

  const processResponse = await request(`/api/v1/documents/${upload.document.id}/process`, { token: apiKey.secret, body: {} });
  assert.equal(processResponse.status, 202);
  const queued = await processResponse.json() as { id: string; status: string };
  assert.equal(queued.status, "QUEUED");

  let job = queued;
  const deadline = Date.now() + 20000;
  while (job.status !== "COMPLETED" && job.status !== "FAILED" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const statusResponse = await request(`/api/v1/jobs/${job.id}`, { token: apiKey.secret });
    assert.equal(statusResponse.status, 200);
    job = await statusResponse.json() as typeof job;
  }
  assert.equal(job.status, "COMPLETED");

  const jobResponse = await request(`/api/v1/jobs/${job.id}`, { token: apiKey.secret });
  const jobBody = await jobResponse.json() as { status: string; result: { data: { invoiceNumber: string; total: number; currency: string }; confidence: number; model: string } };
  assert.equal(jobBody.status, "COMPLETED");
  assert.deepEqual(jobBody.result.data, { invoiceNumber: "INV-E2E-001", vendor: "Example Company", invoiceDate: "2026-11-15", total: 1250, currency: "USD" });
  assert.equal(jobBody.result.confidence, 0.97);
  assert.equal(jobBody.result.model, "test-e2e-model");

  const usageResponse = await request("/api/v1/usage", { token: apiKey.secret });
  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json() as { organizationId: string; totals: { processedDocuments: number; inputTokens: number; outputTokens: number; processingDurationMs: number } };
  assert.equal(usage.organizationId, tenant.organizationId);
  assert.ok(usage.totals.processedDocuments >= 1);
  assert.equal(usage.totals.inputTokens, 321);
  assert.equal(usage.totals.outputTokens, 45);
  assert.ok(usage.totals.processingDurationMs >= 0);

  const outsiderResponse = await request(`/api/v1/jobs/${job.id}`, { token: outsider.accessToken });
  assert.equal(outsiderResponse.status, 404);

  const revokeResponse = await request(`/api/v1/api-keys/${apiKey.id}`, { token: tenant.accessToken, organizationId: tenant.organizationId, method: "DELETE" });
  assert.equal(revokeResponse.status, 200);
  const revokedUsage = await request("/api/v1/usage", { token: apiKey.secret });
  assert.equal(revokedUsage.status, 401);
});
