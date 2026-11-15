import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DocumentStatus, MembershipRole, PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { createRedisConnection } from "./processing-queue";

const maxFileBytes = 10 * 1024 * 1024;
const acceptedTypes = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject("PROCESSING_QUEUE") private readonly queue: Queue,
  ) {}

  async createUpload(userId: string, input: { organizationId?: unknown; filename?: unknown; mimeType?: unknown; size?: unknown }) {
    const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Organization not found");
    if (![MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER].some((role) => role === membership.role)) {
      throw new ForbiddenException("This membership cannot upload documents");
    }

    const filename = typeof input.filename === "string" ? input.filename.trim() : "";
    const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase() : "";
    const size = input.size;
    if (!filename || filename.length > 255 || filename !== filename.split(/[\\/]/).pop()) {
      throw new BadRequestException("Provide a valid filename without path segments");
    }
    if (!acceptedTypes.has(mimeType)) throw new BadRequestException("Only PDF, JPEG, and PNG files are supported");
    if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > maxFileBytes) {
      throw new BadRequestException(`File size must be between 1 byte and ${maxFileBytes} bytes`);
    }

    const cloud = this.cloudinaryConfig();
    const documentId = randomUUID();
    const folder = `docuflow/${organizationId}`;
    const resourceType = mimeType === "application/pdf" ? "raw" : "image";
    const publicId = resourceType === "raw" ? `${documentId}.${acceptedTypes.get(mimeType)}` : documentId;
    const storagePublicId = `${folder}/${publicId}`;
    const storageKey = `${folder}/${publicId}`;
    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        organizationId,
        filename,
        mimeType,
        size: BigInt(size as number),
        storageKey: storagePublicId,
        status: DocumentStatus.PENDING_UPLOAD,
      },
      select: { id: true, organizationId: true, filename: true, mimeType: true, size: true, status: true, createdAt: true, updatedAt: true },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const params = { folder, overwrite: "false", public_id: publicId, timestamp, type: "authenticated" };
    const signature = this.signParams(params, cloud.apiSecret);
    return {
      document: { ...document, size: Number(document.size) },
      upload: {
        url: `${cloud.apiBaseUrl}/v1_1/${encodeURIComponent(cloud.cloudName)}/${resourceType}/upload`,
        apiKey: cloud.apiKey,
        params: { ...params, signature },
      },
    };
  }

  async completeUpload(userId: string, documentId: string) {
    const document = await this.findAuthorizedDocument(userId, documentId);
    if (document.status !== DocumentStatus.PENDING_UPLOAD) {
      if ([DocumentStatus.UPLOADED, DocumentStatus.QUEUED, DocumentStatus.PROCESSING, DocumentStatus.COMPLETED].some((status) => document.status === status)) return this.publicDocument(document);
      throw new BadRequestException("Document is not awaiting upload");
    }

    const cloud = this.cloudinaryConfig();
    const auth = Buffer.from(`${cloud.apiKey}:${cloud.apiSecret}`).toString("base64");
    const resourceType = document.mimeType === "application/pdf" ? "raw" : "image";
    const publicId = document.storageKey;
    const encodedPublicId = publicId.split("/").map(encodeURIComponent).join("/");
    const url = `${cloud.apiBaseUrl}/v1_1/${encodeURIComponent(cloud.cloudName)}/resources/${resourceType}/authenticated/${encodedPublicId}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
    } catch {
      throw new ServiceUnavailableException("Could not verify uploaded document");
    }
    if (response.status === 404) throw new BadRequestException("Uploaded file was not found in storage");
    if (!response.ok) throw new ServiceUnavailableException("Could not verify uploaded document");
    const asset = await response.json() as { public_id?: unknown; resource_type?: unknown; format?: unknown; bytes?: unknown };
    const expectedFormat = acceptedTypes.get(document.mimeType);
    const actualFormat = typeof asset.format === "string" ? asset.format : publicId.split(".").pop();
    if (asset.public_id !== publicId || asset.resource_type !== resourceType || actualFormat !== expectedFormat || asset.bytes !== Number(document.size)) {
      throw new BadRequestException("Uploaded file does not match the declared document metadata");
    }

    const queued = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.updateMany({
        where: { id: document.id, organizationId: document.organizationId, status: DocumentStatus.PENDING_UPLOAD },
        data: { status: DocumentStatus.QUEUED },
      });
      if (updated.count === 0) return null;
      return tx.processingJob.create({ data: { documentId: document.id } });
    });
    if (!queued) return this.publicDocument(await this.findAuthorizedDocument(userId, documentId));
    try {
      await this.queue.add("process-document", { jobId: queued.id, documentId: document.id }, { jobId: queued.id, attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    } catch {
      await this.prisma.$transaction(async (tx) => {
        await tx.processingJob.update({ where: { id: queued.id }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Could not enqueue document processing" } });
        await tx.document.update({ where: { id: document.id }, data: { status: DocumentStatus.FAILED } });
      });
      throw new ServiceUnavailableException("Could not queue document processing");
    }
    return this.publicDocument(await this.prisma.document.findUniqueOrThrow({ where: { id: document.id } }));
  }

  async list(userId: string, organizationId?: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, ...(organizationId ? { organizationId } : {}) },
      select: { organizationId: true },
    });
    if (organizationId && memberships.length === 0) throw new NotFoundException("Organization not found");
    const documents = await this.prisma.document.findMany({
      where: { organizationId: { in: memberships.map(({ organizationId: id }) => id) } },
      orderBy: { createdAt: "desc" },
    });
    return documents.map((document) => this.publicDocument(document));
  }

  async get(userId: string, documentId: string) {
    return this.publicDocument(await this.findAuthorizedDocument(userId, documentId));
  }

  async listJobs(userId: string, documentId: string) {
    await this.findAuthorizedDocument(userId, documentId);
    return this.prisma.processingJob.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } });
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.prisma.processingJob.findFirst({ where: { id: jobId, document: { organization: { memberships: { some: { userId } } } } } });
    if (!job) throw new NotFoundException("Processing job not found");
    return job;
  }

  async retryJob(userId: string, jobId: string) {
    const job = await this.getJob(userId, jobId);
    if (job.status !== "FAILED") throw new BadRequestException("Only failed jobs can be retried");
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.processingJob.updateMany({
        where: { id: job.id, status: "FAILED" },
        data: { status: "QUEUED", attempts: 0, errorCode: null, errorMessage: null },
      });
      if (changed.count === 0) throw new BadRequestException("Only failed jobs can be retried");
      await tx.document.update({ where: { id: job.documentId }, data: { status: DocumentStatus.QUEUED } });
      return tx.processingJob.findUniqueOrThrow({ where: { id: job.id } });
    });
    try {
      const queueJob = await this.queue.getJob(job.id);
      if (queueJob) await queueJob.remove();
      await this.queue.add("process-document", { jobId: job.id, documentId: job.documentId }, { jobId: job.id, attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    } catch {
      await this.prisma.$transaction(async (tx) => {
        await tx.processingJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Could not enqueue document processing" } });
        await tx.document.update({ where: { id: job.documentId }, data: { status: DocumentStatus.FAILED } });
      });
      throw new ServiceUnavailableException("Could not queue document processing");
    }
    return updated;
  }

  private async findAuthorizedDocument(userId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organization: { memberships: { some: { userId } } } },
    });
    if (!document) throw new NotFoundException("Document not found");
    return document;
  }

  private publicDocument<T extends { size: bigint }>(document: T) {
    return { ...document, size: Number(document.size) };
  }

  private cloudinaryConfig() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new ServiceUnavailableException("Cloudinary storage is not configured");
    return {
      cloudName,
      apiKey,
      apiSecret,
      apiBaseUrl: (process.env.CLOUDINARY_API_BASE_URL ?? "https://api.cloudinary.com").replace(/\/$/, ""),
    };
  }

  private signParams(params: Record<string, string>, apiSecret: string) {
    const canonical = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
    return createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
  }
}
