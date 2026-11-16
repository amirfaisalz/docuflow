import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export * from "../generated/prisma/client.js";

/**
 * Prisma 7 requires a driver adapter. Centralising construction keeps the API,
 * the worker, and the tests on the same connection settings and makes sure the
 * DATABASE_URL check happens with a useful error message.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; cannot create the Prisma client");
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
