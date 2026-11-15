import { createLogger, errorFields, startTelemetry } from "@docuflow/observability";
import { createApiApp } from "./app";

const logger = createLogger({ service: "api" });

async function bootstrap() {
  const telemetry = startTelemetry({ serviceName: "docuflow-api" });
  const app = await createApiApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  logger.info("api.listening", { port, telemetryEnabled: telemetry.enabled, environment: process.env.NODE_ENV ?? "development" });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("api.shutdown", { signal });
    try {
      await app.close();
      await telemetry.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error("api.shutdown.failed", { signal, ...errorFields(error) });
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error: unknown) => {
  logger.error("api.bootstrap.failed", errorFields(error));
  process.exit(1);
});
