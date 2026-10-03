import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { openTestDatabase } from './support/database.mjs';

// End-to-end through HTTP against a real PostgreSQL. The API connects as fs_api, exactly as in
// production; SMS uses the development adapter and the test reads the code from the API log.
const skip = process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL (TEST_DATABASE_URL) so the API can connect as fs_api';
let db, child, base, mediaDir, workerUrl;
const codes = new Map();

before(async () => {
  if (skip) return;
  db = await openTestDatabase('http');
  const password = randomBytes(18).toString('hex');
  await db.exec(`ALTER ROLE fs_api LOGIN PASSWORD '${password}'`);
  const url = new URL(db.url); url.username = 'fs_api'; url.password = password;
  const workerPassword = randomBytes(18).toString('hex');
  await db.exec(`ALTER ROLE fs_worker LOGIN PASSWORD '${workerPassword}'`);
  const worker = new URL(db.url); worker.username = 'fs_worker'; worker.password = workerPassword; workerUrl = worker.toString();
  mediaDir = await mkdtemp(join(tmpdir(), 'fs-media-'));

  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}/v1`;
  const { TEST_DATABASE_URL, MIGRATION_DATABASE_URL, SEED_DATABASE_URL, ...env } = process.env;
  child = spawn(process.execPath, [fileURLToPath(new URL('../apps/api/dist/main.js', import.meta.url))], {
    env: { ...env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: url.toString(),
      OTP_SECRET: randomBytes(32).toString('base64'), JOIN_LINK_KEY: randomBytes(32).toString('base64'),
      JOIN_LINK_BASE_URL: 'https://join.example.test/join', SMS_PROVIDER: 'development',
      MEDIA_DIR: mediaDir, MEDIA_URL_SECRET: randomBytes(32).toString('base64'), OCR_PROVIDER: 'development' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (const m of buffer.matchAll(/\[development SMS\] to (\+\d+): \D*(\d{6})/g)) codes.set(m[1], m[2]);
  });
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw Error('API exited before readiness');
    try { if ((await fetch(`${base}/ready`)).ok) return; } catch {}
    await setTimeout(100);
  }
  throw Error('API startup timeout');
});
after(async () => {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await db?.close();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

async function call(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'accept-language': 'en', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}
let phoneSeq = 0;
const newPhone = () => `08${String(10000000 + phoneSeq++ + Math.floor(Math.random() * 1000) * 1000).slice(-8)}`;

async function signIn(localPhone, displayName) {
  const requested = await call('POST', '/auth/otp/request', { body: { phone: localPhone } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.delivery, 'development');
  const e164 = `+66${localPhone.slice(1)}`;
  for (let i = 0; i < 50 && !codes.has(e164); i++) await setTimeout(20);
  const verified = await call('POST', '/auth/otp/verify', { body: { challenge_id: requested.body.challenge_id, code: codes.get(e164), display_name: displayName } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return verified.body;
}

test('owner signs up, creates a shop, technician joins, owner approves', { skip }, async () => {
  const owner = await signIn(newPhone(), 'Owner One');
  const created = await call('POST', '/organizations', { token: owner.access_token, body: { name: 'Cool Air' }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const shopId = created.body.organization.id;
  assert.match(created.body.join_link.url, /^https:\/\/join\.example\.test\/join\/[A-Za-z0-9_-]{43}$/);
  assert.match(created.body.join_link.qr_png, /^data:image\/png;base64,/);
  const token = created.body.join_link.url.split('/').at(-1);

  const preview = await call('GET', `/join-links/${token}`);
  assert.deepEqual(preview.body, { state: 'active', organization_name: 'Cool Air' });

  const tech = await signIn(newPhone(), 'Tech One');
  const joined = await call('POST', '/join-requests', { token: tech.access_token, body: { token, display_name: 'Somchai' } });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.status, 'pending');

  const blocked = await call('GET', `/organizations/${shopId}`, { token: tech.access_token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'MEMBERSHIP_INACTIVE');

  const me = await call('GET', '/me', { token: tech.access_token });
  assert.equal(me.body.memberships[0].status, 'pending');

  const team = await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token });
  const pending = team.body.members.find(m => m.status === 'pending');
  assert.equal(pending.display_name, 'Somchai');
  assert.deepEqual(team.body.seats, { active_technicians: 0, seat_limit: 3 });

  const approved = await call('POST', `/organizations/${shopId}/members/${pending.member_id}/approve`, { token: owner.access_token, body: { expected_version: pending.version } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'active');

  const allowed = await call('GET', `/organizations/${shopId}`, { token: tech.access_token });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.membership.role, 'technician');

  const techCannotManage = await call('GET', `/organizations/${shopId}/members`, { token: tech.access_token });
  assert.equal(techCannotManage.status, 403);

  const suspended = await call('POST', `/organizations/${shopId}/members/${pending.member_id}/suspend`, { token: owner.access_token, body: { expected_version: approved.body.version } });
  assert.equal(suspended.status, 200);
  const afterSuspend = await call('GET', `/organizations/${shopId}`, { token: tech.access_token });
  assert.equal(afterSuspend.status, 403);
  assert.equal(afterSuspend.body.code, 'MEMBERSHIP_INACTIVE');

  const stale = await call('POST', `/organizations/${shopId}/members/${pending.member_id}/reactivate`, { token: owner.access_token, body: { expected_version: approved.body.version } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal(stale.body.latest_version, suspended.body.version);
});

test('another shop owner and forged identities get nothing', { skip }, async () => {
  const ownerA = await signIn(newPhone(), 'Owner A');
  const shopA = (await call('POST', '/organizations', { token: ownerA.access_token, body: { name: 'Shop A' } })).body.organization.id;
  const ownerB = await signIn(newPhone(), 'Owner B');
  await call('POST', '/organizations', { token: ownerB.access_token, body: { name: 'Shop B' } });

  for (const path of [`/organizations/${shopA}`, `/organizations/${shopA}/members`, `/organizations/${shopA}/join-link`]) {
    const r = await call('GET', path, { token: ownerB.access_token });
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'TENANT_ACCESS_DENIED');
  }
  const forged = await call('GET', `/organizations/${shopA}`, { headers: { 'x-user-id': ownerA.user_id, 'x-organization-id': shopA } });
  assert.equal(forged.status, 401);
  const randomBearer = await call('GET', `/organizations/${shopA}`, { token: randomBytes(32).toString('base64url') });
  assert.equal(randomBearer.status, 401);
  assert.equal(randomBearer.body.code, 'AUTHENTICATION_REQUIRED');
  assert.ok(randomBearer.body.request_id);
});

test('reset link: the old link stops working, the new one works', { skip }, async () => {
  const owner = await signIn(newPhone(), 'Owner R');
  const created = (await call('POST', '/organizations', { token: owner.access_token, body: { name: 'Reset Shop' } })).body;
  const oldToken = created.join_link.url.split('/').at(-1);
  const rotated = await call('POST', `/organizations/${created.organization.id}/join-link/rotate`, { token: owner.access_token });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.generation, 2);
  assert.equal((await call('GET', `/join-links/${oldToken}`)).body.state, 'invalid');
  const tech = await signIn(newPhone(), 'Late');
  const refused = await call('POST', '/join-requests', { token: tech.access_token, body: { token: oldToken, display_name: 'Late' } });
  assert.equal(refused.status, 404);
  assert.equal(refused.body.code, 'JOIN_LINK_INVALID');
  const newToken = rotated.body.url.split('/').at(-1);
  assert.equal((await call('POST', '/join-requests', { token: tech.access_token, body: { token: newToken, display_name: 'Late' } })).body.status, 'pending');
});

test('sign in again with the same phone, refresh, logout', { skip }, async () => {
  const phone = newPhone();
  const first = await signIn(phone, 'Again');
  await db.query("UPDATE auth.otp_challenges SET created_at = created_at - interval '2 hours' WHERE phone_e164 = $1", [`+66${phone.slice(1)}`]);
  const second = await signIn(phone);
  assert.equal(second.user_id, first.user_id);
  assert.equal(second.is_new_user, false);

  const refreshed = await call('POST', '/auth/refresh', { body: { refresh_token: second.refresh_token } });
  assert.equal(refreshed.status, 200);
  assert.equal((await call('GET', '/me', { token: second.access_token })).status, 401);
  assert.equal((await call('GET', '/me', { token: refreshed.body.access_token })).status, 200);
  const reused = await call('POST', '/auth/refresh', { body: { refresh_token: second.refresh_token } });
  assert.equal(reused.status, 401);
  assert.equal((await call('GET', '/me', { token: refreshed.body.access_token })).status, 401, 'reuse revoked the session');

  assert.equal((await call('POST', '/auth/logout', { token: first.access_token })).status, 204);
  assert.equal((await call('GET', '/me', { token: first.access_token })).status, 401);
});

test('OTP requests are rate limited and validated', { skip }, async () => {
  const phone = newPhone();
  assert.equal((await call('POST', '/auth/otp/request', { body: { phone } })).status, 201);
  const again = await call('POST', '/auth/otp/request', { body: { phone } });
  assert.equal(again.status, 429);
  assert.equal(again.body.code, 'RATE_LIMITED');
  assert.ok(Number(again.headers.get('retry-after')) > 0);
  const bad = await call('POST', '/auth/otp/request', { body: { phone: '021234567' }, headers: { 'accept-language': 'th' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.field_errors, { phone: 'field.phone' });
  assert.match(bad.body.message, /ตรวจข้อมูล/);
  const wrong = await call('POST', '/auth/otp/verify', { body: { challenge_id: randomUUID(), code: '000000' } });
  assert.equal(wrong.body.code, 'OTP_INVALID');
});

test('subscription: owner sees plan and limits, technician only the state; expired shop cannot approve', { skip }, async () => {
  const owner = await signIn(newPhone(), 'Owner S');
  const created = (await call('POST', '/organizations', { token: owner.access_token, body: { name: 'Plan Shop' } })).body;
  const shopId = created.organization.id;
  const token = created.join_link.url.split('/').at(-1);
  const sub = await call('GET', `/organizations/${shopId}/subscription`, { token: owner.access_token });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.state, 'trialing');
  assert.equal(sub.body.plan.code, 'trial');
  assert.deepEqual(sub.body.limits, { technician_seats: 3, storage_bytes: 1_000_000_000, ocr_per_period: 20 });

  const tech = await signIn(newPhone(), 'Tech S');
  const joined = (await call('POST', '/join-requests', { token: tech.access_token, body: { token, display_name: 'Tech S' } })).body;
  const team = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body;
  const member = team.members.find(m => m.member_id === joined.member_id);
  assert.equal((await call('POST', `/organizations/${shopId}/members/${member.member_id}/approve`, { token: owner.access_token, body: { expected_version: member.version } })).status, 200);
  const techView = await call('GET', `/organizations/${shopId}/subscription`, { token: tech.access_token });
  assert.deepEqual(techView.body, { state: 'trialing', writable: true });
  assert.equal((await call('POST', `/organizations/${shopId}/subscription/cancel-renewal`, { token: tech.access_token })).status, 403);

  const late = await signIn(newPhone(), 'Late S');
  const lateJoin = (await call('POST', '/join-requests', { token: late.access_token, body: { token, display_name: 'Late S' } })).body;
  await db.query("UPDATE billing.subscription_periods SET start_at = start_at - interval '15 days', end_at = end_at - interval '15 days' WHERE organization_id = $1", [shopId]);
  assert.equal((await call('GET', `/organizations/${shopId}/subscription`, { token: owner.access_token })).body.state, 'expired');
  const lateMember = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members.find(m => m.member_id === lateJoin.member_id);
  const refused = await call('POST', `/organizations/${shopId}/members/${lateMember.member_id}/approve`, { token: owner.access_token, body: { expected_version: lateMember.version } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'SUBSCRIPTION_EXPIRED');
  assert.equal((await call('GET', `/organizations/${shopId}`, { token: tech.access_token })).status, 200, 'reading stays allowed');
});

async function sharp() {
  return (await import(pathToFileURL(createRequire(new URL('../apps/api/package.json', import.meta.url)).resolve('sharp')).href)).default;
}
async function put(path, token, bytes, type = 'image/jpeg') {
  const response = await fetch(`${base}${path}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': type, 'accept-language': 'en' }, body: bytes });
  return { status: response.status, body: await response.json() };
}

