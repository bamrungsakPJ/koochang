import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';

const shopA = '20000000-0000-0000-0000-000000000001';
let db;
before(async () => { db = await openTestDatabase('identity'); });
after(async () => { await db?.close(); });

const hex = value => createHash('sha256').update(value).digest('hex');
const randomHash = () => hex(randomUUID());
let phoneSeq = 0;
const newPhone = () => `+6681${String(1000000 + phoneSeq++).slice(-7)}`;

/** Runs SQL as the API runtime role, the way DatabaseService.identity does. */
async function api(sql, params, client) {
  const run = client ? (s, p) => client.query(s, p) : (s, p) => db.query(s, p);
  if (client) await client.query('BEGIN; SET LOCAL ROLE fs_api;'); else await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {
    const result = (await run(sql, params)).rows;
    await run('COMMIT'); return result;
  } catch (error) { await run('ROLLBACK'); throw error; }
}
const one = async (sql, params, client) => (await api(sql, params, client))[0];

async function challenge(phone, code = '123456') {
  const id = randomUUID();
  const row = await one('SELECT * FROM auth.create_otp_challenge($1,$2,$3,$4,300,5,30,20,1000)', [id, phone, hex(`${id}:${code}`), null]);
  return { id, code, row };
}
/** Lets the next code request for this phone pass the cooldown (test setup runs as superuser). */
const ageChallenges = phone => db.query("UPDATE auth.otp_challenges SET created_at = created_at - interval '2 hours', expires_at = expires_at - interval '2 hours' WHERE phone_e164 = $1", [phone]);

async function signIn(phone, name = 'Tester') {
  await ageChallenges(phone);
  const c = await challenge(phone);
  const access = randomUUID(), refresh = randomUUID();
  const row = await one('SELECT * FROM auth.verify_otp($1,$2,$3,$4,$5,1800,$6,86400)', [c.id, hex(`${c.id}:${c.code}`), name, 'th', hex(access), hex(refresh)]);
  assert.equal(row.outcome, 'ok');
  return { userId: row.user_id, isNew: row.is_new_user, access, refresh, sessionId: row.session_id };
}

async function createShop(ownerName = 'Owner') {
  const owner = await signIn(newPhone(), ownerName);
  const token = randomUUID();
  const row = await one('SELECT * FROM auth.create_organization($1,$2,$3,$4,$5,$6,$7)', [owner.userId, `Shop ${ownerName}`, null, 'th', hex(token), 'sealed', randomUUID()]);
  assert.equal(row.outcome, 'created');
  return { owner, organizationId: row.organization_id, ownerMemberId: row.member_id, token };
}

const requestJoin = (user, token, name = 'Tech') => one('SELECT * FROM auth.request_join($1,$2,$3,$4)', [user.userId, hex(token), name, randomUUID()]);
const memberVersion = async memberId => (await db.query('SELECT version FROM core.organization_members WHERE id = $1', [memberId])).rows[0].version;
async function change(actor, organizationId, memberId, action, version, client) {
  return one('SELECT * FROM auth.change_member_status($1,$2,$3,$4,$5,$6,$7)',
    [actor.userId, organizationId, memberId, action, version ?? await memberVersion(memberId), null, randomUUID()], client);
}
/** Same RLS path a tenant request takes. Counts shop data the member can see: the shop row and
 * the customers (technicians see only the customers they created, so the shop row is what
 * proves access for them). */
async function visibleCustomers(userId, organizationId) {
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)", [userId, organizationId]);
    return (await db.query('SELECT id FROM core.organizations')).rows.length;
  } finally { await db.exec('ROLLBACK'); }
}
const addCustomer = organizationId => db.query("INSERT INTO core.customers(organization_id, name) VALUES ($1, 'Customer')", [organizationId]);

test('runtime role reaches identity data only through auth functions', async () => {
  for (const sql of ['SELECT * FROM auth.sessions', 'SELECT * FROM auth.otp_challenges', "INSERT INTO core.organizations(name) VALUES ('x')",
    "UPDATE core.organization_members SET status = 'active'"]) {
    await assert.rejects(() => api(sql), e => e.code === '42501', sql);
  }
});

