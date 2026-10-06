import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';
import { CustomersController } from '../apps/api/dist/customers/customers.controller.js';

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

test('customer form saves first-place GPS atomically, records actor, and retries without duplicating coordinates', async () => {
  const shop = await a.createShop('Customer form GPS');
  const tenant = { organizationId: shop.organizationId, memberId: await memberId(shop.organizationId, shop.owner.userId), role: 'owner' };
  const session = { userId: shop.owner.userId, sessionId: randomUUID() };
  const database = {
    identity: run => asMember(session.userId, tenant.organizationId, () => run(db)),
    withTenant: (userId, organizationId, run) => asMember(userId, organizationId, () => run(db)),
  };
  const controller = new CustomersController(database);
  const body = { request_key: randomUUID(), phone: '0812345679', location: { label: 'Home', coordinates: { latitude: 13.7563314, longitude: 100.5017624, accuracy_m: 12, method: 'current_location' } } };
  const created = await controller.create(session, tenant, randomUUID(), body);
  assert.equal(created.name, null, 'customer name is optional');
  for (const phone of [undefined, '', '   ']) {
    await assert.rejects(controller.create(session, tenant, randomUUID(), { ...body, request_key: randomUUID(), name: 'Name cannot replace phone', phone }), error => error.getStatus() === 400);
  }
  assert.equal(created.locations.length, 1);
  assert.equal(created.locations[0].address, null, 'coordinates can replace typing an address');
  assert.equal(created.locations[0].latitude, 13.756331);
  assert.equal(created.locations[0].longitude, 100.501762);
  assert.equal(created.locations[0].capture_method, 'current_location');
  const stored = (await db.query('SELECT location_captured_by, location_captured_at, accuracy_meters FROM core.customer_locations WHERE id=$1', [created.locations[0].id])).rows[0];
  assert.equal(stored.location_captured_by, session.userId);
  assert.ok(stored.location_captured_at);
  assert.equal(Number(stored.accuracy_meters), 12);
  const retry = await controller.create(session, tenant, randomUUID(), { ...body, location: { ...body.location, coordinates: { ...body.location.coordinates, latitude: 14 } } });
  assert.equal(retry.id, created.id);
  assert.equal(retry.locations[0].latitude, created.locations[0].latitude, 'retry cannot move an already created place');
  assert.equal((await db.query("SELECT count(*)::int n FROM ops.audit_logs WHERE entity_id=$1 AND action='location.coordinates_saved'", [created.locations[0].id])).rows[0].n, 1);

  const addBody = { request_key: randomUUID(), label: 'Second place', coordinates: { latitude: 0, longitude: 0, accuracy_m: null, method: 'current_location' } };
  const added = await controller.addLocation(session, tenant, randomUUID(), created.id, addBody);
  const second = added.locations.find(place => place.label === 'Second place');
  assert.equal(second.latitude, 0, 'zero is a valid latitude, not a missing coordinate');
  assert.equal(second.longitude, 0);
  const addRetry = await controller.addLocation(session, tenant, randomUUID(), created.id, addBody);
  assert.equal(addRetry.locations.length, 2);

  for (const coordinates of [null, {}, { ...body.location.coordinates, latitude: 91 }, { ...body.location.coordinates, longitude: null }, { ...body.location.coordinates, accuracy_m: -1 }, { ...body.location.coordinates, method: 'background' }]) {
    const request_key = randomUUID();
    await assert.rejects(controller.create(session, tenant, randomUUID(), { ...body, request_key, location: { ...body.location, coordinates } }), error => error.getStatus() === 400);
    assert.equal((await db.query('SELECT count(*)::int n FROM core.customers WHERE create_request_key=$1', [request_key])).rows[0].n, 0);
  }

  const rollbackKey = randomUUID();
  const failing = new CustomersController({ ...database, withTenant: (userId, organizationId, run) => asMember(userId, organizationId, () => run({ query: (sql, params) => {
    if (sql.startsWith('INSERT INTO ops.audit_logs')) throw new Error('synthetic audit failure');
    return db.query(sql, params);
  } })) });
  await assert.rejects(failing.create(session, tenant, randomUUID(), { ...body, request_key: rollbackKey, phone: '0812345680' }), /synthetic audit failure/);
  assert.equal((await db.query('SELECT count(*)::int n FROM core.customers WHERE create_request_key=$1', [rollbackKey])).rows[0].n, 0, 'customer and coordinates roll back together');
});

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
