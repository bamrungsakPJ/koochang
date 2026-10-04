import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';

let db, a;
before(async () => { db = await openTestDatabase('entitlement'); a = actors(db); });
after(async () => { await db?.close(); });

const STARTER = '72000000-0000-0000-0000-000000000001';
const TEAM = '72000000-0000-0000-0000-000000000002';
const DAY = 86400000;

/** Entitlement as the server computes it, optionally at another moment. */
const entitlement = async (organizationId, at) =>
  (await db.query('SELECT * FROM billing.entitlement($1, coalesce($2::timestamptz, now()))', [organizationId, at ?? null])).rows[0];
/** Moves every period of a shop back in time, as if days had passed. */
const age = (organizationId, days) => db.query(
  `UPDATE billing.subscription_periods SET start_at = start_at - make_interval(days => $2), end_at = end_at - make_interval(days => $2) WHERE organization_id = $1`,
  [organizationId, days]);
async function invoice(organizationId, priceVersionId = STARTER) {
  return (await db.query("INSERT INTO billing.invoices(organization_id, number, amount_minor, price_version_id, status, paid_at) VALUES ($1, $2, 59000, $3, 'paid', now()) RETURNING id",
    [organizationId, `INV-${randomUUID().slice(0, 8)}`, priceVersionId])).rows[0].id;
}
const pay = async (organizationId, invoiceId, confirmedAt, priceVersionId = STARTER) => (await db.query(
  'SELECT * FROM billing.apply_paid_period($1,$2,$3,$4)', [organizationId, invoiceId, priceVersionId, confirmedAt])).rows[0];

test('a new shop starts its one trial: 14 days, trial limits, writable', async () => {
  const shop = await a.createShop('Trial');
  const e = await entitlement(shop.organizationId);
  assert.equal(e.state, 'trialing');
  assert.equal(e.writable, true);
  assert.deepEqual([e.technician_seats, Number(e.storage_bytes), e.ocr_per_period], [3, 1_000_000_000, 20]);
  assert.equal(Math.round((e.period_end - e.period_start) / DAY), 14);
  assert.equal((await db.query('SELECT billing.start_trial($1) AS id', [shop.organizationId])).rows[0].id, null, 'no second trial');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM billing.subscription_periods WHERE organization_id = $1 AND source = 'trial'", [shop.organizationId])).rows[0].n, 1);
  const rotated = await a.one('SELECT * FROM auth.change_join_link($1,$2,$3,$4,$5,$6)', [shop.owner.userId, shop.organizationId, 'rotate', a.hex(randomUUID()), 'x', randomUUID()]);
  assert.equal(rotated.outcome, 'ok');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscription_periods WHERE organization_id = $1', [shop.organizationId])).rows[0].n, 1, 'resetting the link does not restart the trial');
});

test('without a published trial plan a new shop waits for payment and cannot approve technicians', async () => {
  await db.query("UPDATE billing.plans SET status = 'archived' WHERE kind = 'trial'");
  let shop;
  try { shop = await a.createShop('NoTrial'); } finally { await db.query("UPDATE billing.plans SET status = 'active' WHERE kind = 'trial'"); }
  const e = await entitlement(shop.organizationId);
  assert.equal(e.state, 'pending_payment');
  assert.equal(e.writable, false);
  const tech = await a.addTechnician(shop);
  assert.equal((await a.change(shop.owner, shop.organizationId, tech.memberId, 'approve')).outcome, 'subscription_inactive');
});

test('after the trial the shop expires: no grace, no approvals, technicians keep their rows', async () => {
  const shop = await a.createShop('Expired');
  const active = await a.addTechnician(shop);
  await a.change(shop.owner, shop.organizationId, active.memberId, 'approve');
  const pending = await a.addTechnician(shop);
  await age(shop.organizationId, 15);
  const e = await entitlement(shop.organizationId);
  assert.equal(e.state, 'expired');
  assert.equal(e.writable, false);
  assert.equal(e.grace_until, null);
  assert.equal((await a.change(shop.owner, shop.organizationId, pending.memberId, 'approve')).outcome, 'subscription_inactive');
  assert.equal((await a.change(shop.owner, shop.organizationId, active.memberId, 'suspend')).outcome, 'ok', 'owners can still reduce the team');
  assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)', [shop.owner.userId, shop.organizationId])).outcome, 'inactive');
});

