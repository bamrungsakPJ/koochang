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
      MEDIA_DIR: mediaDir, MEDIA_URL_SECRET: randomBytes(32).toString('base64'), OCR_PROVIDER: 'development',
      // Every test signs in from 127.0.0.1; the per-client OTP limit is tested separately.
      OTP_CLIENT_HOURLY_LIMIT: '1000' },
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

async function shopWithTechnician(label) {
  const owner = await signIn(newPhone(), `Owner ${label}`);
  const created = (await call('POST', '/organizations', { token: owner.access_token, body: { name: `${label} Shop` } })).body;
  const shopId = created.organization.id;
  const tech = await signIn(newPhone(), `Tech ${label}`);
  const joined = (await call('POST', '/join-requests', { token: tech.access_token, body: { token: created.join_link.url.split('/').at(-1), display_name: `Tech ${label}` } })).body;
  const member = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members.find(m => m.member_id === joined.member_id);
  await call('POST', `/organizations/${shopId}/members/${member.member_id}/approve`, { token: owner.access_token, body: { expected_version: member.version } });
  return { owner, tech, shopId };
}

test('customers: phone-first create with first location, retry-safe, duplicate warning, search', { skip }, async () => {
  const { owner, shopId } = await shopWithTechnician('Cust');
  const path = `/organizations/${shopId}/customers`;
  const key = randomUUID();
  const body = { request_key: key, phone: '081-555-1234', location: { label: 'บ้าน', address: '12/3 ซอยสุขุมวิท 50', travel_note: 'ประตูสีเขียว' } };
  const first = await call('POST', path, { token: owner.access_token, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.name, null, 'no invented name');
  assert.equal(first.body.phone_normalized, '+66815551234');
  assert.equal(first.body.locations.length, 1);
  assert.equal(first.body.locations[0].latitude, null, 'no coordinates until someone saves them');
  const retry = await call('POST', path, { token: owner.access_token, body });
  assert.equal(retry.body.id, first.body.id, 'same request key → same customer');

  const dup = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), name: 'Somsri', phone: '0815551234' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'DUPLICATE_WARNING');
  assert.equal(dup.body.candidates[0].id, first.body.id);
  const second = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), name: 'Somsri', phone: '0815551234', confirm_duplicate: true } });
  assert.equal(second.status, 201, 'shared numbers are allowed after confirmation');

  assert.equal((await call('GET', `${path}?q=555-12`, { token: owner.access_token })).body.items.length, 2);
  assert.equal((await call('GET', `${path}?q=somsri`, { token: owner.access_token })).body.items.length, 1);
  assert.equal((await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID() } })).status, 400, 'name or phone required');
});

