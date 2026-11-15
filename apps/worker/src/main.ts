import { createWorkerApp } from "./app";

async function bootstrap() {
  const app = await createWorkerApp();
  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
