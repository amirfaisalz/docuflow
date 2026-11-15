import "reflect-metadata";
import { Body, Controller, Get, Headers, HttpCode, Inject, Injectable, Module, OnApplicationShutdown, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { AuthTenancyService } from "./auth-tenancy";
import { DocumentsService } from "./documents";
import { createProcessingQueue } from "./processing-queue";

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

@Controller("api/v1/documents")
class DocumentsController {
  constructor(
    @Inject(AuthTenancyService) private readonly auth: AuthTenancyService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  @Post("upload-url") @HttpCode(201) async createUpload(@Headers("authorization") authorization: string | undefined, @Body() body: { organizationId?: unknown; filename?: unknown; mimeType?: unknown; size?: unknown }) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.createUpload(user.id, body);
  }

  @Post(":id/complete-upload") @HttpCode(200) async completeUpload(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.documents.completeUpload(user.id, id);
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
  ) {}

  @Get(":id") async get(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
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
  controllers: [HealthController, AuthTenancyController, DocumentsController, JobsController],
  providers: [
    PrismaClient,
    AuthTenancyService,
    DocumentsService,
    { provide: "PROCESSING_QUEUE", useFactory: createProcessingQueue, inject: [] },
    ProcessingQueueLifecycle,
  ],
})
class ApiModule {}

export async function createApiApp() {
  const app = await NestFactory.create(ApiModule, { logger: ["error"] });
  app.enableShutdownHooks();
  app.get(ProcessingQueueLifecycle);
  return app;
}