test('locations: version conflicts, explicit coordinate capture, replacing needs confirmation and is audited', { skip }, async () => {
  const { owner, shopId } = await shopWithTechnician('Loc');
  const customer = (await call('POST', `/organizations/${shopId}/customers`, { token: owner.access_token, body: { request_key: randomUUID(), name: 'Lek', phone: '0899000111' } })).body;
  const withLocation = (await call('POST', `/organizations/${shopId}/customers/${customer.id}/locations`, { token: owner.access_token, body: { request_key: randomUUID(), label: 'โกดัง' } })).body;
  const location = withLocation.locations[0];
  const coordinates = `/organizations/${shopId}/locations/${location.id}/coordinates`;

  const saved = await call('PUT', coordinates, { token: owner.access_token, body: { expected_version: location.version, latitude: 13.7563, longitude: 100.5018, accuracy_m: 12, method: 'current_location' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = saved.body.locations[0];
  assert.deepEqual([after.latitude, after.longitude, after.accuracy_m, after.capture_method], [13.7563, 100.5018, 12, 'current_location']);

  const again = await call('PUT', coordinates, { token: owner.access_token, body: { expected_version: after.version, latitude: 13.8, longitude: 100.6, method: 'manual_pin' } });
  assert.equal(again.body.code, 'COORDINATES_EXIST');
  const stale = await call('PUT', coordinates, { token: owner.access_token, body: { expected_version: location.version, latitude: 13.8, longitude: 100.6, method: 'manual_pin', replace_existing: true } });
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  const replaced = await call('PUT', coordinates, { token: owner.access_token, body: { expected_version: after.version, latitude: 13.8, longitude: 100.6, method: 'manual_pin', replace_existing: true } });
  assert.equal(replaced.body.locations[0].capture_method, 'manual_pin');
  const audit = (await db.query("SELECT action, details FROM ops.audit_logs WHERE entity_id = $1 AND action LIKE 'location.coordinates%' ORDER BY created_at", [location.id])).rows;
  assert.deepEqual(audit.map(r => r.action), ['location.coordinates_saved', 'location.coordinates_replaced']);
  assert.equal(Number(audit[1].details.previous.latitude), 13.7563);
  assert.equal((await call('PUT', coordinates, { token: owner.access_token, body: { expected_version: 99, latitude: 91, longitude: 0, method: 'manual_pin' } })).status, 400);
});

test('customers: technician scope, other shops, and an expired plan is read-only', { skip }, async () => {
  const { owner, tech, shopId } = await shopWithTechnician('Scope');
  const path = `/organizations/${shopId}/customers`;
  const ownerCustomer = (await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), name: 'Owner customer' } })).body;
  const techCustomer = (await call('POST', path, { token: tech.access_token, body: { request_key: randomUUID(), name: 'On-site customer', location: { label: 'ร้าน' } } }));
  assert.equal(techCustomer.status, 201);
  assert.deepEqual((await call('GET', path, { token: tech.access_token })).body.items.map(c => c.name), ['On-site customer']);
  assert.equal((await call('GET', `${path}/${ownerCustomer.id}`, { token: tech.access_token })).status, 404, 'not visible to the technician');
  assert.equal((await call('GET', path, { token: owner.access_token })).body.items.length, 2);
  assert.equal((await call('POST', `${path}/${techCustomer.body.id}/archive`, { token: tech.access_token })).status, 403, 'only owners archive');

  const other = await signIn(newPhone(), 'Other C');
  await call('POST', '/organizations', { token: other.access_token, body: { name: 'Other C Shop' } });
  assert.equal((await call('GET', `${path}/${ownerCustomer.id}`, { token: other.access_token })).status, 403);

  await db.query("UPDATE billing.subscription_periods SET start_at = start_at - interval '15 days', end_at = end_at - interval '15 days' WHERE organization_id = $1", [shopId]);
  const refused = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), name: 'Too late' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'SUBSCRIPTION_EXPIRED');
  assert.equal((await call('GET', path, { token: owner.access_token })).status, 200, 'reading stays allowed');
});

