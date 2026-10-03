import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import core from '../packages/core/dist/index.js';
import { createSmsSender, DevelopmentSmsSender } from '../apps/api/dist/sms/sms.sender.js';
import { loadAuthSettings } from '../apps/api/dist/config.js';
import { decrypt, encrypt, otpCode, randomToken, tokenPattern } from '../apps/api/dist/shared/crypto.js';

test('production has no SMS sender until a provider is configured, and never the development one', () => {
  assert.equal(createSmsSender({ NODE_ENV: 'production' }), null);
  assert.equal(createSmsSender({ NODE_ENV: 'production', SMS_PROVIDER: 'development' }), null);
  assert.throws(() => new DevelopmentSmsSender(true), /DEVELOPMENT_SMS_IN_PRODUCTION/);
  assert.equal(createSmsSender({ NODE_ENV: 'development' })?.delivery, 'development');
});

test('missing or short secrets disable OTP and join links instead of using defaults', () => {
  const settings = loadAuthSettings({ NODE_ENV: 'production', OTP_SECRET: 'short', JOIN_LINK_KEY: randomBytes(16).toString('base64') });
  assert.equal(settings.otpSecret, undefined);
  assert.equal(settings.joinLinkKey, undefined);
  assert.equal(settings.joinLinkBaseUrl, '');
});

test('join link tokens are random, url-safe and decrypt only with the same key', () => {
  const key = randomBytes(32);
  const token = randomToken();
  assert.match(token, tokenPattern);
  assert.notEqual(randomToken(), token);
  const sealed = encrypt(key, token);
  assert.equal(decrypt(key, sealed), token);
  assert.throws(() => decrypt(randomBytes(32), sealed));
  assert.match(otpCode(), /^\d{6}$/);
});

test('Thai phone numbers normalize to E.164 and only mobiles receive SMS', () => {
  assert.equal(core.normalizePhone('081-234-5678'), '+66812345678');
  assert.equal(core.normalizePhone('+66 81 234 5678'), '+66812345678');
  assert.equal(core.normalizePhone('12345'), null);
  assert.equal(core.isThaiMobile('+66812345678'), true);
  assert.equal(core.isThaiMobile(core.normalizePhone('021234567')), false);
  assert.equal(core.formatPhone('+66812345678'), '081-234-5678');
});
