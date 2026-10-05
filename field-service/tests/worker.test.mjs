import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';

let db, a;
before(async () => { db = await openTestDatabase('worker'); a = actors(db); });
after(async () => { await db?.close(); });

/** Runs SQL as the worker role, the way apps/api/src/worker.ts does. */
async function asWorker(sql, params) {
  await db.exec('BEGIN; SET LOCAL ROLE fs_worker;');
  try { const r = (await db.query(sql, params)).rows; await db.exec('COMMIT'); return r; }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function readyAsset(shop) {
  return (await db.query(`INSERT INTO core.media_assets(organization_id, object_key, mime_type, size_bytes, status, uploaded_by, request_key, thumbnail_key, checksum, gps_metadata_stripped_at)
    VALUES ($1, $2, 'image/jpeg', 1000, 'ready', $3, $4, $5, repeat('a', 64), now()) RETURNING id`,
    [shop.organizationId, `${shop.organizationId}/test/${randomUUID()}.jpg`, shop.owner.userId, randomUUID(), `${shop.organizationId}/test/${randomUUID()}_thumb.jpg`])).rows[0].id;
}
async function queueOcr(shop) {
  const key = randomUUID();
  assert.equal((await a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,1,600)', [shop.owner.userId, shop.organizationId, 'ocr', key])).outcome, 'reserved');
  const id = (await db.query('INSERT INTO core.ocr_requests(organization_id, request_key, media_asset_id, requested_by) VALUES ($1,$2,$3,$4) RETURNING id',
    [shop.organizationId, key, await readyAsset(shop), shop.owner.userId])).rows[0].id;
  return { id, key };
}
const ocrUsed = async shop => Number((await a.one('SELECT * FROM auth.subscription_summary($1,$2)', [shop.owner.userId, shop.organizationId])).ocr_used);
const inbox = async (userId, organizationId) => (await db.query('SELECT template_key, parameters, event_key FROM core.notifications WHERE recipient_user_id = $1 AND organization_id = $2 ORDER BY created_at', [userId, organizationId])).rows;

test('worker role reaches data only through worker functions; the API role cannot call them', async () => {
  await assert.rejects(() => asWorker('SELECT * FROM core.ocr_requests'), e => e.code === '42501');
  await assert.rejects(() => asWorker('SELECT * FROM auth.sessions'), e => e.code === '42501');
  await assert.rejects(() => a.api('SELECT * FROM worker.claim_ocr(1)'), e => e.code === '42501');
  await assert.rejects(() => a.api('SELECT core.notify($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), randomUUID(), 'x', 'x', '{}', null, null]), e => e.code === '42501');
});

test('OCR success is counted once; a claimed job is not claimed again', async () => {
  const shop = await a.createShop('OcrOk');
  const job = await queueOcr(shop);
  const claimed = await asWorker('SELECT * FROM worker.claim_ocr(10)');
  assert.ok(claimed.some(c => c.id === job.id));
  assert.equal((await asWorker('SELECT * FROM worker.claim_ocr(10)')).filter(c => c.id === job.id).length, 0);
  await asWorker('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)', [job.id, 'succeeded', 'development', { fields: { brand: 'Daikin' } }, null, 0]);
  await asWorker('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)', [job.id, 'succeeded', 'development', {}, null, 0]);
  const row = (await db.query('SELECT status, result FROM core.ocr_requests WHERE id = $1', [job.id])).rows[0];
  assert.equal(row.status, 'succeeded');
  assert.deepEqual(row.result, { fields: { brand: 'Daikin' } });
  assert.equal(await ocrUsed(shop), 1);
});

test('OCR temporary errors are retried up to 3 attempts and failures are not counted', async () => {
  const shop = await a.createShop('OcrRetry');
  const job = await queueOcr(shop);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await db.query('UPDATE core.ocr_requests SET next_attempt_at = now() WHERE id = $1', [job.id]);
    assert.ok((await asWorker('SELECT * FROM worker.claim_ocr(10)')).some(c => c.id === job.id), `attempt ${attempt}`);
    await asWorker('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)', [job.id, 'retry', 'development', null, 'TIMEOUT', 0]);
  }
  const row = (await db.query('SELECT status, attempts FROM core.ocr_requests WHERE id = $1', [job.id])).rows[0];
  assert.deepEqual([row.status, row.attempts], ['failed', 3]);
  assert.equal(await ocrUsed(shop), 0);
  assert.equal((await db.query('SELECT status FROM billing.usage_reservations WHERE organization_id = $1 AND request_key = $2', [shop.organizationId, job.key])).rows[0].status, 'released');
});

test('a running job left by a crashed worker goes back to the queue', async () => {
  const shop = await a.createShop('OcrStale');
  const job = await queueOcr(shop);
  await asWorker('SELECT * FROM worker.claim_ocr(10)');
  // touch_version would reset updated_at; replica mode skips triggers for this setup step only.
  await db.exec('SET session_replication_role = replica');
  try { await db.query("UPDATE core.ocr_requests SET updated_at = now() - interval '20 minutes' WHERE id = $1", [job.id]); }
  finally { await db.exec('SET session_replication_role = origin'); }
  assert.ok((await asWorker('SELECT worker.requeue_stale_ocr(600) AS n'))[0].n >= 1);
  assert.equal((await db.query('SELECT status FROM core.ocr_requests WHERE id = $1', [job.id])).rows[0].status, 'queued');
});

test('join requests notify the owner, approval notifies the technician, each once', async () => {
  const shop = await a.createShop('Notify');
  const tech = await a.addTechnician(shop);
  const ownerInbox = await inbox(shop.owner.userId, shop.organizationId);
  assert.equal(ownerInbox.filter(n => n.template_key === 'join_request').length, 1);
  assert.deepEqual(ownerInbox.find(n => n.template_key === 'join_request').parameters, { name: 'Tech' });
  await a.requestJoin(tech, shop.token);
  assert.equal((await inbox(shop.owner.userId, shop.organizationId)).filter(n => n.template_key === 'join_request').length, 1, 'repeating the request does not notify again');
  await a.change(shop.owner, shop.organizationId, tech.memberId, 'approve');
  assert.deepEqual((await inbox(tech.userId, shop.organizationId)).map(n => n.template_key), ['member_approved']);
});

test('a member can read only their own notifications', async () => {
  const shop = await a.createShop('Inbox');
  const tech = await a.addTechnician(shop);
  await a.change(shop.owner, shop.organizationId, tech.memberId, 'approve');
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)", [tech.userId, shop.organizationId]);
    const visible = (await db.query('SELECT recipient_user_id FROM core.notifications')).rows;
    assert.ok(visible.length >= 1);
    assert.ok(visible.every(r => r.recipient_user_id === tech.userId));
    const changed = await db.query("UPDATE core.notifications SET read_at = now() WHERE recipient_user_id <> $1", [tech.userId]);
    assert.equal(changed.rowCount ?? changed.affectedRows ?? 0, 0);
  } finally { await db.exec('ROLLBACK'); }
});

test('push deliveries are queued per device and finished by the worker', async () => {
  const shop = await a.createShop('Push');
  await a.one('SELECT auth.register_device($1,$2,$3) AS id', [shop.owner.userId, `ExponentPushToken[${randomUUID()}]`, 'android']);
  await a.addTechnician(shop);
  const claimed = (await asWorker('SELECT * FROM worker.claim_deliveries(50)')).filter(d => d.organization_id === shop.organizationId);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].template_key, 'join_request');
  await asWorker('SELECT worker.finish_delivery($1,$2,$3)', [claimed[0].id, 'invalid_token', 'DeviceNotRegistered']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM auth.device_tokens WHERE user_id = $1 AND revoked_at IS NULL', [shop.owner.userId])).rows[0].n, 0, 'invalid tokens are revoked');
});