async function uploadPhoto(token, shopId) {
  const s = await sharp();
  const bytes = await s({ create: { width: 800, height: 600, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer();
  const created = await call('POST', `/organizations/${shopId}/media`, { token, body: { request_key: randomUUID(), mime_type: 'image/jpeg', byte_size: bytes.length, purpose: 'nameplate' } });
  const uploaded = await put(`/organizations/${shopId}/media/${created.body.id}/content`, token, bytes);
  assert.equal(uploaded.body.status, 'ready');
  return uploaded.body.id;
}

test('equipment: camera first, OCR stays a suggestion, confirmed values recorded, duplicates offered', { skip }, async () => {
  const { owner, tech, shopId } = await shopWithTechnician('Equip');
  const customer = (await call('POST', `/organizations/${shopId}/customers`, { token: owner.access_token,
    body: { request_key: randomUUID(), phone: '0866600011', location: { label: 'บ้าน' } } })).body;
  const locationId = customer.locations[0].id;
  const nameplate = await uploadPhoto(owner.access_token, shopId);
  const ocr = (await call('POST', `/organizations/${shopId}/ocr-requests`, { token: owner.access_token, body: { request_key: randomUUID(), media_asset_id: nameplate } })).body;

  const path = `/organizations/${shopId}/locations/${locationId}/equipment`;
  const key = randomUUID();
  const body = { request_key: key, category: 'air_conditioner', name: 'แอร์ห้องนอน', brand: 'Daikin', model: 'FTKC12', serial_number: 'e123-45o',
    photos: [{ media_asset_id: nameplate, photo_type: 'nameplate' }], ocr_request_id: ocr.id };
  const created = await call('POST', path, { token: owner.access_token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.serial_number, 'e123-45o', 'stored as typed; O and 0 are not guessed');
  assert.equal(created.body.photos.length, 1);
  assert.ok(created.body.photos[0].thumbnail_url);
  assert.equal((await call('POST', path, { token: owner.access_token, body })).body.id, created.body.id, 'retry returns the same equipment');
  const accepted = (await db.query('SELECT accepted_fields, equipment_id FROM core.ocr_requests WHERE id = $1', [ocr.id])).rows[0];
  assert.equal(accepted.equipment_id, created.body.id);
  assert.deepEqual(accepted.accepted_fields, { brand: 'Daikin', model: 'FTKC12', serial_number: 'e123-45o' });

  const sameSerial = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), category: 'air_conditioner', serial_number: 'E12345O' } });
  assert.equal(sameSerial.body.code, 'DUPLICATE_WARNING');
  assert.equal(sameSerial.body.candidates[0].id, created.body.id);
  const second = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), category: 'air_conditioner', serial_number: 'E12345O', confirm_duplicate: true } });
  assert.equal(second.status, 201);
  const minimal = await call('POST', path, { token: owner.access_token, body: { request_key: randomUUID(), category: 'water_filter' } });
  assert.equal(minimal.status, 201, 'no brand, model, serial or photo needed');

  const list = (await call('GET', path, { token: owner.access_token })).body.items;
  assert.equal(list.length, 3);
  assert.ok(list.find(e => e.id === created.body.id).thumbnail_url);

  const stale = await call('PATCH', `/organizations/${shopId}/equipment/${created.body.id}`, { token: owner.access_token, body: { expected_version: 99, name: 'x' } });
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  const renamed = await call('PATCH', `/organizations/${shopId}/equipment/${created.body.id}`, { token: owner.access_token, body: { expected_version: created.body.version, name: 'แอร์ห้องนั่งเล่น' } });
  assert.equal(renamed.body.name, 'แอร์ห้องนั่งเล่น');
  assert.equal(renamed.body.brand, 'Daikin', 'fields not sent stay as they were');

  // Technician scope: equipment follows customer visibility; photos of others cannot be attached.
  assert.equal((await call('GET', path, { token: tech.access_token })).status, 404);
  const own = (await call('POST', `/organizations/${shopId}/customers`, { token: tech.access_token, body: { request_key: randomUUID(), phone: '0866600022', location: { label: 'ร้าน' } } })).body;
  const techPath = `/organizations/${shopId}/locations/${own.locations[0].id}/equipment`;
  const borrowed = await call('POST', techPath, { token: tech.access_token, body: { request_key: randomUUID(), category: 'pump', photos: [{ media_asset_id: nameplate, photo_type: 'equipment' }] } });
  assert.equal(borrowed.status, 400, 'cannot attach a photo uploaded by someone else');
  const techPhoto = await uploadPhoto(tech.access_token, shopId);
  const techEquipment = await call('POST', techPath, { token: tech.access_token, body: { request_key: randomUUID(), category: 'pump', photos: [{ media_asset_id: techPhoto, photo_type: 'equipment' }] } });
  assert.equal(techEquipment.status, 201);
  assert.equal((await call('GET', `/organizations/${shopId}/media/${techPhoto}`, { token: owner.access_token })).status, 200, 'owner sees technician photos');
  assert.equal((await call('GET', `/organizations/${shopId}/equipment/${created.body.id}`, { token: tech.access_token })).status, 404);
});

