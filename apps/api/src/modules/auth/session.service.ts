import { Injectable } from '@nestjs/common';
import type { Role } from '@serviceflow/shared';
import { TokenService } from '../../common/auth/token.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface TenantSummary {
  id: string;
  name: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  /** Goes into the httpOnly cookie, never into the response body. */
  refreshToken: string;
  account: { id: string; displayName: string };
  tenants: TenantSummary[];
  activeTenantId: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async tenantsOf(accountId: number): Promise<TenantSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { accountId, status: 'ACTIVE', tenant: { deletedAt: null } },
      include: { tenant: { select: { publicId: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ id: m.tenant.publicId, name: m.tenant.name, role: m.role as Role }));
  }

  /**
   * `preferredTenantId` is honoured only if the account still belongs to it.
   * With exactly one shop it is selected automatically.
   */
  async create(accountId: number, preferredTenantId?: string | null): Promise<Session> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const tenants = await this.tenantsOf(accountId);

    let active: string | null = null;
    if (preferredTenantId && tenants.some((t) => t.id === preferredTenantId)) active = preferredTenantId;
    else if (tenants.length === 1) active = tenants[0].id;

    return {
      accessToken: this.tokens.signAccess({ sub: account.publicId, tid: active }),
      refreshToken: await this.tokens.issueRefresh(accountId, active),
      account: { id: account.publicId, displayName: account.displayName },
      tenants,
      activeTenantId: active,
    };
  }
}
