import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "api" };
  }
}

@Module({ controllers: [HealthController] })
class ApiModule {}

export async function createApiApp() {
  return NestFactory.create(ApiModule, { logger: false });
}