async function addTechnician(owner, shopId, label) {
  const link = (await call('GET', `/organizations/${shopId}/join-link`, { token: owner.access_token })).body.url.split('/').at(-1);
  const tech = await signIn(newPhone(), label);
  const joined = (await call('POST', '/join-requests', { token: tech.access_token, body: { token: link, display_name: label } })).body;
  const member = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members.find(m => m.member_id === joined.member_id);
  await call('POST', `/organizations/${shopId}/members/${member.member_id}/approve`, { token: owner.access_token, body: { expected_version: member.version } });
  return { ...tech, memberId: member.member_id };
}

test('jobs: create and assign, technician sees only that job and place, conflicts warn, reassignment removes access', { skip }, async () => {
  const { owner, tech, shopId } = await shopWithTechnician('Jobs');
  const techMember = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members.find(m => m.role === 'technician').member_id;
  const second = await addTechnician(owner, shopId, 'Tech Two');
  const customer = (await call('POST', `/organizations/${shopId}/customers`, { token: owner.access_token,
    body: { request_key: randomUUID(), name: 'Job customer', phone: '0877700011', location: { label: 'บ้าน' } } })).body;
  const other = (await call('POST', `/organizations/${shopId}/customers/${customer.id}/locations`, { token: owner.access_token, body: { request_key: randomUUID(), label: 'โกดัง' } })).body;
  const locationId = customer.locations[0].id;
  const unit = (await call('POST', `/organizations/${shopId}/locations/${locationId}/equipment`, { token: owner.access_token, body: { request_key: randomUUID(), category: 'air_conditioner' } })).body;

  const jobs = `/organizations/${shopId}/jobs`;
  const key = randomUUID();
  const body = { request_key: key, customer_id: customer.id, location_id: locationId, job_type: 'maintenance', description: 'ล้างแอร์ 3 เครื่อง',
    estimated_equipment_count: 3, equipment_ids: [unit.id], assignee_member_id: techMember,
    scheduled_start: '2026-11-10T09:00:00+07:00', scheduled_end: '2026-11-10T11:00:00+07:00' };
  const created = await call('POST', jobs, { token: owner.access_token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = created.body.job;
  assert.equal(job.status, 'scheduled');
  assert.equal(job.assignee_name, 'Tech Jobs');
  assert.equal(job.equipment.length, 1);
  assert.equal(job.estimated_equipment_count, 3);
  assert.equal((await call('POST', jobs, { token: owner.access_token, body })).body.job.id, job.id, 'retry returns the same job');
  assert.equal((await call('POST', jobs, { token: tech.access_token, body: { ...body, request_key: randomUUID() } })).status, 403, 'technicians do not plan jobs');

  // The technician now sees this job, its customer and only the job's location.
  const techList = (await call('GET', `${jobs}?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`, { token: tech.access_token })).body.items;
  assert.deepEqual(techList.map(j => j.id), [job.id]);
  const seen = (await call('GET', `/organizations/${shopId}/customers/${customer.id}`, { token: tech.access_token })).body;
  assert.deepEqual(seen.locations.map(l => l.label), ['บ้าน'], 'not the other location of this customer');
  assert.equal((await call('GET', `/organizations/${shopId}/locations/${other.locations[1].id}/equipment`, { token: tech.access_token })).status, 404);
  const inbox = (await call('GET', `/organizations/${shopId}/notifications`, { token: tech.access_token })).body.items;
  assert.ok(inbox.some(n => n.template_key === 'job_assigned'));

  const overlap = await call('POST', jobs, { token: owner.access_token, body: { ...body, request_key: randomUUID(), equipment_ids: [],
    scheduled_start: '2026-11-10T10:00:00+07:00', scheduled_end: '2026-11-10T12:00:00+07:00' } });
  assert.equal(overlap.status, 201, 'a time clash is a warning, not a block');
  assert.deepEqual(overlap.body.conflicts.map(c => c.id), [job.id]);
  // Cancel the clash so the first technician has no other open job at this customer.
  await call('POST', `${jobs}/${overlap.body.job.id}/cancel`, { token: owner.access_token, body: { expected_version: overlap.body.job.version, reason: 'test' } });

  const stale = await call('POST', `${jobs}/${job.id}/assign`, { token: owner.access_token, body: { expected_version: job.version - 1 || 99, assignee_member_id: second.memberId } });
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  const moved = await call('POST', `${jobs}/${job.id}/assign`, { token: owner.access_token, body: { expected_version: job.version, assignee_member_id: second.memberId, reason: 'สลับคิว' } });
  assert.equal(moved.status, 201, JSON.stringify(moved.body));
  assert.equal(moved.body.job.assignee_name, 'Tech Two');
  assert.equal((await call('GET', `${jobs}/${job.id}`, { token: tech.access_token })).status, 404, 'previous technician loses access at once');
  assert.equal((await call('GET', `/organizations/${shopId}/customers/${customer.id}`, { token: tech.access_token })).status, 404);
  assert.ok((await call('GET', `/organizations/${shopId}/notifications`, { token: tech.access_token })).body.items.some(n => n.template_key === 'job_unassigned'));
  assert.equal((await call('GET', `${jobs}/${job.id}`, { token: second.access_token })).status, 200);

  // Start, then cancel with a reason; a cancelled job cannot be started again.
  assert.equal((await call('POST', `${jobs}/${job.id}/start`, { token: tech.access_token, body: { expected_version: moved.body.job.version } })).status, 404);
  const started = await call('POST', `${jobs}/${job.id}/start`, { token: second.access_token, body: { expected_version: moved.body.job.version } });
  assert.equal(started.body.status, 'in_progress');
  assert.equal((await call('POST', `${jobs}/${job.id}/cancel`, { token: second.access_token, body: { expected_version: started.body.version, reason: 'x' } })).status, 403);
  assert.equal((await call('POST', `${jobs}/${job.id}/cancel`, { token: owner.access_token, body: { expected_version: started.body.version } })).status, 400, 'reason required');
  const cancelled = await call('POST', `${jobs}/${job.id}/cancel`, { token: owner.access_token, body: { expected_version: started.body.version, reason: 'ลูกค้าเลื่อน' } });
  assert.equal(cancelled.body.status, 'cancelled');
  assert.deepEqual(cancelled.body.history.map(h => h.to_status), ['scheduled', 'in_progress', 'cancelled']);
  assert.equal((await call('POST', `${jobs}/${job.id}/start`, { token: second.access_token, body: { expected_version: cancelled.body.version } })).body.code, 'INVALID_STATE_TRANSITION');
});

test('jobs: unassign returns the job to the queue; reschedule notifies; an expired plan cannot create work', { skip }, async () => {
  const { owner, tech, shopId } = await shopWithTechnician('Queue');
  const techMember = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members.find(m => m.role === 'technician').member_id;
  const customer = (await call('POST', `/organizations/${shopId}/customers`, { token: owner.access_token, body: { request_key: randomUUID(), phone: '0877700022', location: { label: 'ร้าน' } } })).body;
  const jobs = `/organizations/${shopId}/jobs`;
  const unassigned = (await call('POST', jobs, { token: owner.access_token, body: { request_key: randomUUID(), customer_id: customer.id, location_id: customer.locations[0].id, job_type: 'repair' } })).body.job;
  assert.equal(unassigned.status, 'unassigned');
  assert.equal(unassigned.scheduled_start, null, 'no time yet is allowed');
  const assigned = (await call('POST', `${jobs}/${unassigned.id}/assign`, { token: owner.access_token, body: { expected_version: unassigned.version, assignee_member_id: techMember } })).body.job;
  const moved = (await call('POST', `${jobs}/${assigned.id}/reschedule`, { token: owner.access_token,
    body: { expected_version: assigned.version, scheduled_start: '2026-12-01T13:00:00+07:00' } })).body.job;
  assert.equal(new Date(moved.scheduled_start).toISOString(), '2026-12-01T06:00:00.000Z');
  assert.ok((await call('GET', `/organizations/${shopId}/notifications`, { token: tech.access_token })).body.items.some(n => n.template_key === 'job_rescheduled'));
  const back = (await call('POST', `${jobs}/${moved.id}/unassign`, { token: owner.access_token, body: { expected_version: moved.version } })).body;
  assert.equal(back.status, 'unassigned');
  assert.equal(back.assignee_name, null);
  assert.equal((await call('GET', `${jobs}/${moved.id}`, { token: tech.access_token })).status, 404);
  assert.equal((await call('POST', jobs, { token: owner.access_token, body: { request_key: randomUUID(), customer_id: customer.id, location_id: customer.locations[0].id,
    job_type: 'repair', scheduled_start: 'tomorrow' } })).status, 400);

  await db.query("UPDATE billing.subscription_periods SET start_at = start_at - interval '15 days', end_at = end_at - interval '15 days' WHERE organization_id = $1", [shopId]);
  const refused = await call('POST', jobs, { token: owner.access_token, body: { request_key: randomUUID(), customer_id: customer.id, location_id: customer.locations[0].id, job_type: 'repair' } });
  assert.equal(refused.body.code, 'SUBSCRIPTION_EXPIRED');
  assert.equal((await call('GET', jobs, { token: owner.access_token })).status, 200);
});

async function serviceSetup(label) {
  const { owner, tech, shopId } = await shopWithTechnician(label);
  const members = (await call('GET', `/organizations/${shopId}/members`, { token: owner.access_token })).body.members;
  const techMember = members.find(m => m.role === 'technician').member_id;
  const customer = (await call('POST', `/organizations/${shopId}/customers`, { token: owner.access_token,
    body: { request_key: randomUUID(), name: `${label} customer`, phone: '0855500011', location: { label: 'บ้าน' } } })).body;
  const locationId = customer.locations[0].id;
  const unit = async name => (await call('POST', `/organizations/${shopId}/locations/${locationId}/equipment`, { token: owner.access_token,
    body: { request_key: randomUUID(), category: 'air_conditioner', name } })).body;
  return { owner, tech, shopId, techMember, customer, locationId, unit };
}
async function startedJob(s, assignee, token, equipmentIds) {
  const job = (await call('POST', `/organizations/${s.shopId}/jobs`, { token: s.owner.access_token, body: { request_key: randomUUID(), customer_id: s.customer.id,
    location_id: s.locationId, job_type: 'maintenance', equipment_ids: equipmentIds, assignee_member_id: assignee } })).body.job;
  return (await call('POST', `/organizations/${s.shopId}/jobs/${job.id}/start`, { token, body: { expected_version: job.version } })).body;
}

test('service: complete a job with per-unit results, photos and calendar-month next cycle; retries return the same result', { skip }, async () => {
  const s = await serviceSetup('Svc');
  const [a, b] = [await s.unit('ห้องนอน'), await s.unit('ห้องนั่งเล่น')];
  const job = await startedJob(s, s.techMember, s.tech.access_token, [a.id, b.id]);
  assert.equal(job.status, 'in_progress');
  const before = await uploadPhoto(s.tech.access_token, s.shopId);
  const after = await uploadPhoto(s.tech.access_token, s.shopId);
  const clientEventId = randomUUID();
  const body = { expected_version: job.version, client_event_id: clientEventId, occurred_at: '2026-08-31T10:00:00+07:00', note: 'ล้างเสร็จ 1 เครื่อง',
    items: [
      { equipment_id: a.id, service_type: 'maintenance', outcome: 'done', work_note: 'ล้างคอยล์', photos: [{ media_asset_id: before, photo_type: 'before' }, { media_asset_id: after, photo_type: 'after' }],
        next_maintenance: { mode: 'months', interval_months: 6 } },
      { equipment_id: b.id, service_type: 'maintenance', outcome: 'not_done', not_done_reason: 'ลูกค้าไม่สะดวก' },
    ] };
  const path = `/organizations/${s.shopId}/jobs/${job.id}/complete`;
  assert.equal((await call('POST', path, { token: s.owner.access_token, body })).status, 403, 'only the assignee records the service');
  const done = await call('POST', path, { token: s.tech.access_token, body });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.job_status, 'completed');
  assert.deepEqual(done.body.items.map(i => [i.outcome, i.next_due_on]), [['done', '2027-02-28'], ['not_done', null]], '31 Aug + 6 months → last day of February');
  const retry = await call('POST', path, { token: s.tech.access_token, body });
  assert.equal(retry.body.service_event_id, done.body.service_event_id);
  assert.equal(retry.body.replayed, true);
  const changed = await call('POST', path, { token: s.tech.access_token, body: { ...body, note: 'คนละข้อมูล' } });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'IDEMPOTENCY_MISMATCH');

  const detail = (await call('GET', `/organizations/${s.shopId}/jobs/${job.id}`, { token: s.owner.access_token })).body;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.history.at(-1).to_status, 'completed');
  assert.ok((await call('GET', `/organizations/${s.shopId}/notifications`, { token: s.owner.access_token })).body.items.some(n => n.template_key === 'job_completed'));

  const historyA = (await call('GET', `/organizations/${s.shopId}/equipment/${a.id}/history`, { token: s.owner.access_token })).body;
  assert.equal(historyA.items.length, 1);
  assert.equal(historyA.items[0].performed_by_name, 'Tech Svc');
  assert.deepEqual(historyA.items[0].photos.map(p => p.photo_type), ['before', 'after']);
  assert.deepEqual(historyA.maintenance.map(m => [m.service_type, m.interval_months, m.due_date]), [['maintenance', 6, '2027-02-28']]);
  const historyB = (await call('GET', `/organizations/${s.shopId}/equipment/${b.id}/history`, { token: s.owner.access_token })).body;
  assert.equal(historyB.items[0].outcome, 'not_done');
  assert.deepEqual(historyB.maintenance, [], 'a unit not serviced gets no new cycle');

  const none = await startedJob(s, s.techMember, s.tech.access_token, [b.id]);
  const noneDone = await call('POST', `/organizations/${s.shopId}/jobs/${none.id}/complete`, { token: s.tech.access_token, body: { expected_version: none.version,
    client_event_id: randomUUID(), occurred_at: new Date().toISOString(), items: [{ equipment_id: b.id, service_type: 'maintenance', outcome: 'deferred', not_done_reason: 'ฝนตก' }] } });
  assert.equal(noneDone.status, 400);
  assert.equal(noneDone.body.field_errors.items, 'field.noneDone');
});

