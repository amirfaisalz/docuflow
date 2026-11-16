#!/usr/bin/env node
// Prisma CLI only reads .env from its own working directory (packages/database)
// and the schema directory. This workspace keeps a single .env at the repo root,
// so load that first without overriding anything already exported in the shell.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(start) {
  let current = start;
  for (;;) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(findRepoRoot(here), ".env");

if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.warn(`Could not load ${envPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!process.env.DATABASE_URL) {
  console.error(
    `DATABASE_URL is not set. Add it to ${envPath} or export it in this shell before running Prisma.`,
  );
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/load-root-env.mjs <command> [args...]");
  process.exit(1);
}

const child = spawn(command, args, { stdio: "inherit", env: process.env });

child.on("error", (error) => {
  console.error(`Could not start ${command}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
