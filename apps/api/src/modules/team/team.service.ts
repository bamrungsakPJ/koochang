import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatThaiPhone, Role } from '@serviceflow/shared';
import { LINE_ID_TOKEN_VERIFIER, LineIdTokenVerifier } from '../../adapters/line-auth';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { TenantAuthContext } from '../../common/auth/auth-context';
import { appendEvent, EventType } from '../../common/events';
import { newPublicId, randomToken, sha256 } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Session, SessionService } from '../auth/session.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Technician onboarding (docs/architecture.md §7.2): the owner copies an invite link into
 * their own LINE chat; the technician opens it inside LINE and joins. No phone verification —
 * the LINE identity is the login.
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LINE_ID_TOKEN_VERIFIER) private readonly line: LineIdTokenVerifier,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async createInvite(auth: TenantAuthContext, role: Role) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const token = randomToken();
    const invite = await db.$transaction(async (tx) => {
      const created = await tx.invite.create({
        data: {
          publicId: newPublicId(),
          tenantId: auth.membership.tenantId,
          role,
          tokenHash: sha256(token),
          createdByMembershipId: auth.membership.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await appendEvent(tx, {
        tenantId: auth.membership.tenantId,
        eventType: EventType.MEMBER_INVITED,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'INVITE',
        subjectId: created.publicId,
        metadata: { role },
      });
      return created;
    });
    // The raw token is only ever shown here; the database keeps its hash.
    return {
      id: invite.publicId,
      role: invite.role,
      expiresAt: invite.expiresAt,
      url: `${this.config.APP_URL}/join/${token}`,
    };
  }

  async listPendingInvites(auth: TenantAuthContext) {
    const invites = await this.prisma.forTenant(auth.membership.tenantId).invite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({ id: i.publicId, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt }));
  }

  async revokeInvite(auth: TenantAuthContext, invitePublicId: string) {
    const result = await this.prisma.forTenant(auth.membership.tenantId).invite.updateMany({
      where: { publicId: invitePublicId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('ไม่พบลิงก์เชิญ');
  }

  async listMembers(auth: TenantAuthContext) {
    const members = await this.prisma.forTenant(auth.membership.tenantId).membership.findMany({
      where: { status: 'ACTIVE' },
      include: { account: { select: { displayName: true, contactPhone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.publicId,
      role: m.role,
      displayName: m.account.displayName,
      phone: m.account.contactPhone ? formatThaiPhone(m.account.contactPhone) : null,
      joinedAt: m.createdAt,
    }));
  }

  async removeMember(auth: TenantAuthContext, membershipPublicId: string) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const target = await db.membership.findFirst({ where: { publicId: membershipPublicId, status: 'ACTIVE' } });
    if (!target) throw new NotFoundException('ไม่พบสมาชิก');
    if (target.id === auth.membership.id) throw new BadRequestException('ลบตัวเองออกจากร้านไม่ได้');
    if (target.role === Role.OWNER && auth.membership.role !== Role.OWNER) {
      throw new ForbiddenException('เฉพาะเจ้าของร้านเท่านั้นที่ลบเจ้าของร้านได้');
    }

    await db.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: target.id },
        data: { status: 'REMOVED', removedAt: new Date() },
      });
      await appendEvent(tx, {
        tenantId: auth.membership.tenantId,
        eventType: EventType.MEMBER_REMOVED,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'MEMBERSHIP',
        subjectId: target.publicId,
      });
    });
  }

  /** What the join page shows before the technician confirms. */
  async previewInvite(token: string) {
    const invite = await this.findUsableInvite(token);
    return { shopName: invite.tenant.name, role: invite.role };
  }

  async acceptInvite(
    token: string,
    input: { lineIdToken: string; displayName: string; phone?: string },
  ): Promise<Session> {
    const user = await this.line.verify(input.lineIdToken);
    const invite = await this.findUsableInvite(token);

    // System-level transaction: the joining person has no tenant context yet.
    const accountId = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new GoneException('ลิงก์นี้หมดอายุหรือถูกใช้แล้ว');

      const identity = await tx.lineIdentity.findUnique({
        where: { lineChannelId_lineUserId: { lineChannelId: user.channelId, lineUserId: user.userId } },
        include: { account: true },
      });
      let account = identity?.account ?? null;
      if (!account) {
        account = await tx.account.create({
          data: { publicId: newPublicId(), displayName: input.displayName, contactPhone: input.phone },
        });
        if (identity) {
          await tx.lineIdentity.update({ where: { id: identity.id }, data: { accountId: account.id } });
        } else {
          await tx.lineIdentity.create({
            data: { lineChannelId: user.channelId, lineUserId: user.userId, accountId: account.id },
          });
        }
      }

      const existing = await tx.membership.findUnique({
        where: { tenantId_accountId: { tenantId: invite.tenantId, accountId: account.id } },
      });
      if (existing?.status === 'ACTIVE') throw new ConflictException('คุณเป็นสมาชิกของร้านนี้อยู่แล้ว');

      const membership = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', role: invite.role, removedAt: null },
          })
        : await tx.membership.create({
            data: { publicId: newPublicId(), tenantId: invite.tenantId, accountId: account.id, role: invite.role },
          });

      await tx.invite.update({ where: { id: invite.id }, data: { acceptedMembershipId: membership.id } });
      await appendEvent(tx, {
        tenantId: invite.tenantId,
        eventType: EventType.MEMBER_JOINED,
        actorType: 'ACCOUNT',
        actorId: account.publicId,
        subjectType: 'MEMBERSHIP',
        subjectId: membership.publicId,
        metadata: { role: invite.role, inviteId: invite.publicId, displayName: account.displayName },
      });
      return account.id;
    });

    return this.sessions.create(accountId, invite.tenant.publicId);
  }

  private async findUsableInvite(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { tenant: true },
    });
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date() ||
      invite.tenant.deletedAt
    ) {
      throw new GoneException('ลิงก์นี้หมดอายุหรือถูกใช้แล้ว');
    }
    return invite;
  }
}
