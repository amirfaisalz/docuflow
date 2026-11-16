import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "prisma/config";

// Prisma CLI only reads .env from this package and the schema directory. The
// workspace keeps a single .env at the repo root, so load that one without
// overriding values already exported in the shell.
function loadRepoEnv(start: string) {
  let current = start;
  for (;;) {
    const candidate = resolve(current, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

loadRepoEnv(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // The fallback keeps `prisma generate` and `prisma validate` working during
    // builds that do not need a live database. The db:* scripts require a real
    // DATABASE_URL before they start, so migrations never hit this default.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/docuflow",
  },
});
