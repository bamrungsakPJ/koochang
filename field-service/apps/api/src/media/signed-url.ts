import { createHmac, timingSafeEqual } from 'node:crypto';

/** Short-lived download tokens: base64url({k: storage key, e: expiry}) + '.' + HMAC. Anyone
 * holding the URL can fetch the file until it expires, so the lifetime is kept short and the
 * URL is only issued after the permission check. */
export function signKey(secret: Buffer, key: string, ttlSeconds: number, now = Date.now()): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now + ttlSeconds * 1000);
  const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  return { token: `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`, expiresAt };
}

export function verifyToken(secret: Buffer, token: string, now = Date.now()): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k: string; e: number };
    return typeof k === 'string' && typeof e === 'number' && e * 1000 > now ? k : null;
  } catch { return null; }
}