test('queued pushes never reach a device after sign-out or after another account takes the phone', async () => {
  const shop = await a.createShop('Push handover');
  const token = `fcm-${randomUUID()}`;
  await a.one('SELECT auth.register_device($1,$2,$3) AS id', [shop.owner.userId, token, 'android']);
  await a.addTechnician(shop);
  await a.one('SELECT auth.revoke_device($1,$2) AS ok', [shop.owner.userId, token]);
  const queued = (await db.query('SELECT d.id FROM ops.notification_deliveries d JOIN auth.device_tokens t ON t.id = d.device_token_id WHERE t.token = $1', [token])).rows;
  assert.equal(queued.length, 1);
  assert.equal((await asWorker('SELECT * FROM worker.claim_deliveries(50)')).filter(d => d.token === token).length, 0, 'revoked device not claimed');
  assert.deepEqual((await db.query('SELECT status, last_error FROM ops.notification_deliveries WHERE id = $1', [queued[0].id])).rows[0], { status: 'skipped', last_error: 'DEVICE_NOT_CURRENT' });

  // Same phone, same token: the owner signs in again, a new request arrives, then a technician signs in on it.
  await a.one('SELECT auth.register_device($1,$2,$3) AS id', [shop.owner.userId, token, 'android']);
  await a.addTechnician(shop);
  const other = await a.createShop('Push handover 2');
  await a.one('SELECT auth.register_device($1,$2,$3) AS id', [other.owner.userId, token, 'android']);
  assert.equal((await asWorker('SELECT * FROM worker.claim_deliveries(50)')).filter(d => d.token === token).length, 0, 'push for the previous holder skipped');
  await a.addTechnician(other);
  const mine = (await asWorker('SELECT * FROM worker.claim_deliveries(50)')).filter(d => d.token === token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].organization_id, other.organizationId, 'current holder still receives theirs');
});

