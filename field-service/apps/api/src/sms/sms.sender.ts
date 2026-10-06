/** OTP delivery. Missing provider credentials fail closed. */
export abstract class SmsSender {
  abstract readonly delivery: 'development' | 'sms';
  abstract send(phoneE164: string, message: string): Promise<void>;
  async resolve(): Promise<SmsSender | null> { return this; }
}

/** Development only: writes the message to the API log instead of sending it. Refuses to exist
 * in production so a fake verification path can never ship. */
export class DevelopmentSmsSender extends SmsSender {
  readonly delivery = 'development' as const;
  constructor(production: boolean) {
    super();
    if (production) throw new Error('DEVELOPMENT_SMS_IN_PRODUCTION');
  }
  async send(phoneE164: string, message: string): Promise<void> {
    console.log(`[development SMS] to ${phoneE164}: ${message}`);
  }
}

export function deeSmsxSettings(env: NodeJS.ProcessEnv) {
  const apiKey = env.DEESMSX_API_KEY?.trim(), secretKey = env.DEESMSX_SECRET_KEY?.trim(), sender = env.DEESMSX_SENDER?.trim();
  return apiKey && secretKey && sender ? { apiKey, secretKey, sender } : null;
}

export class DeeSmsxSender extends SmsSender {
  readonly delivery = 'sms' as const;
  constructor(private readonly settings: NonNullable<ReturnType<typeof deeSmsxSettings>>) { super(); }
  async send(phoneE164: string, message: string): Promise<void> {
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164) || !message.trim()) throw new Error('SMS_INVALID_REQUEST');
    try {
      // No retry: a timeout can occur after the provider accepted a billable SMS.
      const response = await fetch('https://apicall.deesmsx.com/v1/SMSWebService', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...this.settings, to: phoneE164.slice(1), msg: message }),
      });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('SMS_REJECTED'); }
      // Published 200 schema has no specified fields. Acceptance is not handset delivery.
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('SMS_INVALID_RESPONSE');
    } catch { throw new Error('SMS_DELIVERY_UNAVAILABLE'); }
  }
}

/** THSMS (thsms.com API V2), used temporarily while testing (2026-10-06). Thai numbers only.
 * THSMS_SENDER must match an approved sender name exactly (case-sensitive), e.g. SMS or VIP. */
export function thsmsSettings(env: NodeJS.ProcessEnv) {
  const token = env.THSMS_TOKEN?.trim(), sender = env.THSMS_SENDER?.trim();
  return token && sender ? { token, sender } : null;
}

export class ThsmsSender extends SmsSender {
  readonly delivery = 'sms' as const;
  constructor(private readonly settings: NonNullable<ReturnType<typeof thsmsSettings>>) { super(); }
  async send(phoneE164: string, message: string): Promise<void> {
    if (!/^\+66\d{8,9}$/.test(phoneE164) || !message.trim()) throw new Error('SMS_INVALID_REQUEST');
    try {
      // No retry: a timeout can occur after the provider accepted a billable SMS.
      const response = await fetch('https://thsms.com/api/send-sms', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this.settings.token}` },
        body: JSON.stringify({ sender: this.settings.sender, msisdn: [`0${phoneE164.slice(3)}`], message }),
      });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('SMS_REJECTED'); }
      const result: unknown = await response.json();
      // Documented 200 body: { success: true, code: 200, message: 'OK', data: { credit_usage, remaining_credit } }.
      if (!result || typeof result !== 'object' || (result as { success?: unknown }).success !== true) throw new Error('SMS_INVALID_RESPONSE');
    } catch { throw new Error('SMS_DELIVERY_UNAVAILABLE'); }
  }
}

export function createSmsSender(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.SMS_PROVIDER ?? (production ? undefined : 'development');
  if (provider === 'development' && !production) return new DevelopmentSmsSender(production);
  if (provider === 'deesmsx') {
    const settings = deeSmsxSettings(env);
    return settings ? new DeeSmsxSender(settings) : null;
  }
  if (provider === 'thsms') {
    const settings = thsmsSettings(env);
    return settings ? new ThsmsSender(settings) : null;
  }
  return null;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
