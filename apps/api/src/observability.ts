import { randomUUID } from "node:crypto";
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { createLogger } from "@docuflow/observability";

const logger = createLogger({ service: "api" });
const tracer = trace.getTracer("docuflow-api");

interface ObservableRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ObservableResponse {
  statusCode: number;
  writableFinished?: boolean;
  setHeader(name: string, value: string): void;
  once(event: "finish" | "close", listener: () => void): void;
}

export function requestObservability(request: ObservableRequest, response: ObservableResponse, next: () => void) {
  const method = request.method ?? "GET";
  const path = (request.originalUrl ?? request.url ?? "/").split("?")[0];
  const header = request.headers["x-request-id"];
  const requestId = typeof header === "string" && header.length > 0 && header.length <= 128 ? header : randomUUID();
  const startedAt = Date.now();
  response.setHeader("x-request-id", requestId);

  const parentContext = propagation.extract(context.active(), request.headers);
  const span = tracer.startSpan(
    `${method} ${path}`,
    {
      attributes: {
        "http.request.method": method,
        "url.path": path,
        "http.request.id": requestId,
      },
    },
    parentContext,
  );
  const { traceId, spanId } = span.spanContext();
  const traceFields = traceId === "00000000000000000000000000000000" ? {} : { traceId, spanId };
  let logged = false;

  const finish = (aborted: boolean) => {
    if (logged) return;
    logged = true;
    const durationMs = Date.now() - startedAt;
    span.setAttribute("http.response.status_code", response.statusCode);
    if (aborted) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "client closed connection" });
      logger.warn("http.request.aborted", { requestId, ...traceFields, method, path, statusCode: response.statusCode, durationMs });
    } else if (response.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.statusCode}` });
      logger.error("http.request.failed", { requestId, ...traceFields, method, path, statusCode: response.statusCode, durationMs });
    } else {
      const fields = { requestId, ...traceFields, method, path, statusCode: response.statusCode, durationMs };
      if (response.statusCode >= 400) logger.warn("http.request.rejected", fields);
      else logger.info("http.request.completed", fields);
    }
    span.end();
  };

  response.once("finish", () => finish(false));
  response.once("close", () => finish(!response.writableFinished));

  context.with(trace.setSpan(parentContext, span), next);
}
