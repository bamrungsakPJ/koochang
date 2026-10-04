import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { migrate } from '../scripts/migrate.mjs';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { openTestDatabase } from './support/database.mjs';

const A='20000000-0000-0000-0000-000000000001';
const B='20000000-0000-0000-0000-000000000002';
const ownerA='10000000-0000-0000-0000-000000000001';
const ownerB='10000000-0000-0000-0000-000000000002';
const techA='10000000-0000-0000-0000-000000000003';
let db;
const adapter=()=>db.migrationAdapter();
async function tenant(user,organization,operation) {
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,organization]);
    const result=await operation(); await db.exec('COMMIT'); return result;
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
before(async()=>{
  db=await openTestDatabase('foundation');
  console.log('PostgreSQL test engine:',(await db.query('SHOW server_version')).rows[0].server_version);
});
after(async()=>{await db?.close();});

test('migration is replayable and has a recorded checksum',async()=>{
  await db.exec('SET ROLE fs_migrator');
  try {
    await migrate(adapter());
    const files=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(n=>/^\d+.*\.sql$/.test(n));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migration.history')).rows[0].n,files.length);
  }
  finally { await db.exec('RESET ROLE'); }
});
test('64 tables: foundation, business workflows and complete console management',async()=>{
  const r=await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema IN ('core','billing','platform','ops')");
  assert.equal(r.rows[0].n,64);
});
test('missing tenant context reveals no customers',async()=>{
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,0);}
  finally {await db.exec('ROLLBACK');}
});
test('each active owner sees only the authorized shop',async()=>{
  for(const [u,o] of [[ownerA,A],[ownerB,B]]) await tenant(u,o,async()=>{
    const r=await db.query('SELECT organization_id FROM core.customers'); assert.equal(r.rows.length,1); assert.equal(r.rows[0].organization_id,o);
  });
});
test('choosing another organization does not grant membership',async()=>{
  await tenant(ownerA,B,async()=>assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,0));
});
test('transaction-local tenant context never carries to the next request',async()=>{
  await tenant(ownerA,A,async()=>assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,1));
  await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
  try {assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,0);} finally {await db.exec('ROLLBACK');}
});
test('cross-tenant INSERT is rejected by RLS',async()=>{
  await assert.rejects(()=>tenant(ownerA,A,()=>db.query('INSERT INTO core.customers(organization_id,name) VALUES($1,$2)',[B,'Invalid'])),e=>e.code==='42501');
});
test('composite FK rejects a customer from a different tenant',async()=>{
  await assert.rejects(()=>tenant(ownerA,A,()=>db.query('INSERT INTO core.customer_locations(organization_id,customer_id,name) VALUES($1,$2,$3)',[A,'40000000-0000-0000-0000-000000000002','Invalid'])),e=>e.code==='23503');
});
test('suspended membership, identity and organization lose tenant visibility',async()=>{
  for(const [table,id] of [['core.organization_members','30000000-0000-0000-0000-000000000001'],['core.users',ownerA],['core.organizations',A]]) {
    await db.query(`UPDATE ${table} SET status='suspended' WHERE id=$1`,[id]);
    try { await tenant(ownerA,A,async()=>assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,0)); }
    finally {await db.query(`UPDATE ${table} SET status='active' WHERE id=$1`,[id]);}
  }
});
test('shop runtime cannot read platform identities or mutate membership',async()=>{
  await assert.rejects(()=>tenant(ownerA,A,()=>db.query('SELECT * FROM platform.accounts')),e=>e.code==='42501');
  await assert.rejects(()=>tenant(ownerA,A,()=>db.query("UPDATE core.organization_members SET role='owner'")),e=>e.code==='42501');
});
test('technician cannot read subscription invoice amounts',async()=>{
  await db.query("INSERT INTO billing.invoices(organization_id,number,amount_minor,price_version_id) VALUES($1,'DEMO-001',59000,'72000000-0000-0000-0000-000000000001')",[A]);
  await tenant(ownerA,A,async()=>assert.equal((await db.query('SELECT * FROM billing.invoices')).rows.length,1));
  await tenant(techA,A,async()=>assert.equal((await db.query('SELECT * FROM billing.invoices')).rows.length,0));
});
test('coordinates are optional and recorded only on customer locations',async()=>{
  const r=await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema IN ('core','billing','platform','ops') AND column_name IN ('latitude','longitude')");
  assert.equal(r.rows.length,2); assert.ok(r.rows.every(x=>x.table_name==='customer_locations'));
  await assert.rejects(()=>tenant(ownerA,A,()=>db.query("UPDATE core.customer_locations SET latitude=91,longitude=100,capture_method='manual_pin',location_captured_at=now(),location_captured_by=$1 WHERE organization_id=$2",[ownerA,A])),e=>e.code==='23514');
});
test('published price snapshots cannot be rewritten',async()=>{
  await assert.rejects(()=>db.query('UPDATE billing.price_versions SET amount_minor=1'),e=>e.code==='23514');
});
test('service idempotency and maintenance preserve one current cycle',async()=>{
  const event='80000000-0000-0000-0000-000000000001';
  await db.query("INSERT INTO core.service_events(id,organization_id,client_event_id,customer_id,location_id,performed_by,occurred_at) VALUES($1,$2,$1,'40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',now())",[event,A]);
  await assert.rejects(()=>db.query("INSERT INTO core.service_events(organization_id,client_event_id,customer_id,location_id,performed_by,occurred_at) VALUES($1,$2,'40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',now())",[A,event]),e=>e.code==='23505');
  const schedule=(await db.query("INSERT INTO core.maintenance_schedules(organization_id,equipment_id,service_type,interval_months) VALUES($1,'60000000-0000-0000-0000-000000000001','maintenance',6) RETURNING id",[A])).rows[0].id;
  await db.query("INSERT INTO core.maintenance_cycles(organization_id,schedule_id,due_date) VALUES($1,$2,'2027-04-03')",[A,schedule]);
  await assert.rejects(()=>db.query("INSERT INTO core.maintenance_cycles(organization_id,schedule_id,due_date) VALUES($1,$2,'2027-04-04')",[A,schedule]),e=>e.code==='23505');
});
test('invalid language and invalid maintenance policy are rejected',async()=>{
  await assert.rejects(()=>db.query("UPDATE core.users SET preferred_language='eg' WHERE id=$1",[ownerA]),e=>e.code==='23514');
  await assert.rejects(()=>db.query("INSERT INTO core.maintenance_schedules(organization_id,equipment_id,service_type,interval_months) VALUES($1,'60000000-0000-0000-0000-000000000001','repair',NULL)",[A]),e=>e.code==='23514');
});
test('API transaction helper uses the runtime role and clears context',async()=>{
  const service=new DatabaseService();let released=false;
  service.pool={connect:async()=>({query:(sql,params)=>db.query(sql,params),release:()=>{released=true;}})};
  await db.exec('SET ROLE fs_api');
  try {
    const rows=await service.withTenant(ownerA,A,async client=>(await client.query('SELECT organization_id FROM core.customers')).rows);
    assert.equal(rows.length,1);assert.equal(rows[0].organization_id,A);assert.equal(released,true);
    assert.equal((await db.query('SELECT * FROM core.customers')).rows.length,0);
  } finally {await db.exec('RESET ROLE');}
});
test('API transaction helper refuses a privileged database role',async()=>{
  const service=new DatabaseService();let released=false;
  service.pool={connect:async()=>({query:(sql,params)=>db.query(sql,params),release:()=>{released=true;}})};
  await assert.rejects(()=>service.withTenant(ownerA,A,()=>{throw Error('must not execute');}),e=>e.getStatus?.()===403);
  assert.equal(released,true);
});
