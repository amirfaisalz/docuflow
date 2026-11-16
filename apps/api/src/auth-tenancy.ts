import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { MembershipRole, PrismaClient } from "@docuflow/database";

const scrypt = promisify(scryptCallback);
const tokenLifetimeSeconds = 60 * 60;

type TokenPayload = { sub: string; exp: number };
type AuthenticatedUser = { id: string; email: string };

@Injectable()
export class AuthTenancyService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async register(input: { email?: unknown; password?: unknown; name?: unknown }) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!email.includes("@") || password.length < 12) {
      throw new BadRequestException("Provide a valid email and a password of at least 12 characters");
    }
    const passwordHash = await this.hashPassword(password);
    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, name: typeof input.name === "string" ? input.name : null },
        select: { id: true, email: true, name: true },
      });
      return { user, accessToken: this.issueToken(user.id) };
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException("Email is already registered");
      throw error;
    }
  }

  async login(input: { email?: unknown; password?: unknown }) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return { user: { id: user.id, email: user.email, name: user.name }, accessToken: this.issueToken(user.id) };
  }

  async authenticate(authorization?: string): Promise<AuthenticatedUser> {
    const [scheme, token] = authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    const payload = this.verifyToken(token);
    if (!payload) throw new UnauthorizedException("Invalid or expired access token");
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async listOrganizations(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  }

  async createOrganization(userId: string, input: { name?: unknown }) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw new BadRequestException("Organization name is required");
    const baseSlug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "organization";
    const organization = await this.prisma.$transaction(async (tx) => {
      let slug = baseSlug;
      for (let suffix = 1; await tx.organization.findUnique({ where: { slug } }); suffix += 1) {
        slug = `${baseSlug}-${suffix}`;
      }
      const created = await tx.organization.create({ data: { name, slug } });
      await tx.membership.create({ data: { userId, organizationId: created.id, role: MembershipRole.OWNER } });
      return created;
    });
    return { ...organization, role: MembershipRole.OWNER };
  }

  async getOrganization(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true },
    });
    if (!membership) throw new NotFoundException("Organization not found");
    return { ...membership.organization, role: membership.role };
  }

  async listMembers(userId: string, organizationId: string) {
    const actor = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (!actor) throw new NotFoundException("Organization not found");
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map(({ id, role, createdAt, user }) => ({ id, role, createdAt, ...user }));
  }

  async addMember(userId: string, organizationId: string, input: { email?: unknown; role?: unknown }) {
    const actor = await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (!actor) throw new NotFoundException("Organization not found");
    if (!([MembershipRole.OWNER, MembershipRole.ADMIN] as MembershipRole[]).includes(actor.role)) {
      throw new ForbiddenException("Only organization owners and admins can manage members");
    }
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const role = input.role;
    if (!([MembershipRole.ADMIN, MembershipRole.MEMBER, MembershipRole.DEVELOPER] as MembershipRole[]).includes(role as MembershipRole)) {
      throw new BadRequestException("Membership role must be ADMIN, MEMBER, or DEVELOPER");
    }
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new NotFoundException("User not found");
    try {
      return await this.prisma.membership.create({
        data: { userId: user.id, organizationId, role: role as MembershipRole },
        select: { id: true, userId: true, organizationId: true, role: true, createdAt: true },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException("User is already a member");
      throw error;
    }
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64) as Buffer;
    return `${salt.toString("hex")}:${derived.toString("hex")}`;
  }

  private async verifyPassword(password: string, encoded: string) {
    const [saltHex, hashHex] = encoded.split(":");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private issueToken(userId: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds })}`;
    return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
  }

  private verifyToken(token: string): TokenPayload | null {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const signature = createHmac("sha256", secret).update(unsigned).digest();
    let provided: Buffer;
    try { provided = Buffer.from(parts[2], "base64url"); } catch { return null; }
    if (provided.length !== signature.length || !timingSafeEqual(provided, signature)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as TokenPayload;
      if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return null;
      return payload;
    } catch { return null; }
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }
}
