/** Runtime settings read once from the environment. Missing secrets do not stop the API from
 * starting; the features that need them answer 503 TEMPORARILY_UNAVAILABLE (fail closed). */
export interface AuthSettings {
  production: boolean;
  /** HMAC key for OTP codes. */
  otpSecret?: Buffer;
  /** AES-256-GCM key for join link tokens kept for re-sharing. */
  joinLinkKey?: Buffer;
  joinLinkBaseUrl: string;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpCooldownSeconds: number;
  otpPhoneHourlyLimit: number;
  otpClientHourlyLimit: number;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

function secret(value: string | undefined, minBytes: number): Buffer | undefined {
  if (!value) return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= minBytes ? bytes : undefined;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadAuthSettings(env: NodeJS.ProcessEnv = process.env): AuthSettings {
  const production = env.NODE_ENV === 'production';
  const joinKey = secret(env.JOIN_LINK_KEY, 32);
  return {
    production,
    otpSecret: secret(env.OTP_SECRET, 32),
    joinLinkKey: joinKey && joinKey.length === 32 ? joinKey : undefined,
    joinLinkBaseUrl: (env.JOIN_LINK_BASE_URL ?? (production ? '' : 'http://localhost:3001/join')).replace(/\/+$/, ''),
    otpTtlSeconds: int(env.OTP_TTL_SECONDS, 300),
    otpMaxAttempts: int(env.OTP_MAX_ATTEMPTS, 5),
    otpCooldownSeconds: int(env.OTP_COOLDOWN_SECONDS, 60),
    otpPhoneHourlyLimit: int(env.OTP_PHONE_HOURLY_LIMIT, 5),
    otpClientHourlyLimit: int(env.OTP_CLIENT_HOURLY_LIMIT, 20),
    accessTtlSeconds: int(env.ACCESS_TOKEN_TTL_SECONDS, 1800),
    refreshTtlSeconds: int(env.REFRESH_TOKEN_TTL_SECONDS, 60 * 24 * 3600),
  };
}

export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');

/** File storage and background providers (A04). Production must configure them explicitly. */
export interface MediaSettings {
  production: boolean;
  /** Private directory for stored files (LocalDiskStorage). */
  mediaDir?: string;
  /** HMAC key for short-lived download URLs. */
  urlSecret?: Buffer;
  urlTtlSeconds: number;
  maxUploadBytes: number;
  maxStoredBytes: number;
}

export function loadMediaSettings(env: NodeJS.ProcessEnv = process.env): MediaSettings {
  const production = env.NODE_ENV === 'production';
  return {
    production,
    mediaDir: env.MEDIA_DIR || (production ? undefined : '.media'),
    urlSecret: secret(env.MEDIA_URL_SECRET, 32) ?? (production ? undefined : Buffer.from('development-only-media-url-secret-change-me')),
    urlTtlSeconds: int(env.MEDIA_URL_TTL_SECONDS, 300),
    maxUploadBytes: int(env.MAX_UPLOAD_BYTES, 12_000_000),
    maxStoredBytes: 5_000_000,
  };
}

export const MEDIA_SETTINGS = Symbol('MEDIA_SETTINGS');

/** Platform console and bank-transfer payments (C01). */
export interface PlatformSettings {
  production: boolean;
  /** AES-256-GCM key sealing platform TOTP secrets. */
  secretKey?: Buffer;
  /** Receiving account shown on invoices; without it owners cannot create invoices (503). */
  payment?: { bankName: string; accountName: string; accountNumber: string; bankCode?: string; promptPayId?: string };
}

export function loadPlatformSettings(env: NodeJS.ProcessEnv = process.env): PlatformSettings {
  const production = env.NODE_ENV === 'production';
  const key = secret(env.PLATFORM_SECRET_KEY, 32);
  const payment = env.PAYMENT_BANK_NAME && env.PAYMENT_ACCOUNT_NAME && env.PAYMENT_ACCOUNT_NUMBER
    ? { bankName: env.PAYMENT_BANK_NAME, accountName: env.PAYMENT_ACCOUNT_NAME, accountNumber: env.PAYMENT_ACCOUNT_NUMBER, bankCode: env.PAYMENT_BANK_CODE, promptPayId: env.PAYMENT_PROMPTPAY_ID || undefined }
    : undefined;
  return { production, secretKey: key && key.length === 32 ? key : undefined, payment };
}

export const PLATFORM_SETTINGS = Symbol('PLATFORM_SETTINGS');
