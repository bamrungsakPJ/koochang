import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { apiError } from '../shared/api-error.js';
import { sha256Hex, tokenPattern } from '../shared/crypto.js';

export interface SessionContext { userId: string; sessionId: string; }
export interface TenantContext { organizationId: string; memberId: string; role: 'owner' | 'technician'; }
export interface AppRequest {
  headers: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  ip?: string;
  requestId: string;
  session?: SessionContext;
  tenant?: TenantContext;
}

/** Resolves the bearer access token to a server-side session. Headers such as x-user-id are
 * never read. Expired tokens answer SESSION_EXPIRED so the app refreshes; anything else that
 * cannot be verified answers AUTHENTICATION_REQUIRED. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    request.session = await this.resolve(request);
    return true;
  }
  async resolve(request: AppRequest): Promise<SessionContext> {
    if (request.session) return request.session;
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!token || !tokenPattern.test(token) || !this.database.configured) throw apiError(401, 'AUTHENTICATION_REQUIRED');
    const row = await this.database.identity(async client =>
      (await client.query('SELECT state, user_id, session_id FROM auth.resolve_session($1)', [sha256Hex(token)])).rows[0]);
    if (row?.state === 'active') return { userId: row.user_id, sessionId: row.session_id };
    throw apiError(401, row?.state === 'expired' ? 'SESSION_EXPIRED' : 'AUTHENTICATION_REQUIRED');
  }
}

export const Session = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AppRequest>().session!);
export const Tenant = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AppRequest>().tenant!);
export const RequestId = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<AppRequest>().requestId);