test('service: next round by another technician keeps the first one in history; back-dated work does not move the cycle; no-reminder disables', { skip }, async () => {
  const s = await serviceSetup('Round');
  const second = await addTechnician(s.owner, s.shopId, 'Tech Next');
  const unit = await s.unit('แอร์');
  const complete = async (job, token, occurredAt, next) => (await call('POST', `/organizations/${s.shopId}/jobs/${job.id}/complete`, { token, body: {
    expected_version: job.version, client_event_id: randomUUID(), occurred_at: occurredAt,
    items: [{ equipment_id: unit.id, service_type: 'maintenance', outcome: 'done', next_maintenance: next }] } })).body;
  const first = await complete(await startedJob(s, s.techMember, s.tech.access_token, [unit.id]), s.tech.access_token, '2026-04-02T09:00:00+07:00', { mode: 'months', interval_months: 6 });
  assert.equal(first.items[0].next_due_on, '2026-10-02');
  const nextRound = await complete(await startedJob(s, second.memberId, second.access_token, [unit.id]), second.access_token, '2026-10-01T09:00:00+07:00', null);
  assert.equal(nextRound.items[0].next_due_on, '2027-04-01', 'existing 6-month schedule is reused');
  const history = (await call('GET', `/organizations/${s.shopId}/equipment/${unit.id}/history`, { token: s.owner.access_token })).body;
  assert.deepEqual(history.items.map(i => i.performed_by_name), ['Tech Next', 'Tech Round'], 'earlier work keeps its technician');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM core.maintenance_cycles WHERE organization_id = $1 AND status = 'open'", [s.shopId])).rows[0].n, 1);

  const backdated = await complete(await startedJob(s, second.memberId, second.access_token, [unit.id]), second.access_token, '2026-06-01T09:00:00+07:00', { mode: 'months', interval_months: 3 });
  assert.equal(backdated.items[0].next_due_on, null, 'older than the latest service: recorded, cycle unchanged');
  assert.equal((await call('GET', `/organizations/${s.shopId}/equipment/${unit.id}/history`, { token: s.owner.access_token })).body.maintenance[0].due_date, '2027-04-01');

  await complete(await startedJob(s, second.memberId, second.access_token, [unit.id]), second.access_token, new Date().toISOString(), { mode: 'none' });
  const afterNone = (await call('GET', `/organizations/${s.shopId}/equipment/${unit.id}/history`, { token: s.owner.access_token })).body.maintenance[0];
  assert.deepEqual([afterNone.enabled, afterNone.due_date], [false, null]);
});

