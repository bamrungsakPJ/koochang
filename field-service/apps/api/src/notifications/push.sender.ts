/** Push delivery. No provider is chosen yet (Expo push / FCM / APNs need app builds and keys).
 * Without one, queued pushes are marked skipped; the in-app inbox still has every notification. */
export type PushOutcome = 'sent' | 'invalid_token';
export class TemporaryPushError extends Error {}

export interface PushMessage { token: string; platform: string; title: string; body: string; data: Record<string, string>; }

export abstract class PushSender {
  abstract readonly name: string;
  abstract send(message: PushMessage): Promise<PushOutcome>;
}

/** Development only: logs the message instead of sending it. */
export class DevelopmentPushSender extends PushSender {
  readonly name = 'development';
  constructor(production: boolean) { super(); if (production) throw new Error('DEVELOPMENT_PUSH_IN_PRODUCTION'); }
  async send(message: PushMessage): Promise<PushOutcome> {
    console.log(`[development push] ${message.platform}: ${message.title} — ${message.body}`);
    return 'sent';
  }
}

export function createPushSender(env: NodeJS.ProcessEnv = process.env): PushSender | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.PUSH_PROVIDER ?? (production ? undefined : 'development');
  return provider === 'development' && !production ? new DevelopmentPushSender(production) : null;
}
