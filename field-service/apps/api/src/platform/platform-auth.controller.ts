import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { apiError, Validation } from '../shared/api-error.js';
import { decrypt, randomToken, sha256Hex, tokenPattern } from '../shared/crypto.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, PlatformGuard, STEP_UP_DEFAULT_MINUTES, type PlatformAccount } from './platform.guard.js';
import { verifyPassword, verifyTotp } from './secrets.js';

/** Platform console sign-in: email + password, then a TOTP code (MFA is mandatory). Accounts
 * are created with scripts/platform-account.mjs; there is no sign-up and no built-in root. Every
 * failure answers the same LOGIN_FAILED so the response never reveals which emails exist. */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly database: PlatformDatabaseService, @Inject(PLATFORM_SETTINGS) private readonly settings: PlatformSettings) {}

  @Post('login') @HttpCode(200)
  async login(@Body() body: Record<string, unknown> = {}, @Req() request: { headers: Record<string, string | undefined> }) {
    if (!this.settings.secretKey) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const check = new Validation();
    const email = check.text('email', body.email, { max: 254 });
    const password = typeof body.password === 'string' && body.password.length <= 200 ? body.password : (check.fail('password', 'field.required'), '');
    check.done();
    const account = await this.database.run(async c => (await c.query('SELECT * FROM padmin.login_account($1)', [email])).rows[0]);
    const passwordOk = await verifyPassword(password, account?.password_hash);
    const usable = account && account.status === 'active' && account.totp_secret_sealed && (!account.locked_until || new Date(account.locked_until) <= new Date());
    if (!passwordOk || !usable) {
      if (account && account.status === 'active') await this.database.run(c => c.query('SELECT padmin.record_login_failure($1)', [account.id]));
      throw apiError(401, 'LOGIN_FAILED');
    }
    const token = randomToken();
    await this.database.run(c => c.query('SELECT padmin.create_session($1,$2,$3)', [account.id, sha256Hex(token), request.headers['user-agent'] ?? null]));
    return { mfa_token: token, expires_in: 300 };
  }

  @Post('mfa') @HttpCode(200)
  async mfa(@Body() body: Record<string, unknown> = {}) {
    const token = typeof body.mfa_token === 'string' && tokenPattern.test(body.mfa_token) ? body.mfa_token : null;
    if (!token) throw apiError(401, 'LOGIN_FAILED');
    const result = await this.checkCode(sha256Hex(token), body.code, false);
    return { access_token: token, expires_at: result.expires_at };
  }

  @Post('step-up') @HttpCode(200) @UseGuards(PlatformGuard)
  async stepUp(@Account() account: PlatformAccount, @Body() body: Record<string, unknown> = {}) {
    await this.checkCode(account.tokenHash, body.code, true);
    const minutes = Number((await this.database.run(async c => (await c.query('SELECT padmin.step_up_policy() AS v')).rows[0]?.v))?.minutes) || STEP_UP_DEFAULT_MINUTES;
    return { step_up_until: new Date(Date.now() + minutes * 60_000).toISOString() };
  }

  @Post('logout') @HttpCode(200) @UseGuards(PlatformGuard)
  async logout(@Account() account: PlatformAccount) {
    await this.database.run(c => c.query('SELECT padmin.revoke_session($1)', [account.tokenHash]));
    return { ok: true };
  }

  @Get('me') @UseGuards(PlatformGuard)
  me(@Account() account: PlatformAccount) {
    return { id: account.accountId, display_name: account.displayName, email: account.email, preferred_language: account.language,
      roles: account.roles, permissions: account.permissions, step_up_at: account.stepUpAt };
  }

  private async checkCode(tokenHash: string, code: unknown, stepUp: boolean) {
    const row = await this.database.run(async c => (await c.query('SELECT * FROM padmin.session_totp($1)', [tokenHash])).rows[0]);
    if (!row || row.mfa_pending === stepUp || !row.totp_secret_sealed) throw apiError(401, stepUp ? 'MFA_INVALID' : 'LOGIN_FAILED');
    let step: number | null = null;
    try { step = verifyTotp(decrypt(this.settings.secretKey!, row.totp_secret_sealed), typeof code === 'string' ? code.trim() : ''); } catch { step = null; }
    const outcome = step === null ? null : await this.database.run(async c => (await c.query('SELECT * FROM padmin.mfa_passed($1,$2,$3)', [tokenHash, step, stepUp])).rows[0]);
    if (!outcome || outcome.outcome !== 'ok') {
      await this.database.run(c => c.query('SELECT padmin.record_login_failure($1)', [row.account_id]));
      throw apiError(stepUp ? 403 : 401, stepUp ? 'MFA_INVALID' : 'LOGIN_FAILED');
    }
    return outcome as { expires_at: Date };
  }
}