test('OTP: wrong codes are counted and the challenge locks after the limit', async () => {
  const phone = newPhone();
  const c = await challenge(phone);
  for (let i = 1; i <= 4; i++) {
    const r = await one('SELECT * FROM auth.verify_otp($1,$2,NULL,NULL,$3,1800,$4,86400)', [c.id, hex(`${c.id}:000000`), randomHash(), randomHash()]);
    assert.equal(r.outcome, 'invalid');
  }
  assert.equal((await one('SELECT * FROM auth.verify_otp($1,$2,NULL,NULL,$3,1800,$4,86400)', [c.id, hex(`${c.id}:000000`), randomHash(), randomHash()])).outcome, 'attempts_exceeded');
  const correct = await one('SELECT * FROM auth.verify_otp($1,$2,NULL,NULL,$3,1800,$4,86400)', [c.id, hex(`${c.id}:${c.code}`), randomHash(), randomHash()]);
  assert.equal(correct.outcome, 'attempts_exceeded');
  assert.equal(correct.user_id, null);
});

test('OTP: cooldown and hourly limits return a wait time instead of a challenge', async () => {
  const phone = newPhone();
  assert.ok((await challenge(phone)).row.challenge_id);
  const again = await challenge(phone);
  assert.equal(again.row.challenge_id, null);
  assert.ok(again.row.retry_after_seconds > 0 && again.row.retry_after_seconds <= 30);
  const client = randomHash();
  await one('SELECT * FROM auth.create_otp_challenge($1,$2,$3,$4,300,5,30,20,1)', [randomUUID(), newPhone(), randomHash(), client]);
  const blocked = await one('SELECT * FROM auth.create_otp_challenge($1,$2,$3,$4,300,5,30,20,1)', [randomUUID(), newPhone(), randomHash(), client]);
  assert.equal(blocked.challenge_id, null);
  assert.ok(blocked.retry_after_seconds > 0);
});

test('OTP: expired, superseded and already used codes are refused', async () => {
  const phone = newPhone();
  const old = await challenge(phone);
  await ageChallenges(phone);
  const fresh = await challenge(phone);
  const verify = c => one('SELECT * FROM auth.verify_otp($1,$2,NULL,NULL,$3,1800,$4,86400)', [c.id, hex(`${c.id}:${c.code}`), randomHash(), randomHash()]);
  assert.equal((await verify(old)).outcome, 'expired');
  assert.equal((await verify(fresh)).outcome, 'ok');
  assert.equal((await verify(fresh)).outcome, 'invalid');
});

test('signing up twice with the same phone returns the same user', async () => {
  const phone = newPhone();
  const first = await signIn(phone, 'First');
  const second = await signIn(phone, 'Second');
  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.userId, first.userId);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM core.users WHERE phone_e164 = $1', [phone])).rows[0].n, 1);
});

test('creating a shop makes the owner and one join link together; retries return the same shop', async () => {
  const owner = await signIn(newPhone(), 'Owner');
  const requestId = randomUUID();
  const create = () => one('SELECT * FROM auth.create_organization($1,$2,$3,$4,$5,$6,$7)', [owner.userId, ' My Shop ', null, 'en', randomHash(), 'sealed', requestId]);
  const first = await create();
  const retry = await create();
  assert.equal(first.outcome, 'created');
  assert.equal(retry.outcome, 'existing');
  assert.equal(retry.organization_id, first.organization_id);
  const members = (await db.query('SELECT role, status FROM core.organization_members WHERE organization_id = $1', [first.organization_id])).rows;
  assert.deepEqual(members, [{ role: 'owner', status: 'active' }]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM core.organization_join_links WHERE organization_id = $1 AND status = 'active'", [first.organization_id])).rows[0].n, 1);
  assert.equal((await db.query('SELECT name FROM core.organizations WHERE id = $1', [first.organization_id])).rows[0].name, 'My Shop');
  const unverified = await one('SELECT * FROM auth.create_organization($1,$2,$3,$4,$5,$6,$7)', ['10000000-0000-0000-0000-000000000001', 'X', null, 'th', randomHash(), 'sealed', randomUUID()]);
  assert.equal(unverified.outcome, 'forbidden');
});

test('a join request stays pending and sees no shop data until the owner approves', async () => {
  const shop = await createShop('Pending');
  await addCustomer(shop.organizationId);
  const preview = await one('SELECT * FROM auth.join_link_preview($1)', [hex(shop.token)]);
  assert.deepEqual(preview, { state: 'active', organization_name: 'Shop Pending' });
  const tech = await signIn(newPhone(), 'Tech');
  const request = await requestJoin(tech, shop.token, 'Somchai');
  assert.equal(request.outcome, 'pending');
  const repeat = await requestJoin(tech, shop.token, 'Somchai');
  assert.equal(repeat.member_id, request.member_id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM core.organization_members WHERE organization_id = $1 AND user_id = $2', [shop.organizationId, tech.userId])).rows[0].n, 1);
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 0);
  assert.equal((await change(shop.owner, shop.organizationId, request.member_id, 'approve')).outcome, 'ok');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 1);
  assert.equal((await requestJoin(tech, shop.token)).outcome, 'active');
});

