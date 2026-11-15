import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createReadinessReport, type ReadinessReport } from "@docuflow/observability";
import Redis from "ioredis";
import { createRedisConnection } from "./processing-queue";

@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly redis = new Redis({
    ...createRedisConnection(),
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => attempt > 3 ? null : Math.min(attempt * 200, 1000),
  });

  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {
    this.redis.on("error", () => undefined);
  }

  live() {
    return { status: "ok", service: "worker" } as const;
  }

  ready(): Promise<ReadinessReport> {
    return createReadinessReport([
      { name: "database", check: () => this.prisma.$queryRaw`SELECT 1` },
      {
        name: "redis",
        check: async () => {
          if (this.redis.status === "wait" || this.redis.status === "end") await this.redis.connect();
          if ((await this.redis.ping()) !== "PONG") throw new Error("Redis ping failed");
        },
      },
    ]);
  }

  async onApplicationShutdown() {
    this.redis.disconnect();
  }
}
