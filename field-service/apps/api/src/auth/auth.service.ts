import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isThaiMobile, normalizePhone, type Language } from '@field-service/core';
import { AUTH_SETTINGS, type AuthSettings } from '../config.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, Validation, uuidPattern } from '../shared/api-error.js';
import { hmacHex, otpCode, randomToken, sha256Hex } from '../shared/crypto.js';
import { SMS_SENDER, type SmsSender } from '../sms/sms.sender.js';
import { hashPassword, verifyPassword } from '../platform/secrets.js';

export interface Tokens { access_token: string; refresh_token: string; access_expires_in: number; refresh_expires_in: number; }

/** Shop sign-in passwords: 8-200 characters, kept byte for byte (spaces count). */
export function passwordProblem(value: unknown): string | null {
  return typeof value !== 'string' || [...value].length < 8 || value.length > 200 ? 'field.password' : null;
}

/** ASCII SMS in either UI language; reference identifies this request, never the OTP. */
export const otpReference = (challengeId: string) => challengeId.replaceAll('-', '').slice(0, 6).toUpperCase();
export const otpSmsText = (code: string, reference: string) => `Your OTP For KooChang is ${code}, Ref: ${reference}`;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
    @Inject(SMS_SENDER) private readonly sms: SmsSender | null,
  ) {}

  async requestOtp(body: { phone?: unknown }, clientAddress: string | undefined, language: Language) {
    const check = new Validation();
    const phone = normalizePhone(body.phone);
    if (!phone || (phone.startsWith('+66') && !isThaiMobile(phone))) check.fail('phone', 'field.phone');
    check.done();
    let sms: SmsSender | null;
    try { sms = this.sms ? await this.sms.resolve() : null; } catch { throw apiError(503, 'TEMPORARILY_UNAVAILABLE'); }
    if (!sms || !this.settings.otpSecret) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');

    const challengeId = randomUUID();
    const code = otpCode();
    const s = this.settings;
    const row = await this.database.identity(async client => (await client.query(
      'SELECT challenge_id, expires_at, retry_after_seconds FROM auth.create_otp_challenge($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [challengeId, phone, hmacHex(s.otpSecret!, `${challengeId}:${code}`), clientAddress ? sha256Hex(`client:${clientAddress}`) : null,
        s.otpTtlSeconds, s.otpMaxAttempts, s.otpCooldownSeconds, s.otpPhoneHourlyLimit, s.otpClientHourlyLimit])).rows[0]);
    if (!row?.challenge_id) throw apiError(429, 'RATE_LIMITED', { retry_after: row?.retry_after_seconds ?? s.otpCooldownSeconds });
    const reference = otpReference(challengeId);
    try { await sms.send(phone!, otpSmsText(code, reference)); }
    catch { throw apiError(503, 'TEMPORARILY_UNAVAILABLE'); }
    return { challenge_id: challengeId, reference, expires_at: row.expires_at, resend_after: s.otpCooldownSeconds, delivery: sms.delivery };
  }

  async verifyOtp(body: { challenge_id?: unknown; code?: unknown; display_name?: unknown; preferred_language?: unknown }) {
    const check = new Validation();
    const challengeId = typeof body.challenge_id === 'string' && uuidPattern.test(body.challenge_id) ? body.challenge_id : undefined;
    if (!challengeId) check.fail('challenge_id', 'field.required');
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) check.fail('code', 'field.code');
    const displayName = check.text('display_name', body.display_name, { required: false, max: 80 });
    const language = body.preferred_language === 'en' || body.preferred_language === 'th' ? body.preferred_language : null;
    check.done();
    if (!this.settings.otpSecret) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');

    const pair = this.newPair();
    const row = await this.database.identity(async client => (await client.query(
      'SELECT outcome, user_id, is_new_user, session_id FROM auth.verify_otp($1,$2,$3,$4,$5,$6,$7,$8)',
      [challengeId, hmacHex(this.settings.otpSecret!, `${challengeId}:${code}`), displayName ?? null, language,
        pair.accessHash, this.settings.accessTtlSeconds, pair.refreshHash, this.settings.refreshTtlSeconds])).rows[0]);
    switch (row?.outcome) {
      case 'ok': {
        const status = await this.passwordStatus(row.user_id as string, row.session_id as string);
        return { ...pair.tokens, user_id: row.user_id as string, is_new_user: row.is_new_user as boolean, password_set: status.has_password };
      }
      case 'expired': throw apiError(400, 'OTP_EXPIRED');
      case 'attempts_exceeded': throw apiError(400, 'OTP_ATTEMPTS_EXCEEDED');
      case 'user_disabled': throw apiError(403, 'ACCOUNT_DISABLED');
      default: throw apiError(400, 'OTP_INVALID');
    }
  }

  /** Everyday sign-in: phone + password, no SMS. Unknown phone, no password yet and a wrong
   * password all answer PHONE_LOGIN_FAILED after the same hashing work. */
  async passwordLogin(body: { phone?: unknown; password?: unknown }, clientAddress: string | undefined) {
    const check = new Validation();
    const phone = normalizePhone(body.phone);
    if (!phone) check.fail('phone', 'field.phone');
    const password = typeof body.password === 'string' && body.password.length <= 200 ? body.password : '';
    if (!password) check.fail('password', 'field.required');
    check.done();
    const s = this.settings;
    const begin = await this.database.identity(async client => (await client.query(
      'SELECT outcome, user_id, password_hash, retry_after_seconds FROM auth.password_login_begin($1,$2,$3,$4,$5)',
      [phone, clientAddress ? sha256Hex(`client:${clientAddress}`) : null, s.passwordMaxFailures, s.passwordLockSeconds, s.passwordClientHourlyLimit])).rows[0]);
    if (begin?.outcome === 'rate_limited') throw apiError(429, 'RATE_LIMITED', { retry_after: begin.retry_after_seconds });
    if (begin?.outcome === 'locked') throw apiError(429, 'LOGIN_LOCKED', { retry_after: begin.retry_after_seconds });
    const ok = await verifyPassword(password, begin?.password_hash);
    if (!ok || !begin?.user_id) throw apiError(401, 'PHONE_LOGIN_FAILED');
    const pair = this.newPair();
    const row = await this.database.identity(async client => (await client.query(
      'SELECT outcome FROM auth.password_login_finish($1,$2,$3,$4,$5,$6)',
      [begin.user_id, begin.password_hash, pair.accessHash, s.accessTtlSeconds, pair.refreshHash, s.refreshTtlSeconds])).rows[0]);
    if (row?.outcome === 'user_disabled') throw apiError(403, 'ACCOUNT_DISABLED');
    if (row?.outcome !== 'ok') throw apiError(401, 'PHONE_LOGIN_FAILED');
    return { ...pair.tokens, user_id: begin.user_id as string, password_set: true };
  }

  passwordStatus(userId: string, sessionId: string): Promise<{ has_password: boolean; password_hash: string | null; fresh_otp: boolean }> {
    return this.database.identity(async client => (await client.query(
      'SELECT has_password, password_hash, fresh_otp FROM auth.password_status($1,$2,$3)',
      [userId, sessionId, this.settings.passwordResetWindowSeconds])).rows[0]);
  }

  /** Sets the first password, a new one right after an SMS code (forgot password), or changes it
   * with the current one. Other devices are signed out. */
  async setPassword(userId: string, sessionId: string, body: { password?: unknown; current_password?: unknown }) {
    const check = new Validation();
    const problem = passwordProblem(body.password);
    if (problem) check.fail('password', problem);
    const current = typeof body.current_password === 'string' && body.current_password.length <= 200 ? body.current_password : '';
    check.done();
    const status = await this.passwordStatus(userId, sessionId);
    let via: 'first' | 'otp' | 'current';
    if (!status.has_password) via = 'first';
    else if (current) {
      // Same lockout as sign-in, so a stolen session cannot guess the current password.
      const s = this.settings;
      const begin = await this.database.identity(async client => (await client.query(
        'SELECT b.outcome, b.retry_after_seconds FROM auth.user_profile($1) p, auth.password_login_begin(p.phone_e164,NULL,$2,$3,$4) b',
        [userId, s.passwordMaxFailures, s.passwordLockSeconds, s.passwordClientHourlyLimit])).rows[0]);
      if (begin?.outcome === 'locked') throw apiError(429, 'LOGIN_LOCKED', { retry_after: begin.retry_after_seconds });
      if (!await verifyPassword(current, status.password_hash)) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { current_password: 'field.currentPassword' } });
      via = 'current';
    } else if (status.fresh_otp) via = 'otp';
    else throw apiError(403, 'PASSWORD_CHANGE_NOT_ALLOWED');
    const outcome = await this.database.identity(async client => (await client.query(
      'SELECT auth.set_password($1,$2,$3,$4,$5,$6) AS outcome',
      [userId, sessionId, via, status.password_hash, await hashPassword(body.password as string), this.settings.passwordResetWindowSeconds])).rows[0]?.outcome);
    if (outcome === 'conflict') throw apiError(409, 'VERSION_CONFLICT');
    if (outcome !== 'ok') throw apiError(403, 'PASSWORD_CHANGE_NOT_ALLOWED');
    return { password_set: true };
  }

  async refresh(body: { refresh_token?: unknown }): Promise<Tokens> {
    const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw apiError(401, 'AUTHENTICATION_REQUIRED');
    const pair = this.newPair();
    const row = await this.database.identity(async client => (await client.query(
      'SELECT outcome FROM auth.refresh_session($1,$2,$3,$4,$5)',
      [sha256Hex(token), pair.accessHash, this.settings.accessTtlSeconds, pair.refreshHash, this.settings.refreshTtlSeconds])).rows[0]);
    if (row?.outcome === 'ok') return pair.tokens;
    throw apiError(401, row?.outcome === 'expired' ? 'SESSION_EXPIRED' : 'AUTHENTICATION_REQUIRED');
  }

  async logout(sessionId: string): Promise<void> {
    await this.database.identity(client => client.query('SELECT auth.revoke_session($1)', [sessionId]));
  }

  private newPair() {
    const access = randomToken(), refresh = randomToken();
    return {
      accessHash: sha256Hex(access), refreshHash: sha256Hex(refresh),
      tokens: { access_token: access, refresh_token: refresh, access_expires_in: this.settings.accessTtlSeconds, refresh_expires_in: this.settings.refreshTtlSeconds },
    };
  }
}
