import { createLogger, errorFields, startTelemetry } from "@docuflow/observability";
import { createWorkerApp } from "./app";

const logger = createLogger({ service: "worker" });

async function bootstrap() {
  const telemetry = startTelemetry({ serviceName: "docuflow-worker" });
  const app = await createWorkerApp();
  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port, "0.0.0.0");
  logger.info("worker.listening", {
    port,
    telemetryEnabled: telemetry.enabled,
    environment: process.env.NODE_ENV ?? "development",
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    webhookConcurrency: Number(process.env.WEBHOOK_CONCURRENCY ?? 5),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker.shutdown", { signal });
    try {
      await app.close();
      await telemetry.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error("worker.shutdown.failed", { signal, ...errorFields(error) });
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error: unknown) => {
  logger.error("worker.bootstrap.failed", errorFields(error));
  process.exit(1);
});
