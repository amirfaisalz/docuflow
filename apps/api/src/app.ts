import "reflect-metadata";
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Module, OnApplicationShutdown, Param, Post, Query, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AuthTenancyService } from "./auth-tenancy";
import { DocumentsService } from "./documents";
import { createProcessingQueue } from "./processing-queue";
import { DeveloperService } from "./developer";
import { HealthService } from "./health";
import { requestObservability } from "./observability";

@Controller("health")
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  live() {
    return this.health.live();
  }

  @Get("live")
  liveness() {
    return this.health.live();
  }

  @Get("ready")
  async readiness(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const report = await this.health.ready();
    if (report.status !== "ok") response.status(503);
    return { ...report, service: "api" };
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

@Controller("api/v1")
class DeveloperController {
  constructor(
    @Inject(AuthTenancyService) private readonly auth: AuthTenancyService,
    @Inject(DeveloperService) private readonly developer: DeveloperService,
  ) {}

  @Post("api-keys") @HttpCode(201) async createApiKey(@Headers("authorization") authorization: string | undefined, @Body() body: { organizationId?: unknown; name?: unknown }) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.createApiKey(user.id, body);
  }

  @Get("api-keys") async listApiKeys(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.listApiKeys(user.id, organizationId ?? "");
  }

  @Delete("api-keys/:id") async revokeApiKey(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.revokeApiKey(user.id, organizationId ?? "", id);
  }

  @Get("usage") async usage(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId: string | undefined, @Query("from") from?: string, @Query("to") to?: string) {
    if (authorization?.startsWith("Bearer df_live_")) {
      const credential = await this.developer.authenticateApiKey(authorization);
      return this.developer.getUsageForApiKey(credential.organizationId, { from, to });
    }
    const user = await this.auth.authenticate(authorization);
    return this.developer.getUsage(user.id, organizationId ?? "", { from, to });
  }

  @Post("webhooks") @HttpCode(201) async createWebhook(@Headers("authorization") authorization: string | undefined, @Body() body: { organizationId?: unknown; url?: unknown; events?: unknown }) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.createWebhook(user.id, body);
  }

  @Get("webhooks") async listWebhooks(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.listWebhooks(user.id, organizationId ?? "");
  }

  @Delete("webhooks/:id") async deleteWebhook(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.developer.deleteWebhook(user.id, organizationId ?? "", id);
  }
}

@Controller("api/v1/documents")
class DocumentsController {
  constructor(
    @Inject(AuthTenancyService) private readonly auth: AuthTenancyService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(DeveloperService) private readonly developer: DeveloperService,
  ) {}

  @Post("upload-url") @HttpCode(201) async createUpload(@Headers("authorization") authorization: string | undefined, @Body() body: { organizationId?: unknown; filename?: unknown; mimeType?: unknown; size?: unknown }) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.createUpload(user.id, body);
  }

  @Post(":id/complete-upload") @HttpCode(200) async completeUpload(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.completeUpload(user.id, id);
  }

  @Post(":id/process") @HttpCode(202) async process(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const credential = await this.developer.authenticateApiKey(authorization);
    return this.documents.processDocumentForOrganization(credential.organizationId, id);
  }

  @Get() async list(@Headers("authorization") authorization: string | undefined, @Headers("x-organization-id") organizationId?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.list(user.id, organizationId);
  }

  @Get(":id") async get(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.get(user.id, id);
  }

  @Get(":id/jobs") async listJobs(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.listJobs(user.id, id);
  }
}

@Controller("api/v1/jobs")
class JobsController {
  constructor(
    @Inject(AuthTenancyService) private readonly auth: AuthTenancyService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(DeveloperService) private readonly developer: DeveloperService,
  ) {}

  @Get(":id") async get(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    if (authorization?.startsWith("Bearer df_live_")) {
      const credential = await this.developer.authenticateApiKey(authorization);
      return this.documents.getJobForOrganization(credential.organizationId, id);
    }
    const user = await this.auth.authenticate(authorization);
    return this.documents.getJob(user.id, id);
  }

  @Post(":id/retry") @HttpCode(202) async retry(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.retryJob(user.id, id);
  }
}

@Injectable()
class ProcessingQueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject("PROCESSING_QUEUE") private readonly queue: ReturnType<typeof createProcessingQueue>) {}
  async onApplicationShutdown() { await this.queue.close(); }
}

@Module({
  controllers: [HealthController, AuthTenancyController, DeveloperController, DocumentsController, JobsController],
  providers: [
    PrismaClient,
    AuthTenancyService,
    DocumentsService,
    DeveloperService,
    HealthService,
    { provide: "PROCESSING_QUEUE", useFactory: createProcessingQueue, inject: [] },
    ProcessingQueueLifecycle,
  ],
})
class ApiModule {}

export async function createApiApp() {
  const app = await NestFactory.create(ApiModule, { logger: ["error"] });
  app.use(requestObservability);
  app.enableShutdownHooks();
  app.get(ProcessingQueueLifecycle);
  app.get(HealthService);
  return app;
}
