import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './support/database.mjs';

test('public catalog exposes only published active plan prices and safe fields', async () => {
 const db=await openTestDatabase('public_catalog');
 try {
  const plan=(await db.query("INSERT INTO billing.plans(code,name_th,name_en,kind) VALUES('catalog_test','ทดสอบ','Test','paid') RETURNING id")).rows[0].id;
  const version=(await db.query('INSERT INTO billing.plan_versions(plan_id,version_no,technician_seats,storage_bytes,ocr_per_period,trial_days,grace_days,published_at) VALUES($1,1,3,30000000000,0,0,7,now()) RETURNING id',[plan])).rows[0].id;
  await db.query("INSERT INTO billing.price_versions(plan_version_id,amount_minor,interval_unit,effective_from) VALUES($1,59000,'month',now()),($1,99000,'month',now()+interval '1 day')",[version]);
  await db.query("INSERT INTO billing.plan_versions(plan_id,version_no,technician_seats,storage_bytes,ocr_per_period,trial_days,grace_days,published_at) VALUES($1,2,99,1000000000,0,0,7,now()+interval '1 day')",[plan]);
  await db.exec('SET ROLE fs_platform');
  const items=(await db.query('SELECT padmin.public_catalog() AS v')).rows[0].v.items;
  const row=items.find(p=>p.code==='catalog_test');
  assert.equal(row.amount_minor,59000); assert.equal(row.technician_seats,3);
  assert.deepEqual(Object.keys(row).sort(),['code','name_th','name_en','kind','technician_seats','storage_bytes','trial_days','amount_minor','currency','interval_unit'].sort());
  await assert.rejects(db.query('SELECT * FROM billing.plans'));
  await db.exec('RESET ROLE');
  await db.query("UPDATE billing.plans SET status='archived' WHERE id=$1",[plan]);
  await db.exec('SET ROLE fs_platform');
  assert.equal((await db.query('SELECT padmin.public_catalog() AS v')).rows[0].v.items.some(p=>p.code==='catalog_test'),false);
 } finally {await db.close();}
});