test('service: ad-hoc on-site work creates a completed job; late submission after expiry only for jobs started before', { skip }, async () => {
  const s = await serviceSetup('Adhoc');
  const own = (await call('POST', `/organizations/${s.shopId}/customers`, { token: s.tech.access_token, body: { request_key: randomUUID(), phone: '0855500022', location: { label: 'ร้าน' } } })).body;
  const unit = (await call('POST', `/organizations/${s.shopId}/locations/${own.locations[0].id}/equipment`, { token: s.tech.access_token, body: { request_key: randomUUID(), category: 'pump' } })).body;
  const recorded = await call('POST', `/organizations/${s.shopId}/service-events`, { token: s.tech.access_token, body: {
    client_event_id: randomUUID(), customer_id: own.id, location_id: own.locations[0].id, occurred_at: new Date().toISOString(),
    items: [{ equipment_id: unit.id, service_type: 'repair', outcome: 'done', work_note: 'เปลี่ยนสวิตช์แรงดัน' }] } });
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  const adhocJob = (await call('GET', `/organizations/${s.shopId}/jobs/${recorded.body.job_id}`, { token: s.owner.access_token })).body;
  assert.deepEqual([adhocJob.status, adhocJob.job_type, adhocJob.assignee_name], ['completed', 'repair', 'Tech Adhoc']);

  // Plan ends 1 hour ago: a job started 2 hours ago may still be finished within 24 hours.
  const unitA = await s.unit('A');
  const job = await startedJob(s, s.techMember, s.tech.access_token, [unitA.id]);
  await db.query("UPDATE core.jobs SET started_at = now() - interval '2 hours' WHERE id = $1", [job.id]);
  await db.query(`UPDATE billing.subscription_periods SET start_at = now() - interval '15 days', end_at = now() - interval '1 hour' WHERE organization_id = $1`, [s.shopId]);
  const version = (await db.query('SELECT version FROM core.jobs WHERE id = $1', [job.id])).rows[0].version;
  const late = await call('POST', `/organizations/${s.shopId}/jobs/${job.id}/complete`, { token: s.tech.access_token, body: { expected_version: version,
    client_event_id: randomUUID(), occurred_at: new Date().toISOString(), items: [{ equipment_id: unitA.id, service_type: 'maintenance', outcome: 'done' }] } });
  assert.equal(late.status, 201, JSON.stringify(late.body));
  const refused = await call('POST', `/organizations/${s.shopId}/service-events`, { token: s.tech.access_token, body: {
    client_event_id: randomUUID(), customer_id: own.id, location_id: own.locations[0].id, occurred_at: new Date().toISOString(),
    items: [{ equipment_id: unit.id, service_type: 'repair', outcome: 'done' }] } });
  assert.equal(refused.body.code, 'SUBSCRIPTION_EXPIRED', 'no new work after expiry');
});
