import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "worker" };
  }
}

@Module({ controllers: [HealthController] })
class WorkerModule {}

export async function createWorkerApp() {
  return NestFactory.create(WorkerModule, { logger: false });
}