test('suspend and remove take effect on the next query; rejoining needs a new approval', async () => {
  const shop = await createShop('Suspend');
  await addCustomer(shop.organizationId);
  const tech = await signIn(newPhone());
  const { member_id: memberId } = await requestJoin(tech, shop.token);
  await change(shop.owner, shop.organizationId, memberId, 'approve');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 1);
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'suspend')).outcome, 'ok');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 0);
  assert.equal((await requestJoin(tech, shop.token)).outcome, 'suspended', 'a suspended member cannot reset itself by asking again');
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'reactivate')).outcome, 'ok');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 1);
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'remove')).outcome, 'ok');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 0);
  const again = await requestJoin(tech, shop.token);
  assert.equal(again.outcome, 'pending');
  assert.equal(again.member_id, memberId, 'the same membership row is reused so history keeps pointing at it');
  assert.equal(await visibleCustomers(tech.userId, shop.organizationId), 0);
  const audit = (await db.query("SELECT action FROM ops.audit_logs WHERE entity_id = $1 ORDER BY created_at", [memberId])).rows.map(r => r.action);
  assert.ok(['member.approve', 'member.suspend', 'member.reactivate', 'member.remove'].every(a => audit.includes(a)));
});

test('closed and reset links stop new requests without revealing the shop', async () => {
  const shop = await createShop('Links');
  const member = await signIn(newPhone());
  const { member_id: memberId } = await requestJoin(member, shop.token);
  await change(shop.owner, shop.organizationId, memberId, 'approve');
  const link = (op, token) => one('SELECT * FROM auth.change_join_link($1,$2,$3,$4,$5,$6)', [shop.owner.userId, shop.organizationId, op, token ? hex(token) : null, token ? 'sealed2' : null, randomUUID()]);

  assert.equal((await link('close')).status, 'closed');
  assert.deepEqual(await one('SELECT * FROM auth.join_link_preview($1)', [hex(shop.token)]), { state: 'closed', organization_name: null });
  assert.equal((await requestJoin(await signIn(newPhone()), shop.token)).outcome, 'closed');
  assert.equal((await requestJoin(member, shop.token)).outcome, 'active', 'an existing member can still open the link');
  assert.equal((await link('open')).status, 'active');

  const pendingUser = await signIn(newPhone());
  const pending = await requestJoin(pendingUser, shop.token);
  const newToken = randomUUID();
  const rotated = await link('rotate', newToken);
  assert.equal(rotated.generation, 2);
  assert.deepEqual(await one('SELECT * FROM auth.join_link_preview($1)', [hex(shop.token)]), { state: 'invalid', organization_name: null });
  assert.equal((await requestJoin(await signIn(newPhone()), shop.token)).outcome, 'invalid_link');
  assert.equal((await requestJoin(await signIn(newPhone()), newToken)).outcome, 'pending');
  assert.equal((await db.query('SELECT status FROM core.organization_members WHERE id = $1', [pending.member_id])).rows[0].status, 'pending');
  assert.equal((await one('SELECT * FROM auth.join_link_preview($1)', [randomHash()])).state, 'invalid');
});

