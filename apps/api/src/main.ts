import { createApiApp } from "./app";

async function bootstrap() {
  const app = await createApiApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
