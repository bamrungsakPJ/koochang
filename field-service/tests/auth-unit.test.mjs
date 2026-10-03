import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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

test('images are verified, rotated, stripped of GPS metadata, resized and get a thumbnail', async () => {
  // sharp is a dependency of the API package, resolve it from there.
  const { default: sharp } = await import(pathToFileURL(createRequire(new URL('../apps/api/package.json', import.meta.url)).resolve('sharp')).href);
  const { processImage, InvalidImageError } = await import('../apps/api/dist/media/image.js');
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#88aacc' } })
    .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 45/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '100/1 30/1 0/1' } })
    .jpeg().toBuffer();
  assert.ok((await sharp(photo).metadata()).exif, 'fixture carries EXIF');
  const out = await processImage(photo, 5_000_000);
  const meta = await sharp(out.image).metadata();
  assert.equal(meta.exif, undefined, 'no EXIF (and so no GPS) in the stored image');
  assert.equal(Math.max(meta.width, meta.height), 2560);
  assert.ok(out.image.length <= 5_000_000);
  assert.ok(Math.max((await sharp(out.thumbnail).metadata()).width, (await sharp(out.thumbnail).metadata()).height) <= 400);
  assert.match(out.checksum, /^[0-9a-f]{64}$/);
  await assert.rejects(() => processImage(Buffer.from('not an image'), 5_000_000), e => e instanceof InvalidImageError);
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
  await assert.rejects(() => processImage(gif, 5_000_000), e => e.message === 'IMAGE_TYPE_NOT_ALLOWED');
});

test('download links expire and cannot be forged; storage keys cannot escape the media directory', async () => {
  const { signKey, verifyToken } = await import('../apps/api/dist/media/signed-url.js');
  const { LocalDiskStorage } = await import('../apps/api/dist/media/object-storage.js');
  const secret = randomBytes(32);
  const { token } = signKey(secret, 'org/2026/10/a.jpg', 60, 1_000_000);
  assert.equal(verifyToken(secret, token, 1_000_000), 'org/2026/10/a.jpg');
  assert.equal(verifyToken(secret, token, 1_000_000 + 61_000), null, 'expired');
  assert.equal(verifyToken(randomBytes(32), token, 1_000_000), null, 'other key');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ k: 'other/b.jpg', e: 9_999_999_999 })).toString('base64url');
  assert.equal(verifyToken(secret, `${forged}.${signature}`, 1_000_000), null, 'payload swapped');
  assert.ok(payload);
  const storage = new LocalDiskStorage(join(tmpdir(), `fs-media-${randomBytes(4).toString('hex')}`));
  for (const key of ['../etc/passwd.jpg', '/abs/x.jpg', 'a/../../x.jpg', 'x.exe']) await assert.rejects(() => storage.put(key, Buffer.from('x')), /INVALID_STORAGE_KEY/, key);
});

test('production refuses development OCR and push adapters', async () => {
  const { createOcrProvider, DevelopmentOcrProvider } = await import('../apps/api/dist/ocr/ocr.provider.js');
  const { createPushSender } = await import('../apps/api/dist/notifications/push.sender.js');
  const { loadMediaSettings } = await import('../apps/api/dist/config.js');
  assert.equal(createOcrProvider({ NODE_ENV: 'production', OCR_PROVIDER: 'development' }), null);
  assert.equal(createPushSender({ NODE_ENV: 'production', PUSH_PROVIDER: 'development' }), null);
  assert.throws(() => new DevelopmentOcrProvider(true));
  const prod = loadMediaSettings({ NODE_ENV: 'production' });
  assert.equal(prod.mediaDir, undefined);
  assert.equal(prod.urlSecret, undefined);
});
