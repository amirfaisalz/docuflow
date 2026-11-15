import "reflect-metadata";
import { Controller, Get, Injectable, Module, OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Job, Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { createRedisConnection, processingQueueName } from "./processing-queue";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "worker" };
  }
}

@Injectable()
class ProcessingWorkerLifecycle implements OnApplicationShutdown {
  private readonly prisma = new PrismaClient();
  private readonly failedQueue = new Queue(`${processingQueueName}-failed`, { connection: createRedisConnection() });
  private readonly worker = new Worker(processingQueueName, async (job: Job<{ jobId: string; documentId: string }>) => {
    const processing = await this.prisma.processingJob.updateMany({
      where: {
        id: job.data.jobId,
        status: { in: ["QUEUED", "PROCESSING"] },
        attempts: job.attemptsMade,
      },
      data: { status: "PROCESSING", attempts: job.attemptsMade + 1 },
    });
    if (processing.count === 0) return;
    try {
      await this.prisma.document.update({ where: { id: job.data.documentId }, data: { status: "PROCESSING" } });
      const forcedFailures = Number(process.env.WORKER_FAIL_ATTEMPTS ?? 0);
      if (job.attemptsMade < forcedFailures) throw new Error("Configured processing failure");

      // Milestone 4 placeholder: OCR and extraction are implemented in Milestone 5.
      await this.prisma.$transaction(async (tx) => {
        await tx.processingJob.updateMany({
          where: { id: job.data.jobId, status: "PROCESSING" },
          data: { status: "COMPLETED", errorCode: null, errorMessage: null },
        });
        await tx.document.update({ where: { id: job.data.documentId }, data: { status: "COMPLETED" } });
      });
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const message = error instanceof Error ? error.message : "Processing failed";
        await this.prisma.$transaction(async (tx) => {
          await tx.processingJob.updateMany({
            where: { id: job.data.jobId, status: "PROCESSING" },
            data: { status: "FAILED", errorCode: "PROCESSING_FAILED", errorMessage: message.slice(0, 1000) },
          });
          await tx.document.updateMany({
            where: { id: job.data.documentId, status: { in: ["QUEUED", "PROCESSING"] } },
            data: { status: "FAILED" },
          });
        });
        await this.failedQueue.add("failed-document", { jobId: job.data.jobId, documentId: job.data.documentId, error: message }, { jobId: `${job.data.jobId}-${Date.now()}`, removeOnComplete: false });
      }
      throw error;
    }
  }, { connection: createRedisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

  async onApplicationShutdown() {
    await this.worker.close();
    await this.failedQueue.close();
    await this.prisma.$disconnect();
  }
}

@Module({ controllers: [HealthController], providers: [ProcessingWorkerLifecycle] })
class WorkerModule {}

export async function createWorkerApp() {
  return NestFactory.create(WorkerModule, { logger: false });
}
