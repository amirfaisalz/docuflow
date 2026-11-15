import "reflect-metadata";
import { Controller, Get, Injectable, Module, OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Job, Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { createRedisConnection, processingQueueName } from "./processing-queue";
import { processDocument, ProcessingError } from "./document-processing";
import { createWebhookWorker, enqueueWebhookEvents, webhookQueueName } from "./webhooks";

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
  private readonly webhookQueue = new Queue(webhookQueueName, { connection: createRedisConnection() });
  private readonly webhookWorker = createWebhookWorker(this.prisma);
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
      const startedAt = Date.now();
      await this.prisma.document.update({ where: { id: job.data.documentId }, data: { status: "PROCESSING" } });
      const document = await this.prisma.document.findUniqueOrThrow({ where: { id: job.data.documentId } });
      const extraction = await processDocument({ storageKey: document.storageKey, mimeType: document.mimeType, filename: document.filename });
      await this.prisma.$transaction(async (tx) => {
        await tx.extractionResult.upsert({
          where: { jobId: job.data.jobId },
          create: {
            jobId: job.data.jobId,
            data: extraction.data,
            confidence: extraction.confidence ?? null,
            extractedText: extraction.extractedText,
            model: extraction.model,
          },
          update: {
            data: extraction.data,
            confidence: extraction.confidence ?? null,
            extractedText: extraction.extractedText,
            model: extraction.model,
          },
        });
        await tx.usageRecord.upsert({
          where: { jobId: job.data.jobId },
          create: { organizationId: document.organizationId, jobId: job.data.jobId, inputTokens: extraction.inputTokens, outputTokens: extraction.outputTokens, processingDuration: Date.now() - startedAt },
          update: { inputTokens: extraction.inputTokens, outputTokens: extraction.outputTokens, processingDuration: Date.now() - startedAt },
        });
        await tx.processingJob.updateMany({
          where: { id: job.data.jobId, status: "PROCESSING" },
          data: { status: "COMPLETED", errorCode: null, errorMessage: null },
        });
        await tx.document.update({ where: { id: job.data.documentId }, data: { status: "COMPLETED" } });
      });
      await enqueueWebhookEvents(this.prisma, this.webhookQueue, document.organizationId, "document.processing.completed", { documentId: document.id, jobId: job.data.jobId, status: "COMPLETED" }).catch(() => undefined);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        const message = error instanceof Error ? error.message : "Processing failed";
        const errorCode = error instanceof ProcessingError ? error.code : "PROCESSING_FAILED";
        await this.prisma.$transaction(async (tx) => {
          await tx.processingJob.updateMany({
            where: { id: job.data.jobId, status: "PROCESSING" },
            data: { status: "FAILED", errorCode, errorMessage: message.slice(0, 1000) },
          });
          await tx.document.updateMany({
            where: { id: job.data.documentId, status: { in: ["QUEUED", "PROCESSING"] } },
            data: { status: "FAILED" },
          });
        });
        await this.failedQueue.add("failed-document", { jobId: job.data.jobId, documentId: job.data.documentId, error: message }, { jobId: `${job.data.jobId}-${Date.now()}`, removeOnComplete: false });
        const document = await this.prisma.document.findUnique({ where: { id: job.data.documentId }, select: { organizationId: true } });
        if (document) await enqueueWebhookEvents(this.prisma, this.webhookQueue, document.organizationId, "document.processing.failed", { documentId: job.data.documentId, jobId: job.data.jobId, status: "FAILED", errorCode }).catch(() => undefined);
      }
      throw error;
    }
  }, { connection: createRedisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

  async onApplicationShutdown() {
    await this.worker.close();
    await this.webhookWorker.close();
    await this.webhookQueue.close();
    await this.failedQueue.close();
    await this.prisma.$disconnect();
  }
}

@Module({ controllers: [HealthController], providers: [ProcessingWorkerLifecycle] })
class WorkerModule {}

export async function createWorkerApp() {
  return NestFactory.create(WorkerModule, { logger: false });
}
