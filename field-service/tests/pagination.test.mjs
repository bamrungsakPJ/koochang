import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CustomersController } from '../apps/api/dist/customers/customers.controller.js';
import { JobsController } from '../apps/api/dist/jobs/jobs.controller.js';
import { pagination } from '../apps/api/dist/shared/pagination.js';
import { openTestDatabase } from './support/database.mjs';

const organizationId = '20000000-0000-0000-0000-000000000001';
const otherShop = '20000000-0000-0000-0000-000000000002';
const session = { userId: '10000000-0000-0000-0000-000000000001' };
const tenant = { organizationId };
let db, customers, jobs;
before(async () => {
  db = await openTestDatabase('pagination');
  // Deliberately identical timestamps exercise the id tie-breaker at page boundaries.
  await db.query(`INSERT INTO core.customers(organization_id,name,updated_at)
    SELECT $1, 'Pagination customer ' || n, '2026-10-04T00:00:00Z' FROM generate_series(1,106) n`, [organizationId]);
  await db.query(`INSERT INTO core.customers(organization_id,name) VALUES($1,'Pagination customer hidden')`, [otherShop]);
  await db.query(`INSERT INTO core.jobs(organization_id,customer_id,location_id,job_type,status,created_at)
    SELECT $1,'40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','repair','unassigned','2026-10-04T00:00:00Z'
    FROM generate_series(1,205)`, [organizationId]);
  const database = { withTenant: async (user, org, action) => {
    await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
    try {
      await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)", [user, org]);
      const result = await action(db); await db.exec('COMMIT'); return result;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  } };
  customers = new CustomersController(database); jobs = new JobsController(database);
});
after(async () => { await db?.close(); });

test('customer pagination retrieves beyond 100 without duplicates or another shop, including tied timestamps', async () => {
  const ids = []; let offset = 0;
  do {
    const page = await customers.list(session, tenant, 'Pagination customer', '50', String(offset));
    ids.push(...page.items.map(c => c.id)); offset = page.next_offset;
    assert.equal(page.has_more, offset !== null);
  } while (offset !== null);
  assert.equal(ids.length, 106); assert.equal(new Set(ids).size, 106);
  const filtered = await customers.list(session, tenant, 'customer 106', '50', '0');
  assert.equal(filtered.items.length, 1); assert.equal(filtered.has_more, false);
  const forbidden = await customers.list(session, { organizationId: otherShop }, '', '50', '0');
  assert.equal(forbidden.items.length, 0);
});

test('job pagination retrieves beyond 200 with stable boundaries and preserved status filters', async () => {
  const ids = []; let offset = 0;
  do {
    const page = await jobs.list(session, tenant, '2000-01-01', '2100-01-01', 'unassigned', undefined, '50', String(offset));
    ids.push(...page.items.map(j => j.id)); offset = page.next_offset;
  } while (offset !== null);
  assert.equal(ids.length, 205); assert.equal(new Set(ids).size, 205);
  const empty = await jobs.list(session, tenant, '2000-01-01', '2100-01-01', 'completed', undefined, '50', '0');
  assert.equal(empty.items.length, 0); assert.equal(empty.next_offset, null);
});

test('pagination retains legacy default sizes, caps limits, and rejects invalid input', () => {
  assert.deepEqual(pagination(undefined, undefined, 200, 200), { limit: 200, offset: 0 });
  assert.deepEqual(pagination('999', '50', 30, 100), { limit: 100, offset: 50 });
  for (const [limit, offset] of [['0','0'], ['1.5','0'], ['NaN','0'], ['10','-1'], ['10','Infinity'], ['10','2147483648']])
    assert.throws(() => pagination(limit, offset, 30, 100), e => e.getStatus() === 400);
});
