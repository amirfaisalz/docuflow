import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { createApiApp } from "./app";

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await createApiApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
});

test("GET /health reports API service health", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "api" });
});

test("GET /health/live and /health/ready expose liveness and dependency readiness", async () => {
  const live = await fetch(`${baseUrl}/health/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: "ok", service: "api" });
  assert.ok(live.headers.get("x-request-id"));

  const ready = await fetch(`${baseUrl}/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ok", checks: { database: "up", redis: "up" }, service: "api" });
});
