/** SMS delivery. No production provider has been chosen yet, so production has no sender and
 * every OTP request answers 503 until one is configured (fail closed). */
export abstract class SmsSender {
  abstract readonly delivery: 'development' | 'sms';
  abstract send(phoneE164: string, message: string): Promise<void>;
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

export function createSmsSender(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.SMS_PROVIDER ?? (production ? undefined : 'development');
  if (provider === 'development' && !production) return new DevelopmentSmsSender(production);
  return null;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
