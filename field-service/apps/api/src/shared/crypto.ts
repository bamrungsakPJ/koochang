import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

/** 256-bit random token, base64url (43 characters). */
export function randomToken(): string { return randomBytes(32).toString('base64url'); }
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function hmacHex(key: Buffer, value: string): string { return createHmac('sha256', key).update(value).digest('hex'); }

/** Six digits from a CSPRNG, zero padded. */
export function otpCode(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decrypt(key: Buffer, sealed: string): string {
  const data = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
