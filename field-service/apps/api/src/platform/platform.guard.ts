import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { apiError } from '../shared/api-error.js';
import { sha256Hex, tokenPattern } from '../shared/crypto.js';
import { PlatformDatabaseService } from './platform-database.service.js';

export interface PlatformAccount {
  sessionId: string; accountId: string; displayName: string; email: string; language: string;
  permissions: string[]; roles: string[]; stepUpAt: Date | null; tokenHash: string;
}
interface PlatformRequest { headers: Record<string, string | undefined>; platform?: PlatformAccount; requestId: string }

const PERMISSION = 'platform:permission';
const STEP_UP = 'platform:step-up';
/** Permission code the endpoint needs (checked here and again in the padmin function). */
export const Permission = (code: string) => SetMetadata(PERMISSION, code);
/** Money and access actions need a TOTP confirmation within the last 10 minutes. */
export const StepUp = () => SetMetadata(STEP_UP, true);
export const STEP_UP_WINDOW_MS = 10 * 60_000;

export const Account = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<PlatformRequest>().platform!);

/** Platform console session: separate tokens from the shop app, full (MFA-passed) sessions only. */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly database: PlatformDatabaseService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!token || !tokenPattern.test(token)) throw apiError(401, 'AUTHENTICATION_REQUIRED');
    const tokenHash = sha256Hex(token);
    const row = await this.database.run(async client => (await client.query('SELECT * FROM padmin.resolve_session($1)', [tokenHash])).rows[0]);
    if (!row || row.mfa_pending) throw apiError(401, 'AUTHENTICATION_REQUIRED');
    request.platform = { sessionId: row.session_id, accountId: row.account_id, displayName: row.display_name, email: row.email, language: row.preferred_language,
      permissions: row.permissions, roles: row.roles, stepUpAt: row.step_up_at, tokenHash };
    const needed = this.reflector.getAllAndOverride<string | undefined>(PERMISSION, [context.getHandler(), context.getClass()]);
    if (needed && !row.permissions.includes(needed)) throw apiError(403, 'PERMISSION_DENIED');
    const stepUp = this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP, [context.getHandler(), context.getClass()]);
    if (stepUp && (!row.step_up_at || Date.now() - new Date(row.step_up_at).getTime() > STEP_UP_WINDOW_MS)) throw apiError(403, 'STEP_UP_REQUIRED');
    return true;
  }
}