test('paid period: starts at confirmation after the trial, retry of the same invoice does not extend', async () => {
  const shop = await a.createShop('Paid');
  await age(shop.organizationId, 20);
  const inv = await invoice(shop.organizationId);
  const confirmed = new Date('2026-11-10T03:00:00Z');
  const first = await pay(shop.organizationId, inv, confirmed);
  assert.equal(first.outcome, 'created');
  assert.equal(first.start_at.toISOString(), confirmed.toISOString());
  assert.equal(first.end_at.toISOString(), '2026-12-10T03:00:00.000Z');
  const retry = await pay(shop.organizationId, inv, new Date('2026-11-12T03:00:00Z'));
  assert.equal(retry.outcome, 'existing');
  assert.equal(retry.period_id, first.period_id);
  const e = await entitlement(shop.organizationId, '2026-11-20T00:00:00Z');
  assert.deepEqual([e.state, e.plan_code, e.technician_seats], ['active', 'starter', 3]);
});

test('renewal before expiry and within grace continues from the end; after grace starts on confirmation', async () => {
  // Example from the commercial policy: period ends 10 Nov 2026 10:00 (Bangkok), grace 7 days.
  const shop = await a.createShop('Renew');
  const first = await pay(shop.organizationId, await invoice(shop.organizationId), new Date('2026-10-10T03:00:00Z'));
  assert.equal(first.end_at.toISOString(), '2026-11-10T03:00:00.000Z');
  const early = await pay(shop.organizationId, await invoice(shop.organizationId), new Date('2026-11-05T03:00:00Z'));
  assert.equal(early.start_at.toISOString(), '2026-11-10T03:00:00.000Z');
  assert.equal(early.end_at.toISOString(), '2026-12-10T03:00:00.000Z');

  const past = await entitlement(shop.organizationId, '2026-12-13T00:00:00Z');
  assert.equal(past.state, 'past_due');
  assert.equal(past.writable, true);
  assert.equal(past.grace_until.toISOString(), '2026-12-17T03:00:00.000Z');
  const inGrace = await pay(shop.organizationId, await invoice(shop.organizationId), new Date('2026-12-13T03:00:00Z'));
  assert.equal(inGrace.start_at.toISOString(), '2026-12-10T03:00:00.000Z', 'grace renewal keeps the old end');

  const afterGrace = await entitlement(shop.organizationId, '2027-01-18T00:00:00Z');
  assert.equal(afterGrace.state, 'expired');
  const late = await pay(shop.organizationId, await invoice(shop.organizationId), new Date('2027-01-18T03:00:00Z'));
  assert.equal(late.start_at.toISOString(), '2027-01-18T03:00:00.000Z');
  const periods = (await db.query("SELECT start_at, end_at FROM billing.subscription_periods WHERE organization_id = $1 AND source = 'paid' ORDER BY start_at", [shop.organizationId])).rows;
  for (let i = 1; i < periods.length; i++) assert.ok(periods[i].start_at >= periods[i - 1].end_at, 'paid periods never overlap');
});

test('a 31st anchor uses the last day of short months and comes back to the 31st', async () => {
  const end = async (anchor, after) => (await db.query("SELECT billing.period_end_after($1,$2,'month') AS t", [anchor, after])).rows[0].t.toISOString();
  const anchor = '2027-01-31T10:00:00+07:00';
  assert.equal(await end(anchor, anchor), '2027-02-28T03:00:00.000Z');
  assert.equal(await end(anchor, '2027-02-28T10:00:00+07:00'), '2027-03-31T03:00:00.000Z');
  assert.equal(await end(anchor, '2027-03-31T10:00:00+07:00'), '2027-04-30T03:00:00.000Z');
  assert.equal(await end('2027-11-30T10:00:00+07:00', '2028-01-30T10:00:00+07:00'), '2028-02-29T03:00:00.000Z', 'leap year');
});

