import { Injectable, Logger } from '@nestjs/common';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(phoneE164: string, message: string): Promise<void>;
}

export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly providerCode?: string,
  ) {
    super(message);
  }
}

/** Dev only: prints the SMS to the log instead of sending it. */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  async send(phoneE164: string, message: string): Promise<void> {
    this.logger.log(`→ ${phoneE164}: ${message}`);
  }
}

export interface DeeSmsxConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  sender: string;
}

/**
 * DEESMSX Send SMS API — https://deesmsx.readme.io/reference/getting-started-with-your-api
 * POST /v1/SMSWebService { apiKey, secretKey, to: "66xxxxxxxxx", sender, msg }
 * Response: { error: "0", msg, status, credit_balance } — anything but error "0" is a failure
 * (99 bad number, 100 sender not found, 101 contact admin, 102 out of credit).
 */
export class DeeSmsxSender implements SmsSender {
  private readonly logger = new Logger('SMS:DEESMSX');

  constructor(
    private readonly config: DeeSmsxConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phoneE164: string, message: string): Promise<void> {
    const to = phoneE164.replace(/^\+/, '');
    const masked = `…${to.slice(-4)}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/v1/SMSWebService`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          apiKey: this.config.apiKey,
          secretKey: this.config.secretKey,
          to,
          sender: this.config.sender,
          msg: message,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`send to ${masked} failed: ${(err as Error).message}`);
      throw new SmsSendError('SMS provider unreachable');
    }

    let body: { error?: unknown; msg?: unknown; credit_balance?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON body: handled as a failure below.
    }

    const code = body.error === undefined ? undefined : String(body.error);
    if (!res.ok || code !== '0') {
      this.logger.error(`send to ${masked} rejected: http=${res.status} code=${code ?? '-'} msg=${String(body.msg ?? '')}`);
      if (code === '102') this.logger.error('DEESMSX credit exhausted — top up to keep OTP working');
      throw new SmsSendError(`SMS provider rejected the message (code ${code ?? res.status})`, code);
    }
    this.logger.log(`sent to ${masked} (credit balance: ${String(body.credit_balance ?? '?')})`);
  }
}
