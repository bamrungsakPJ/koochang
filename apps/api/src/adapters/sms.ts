import { Injectable, Logger } from '@nestjs/common';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(phoneE164: string, message: string): Promise<void>;
}

/** Dev only: prints the SMS to the log instead of sending it. */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  async send(phoneE164: string, message: string): Promise<void> {
    this.logger.log(`→ ${phoneE164}: ${message}`);
  }
}