test('only the owner of the same shop can manage its team', async () => {
  const shop = await createShop('Guarded');
  const other = await createShop('Other');
  const tech = await signIn(newPhone());
  const { member_id: techMember } = await requestJoin(tech, shop.token);
  await change(shop.owner, shop.organizationId, techMember, 'approve');
  const applicant = await signIn(newPhone());
  const { member_id: pendingMember } = await requestJoin(applicant, shop.token);

  assert.equal((await change(tech, shop.organizationId, pendingMember, 'approve')).outcome, 'forbidden');
  assert.equal((await change(other.owner, shop.organizationId, pendingMember, 'approve')).outcome, 'forbidden');
  assert.equal((await change(other.owner, other.organizationId, pendingMember, 'approve')).outcome, 'not_found', 'a member id from another shop is not found');
  assert.equal((await api('SELECT * FROM auth.team($1,$2)', [other.owner.userId, shop.organizationId])).length, 0);
  assert.equal((await api('SELECT * FROM auth.current_join_link($1,$2)', [tech.userId, shop.organizationId])).length, 0);
  assert.equal((await change(shop.owner, shop.organizationId, shop.ownerMemberId, 'suspend')).outcome, 'not_found', 'the owner membership cannot be suspended');
  assert.equal((await db.query('SELECT status FROM core.organization_members WHERE id = $1', [pendingMember])).rows[0].status, 'pending');
});

test('seat limit counts active technicians only', async () => {
  const shop = await createShop('Seats');
  const members = [];
  for (let i = 0; i < 4; i++) members.push((await requestJoin(await signIn(newPhone()), shop.token)).member_id);
  for (const id of members.slice(0, 3)) assert.equal((await change(shop.owner, shop.organizationId, id, 'approve')).outcome, 'ok');
  const full = await change(shop.owner, shop.organizationId, members[3], 'approve');
  assert.equal(full.outcome, 'seat_limit_reached');
  assert.equal(full.seat_limit, 3);
  await change(shop.owner, shop.organizationId, members[0], 'suspend');
  assert.equal((await change(shop.owner, shop.organizationId, members[3], 'approve')).outcome, 'ok');
  assert.equal((await change(shop.owner, shop.organizationId, members[0], 'reactivate')).outcome, 'seat_limit_reached');
  const usage = await one('SELECT * FROM auth.seat_usage($1,$2)', [shop.owner.userId, shop.organizationId]);
  assert.deepEqual(usage, { active_technicians: 3, seat_limit: 3 });
});

test('stale versions conflict, retries of a finished command succeed, invalid transitions fail', async () => {
  const shop = await createShop('Versions');
  const { member_id: memberId } = await requestJoin(await signIn(newPhone()), shop.token);
  const version = await memberVersion(memberId);
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'approve', version)).outcome, 'ok');
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'approve', version)).outcome, 'ok', 'retry after success');
  const conflict = await change(shop.owner, shop.organizationId, memberId, 'suspend', version);
  assert.equal(conflict.outcome, 'version_conflict');
  assert.equal(conflict.version, version + 1);
  assert.equal((await change(shop.owner, shop.organizationId, memberId, 'reject')).outcome, 'invalid_transition');
});

test('sessions: refresh rotates tokens, a reused refresh token revokes the session, logout revokes', async () => {
  const user = await signIn(newPhone());
  const resolve = access => one('SELECT * FROM auth.resolve_session($1)', [hex(access)]);
  assert.equal((await resolve(user.access)).state, 'active');
  assert.equal((await resolve(randomUUID())).state, 'invalid');

  const access2 = randomUUID(), refresh2 = randomUUID();
  const refreshed = await one('SELECT * FROM auth.refresh_session($1,$2,1800,$3,86400)', [hex(user.refresh), hex(access2), hex(refresh2)]);
  assert.equal(refreshed.outcome, 'ok');
  assert.equal((await resolve(user.access)).state, 'invalid');
  assert.equal((await resolve(access2)).state, 'active');

  const reused = await one('SELECT * FROM auth.refresh_session($1,$2,1800,$3,86400)', [hex(user.refresh), randomHash(), randomHash()]);
  assert.equal(reused.outcome, 'reused');
  assert.equal((await resolve(access2)).state, 'invalid', 'the leaked chain is revoked');

  const other = await signIn(newPhone());
  await db.query("UPDATE auth.sessions SET access_expires_at = now() - interval '1 second' WHERE id = $1", [other.sessionId]);
  assert.equal((await resolve(other.access)).state, 'expired');
  await one('SELECT auth.revoke_session($1)', [other.sessionId]);
  assert.equal((await one('SELECT * FROM auth.refresh_session($1,$2,1800,$3,86400)', [hex(other.refresh), randomHash(), randomHash()])).outcome, 'invalid');
});

