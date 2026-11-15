import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

export interface TelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  enabled?: boolean;
}

export interface TelemetryHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

const disabledHandle: TelemetryHandle = { enabled: false, shutdown: async () => undefined };

/**
 * Starts the OpenTelemetry Node SDK when an OTLP endpoint is configured.
 * Instrumentation is opt-in so local development and tests do not require a collector.
 */
export function startTelemetry(options: TelemetryOptions): TelemetryHandle {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const enabled = options.enabled ?? (process.env.OTEL_SDK_DISABLED !== "true" && Boolean(endpoint));
  if (!enabled) return disabledHandle;

  try {
    const sdk = new NodeSDK({
      serviceName: options.serviceName,
      resource: resourceFromAttributes({
        "service.name": options.serviceName,
        "service.version": options.serviceVersion ?? "0.1.0",
        "deployment.environment.name": process.env.NODE_ENV ?? "development",
      }),
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [],
    });
    sdk.start();
    return {
      enabled: true,
      shutdown: async () => {
        try {
          await sdk.shutdown();
        } catch {
          // Telemetry shutdown must never take the service down.
        }
      },
    };
  } catch {
    return disabledHandle;
  }
}
