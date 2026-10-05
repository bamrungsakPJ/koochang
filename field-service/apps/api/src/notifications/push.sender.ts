import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Push delivery. Production uses Firebase Cloud Messaging (Android first; iOS later through the
 * same Firebase project with an APNs key). Without a provider, queued pushes are marked skipped;
 * the in-app inbox still has every notification. */
export type PushOutcome = 'sent' | 'invalid_token' | 'skipped';
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

export interface FcmAccount { projectId: string; clientEmail: string; privateKey: string }

/** Reads the Firebase service account file (FCM_SERVICE_ACCOUNT_FILE). The file stays on the
 * server, outside git; only the three fields needed to sign are kept. */
export function fcmAccount(env: NodeJS.ProcessEnv): FcmAccount | null {
  const file = env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!file) return null;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    const account = { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
    return Object.values(account).every(v => typeof v === 'string' && v) ? account : null;
  } catch { return null; }
}

const scope = 'https://www.googleapis.com/auth/firebase.messaging';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** FCM HTTP v1. Only Android device tokens are sent for now; other platforms are skipped. */
export class FcmPushSender extends PushSender {
  readonly name = 'fcm';
  private access: { token: string; expiresAt: number } | null = null;
  constructor(private readonly account: FcmAccount, private readonly now: () => number = Date.now) { super(); }

  /** OAuth access token from a self-signed service-account JWT, cached until a minute before expiry. */
  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > this.now()) return this.access.token;
    const iat = Math.floor(this.now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
      iss: this.account.clientEmail, scope, aud: tokenUrl, iat, exp: iat + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.privateKey);
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }),
      });
    } catch { throw new TemporaryPushError('FCM_AUTH_UNAVAILABLE'); }
    if (!response.ok) { await response.body?.cancel(); throw response.status >= 500 ? new TemporaryPushError('FCM_AUTH_UNAVAILABLE') : new Error('FCM_AUTH_REJECTED'); }
    const result = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof result.access_token !== 'string') throw new Error('FCM_AUTH_INVALID_RESPONSE');
    const seconds = typeof result.expires_in === 'number' ? result.expires_in : 3600;
    this.access = { token: result.access_token, expiresAt: this.now() + (seconds - 60) * 1000 };
    return this.access.token;
  }

  async send(message: PushMessage): Promise<PushOutcome> {
    if (message.platform !== 'android') return 'skipped';
    const access = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.projectId)}/messages:send`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
        body: JSON.stringify({ message: {
          token: message.token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'HIGH', notification: { channel_id: 'default' } },
        } }),
      });
    } catch { throw new TemporaryPushError('FCM_UNAVAILABLE'); }
    if (response.ok) { await response.body?.cancel(); return 'sent'; }
    const code = await fcmErrorCode(response);
    // The device uninstalled the app or the token belongs to another Firebase project.
    if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return 'invalid_token';
    if (response.status === 401 || response.status === 403) this.access = null;
    if (response.status === 401 || response.status === 429 || response.status >= 500) throw new TemporaryPushError(`FCM_${code ?? response.status}`);
    // INVALID_ARGUMENT and the rest are not retried, but the token is kept: a payload problem must
    // never revoke every device.
    throw new Error(`FCM_${code ?? response.status}`);
  }
}

async function fcmErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { error?: { status?: unknown; details?: { errorCode?: unknown }[] } };
    const detail = body.error?.details?.find(d => typeof d?.errorCode === 'string')?.errorCode;
    const code = detail ?? body.error?.status;
    return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : null;
  } catch { return null; }
}

export function createPushSender(env: NodeJS.ProcessEnv = process.env): PushSender | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.PUSH_PROVIDER ?? (production ? undefined : 'development');
  if (provider === 'development' && !production) return new DevelopmentPushSender(production);
  if (provider === 'fcm') {
    const account = fcmAccount(env);
    return account ? new FcmPushSender(account) : null;
  }
  return null;
}
