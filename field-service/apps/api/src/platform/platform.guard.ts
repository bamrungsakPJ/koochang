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
/** Money and access actions need a recent TOTP confirmation. Whether, and how many minutes it lasts, is the
 * system policy (step_up_enabled, step_up_minutes; default on, 60 minutes); each protected action restarts it. */
export const StepUp = () => SetMetadata(STEP_UP, true);
export const STEP_UP_DEFAULT_MINUTES = 60;

export const Account = createParamDecorator((_: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<PlatformRequest>().platform!);

/** Platform console session: separate tokens from the shop app, full (MFA-passed) sessions only. */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly database: PlatformDatabaseService, private readonly reflector: Reflector) {}
  /** Read on each protected action (they are few), so a policy change applies at once. */
  private async stepUpPolicy() {
    const v = await this.database.run(async c => (await c.query('SELECT padmin.step_up_policy() AS v')).rows[0]?.v);
    const minutes = Number(v?.minutes);
    return { enabled: v?.enabled !== false, minutes: Number.isInteger(minutes) && minutes >= 5 && minutes <= 720 ? minutes : STEP_UP_DEFAULT_MINUTES };
  }
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
    // A super admin may do everything (owner decision 2026-10-04); SQL functions check the same way.
    if (needed && !row.roles.includes('super_admin') && !row.permissions.includes(needed)) throw apiError(403, 'PERMISSION_DENIED');
    const stepUp = this.reflector.getAllAndOverride<boolean | undefined>(STEP_UP, [context.getHandler(), context.getClass()]);
    if (stepUp) {
      const policy = await this.stepUpPolicy();
      if (policy.enabled) {
        if (!row.step_up_at || Date.now() - new Date(row.step_up_at).getTime() > policy.minutes * 60_000) throw apiError(403, 'STEP_UP_REQUIRED');
        await this.database.run(c => c.query('SELECT padmin.touch_step_up($1)', [row.session_id]));
      }
    }
    return true;
  }
}
