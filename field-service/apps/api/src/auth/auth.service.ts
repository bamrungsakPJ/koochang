import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isThaiMobile, normalizePhone, type Language } from '@field-service/core';
import { AUTH_SETTINGS, type AuthSettings } from '../config.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, Validation, uuidPattern } from '../shared/api-error.js';
import { hmacHex, otpCode, randomToken, sha256Hex } from '../shared/crypto.js';
import { SMS_SENDER, type SmsSender } from '../sms/sms.sender.js';

export interface Tokens { access_token: string; refresh_token: string; access_expires_in: number; refresh_expires_in: number; }

const smsText: Record<Language, (code: string, minutes: number) => string> = {
  th: (code, minutes) => `รหัสยืนยัน ${code} ใช้ได้ ${minutes} นาที ห้ามบอกรหัสนี้กับผู้อื่น`,
  en: (code, minutes) => `Your verification code is ${code}. It expires in ${minutes} minutes. Do not share it.`,
};

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
    try { await sms.send(phone!, smsText[language](code, Math.round(s.otpTtlSeconds / 60))); }
    catch { throw apiError(503, 'TEMPORARILY_UNAVAILABLE'); }
    return { challenge_id: challengeId, expires_at: row.expires_at, resend_after: s.otpCooldownSeconds, delivery: sms.delivery };
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
      'SELECT outcome, user_id, is_new_user FROM auth.verify_otp($1,$2,$3,$4,$5,$6,$7,$8)',
      [challengeId, hmacHex(this.settings.otpSecret!, `${challengeId}:${code}`), displayName ?? null, language,
        pair.accessHash, this.settings.accessTtlSeconds, pair.refreshHash, this.settings.refreshTtlSeconds])).rows[0]);
    switch (row?.outcome) {
      case 'ok': return { ...pair.tokens, user_id: row.user_id as string, is_new_user: row.is_new_user as boolean };
      case 'expired': throw apiError(400, 'OTP_EXPIRED');
      case 'attempts_exceeded': throw apiError(400, 'OTP_ATTEMPTS_EXCEEDED');
      case 'user_disabled': throw apiError(403, 'ACCOUNT_DISABLED');
      default: throw apiError(400, 'OTP_INVALID');
    }
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
