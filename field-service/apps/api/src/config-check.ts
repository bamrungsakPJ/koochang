import { loadAuthSettings, loadMediaSettings, loadPlatformSettings } from './config.js';
import { deeSmsxSettings, thsmsSettings } from './sms/sms.sender.js';
import { fcmAccount } from './notifications/push.sender.js';

/** Settings a production start is missing, by name only (never values). Each missing item makes
 * its feature answer 503 (fail closed); the list is logged at start so it is noticed before a
 * shop is. Development defaults never count as configured in production. */
export function productionProblems(env: NodeJS.ProcessEnv = process.env, saved?: import('./platform/runtime-settings.service.js').RuntimeSettings | null): string[] {
  if (env.NODE_ENV !== 'production') return [];
  // Console rows override env, including explicitly disabled services. Diagnostics use markers,
  // never decrypt or print credentials.
  if(saved){
    env={...env};
    if(saved.bank){const bank=saved.bank.enabled?saved.bank:undefined;
      env.PAYMENT_BANK_NAME=bank?.bankName;env.PAYMENT_ACCOUNT_NAME=bank?.accountName;
      env.PAYMENT_ACCOUNT_NUMBER=bank?.accountNumber;env.PAYMENT_BANK_CODE=bank?.bankCode;}
    if(saved.sms&&env.SMS_PROVIDER!=='thsms'){env.SMS_PROVIDER=saved.sms.enabled?'deesmsx':undefined;env.DEESMSX_SENDER=saved.sms.sender;
      env.DEESMSX_API_KEY=saved.sms.apiKeySealed?'configured':undefined;env.DEESMSX_SECRET_KEY=saved.sms.secretKeySealed?'configured':undefined;}
    if(saved.ocr){env.OCR_PROVIDER=saved.ocr.enabled?'claude':undefined;env.ANTHROPIC_API_KEY=saved.ocr.enabled&&saved.ocr.keySealed?'configured':undefined;}
    if(saved.easyslip)env.EASYSLIP_API_KEY=saved.easyslip.enabled&&saved.easyslip.keySealed?'configured':undefined;
  }
  const auth = loadAuthSettings(env), media = loadMediaSettings(env), platform = loadPlatformSettings(env);
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL');
  if (!auth.otpSecret) problems.push('OTP_SECRET (32+ bytes base64)');
  if (!auth.joinLinkKey) problems.push('JOIN_LINK_KEY (32 bytes base64)');
  if (!auth.joinLinkBaseUrl.startsWith('https://')) problems.push('JOIN_LINK_BASE_URL (https)');
  if (env.SMS_PROVIDER === 'thsms') {
    for (const name of ['THSMS_TOKEN', 'THSMS_SENDER']) if (!thsmsSettings(env) && !env[name]?.trim()) problems.push(name);
  } else if (env.SMS_PROVIDER !== 'deesmsx') problems.push('SMS_PROVIDER (deesmsx or thsms required for production SMS)');
  else if (!deeSmsxSettings(env)) {
    for (const name of ['DEESMSX_API_KEY', 'DEESMSX_SECRET_KEY', 'DEESMSX_SENDER']) {
      if (!env[name]?.trim()) problems.push(name);
    }
  }
  if (!media.mediaDir) problems.push('MEDIA_DIR');
  if (!media.urlSecret) problems.push('MEDIA_URL_SECRET (32+ bytes base64)');
  if (env.OCR_PROVIDER !== 'claude') problems.push('OCR_PROVIDER (claude; OCR answers 503 until set)');
  else if (!env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY (OCR answers 503 until set)');
  if (env.PUSH_PROVIDER !== 'fcm') problems.push('PUSH_PROVIDER (fcm; pushes are skipped until set, the in-app inbox still works)');
  else if (!fcmAccount(env)) problems.push('FCM_SERVICE_ACCOUNT_FILE (readable Firebase service account JSON; pushes are skipped until set)');
  if (!env.PLATFORM_DATABASE_URL) problems.push('PLATFORM_DATABASE_URL');
  if (!platform.secretKey) problems.push('PLATFORM_SECRET_KEY (32 bytes base64)');
  if (!platform.payment) problems.push('PAYMENT_BANK_NAME / PAYMENT_ACCOUNT_NAME / PAYMENT_ACCOUNT_NUMBER');
  if (!/^\d{3}$/.test(env.PAYMENT_BANK_CODE ?? '')) problems.push('PAYMENT_BANK_CODE (EasySlip three-digit bank code)');
  if (!env.EASYSLIP_API_KEY) problems.push('EASYSLIP_API_KEY');
  if (!env.SLIP_DATABASE_URL) problems.push('SLIP_DATABASE_URL (fs_worker)');
  if (env.PAYMENT_DATABASE_URL && !env.OWNER_WEB_URL?.startsWith('https://')) problems.push('OWNER_WEB_URL (https Stripe return URL)');
  const origins = (env.ADMIN_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (!origins.length || origins.some(o => !o.startsWith('https://'))) problems.push('ADMIN_ORIGIN (https origins only)');
  return problems;
}
