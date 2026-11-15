import { context, trace } from "@opentelemetry/api";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel | string;
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey = /(secret|token|password|authorization|api[-_]?key|signing[-_]?secret|key[-_]?hash|credential)/i;
// Token *counts* are safe operational metrics, unlike credentials whose names also contain "token".
const safeMetricKeys = new Set(["inputTokens", "outputTokens", "tokenCount", "promptTokenCount", "candidatesTokenCount", "maxTokens"]);
const maxDepth = 6;

function normalizeLevel(value: string | undefined): LogLevel {
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : "info";
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > maxDepth) return "[Truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = !safeMetricKeys.has(key) && sensitiveKey.test(key) ? "[REDACTED]" : redact(item, depth + 1);
  }
  return result;
}

function traceFields() {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  if (!spanContext.traceId || spanContext.traceId === "00000000000000000000000000000000") return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

function defaultWrite(line: string, level: LogLevel) {
  const target = level === "error" || level === "warn" ? process.stderr : process.stdout;
  target.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = levelRank[normalizeLevel(options.level ?? process.env.LOG_LEVEL)];
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());

  const loggerFor = (bindings: LogFields): Logger => {
    const emit = (level: LogLevel, message: string, fields?: LogFields) => {
      if (levelRank[level] < threshold) return;
      const line = JSON.stringify({
        timestamp: now().toISOString(),
        level,
        service: options.service,
        message,
        ...traceFields(),
        ...(redact(bindings) as LogFields),
        ...(fields ? (redact(fields) as LogFields) : {}),
      });
      write(line, level);
    };
    return {
      debug: (message, fields) => emit("debug", message, fields),
      info: (message, fields) => emit("info", message, fields),
      warn: (message, fields) => emit("warn", message, fields),
      error: (message, fields) => emit("error", message, fields),
      child: (childBindings) => loggerFor({ ...bindings, ...childBindings }),
    };
  };

  return loggerFor({});
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  return { errorMessage: String(error) };
}
