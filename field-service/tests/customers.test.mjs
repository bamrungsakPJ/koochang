import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';

let db, a;
before(async () => { db = await openTestDatabase('customers'); a = actors(db); });
after(async () => { await db?.close(); });

/** Runs as fs_api inside a tenant context, like DatabaseService.withTenant. */
async function asMember(userId, organizationId, run) {
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)", [userId, organizationId]);
    const result = await run();
    await db.exec('COMMIT');
    return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const memberId = async (organizationId, userId) =>
  (await db.query('SELECT id FROM core.organization_members WHERE organization_id = $1 AND user_id = $2', [organizationId, userId])).rows[0].id;

async function setup() {
  const shop = await a.createShop('Customers');
  const techs = [];
  for (let i = 0; i < 2; i++) {
    const tech = await a.addTechnician(shop);
    await a.change(shop.owner, shop.organizationId, tech.memberId, 'approve');
    techs.push(tech);
  }
  return { shop, techs };
}
const insertCustomer = (organizationId, createdBy, name) => db.query(
  "INSERT INTO core.customers(organization_id, name, phone_normalized, created_by_member_id) VALUES ($1,$2,'+66812345678',$3) RETURNING id",
  [organizationId, name, createdBy]);

test('owners see every customer; technicians only the ones they created', async () => {
  const { shop, techs } = await setup();
  const [t1, t2] = techs;
  const created = await asMember(t1.userId, shop.organizationId, async () => (await insertCustomer(shop.organizationId, t1.memberId, 'By tech 1')).rows[0].id);
  await insertCustomer(shop.organizationId, await memberId(shop.organizationId, shop.owner.userId), 'By owner');
  const names = async userId => asMember(userId, shop.organizationId, async () => (await db.query('SELECT name FROM core.customers ORDER BY name')).rows.map(r => r.name));
  assert.deepEqual(await names(shop.owner.userId), ['By owner', 'By tech 1']);
  assert.deepEqual(await names(t1.userId), ['By tech 1']);
  assert.deepEqual(await names(t2.userId), []);

  await db.query("INSERT INTO core.customer_locations(organization_id, customer_id, name) VALUES ($1,$2,'Home')", [shop.organizationId, created]);
  const locations = async userId => asMember(userId, shop.organizationId, async () => (await db.query('SELECT name FROM core.customer_locations')).rows.length);
  assert.equal(await locations(t1.userId), 1, 'locations follow the customer');
  assert.equal(await locations(t2.userId), 0);
});

test('a technician cannot create a customer in another member\'s name', async () => {
  const { shop, techs } = await setup();
  await assert.rejects(() => asMember(techs[0].userId, shop.organizationId, () => insertCustomer(shop.organizationId, techs[1].memberId, 'Spoofed')), e => e.code === '42501');
  await assert.rejects(() => asMember(techs[0].userId, shop.organizationId, () => insertCustomer(shop.organizationId, null, 'Nobody')), e => e.code === '42501');
});

test('a customer needs a name or a phone; coordinates come in pairs with how and when they were captured', async () => {
  const { shop } = await setup();
  const owner = await memberId(shop.organizationId, shop.owner.userId);
  await assert.rejects(() => db.query('INSERT INTO core.customers(organization_id, created_by_member_id) VALUES ($1,$2)', [shop.organizationId, owner]), e => e.code === '23514');
  const phoneOnly = (await db.query("INSERT INTO core.customers(organization_id, phone_normalized, created_by_member_id) VALUES ($1,'+66899999999',$2) RETURNING id", [shop.organizationId, owner])).rows[0].id;
  const location = (await db.query("INSERT INTO core.customer_locations(organization_id, customer_id, name) VALUES ($1,$2,'Shop') RETURNING id", [shop.organizationId, phoneOnly])).rows[0].id;
  await assert.rejects(() => db.query('UPDATE core.customer_locations SET latitude = 13.7 WHERE id = $1', [location]), e => e.code === '23514');
  await assert.rejects(() => db.query("UPDATE core.customer_locations SET latitude = 13.7, longitude = 100.5 WHERE id = $1", [location]), e => e.code === '23514', 'no method/time/person');
  await db.query("UPDATE core.customer_locations SET latitude = 13.7, longitude = 100.5, capture_method = 'manual_pin', location_captured_at = now(), location_captured_by = $2 WHERE id = $1", [location, shop.owner.userId]);
});
