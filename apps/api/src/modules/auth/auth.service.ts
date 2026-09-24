import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, Role } from '@serviceflow/shared';
import argon2 from 'argon2';
import { LINE_ID_TOKEN_VERIFIER, LineIdTokenVerifier } from '../../adapters/line-auth';
import { TokenService } from '../../common/auth/token.service';
import { appendEvent, EventType } from '../../common/events';
import { newPublicId } from '../../common/ids';
import { isUniqueViolation, PrismaService } from '../../common/prisma/prisma.service';
import { RateLimiter } from '../../common/rate-limiter';
import { seedDefaultCategories } from '../../common/seed';
import { Session, SessionService } from './session.service';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  /** Verified against when the phone is unknown, so response time doesn't reveal registration. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    @Inject(LINE_ID_TOKEN_VERIFIER) private readonly line: LineIdTokenVerifier,
  ) {}

  async signup(input: {
    verificationToken: string;
    shopName: string;
    displayName: string;
    password: string;
  }): Promise<Session> {
    const phoneE164 = this.tokens.verifyPhoneVerification(input.verificationToken, OtpPurpose.SIGNUP);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    try {
      const accountId = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { publicId: newPublicId(), name: input.shopName } });
        const account = await tx.account.create({
          data: { publicId: newPublicId(), displayName: input.displayName, passwordHash },
        });
        await tx.verifiedPhone.create({ data: { phoneE164, accountId: account.id } });
        await tx.membership.create({
          data: { publicId: newPublicId(), tenantId: tenant.id, accountId: account.id, role: Role.OWNER },
        });
        await seedDefaultCategories(tx, tenant.id);
        await appendEvent(tx, {
          tenantId: tenant.id,
          eventType: EventType.TENANT_CREATED,
          actorType: 'ACCOUNT',
          actorId: account.publicId,
          subjectType: 'TENANT',
          subjectId: tenant.publicId,
        });
        return account.id;
      });
      return this.sessions.create(accountId);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ');
      throw err;
    }
  }

  async login(phoneE164: string, password: string, ip: string): Promise<Session> {
    this.limiter.enforce(`login:phone:${phoneE164}`, 10, LOGIN_WINDOW_MS);
    this.limiter.enforce(`login:ip:${ip}`, 50, LOGIN_WINDOW_MS);

    const verified = await this.prisma.verifiedPhone.findUnique({
      where: { phoneE164 },
      include: { account: true },
    });
    const account = verified?.account;
    const hash = account?.passwordHash ?? (await this.getDummyHash());
    const ok = await argon2.verify(hash, password);
    if (!account || account.status !== 'ACTIVE' || !account.passwordHash || !ok) {
      throw new UnauthorizedException('เบอร์หรือรหัสผ่านไม่ถูกต้อง');
    }
    return this.sessions.create(account.id);
  }

  async lineLogin(lineIdToken: string): Promise<Session> {
    const user = await this.line.verify(lineIdToken);
    const identity = await this.prisma.lineIdentity.findUnique({
      where: { lineChannelId_lineUserId: { lineChannelId: user.channelId, lineUserId: user.userId } },
      include: { account: true },
    });
    if (!identity?.account || identity.account.status !== 'ACTIVE') {
      throw new NotFoundException('ยังไม่ได้ลงทะเบียน กรุณาขอลิงก์เชิญจากร้าน');
    }
    return this.sessions.create(identity.account.id);
  }

  async resetPassword(verificationToken: string, password: string): Promise<Session> {
    const phoneE164 = this.tokens.verifyPhoneVerification(verificationToken, OtpPurpose.RESET);
    const verified = await this.prisma.verifiedPhone.findUnique({ where: { phoneE164 } });
    if (!verified) throw new UnauthorizedException('การยืนยันเบอร์หมดอายุ กรุณาขอรหัสใหม่');

    await this.prisma.account.update({
      where: { id: verified.accountId },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    });
    await this.tokens.revokeAllForAccount(verified.accountId);
    return this.sessions.create(verified.accountId);
  }

  async switchTenant(accountId: number, tenantPublicId: string): Promise<Session> {
    const tenants = await this.sessions.tenantsOf(accountId);
    if (!tenants.some((t) => t.id === tenantPublicId)) throw new ForbiddenException('ไม่ได้เป็นสมาชิกร้านนี้');
    return this.sessions.create(accountId, tenantPublicId);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const { accountId, tenantPublicId } = await this.tokens.consumeRefresh(refreshToken);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.status !== 'ACTIVE') throw new UnauthorizedException();
    return this.sessions.create(accountId, tenantPublicId);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefresh(refreshToken);
  }

  async me(accountId: number) {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    return {
      account: { id: account.publicId, displayName: account.displayName },
      tenants: await this.sessions.tenantsOf(accountId),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
    return this.dummyHash;
  }
}
