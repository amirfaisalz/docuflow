import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./logger";
import { createReadinessReport } from "./health";

function capture(level?: string) {
  const lines: Array<{ level: string; entry: Record<string, unknown> }> = [];
  const logger = createLogger({
    service: "test-service",
    level,
    now: () => new Date("2026-11-15T10:00:00.000Z"),
    write: (line, logLevel) => lines.push({ level: logLevel, entry: JSON.parse(line) as Record<string, unknown> }),
  });
  return { logger, lines };
}

test("structured logger emits JSON with service, timestamp, and trace-safe fields", () => {
  const { logger, lines } = capture("debug");
  logger.child({ requestId: "req_123" }).info("http.request", { statusCode: 200, durationMs: 12 });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].entry, {
    timestamp: "2026-11-15T10:00:00.000Z",
    level: "info",
    service: "test-service",
    message: "http.request",
    requestId: "req_123",
    statusCode: 200,
    durationMs: 12,
  });
});

test("structured logger redacts credentials and serializes errors", () => {
  const { logger, lines } = capture("debug");
  logger.error("request.failed", {
    authorization: "Bearer secret-token",
    apiKey: "df_live_example",
    signingSecret: "whsec_example",
    nested: { password: "hunter2", safe: "visible" },
    error: new Error("boom"),
  });
  const entry = lines[0].entry as { authorization: string; apiKey: string; signingSecret: string; nested: Record<string, unknown>; error: Record<string, unknown> };
  assert.equal(entry.authorization, "[REDACTED]");
  assert.equal(entry.apiKey, "[REDACTED]");
  assert.equal(entry.signingSecret, "[REDACTED]");
  assert.deepEqual(entry.nested, { password: "[REDACTED]", safe: "visible" });
  assert.equal(entry.error.message, "boom");
  assert.equal(entry.error.name, "Error");
});

test("structured logger respects the configured level", () => {
  const { logger, lines } = capture("warn");
  logger.debug("debug.message");
  logger.info("info.message");
  logger.warn("warn.message");
  logger.error("error.message");
  assert.deepEqual(lines.map(({ entry }) => entry.message), ["warn.message", "error.message"]);
});

test("readiness reports dependency health without leaking failure details", async () => {
  const healthy = await createReadinessReport([
    { name: "database", check: async () => true },
    { name: "redis", check: async () => "PONG" },
  ]);
  assert.deepEqual(healthy, { status: "ok", checks: { database: "up", redis: "up" } });

  const degraded = await createReadinessReport([
    { name: "database", check: async () => true },
    { name: "redis", check: async () => { throw new Error("connection refused"); } },
  ]);
  assert.deepEqual(degraded, { status: "error", checks: { database: "up", redis: "down" } });
});
