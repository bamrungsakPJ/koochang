import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@serviceflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext, AuthedRequest, IS_PUBLIC, ROLES } from './auth-context';
import { TokenService } from './token.service';

/**
 * Global guard. Membership status is re-read on every request, so removing a technician
 * from a shop takes effect immediately rather than when their token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const claims = this.tokens.verifyAccess(header.slice('Bearer '.length));

    let auth: AuthContext;
    if (claims.tid) {
      const m = await this.prisma.membership.findFirst({
        where: {
          status: 'ACTIVE',
          tenant: { publicId: claims.tid, deletedAt: null },
          account: { publicId: claims.sub, status: 'ACTIVE' },
        },
        include: { tenant: { select: { publicId: true } }, account: { select: { displayName: true } } },
      });
      if (!m) throw new UnauthorizedException();
      auth = {
        accountId: m.accountId,
        accountPublicId: claims.sub,
        displayName: m.account.displayName,
        membership: {
          id: m.id,
          publicId: m.publicId,
          tenantId: m.tenantId,
          tenantPublicId: m.tenant.publicId,
          role: m.role as Role,
        },
      };
    } else {
      const account = await this.prisma.account.findFirst({
        where: { publicId: claims.sub, status: 'ACTIVE' },
        select: { id: true, displayName: true },
      });
      if (!account) throw new UnauthorizedException();
      auth = { accountId: account.id, accountPublicId: claims.sub, displayName: account.displayName };
    }
    req.auth = auth;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles) {
      if (!auth.membership) throw new ForbiddenException('กรุณาเลือกร้านก่อน');
      if (!roles.includes(auth.membership.role)) throw new ForbiddenException('ไม่มีสิทธิ์ทำรายการนี้');
    }
    return true;
  }
}