test('stopping renewal ends the subscription without grace; resuming restores grace', async () => {
  const shop = await a.createShop('Cancel');
  await age(shop.organizationId, 60);
  const paid = await pay(shop.organizationId, await invoice(shop.organizationId), new Date(Date.now() - 31 * DAY));
  assert.equal((await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,true,$3)', [shop.owner.userId, shop.organizationId, randomUUID()])).outcome, 'ok');
  const tech = await a.addTechnician(shop);
  assert.equal((await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,true,$3)', [tech.userId, shop.organizationId, randomUUID()])).outcome, 'forbidden');
  const afterEnd = new Date(paid.end_at.getTime() + DAY).toISOString();
  assert.equal((await entitlement(shop.organizationId, afterEnd)).state, 'ended');
  await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,false,$3)', [shop.owner.userId, shop.organizationId, randomUUID()]);
  assert.equal((await entitlement(shop.organizationId, afterEnd)).state, 'past_due');
});

test('upgrading to Team applies its seat limit from the next period', async () => {
  const shop = await a.createShop('Upgrade');
  await age(shop.organizationId, 20);
  await pay(shop.organizationId, await invoice(shop.organizationId, TEAM), new Date(), TEAM);
  const e = await entitlement(shop.organizationId);
  assert.deepEqual([e.state, e.plan_code, e.technician_seats], ['active', 'team', 10]);
  assert.equal((await db.query('SELECT auth.technician_seat_limit($1) AS n', [shop.organizationId])).rows[0].n, 10);
});

test('a grant keeps an expired shop working with its limits; security suspension wins over grants', async () => {
  const shop = await a.createShop('Grant');
  await age(shop.organizationId, 15);
  assert.equal((await entitlement(shop.organizationId)).state, 'expired');
  const admin = (await db.query("INSERT INTO platform.accounts(display_name, email) VALUES ('Ops', $1) RETURNING id", [`ops-${randomUUID()}@example.test`])).rows[0].id;
  await db.query(`INSERT INTO billing.entitlement_grants(organization_id, reason, grant_kind, valid_from, valid_until, entitlements, granted_by)
    VALUES ($1, 'pilot extension', 'pilot', now() - interval '1 hour', now() + interval '14 days', '{"technician_seats":3,"storage_bytes":1000000000,"ocr_per_period":20}', $2)`, [shop.organizationId, admin]);
  const granted = await entitlement(shop.organizationId);
  assert.deepEqual([granted.state, granted.writable, granted.source, granted.technician_seats], ['active', true, 'grant', 3]);
  await db.query("UPDATE core.organizations SET status = 'suspended' WHERE id = $1", [shop.organizationId]);
  const suspended = await entitlement(shop.organizationId);
  assert.deepEqual([suspended.state, suspended.writable], ['suspended', false]);
  await db.query("UPDATE core.organizations SET status = 'active' WHERE id = $1", [shop.organizationId]);
});

test('the runtime role cannot create paid periods or touch billing rows directly', async () => {
  const shop = await a.createShop('Locked');
  await assert.rejects(() => a.api('SELECT * FROM billing.apply_paid_period($1,$2,$3,now())', [shop.organizationId, randomUUID(), STARTER]), e => e.code === '42501');
  await assert.rejects(() => a.api('SELECT * FROM billing.entitlement($1)', [shop.organizationId]), e => e.code === '42501');
  await assert.rejects(() => a.api("UPDATE billing.subscriptions SET status = 'active'"), e => e.code === '42501');
});

test('owners see plan and usage, technicians only whether work can be saved', async () => {
  const shop = await a.createShop('Summary');
  const tech = await a.addTechnician(shop);
  await a.change(shop.owner, shop.organizationId, tech.memberId, 'approve');
  const owner = await a.one('SELECT * FROM auth.subscription_summary($1,$2)', [shop.owner.userId, shop.organizationId]);
  assert.deepEqual([owner.state, owner.plan_code, owner.technician_seats, owner.active_technicians], ['trialing', 'trial', 3, 1]);
  const technician = await a.one('SELECT * FROM auth.subscription_summary($1,$2)', [tech.userId, shop.organizationId]);
  assert.deepEqual([technician.state, technician.writable, technician.plan_code, technician.technician_seats], ['trialing', true, null, null]);
  const outsider = await a.signIn();
  assert.equal((await a.api('SELECT * FROM auth.subscription_summary($1,$2)', [outsider.userId, shop.organizationId])).length, 0);
});

test('usage reservations: limit, same key, consume once, release returns quota', async () => {
  const shop = await a.createShop('Usage');
  const reserve = (metric, units, key = randomUUID()) => a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,$5,600)', [shop.owner.userId, shop.organizationId, metric, key, units]);
  const settle = (metric, key, consume) => a.one('SELECT * FROM auth.settle_usage($1,$2,$3,$4)', [shop.organizationId, metric, key, consume]);

  const key = randomUUID();
  assert.equal((await reserve('storage_bytes', 600_000_000, key)).outcome, 'reserved');
  assert.equal((await reserve('storage_bytes', 600_000_000, key)).outcome, 'existing');
  assert.equal((await reserve('storage_bytes', 500_000_000)).outcome, 'limit_reached', 'used + reserved + request must fit 1 GB');
  assert.equal((await settle('storage_bytes', key, true)).outcome, 'consumed');
  assert.equal((await settle('storage_bytes', key, true)).outcome, 'already_consumed');
  const summary = await a.one('SELECT * FROM auth.subscription_summary($1,$2)', [shop.owner.userId, shop.organizationId]);
  assert.equal(Number(summary.storage_used), 600_000_000);

  const ocrKey = randomUUID();
  assert.equal((await reserve('ocr', 20, ocrKey)).outcome, 'reserved');
  assert.equal((await reserve('ocr', 1)).outcome, 'limit_reached');
  assert.equal((await settle('ocr', ocrKey, false)).outcome, 'released');
  assert.equal((await reserve('ocr', 1)).outcome, 'reserved', 'released units come back');

  await age(shop.organizationId, 15);
  assert.equal((await reserve('ocr', 1)).outcome, 'inactive');
  const outsider = await a.signIn();
  assert.equal((await a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,1,600)', [outsider.userId, shop.organizationId, 'ocr', randomUUID()])).outcome, 'forbidden');
});

test('concurrent OCR reservations never pass the quota', { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL (TEST_DATABASE_URL)' }, async () => {
  const shop = await a.createShop('UsageRace');
  const clients = await Promise.all(Array.from({ length: 30 }, () => db.connect()));
  try {
    const results = await Promise.all(clients.map(c => a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,1,600)', [shop.owner.userId, shop.organizationId, 'ocr', randomUUID()], c)));
    assert.equal(results.filter(r => r.outcome === 'reserved').length, 20);
    assert.equal(results.filter(r => r.outcome === 'limit_reached').length, 10);
  } finally { clients.forEach(c => c.release()); }
});

test('concurrent renewals for two invoices chain instead of overlapping', { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL (TEST_DATABASE_URL)' }, async () => {
  const shop = await a.createShop('RenewRace');
  await age(shop.organizationId, 20);
  const invoices = [await invoice(shop.organizationId), await invoice(shop.organizationId)];
  const clients = await Promise.all(invoices.map(() => db.connect()));
  try {
    await Promise.all(invoices.map((id, i) => clients[i].query('SELECT * FROM billing.apply_paid_period($1,$2,$3,now())', [shop.organizationId, id, STARTER])));
  } finally { clients.forEach(c => c.release()); }
  const periods = (await db.query("SELECT start_at, end_at FROM billing.subscription_periods WHERE organization_id = $1 AND source = 'paid' ORDER BY start_at", [shop.organizationId])).rows;
  assert.equal(periods.length, 2);
  assert.equal(periods[1].start_at.toISOString(), periods[0].end_at.toISOString());
});
