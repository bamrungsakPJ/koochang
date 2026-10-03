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
    joinLinkBaseUrl: (env.JOIN_LINK_BASE_URL ?? (production ? '' : 'http://localhost:3000/join')).replace(/\/+$/, ''),
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