test('a suspended user loses every session and cannot sign in again', async () => {
  const phone = newPhone();
  const user = await signIn(phone);
  await db.query("UPDATE core.users SET status = 'suspended' WHERE id = $1", [user.userId]);
  assert.equal((await one('SELECT * FROM auth.resolve_session($1)', [hex(user.access)])).state, 'invalid');
  await ageChallenges(phone);
  const c = await challenge(phone);
  assert.equal((await one('SELECT * FROM auth.verify_otp($1,$2,NULL,NULL,$3,1800,$4,86400)', [c.id, hex(`${c.id}:${c.code}`), randomHash(), randomHash()])).outcome, 'user_disabled');
});

test('the seeded technician of shop A keeps tenant access through RLS', async () => {
  assert.equal(await visibleCustomers('10000000-0000-0000-0000-000000000003', shopA) >= 1, true);
});

test('concurrent approvals never exceed the seat limit', { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL (TEST_DATABASE_URL); PGlite has one connection' }, async () => {
  const shop = await createShop('Race');
  const pending = [];
  for (let i = 0; i < 6; i++) pending.push((await requestJoin(await signIn(newPhone()), shop.token)).member_id);
  const clients = await Promise.all(pending.map(() => db.connect()));
  try {
    const versions = await Promise.all(pending.map(memberVersion));
    const results = await Promise.all(pending.map((id, i) => change(shop.owner, shop.organizationId, id, 'approve', versions[i], clients[i])));
    assert.equal(results.filter(r => r.outcome === 'ok').length, 3);
    assert.equal(results.filter(r => r.outcome === 'seat_limit_reached').length, 3);
  } finally { clients.forEach(c => c.release()); }
  const active = (await db.query("SELECT count(*)::int AS n FROM core.organization_members WHERE organization_id = $1 AND role = 'technician' AND status = 'active'", [shop.organizationId])).rows[0].n;
  assert.equal(active, 3);
});

test('concurrent duplicate join requests create one membership', { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL (TEST_DATABASE_URL)' }, async () => {
  const shop = await createShop('DoubleTap');
  const tech = await signIn(newPhone());
  const clients = await Promise.all([1, 2, 3, 4].map(() => db.connect()));
  try {
    const results = await Promise.all(clients.map(c => one('SELECT * FROM auth.request_join($1,$2,$3,$4)', [tech.userId, hex(shop.token), 'Tap', randomUUID()], c)));
    assert.equal(new Set(results.map(r => r.member_id)).size, 1);
  } finally { clients.forEach(c => c.release()); }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM core.organization_members WHERE organization_id = $1 AND user_id = $2', [shop.organizationId, tech.userId])).rows[0].n, 1);
});

// Phone + password (026) --------------------------------------------------------------------
const begin = (phone, client = null, maxFailures = 5) => one('SELECT * FROM auth.password_login_begin($1,$2,$3,900,$4)', [phone, client, maxFailures, 1000]);
const finish = (userId, hash) => one('SELECT * FROM auth.password_login_finish($1,$2,$3,1800,$4,86400)', [userId, hash, randomHash(), randomHash()]);
const setPassword = async (user, via, expected, next) => (await one('SELECT auth.set_password($1,$2,$3,$4,$5,900) AS outcome', [user.userId, user.sessionId, via, expected, next])).outcome;
const sessionState = async id => (await db.query('SELECT auth_method, revoke_reason FROM auth.sessions WHERE id = $1', [id])).rows[0];