test('photo upload: quota reserved, GPS stripped, signed download, retry-safe, private to the shop', { skip }, async () => {
  const s = await sharp();
  const owner = await signIn(newPhone(), 'Owner M');
  const shopId = (await call('POST', '/organizations', { token: owner.access_token, body: { name: 'Media Shop' } })).body.organization.id;
  const photo = await s({ create: { width: 1600, height: 1200, channels: 3, background: '#336699' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 45/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '100/1 30/1 0/1' } }).jpeg().toBuffer();
  const requestKey = randomUUID();
  const created = await call('POST', `/organizations/${shopId}/media`, { token: owner.access_token, body: { request_key: requestKey, mime_type: 'image/jpeg', byte_size: photo.length, purpose: 'nameplate' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'pending_upload');
  const again = await call('POST', `/organizations/${shopId}/media`, { token: owner.access_token, body: { request_key: requestKey, mime_type: 'image/jpeg', byte_size: photo.length } });
  assert.equal(again.body.id, created.body.id, 'same request key returns the same file');

  const uploaded = await put(`/organizations/${shopId}/media/${created.body.id}/content`, owner.access_token, photo);
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.status, 'ready');
  const retry = await put(`/organizations/${shopId}/media/${created.body.id}/content`, owner.access_token, photo);
  assert.equal(retry.body.status, 'ready', 'a retried upload does not fail or count twice');

  const file = await fetch(uploaded.body.url);
  assert.equal(file.status, 200);
  const stored = Buffer.from(await file.arrayBuffer());
  assert.equal((await s(stored).metadata()).exif, undefined, 'downloaded image has no EXIF/GPS');
  assert.equal((await fetch(uploaded.body.thumbnail_url)).status, 200);
  assert.equal((await fetch(uploaded.body.url.replace(/.$/, c => c === 'A' ? 'B' : 'A'))).status, 404, 'tampered link');

  const sub = (await call('GET', `/organizations/${shopId}/subscription`, { token: owner.access_token })).body;
  assert.equal(sub.usage.storage_bytes, uploaded.body.size_bytes, 'storage counted once at the stored size');

  const other = await signIn(newPhone(), 'Other M');
  await call('POST', '/organizations', { token: other.access_token, body: { name: 'Other Shop' } });
  assert.equal((await call('GET', `/organizations/${shopId}/media/${created.body.id}`, { token: other.access_token })).status, 403);

  const bad = await call('POST', `/organizations/${shopId}/media`, { token: owner.access_token, body: { request_key: randomUUID(), mime_type: 'image/jpeg', byte_size: 20 } });
  const rejected = await put(`/organizations/${shopId}/media/${bad.body.id}/content`, owner.access_token, Buffer.from('this is not a picture'));
  assert.equal(rejected.status, 400);
  assert.equal((await call('GET', `/organizations/${shopId}/media/${bad.body.id}`, { token: owner.access_token })).body.status, 'failed');
  const tooBig = await call('POST', `/organizations/${shopId}/media`, { token: owner.access_token, body: { request_key: randomUUID(), mime_type: 'image/jpeg', byte_size: 999_000_000 } });
  assert.equal(tooBig.status, 400);

  // OCR: queued by the API, read by the worker, counted once.
  const ocr = await call('POST', `/organizations/${shopId}/ocr-requests`, { token: owner.access_token, body: { request_key: randomUUID(), media_asset_id: created.body.id } });
  assert.equal(ocr.status, 201, JSON.stringify(ocr.body));
  assert.equal(ocr.body.status, 'queued');
  const { runOcr, verifyWorkerRole } = await import('../apps/api/dist/worker.js');
  const { LocalDiskStorage } = await import('../apps/api/dist/media/object-storage.js');
  const { DevelopmentOcrProvider } = await import('../apps/api/dist/ocr/ocr.provider.js');
  const pool = new pg.Pool({ connectionString: workerUrl, max: 2 });
  try {
    await verifyWorkerRole(pool);
    await runOcr({ pool, storage: new LocalDiskStorage(mediaDir), ocr: new DevelopmentOcrProvider(false), push: null });
  } finally { await pool.end(); }
  const done = await call('GET', `/organizations/${shopId}/ocr-requests/${ocr.body.id}`, { token: owner.access_token });
  assert.equal(done.body.status, 'succeeded');
  assert.deepEqual(done.body.suggestions.fields, {});
  assert.equal((await call('GET', `/organizations/${shopId}/subscription`, { token: owner.access_token })).body.usage.ocr, 1);
});

test('notification inbox: owner sees the join request and marks it read; a pending member has none', { skip }, async () => {
  const owner = await signIn(newPhone(), 'Owner N');
  const created = (await call('POST', '/organizations', { token: owner.access_token, body: { name: 'Inbox Shop' } })).body;
  const shopId = created.organization.id;
  const tech = await signIn(newPhone(), 'Tech N');
  await call('POST', '/join-requests', { token: tech.access_token, body: { token: created.join_link.url.split('/').at(-1), display_name: 'Tech N' } });
  const inbox = await call('GET', `/organizations/${shopId}/notifications`, { token: owner.access_token });
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.items[0].template_key, 'join_request');
  assert.deepEqual(inbox.body.items[0].parameters, { name: 'Tech N' });
  const read = await call('POST', `/organizations/${shopId}/notifications/read`, { token: owner.access_token, body: {} });
  assert.equal(read.body.unread, 0);
  assert.equal((await call('GET', `/organizations/${shopId}/notifications`, { token: tech.access_token })).status, 403);
  assert.equal((await call('POST', '/me/devices', { token: owner.access_token, body: { token: `ExponentPushToken[${randomUUID()}]`, platform: 'android' } })).status, 204);
});
