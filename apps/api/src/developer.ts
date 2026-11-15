import { createCipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { isSafeWebhookUrl } from "@docuflow/shared";

const keyPrefixLength = 16;

@Injectable()
export class DeveloperService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async createApiKey(userId: string, input: { organizationId?: unknown; name?: unknown }) {
    const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 80) throw new BadRequestException("API key name must be between 1 and 80 characters");
    await this.requireDeveloperRole(userId, organizationId);
    const secret = `df_live_${randomBytes(32).toString("base64url")}`;
    const record = await this.prisma.apiKey.create({
      data: { organizationId, createdByUserId: userId, name, keyPrefix: secret.slice(0, keyPrefixLength), keyHash: this.hash(secret) },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });
    return { ...record, secret };
  }

  async listApiKeys(userId: string, organizationId: string) {
    await this.requireMembership(userId, organizationId);
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeApiKey(userId: string, organizationId: string, keyId: string) {
    await this.requireDeveloperRole(userId, organizationId);
    const result = await this.prisma.apiKey.updateMany({ where: { id: keyId, organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (result.count === 0) throw new NotFoundException("Active API key not found");
    return { id: keyId, revoked: true };
  }

  async authenticateApiKey(authorization?: string) {
    const [scheme, secret, extra] = authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !secret || extra || !secret.startsWith("df_live_")) throw new UnauthorizedException("A valid DocuFlow API key is required");
    const record = await this.prisma.apiKey.findFirst({ where: { keyPrefix: secret.slice(0, keyPrefixLength), revokedAt: null } });
    const actual = Buffer.from(this.hash(secret), "hex");
    const expected = Buffer.from(record?.keyHash ?? "0".repeat(64), "hex");
    if (!record || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException("A valid DocuFlow API key is required");
    await this.prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
    return { organizationId: record.organizationId, apiKeyId: record.id };
  }

  async getUsage(userId: string, organizationId: string, input: { from?: unknown; to?: unknown }) {
    await this.requireMembership(userId, organizationId);
    return this.getOrganizationUsage(organizationId, input);
  }

  async getUsageForApiKey(organizationId: string, input: { from?: unknown; to?: unknown }) {
    return this.getOrganizationUsage(organizationId, input);
  }

  private async getOrganizationUsage(organizationId: string, input: { from?: unknown; to?: unknown }) {
    const from = this.parseDate(input.from, "from");
    const to = this.parseDate(input.to, "to");
    if (from && to && from > to) throw new BadRequestException("from must be before to");
    const createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const where = { organizationId, ...(from || to ? { createdAt } : {}) };
    const [count, totals, recent] = await Promise.all([
      this.prisma.usageRecord.count({ where }),
      this.prisma.usageRecord.aggregate({ where, _sum: { inputTokens: true, outputTokens: true, processingDuration: true } }),
      this.prisma.usageRecord.findMany({ where, select: { jobId: true, inputTokens: true, outputTokens: true, processingDuration: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return {
      organizationId,
      period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      totals: { processedDocuments: count, inputTokens: totals._sum.inputTokens ?? 0, outputTokens: totals._sum.outputTokens ?? 0, processingDurationMs: totals._sum.processingDuration ?? 0 },
      recent,
    };
  }

  async createWebhook(userId: string, input: { organizationId?: unknown; url?: unknown; events?: unknown }) {
    const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
    await this.requireDeveloperRole(userId, organizationId);
    const url = typeof input.url === "string" ? input.url.trim() : "";
    const events = input.events;
    if (!(await isSafeWebhookUrl(url, { resolveDns: process.env.NODE_ENV === "production" }))) throw new BadRequestException("Webhook URL must be HTTPS and must not target a local or private address");
    const allowedEvents = ["document.processing.completed", "document.processing.failed"];
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => typeof event !== "string" || !allowedEvents.includes(event))) {
      throw new BadRequestException(`events must contain one or more of: ${allowedEvents.join(", ")}`);
    }
    const signingSecret = `whsec_${randomBytes(32).toString("base64url")}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { organizationId, url, eventTypes: [...new Set(events as string[])], encryptedSigningSecret: this.encryptSecret(signingSecret) },
      select: { id: true, url: true, eventTypes: true, active: true, createdAt: true },
    });
    return { ...endpoint, signingSecret };
  }

  async listWebhooks(userId: string, organizationId: string) {
    await this.requireMembership(userId, organizationId);
    return this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      select: { id: true, url: true, eventTypes: true, active: true, createdAt: true, updatedAt: true, deliveries: { select: { id: true, eventType: true, status: true, attempts: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 } },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteWebhook(userId: string, organizationId: string, endpointId: string) {
    await this.requireDeveloperRole(userId, organizationId);
    const result = await this.prisma.webhookEndpoint.deleteMany({ where: { id: endpointId, organizationId } });
    if (result.count === 0) throw new NotFoundException("Webhook endpoint not found");
    return { id: endpointId, deleted: true };
  }

  private async requireMembership(userId: string, organizationId: string) {
    this.requireOrganizationScope(organizationId);
    if (!await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })) throw new NotFoundException("Organization not found");
  }

  private async requireDeveloperRole(userId: string, organizationId: string) {
    this.requireOrganizationScope(organizationId);
    const membership = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { role: true } });
    if (!membership) throw new NotFoundException("Organization not found");
    if (![MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.DEVELOPER].some((role) => role === membership.role)) throw new ForbiddenException("Only owners, admins, and developers can manage integrations");
  }

  private requireOrganizationScope(organizationId: string) {
    if (!organizationId) throw new BadRequestException("organizationId or the x-organization-id header is required");
  }

  private parseDate(value: unknown, name: string) {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new BadRequestException(`${name} must be a valid ISO date`);
    return new Date(value);
  }

  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

  private encryptionKey() {
    const value = process.env.WEBHOOK_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
    if (!value || value.length < 32) throw new Error("WEBHOOK_ENCRYPTION_KEY (or a 32-character JWT_SECRET) is required");
    return createHash("sha256").update(value).digest();
  }

  private encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }
}
