import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { createWorkerApp } from "./app";

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await createWorkerApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
});

test("GET /health reports worker service health", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "worker" });
});
