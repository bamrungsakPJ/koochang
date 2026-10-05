import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPushSender, FcmPushSender, TemporaryPushError } from '../apps/api/dist/notifications/push.sender.js';
import { productionProblems } from '../apps/api/dist/config-check.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const file = join(tmpdir(), `fs-fcm-${randomBytes(4).toString('hex')}.json`);
writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'synthetic-project', client_email: 'push@synthetic-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
const env = { NODE_ENV: 'production', PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_FILE: file };
const message = { token: 'synthetic-device-token-123', platform: 'android', title: 'คู่ช่าง', body: 'งานใหม่', data: { organization_id: 'o', target_type: 'job', target_id: 'j' } };

/** Fake Google endpoints: token exchange, then FCM send answers taken from `replies` in order. */
function fakeGoogle(t, replies = []) {
  const calls = { token: [], send: [] };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      calls.token.push(new URLSearchParams(options.body.toString()));
      return Response.json({ access_token: `access-${calls.token.length}`, expires_in: 3600 });
    }
    calls.send.push({ url, options, body: JSON.parse(options.body) });
    const reply = replies.shift() ?? { status: 200, body: { name: 'projects/synthetic-project/messages/1' } };
    return Response.json(reply.body, { status: reply.status });
  });
  return calls;
}
const fcmError = (status, code) => ({ status, body: { error: { status: code, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } } });

test('FCM is chosen only with a readable service account; production lists what is missing', () => {
  assert.ok(createPushSender(env) instanceof FcmPushSender);
  assert.equal(createPushSender({ ...env, FCM_SERVICE_ACCOUNT_FILE: join(tmpdir(), 'missing-fcm.json') }), null);
  assert.equal(createPushSender({ NODE_ENV: 'production' }), null);
  assert.ok(productionProblems({ NODE_ENV: 'production' }).some(p => p.startsWith('PUSH_PROVIDER')));
  assert.ok(productionProblems({ ...env, FCM_SERVICE_ACCOUNT_FILE: '' }).some(p => p.startsWith('FCM_SERVICE_ACCOUNT_FILE')));
  assert.ok(!productionProblems(env).some(p => p.startsWith('PUSH_PROVIDER') || p.startsWith('FCM_')));
});

test('FCM signs a service-account JWT, caches the access token and sends an Android HTTP v1 message', async t => {
  const calls = fakeGoogle(t);
  const sender = createPushSender(env);
  assert.equal(await sender.send(message), 'sent');
  assert.equal(await sender.send(message), 'sent');
  assert.equal(calls.token.length, 1, 'access token reused');
  const assertion = calls.token[0].get('assertion');
  assert.equal(calls.token[0].get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = assertion.split('.');
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')), 'signed with the account key');
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.iss, 'push@synthetic-project.iam.gserviceaccount.com');
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(payload.exp - payload.iat, 3600);
  const [send] = calls.send;
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send');
  assert.equal(send.options.headers.Authorization, 'Bearer access-1');
  assert.equal(send.options.redirect, 'error');
  assert.deepEqual(send.body, { message: { token: message.token, notification: { title: 'คู่ช่าง', body: 'งานใหม่' }, data: message.data,
    android: { priority: 'HIGH', notification: { channel_id: 'default' } } } });
});

test('FCM token expiry triggers a new access token', async t => {
  let now = 1_000_000;
  const calls = fakeGoogle(t);
  const sender = new FcmPushSender({ projectId: 'p', clientEmail: 'c@p.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, () => now);
  await sender.send(message);
  now += 3_540_000;
  await sender.send(message);
  assert.equal(calls.token.length, 2);
});

test('FCM skips other platforms and maps errors: dead tokens revoked, outages retried, bad requests not', async t => {
  const calls = fakeGoogle(t, [fcmError(404, 'UNREGISTERED'), fcmError(403, 'SENDER_ID_MISMATCH'), fcmError(503, 'UNAVAILABLE'), fcmError(429, 'QUOTA_EXCEEDED'),
    fcmError(400, 'INVALID_ARGUMENT'), fcmError(401, 'UNAUTHENTICATED')]);
  const sender = createPushSender(env);
  assert.equal(await sender.send({ ...message, platform: 'ios' }), 'skipped');
  assert.equal(calls.send.length, 0, 'iOS not sent yet');
  assert.equal(await sender.send(message), 'invalid_token');
  assert.equal(await sender.send(message), 'invalid_token');
  await assert.rejects(sender.send(message), e => e instanceof TemporaryPushError && e.message === 'FCM_UNAVAILABLE');
  await assert.rejects(sender.send(message), e => e instanceof TemporaryPushError);
  await assert.rejects(sender.send(message), e => !(e instanceof TemporaryPushError) && e.message === 'FCM_INVALID_ARGUMENT');
  await assert.rejects(sender.send(message), e => e instanceof TemporaryPushError, 'expired access token is retried');
  const before = calls.token.length;
  assert.equal(await sender.send(message), 'sent');
  assert.equal(calls.token.length, before + 1, 'access token fetched again after 401');
});

test('network failure is temporary', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(createPushSender(env).send(message), e => e instanceof TemporaryPushError);
});
