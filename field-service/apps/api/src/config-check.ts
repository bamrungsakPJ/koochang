import { loadAuthSettings, loadMediaSettings, loadPlatformSettings } from './config.js';

/** Settings a production start is missing, by name only (never values). Each missing item makes
 * its feature answer 503 (fail closed); the list is logged at start so it is noticed before a
 * shop is. Development defaults never count as configured in production. */
export function productionProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const auth = loadAuthSettings(env), media = loadMediaSettings(env), platform = loadPlatformSettings(env);
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL');
  if (!auth.otpSecret) problems.push('OTP_SECRET (32+ bytes base64)');
  if (!auth.joinLinkKey) problems.push('JOIN_LINK_KEY (32 bytes base64)');
  if (!auth.joinLinkBaseUrl.startsWith('https://')) problems.push('JOIN_LINK_BASE_URL (https)');
  if (!env.SMS_PROVIDER || env.SMS_PROVIDER === 'development') problems.push('SMS_PROVIDER (no production SMS provider chosen)');
  if (!media.mediaDir) problems.push('MEDIA_DIR');
  if (!media.urlSecret) problems.push('MEDIA_URL_SECRET (32+ bytes base64)');
  if (!env.OCR_PROVIDER || env.OCR_PROVIDER === 'development') problems.push('OCR_PROVIDER (OCR answers 503 until chosen)');
  if (!env.PLATFORM_DATABASE_URL) problems.push('PLATFORM_DATABASE_URL');
  if (!platform.secretKey) problems.push('PLATFORM_SECRET_KEY (32 bytes base64)');
  if (!platform.payment) problems.push('PAYMENT_BANK_NAME / PAYMENT_ACCOUNT_NAME / PAYMENT_ACCOUNT_NUMBER');
  if (!/^\d{3}$/.test(env.PAYMENT_BANK_CODE ?? '')) problems.push('PAYMENT_BANK_CODE (EasySlip three-digit bank code)');
  if (!env.EASYSLIP_API_KEY) problems.push('EASYSLIP_API_KEY');
  if (!env.SLIP_DATABASE_URL) problems.push('SLIP_DATABASE_URL (fs_worker)');
  const origins = (env.ADMIN_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (!origins.length || origins.some(o => !o.startsWith('https://'))) problems.push('ADMIN_ORIGIN (https origins only)');
  return problems;
}