test('password: set once after OTP, then sign in without SMS', async () => {
  const phone = newPhone();
  const user = await signIn(phone);
  const before = await one('SELECT * FROM auth.password_status($1,$2,900)', [user.userId, user.sessionId]);
  assert.deepEqual(before, { has_password: false, password_hash: null, fresh_otp: true });
  assert.equal(await setPassword(user, 'first', null, 'scrypt$one'), 'ok');
  assert.equal(await setPassword(user, 'first', null, 'scrypt$two'), 'conflict');

  const started = await begin(phone);
  assert.equal(started.outcome, 'check');
  assert.equal(started.user_id, user.userId);
  assert.equal(started.password_hash, 'scrypt$one');
  const done = await finish(user.userId, 'scrypt$one');
  assert.equal(done.outcome, 'ok');
  assert.equal((await sessionState(done.session_id)).auth_method, 'password');
  assert.equal((await finish(user.userId, 'scrypt$stale')).outcome, 'invalid');

  const unknown = await begin(newPhone());
  assert.deepEqual([unknown.outcome, unknown.user_id, unknown.password_hash], ['check', null, null]);
});

test('password: wrong guesses lock the account until a correct password or an SMS reset', async () => {
  const phone = newPhone();
  const user = await signIn(phone);
  await setPassword(user, 'first', null, 'scrypt$right');
  for (let i = 0; i < 4; i++) assert.equal((await begin(phone)).outcome, 'check');
  // The 5th attempt is still checked; if it is wrong the account stays locked.
  assert.equal((await begin(phone)).outcome, 'check');
  const locked = await begin(phone);
  assert.equal(locked.outcome, 'locked');
  assert.ok(locked.retry_after_seconds > 800);

  // Forgot password: a fresh OTP session may set a new one, which clears the lock and signs out
  // the other sessions.
  const other = await finishSession(user.userId);
  const reset = await signIn(phone);
  assert.equal(await setPassword(reset, 'otp', null, 'scrypt$new'), 'ok');
  assert.equal((await sessionState(other)).revoke_reason, 'password_changed');
  assert.equal((await sessionState(user.sessionId)).revoke_reason, 'password_changed');
  assert.equal((await sessionState(reset.sessionId)).revoke_reason, null);
  assert.equal((await begin(phone)).outcome, 'check');
});
/** Another signed-in device (setup runs as superuser; fs_api cannot call issue_session). */
const finishSession = async userId => (await db.query('SELECT auth.issue_session($1,$2,1800,$3,86400) AS id', [userId, randomHash(), randomHash()])).rows[0].id;

test('password: a password session cannot reset without the current password', async () => {
  const phone = newPhone();
  const user = await signIn(phone);
  await setPassword(user, 'first', null, 'scrypt$a');
  const done = await finish(user.userId, 'scrypt$a');
  const viaPassword = { userId: user.userId, sessionId: done.session_id };
  assert.equal(await setPassword(viaPassword, 'otp', null, 'scrypt$b'), 'not_allowed');
  assert.equal(await setPassword(viaPassword, 'current', 'scrypt$wrong', 'scrypt$b'), 'conflict');
  assert.equal(await setPassword(viaPassword, 'current', 'scrypt$a', 'scrypt$b'), 'ok');
  assert.equal((await sessionState(user.sessionId)).revoke_reason, 'password_changed');
  // An OTP session older than the window is no longer fresh.
  const old = await signIn(phone);
  await db.query("UPDATE auth.sessions SET created_at = now() - interval '1 hour' WHERE id = $1", [old.sessionId]);
  assert.equal(await setPassword(old, 'otp', null, 'scrypt$c'), 'not_allowed');
});

test('password: attempts from one client are limited per hour', async () => {
  const client = randomHash(), phone = newPhone();
  for (let i = 0; i < 3; i++) assert.equal((await one('SELECT * FROM auth.password_login_begin($1,$2,5,900,3)', [phone, client])).outcome, 'check');
  const limited = await one('SELECT * FROM auth.password_login_begin($1,$2,5,900,3)', [phone, client]);
  assert.equal(limited.outcome, 'rate_limited');
});

test('fs_api cannot read password hashes directly', async () => {
  await assert.rejects(api('SELECT * FROM auth.user_passwords'), /permission denied/);
});