test('subscription reminders: trial ending once per period, expired once', async () => {
  const shop = await a.createShop('Remind');
  await db.query("UPDATE billing.subscription_periods SET start_at = start_at - interval '12 days', end_at = end_at - interval '12 days' WHERE organization_id = $1", [shop.organizationId]);
  await asWorker('SELECT worker.scan_subscriptions(now())');
  await asWorker('SELECT worker.scan_subscriptions(now())');
  assert.deepEqual((await inbox(shop.owner.userId, shop.organizationId)).filter(n => n.template_key === 'trial_ending').length, 1);
  await db.query("UPDATE billing.subscription_periods SET start_at = start_at - interval '5 days', end_at = end_at - interval '5 days' WHERE organization_id = $1", [shop.organizationId]);
  await asWorker('SELECT worker.scan_subscriptions(now())');
  await asWorker('SELECT worker.scan_subscriptions(now())');
  assert.equal((await inbox(shop.owner.userId, shop.organizationId)).filter(n => n.template_key === 'subscription_expired').length, 1);
});

test('storage use at 80% warns the owner once; consumption never exceeds the reservation', async () => {
  const shop = await a.createShop('Storage');
  const key = randomUUID();
  await a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,$5,600)', [shop.owner.userId, shop.organizationId, 'storage_bytes', key, 900_000_000]);
  assert.equal((await a.one('SELECT * FROM auth.consume_usage($1,$2,$3,$4)', [shop.organizationId, 'storage_bytes', key, 2_000_000_000])).outcome, 'consumed');
  const used = Number((await a.one('SELECT * FROM auth.subscription_summary($1,$2)', [shop.owner.userId, shop.organizationId])).storage_used);
  assert.equal(used, 900_000_000, 'capped at the reserved size');
  assert.deepEqual((await inbox(shop.owner.userId, shop.organizationId)).filter(n => n.template_key === 'storage_threshold').map(n => n.parameters), [{ percent: 80 }]);
});

test('housekeeping expires stale reservations and purges spent codes', async () => {
  const shop = await a.createShop('House');
  const key = randomUUID();
  await a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,1,600)', [shop.owner.userId, shop.organizationId, 'ocr', key]);
  await db.query("UPDATE billing.usage_reservations SET expires_at = now() - interval '1 second' WHERE request_key = $1", [key]);
  await db.query("UPDATE auth.otp_challenges SET created_at = created_at - interval '3 days'");
  const result = (await asWorker('SELECT worker.housekeeping() AS r'))[0].r;
  assert.ok(result.reservations_expired >= 1);
  assert.ok(result.otp_deleted >= 1);
  assert.equal((await db.query('SELECT status FROM billing.usage_reservations WHERE request_key = $1', [key])).rows[0].status, 'expired');
});
