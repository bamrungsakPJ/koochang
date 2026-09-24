import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@serviceflow/shared';
import type { Request } from 'express';

export interface TenantMembership {
  id: number;
  publicId: string;
  tenantId: number;
  tenantPublicId: string;
  role: Role;
}

export interface AuthContext {
  accountId: number;
  accountPublicId: string;
  displayName: string;
  /** Absent until the user picks a shop (only when they belong to several). */
  membership?: TenantMembership;
}

export interface TenantAuthContext extends AuthContext {
  membership: TenantMembership;
}

export type AuthedRequest = Request & { auth?: AuthContext };

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** No login required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires an active shop and one of the roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

/** Use on handlers guarded by @Roles(): the membership is guaranteed there. */
export const TenantAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantAuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth?.membership) throw new UnauthorizedException();
  return auth as TenantAuthContext;
});
