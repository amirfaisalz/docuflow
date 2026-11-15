import "reflect-metadata";
import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AuthTenancyService } from "./auth-tenancy";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "api" };
  }
}

@Controller("api/v1")
class AuthTenancyController {
  constructor(@Inject(AuthTenancyService) private readonly service: AuthTenancyService) {}

  @Post("auth/register") @HttpCode(201) register(@Body() body: { email?: unknown; password?: unknown; name?: unknown }) { return this.service.register(body); }
  @Post("auth/login") @HttpCode(200) login(@Body() body: { email?: unknown; password?: unknown }) { return this.service.login(body); }

  @Get("organizations") async organizations(@Headers("authorization") authorization?: string) {
    const user = await this.service.authenticate(authorization);
    return this.service.listOrganizations(user.id);
  }

  @Post("organizations") async createOrganization(@Headers("authorization") authorization: string | undefined, @Body() body: { name?: unknown }) {
    const user = await this.service.authenticate(authorization);
    return this.service.createOrganization(user.id, body);
  }

  @Get("organizations/:id") async organization(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.service.authenticate(authorization);
    return this.service.getOrganization(user.id, id);
  }

  @Get("organizations/:id/members") async listMembers(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.service.authenticate(authorization);
    return this.service.listMembers(user.id, id);
  }

  @Post("organizations/:id/members") async addMember(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Body() body: { email?: unknown; role?: unknown }) {
    const user = await this.service.authenticate(authorization);
    return this.service.addMember(user.id, id, body);
  }
}

@Module({
  controllers: [HealthController, AuthTenancyController],
  providers: [PrismaClient, AuthTenancyService],
})
class ApiModule {}

export async function createApiApp() {
  const app = await NestFactory.create(ApiModule, { logger: ["error"] });
  app.enableShutdownHooks();
  return app;
}
