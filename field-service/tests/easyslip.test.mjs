import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EasySlip } from '../apps/api/dist/billing/easyslip.js';
import { BillingController } from '../apps/api/dist/billing/billing.controller.js';
import { SlipVerificationService } from '../apps/api/dist/billing/slip-verification.service.js';
import { createRequire } from 'node:module';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';

const receiver = { bankCode: '004', accountNumber: '123-4-56789-0' };
const order = { id: randomUUID(), amount_minor: 59000, created_at: new Date(Date.now()-60_000), receiver };
function valid() { return { success: true, data: { isDuplicate: false, isAmountMatched: true, amountInSlip: 590,
  matchedAccount: { bank: { code: '004' }, bankNumber: '1234567890' }, rawSlip: {
    transRef: 'TEST1234', date: new Date().toISOString(), countryCode: 'TH', amount: { amount: 590, local: { currency: 'THB' } },
    receiver: { bank: { id: '004' }, account: { bank: { type: 'BANKAC', account: 'xxx-x-56789-0' } } },
    sender: { account: { name: { th: 'Private sender' } } }, payload: 'private QR',
  } } }; }
const verify = (response, settings=order) => new EasySlip('unit-test-key', async () => Response.json(response)).verify(Buffer.from('test image'), settings);
test('EasySlip uses authenticated v2 multipart amount/account/duplicate checks and minimizes evidence', async () => {
  let requests=0;
  const provider = new EasySlip('unit-test-key', async (url, init) => {
    requests++; assert.equal(url,'https://api.easyslip.com/v2/verify/bank'); assert.equal(init.headers.Authorization,'Bearer unit-test-key');
    assert.equal(init.body.get('matchAccount'),'true'); assert.equal(init.body.get('checkDuplicate'),'true'); assert.equal(init.body.get('matchAmount'),'590');
    assert.equal(init.redirect,'error'); assert.ok(init.signal); return Response.json(valid());
  });
  const result = await provider.verify(Buffer.from('image'),order);
  assert.deepEqual(Object.keys(result).sort(),['amountMinor','code','receivedAt','reference']); assert.equal(result.code,'VERIFIED'); assert.equal(requests,1);
});
test('EasySlip rejects duplicate, wrong amount/receiver/currency/date and incomplete results', async () => {
  for (const [code, mutate] of [
    ['DUPLICATE',r=>r.data.isDuplicate=true], ['AMOUNT_MISMATCH',r=>r.data.amountInSlip=589],
    ['AMOUNT_MISMATCH',r=>r.data.rawSlip.amount.amount=590.001], ['RECEIVER_MISMATCH',r=>r.data.matchedAccount.bankNumber='9999999999'],
    ['RECEIVER_MISMATCH',r=>r.data.rawSlip.receiver.bank.id='014'], ['RECEIVER_MISMATCH',r=>r.data.rawSlip.receiver.account.bank.account='xxx-x-98765-0'],
    ['RECEIVER_MISMATCH',r=>delete r.data.rawSlip.receiver.account.bank], ['CURRENCY_MISMATCH',r=>r.data.rawSlip.countryCode='US'],
    ['DATE_MISMATCH',r=>r.data.rawSlip.date='2020-01-01T00:00:00Z'], ['DATE_MISMATCH',r=>r.data.rawSlip.date=new Date(Date.now()+120_000).toISOString()],
    ['INVALID_RESPONSE',r=>delete r.data.isDuplicate], ['INVALID_RESPONSE',r=>r.data.rawSlip.transRef=''],
  ]) { const r=valid(); mutate(r); assert.equal((await verify(r)).code,code); }
});
test('EasySlip failures, missing config and oversized images fail into manual review', async () => {
  assert.equal((await verify({success:false,error:{code:'SLIP_PENDING'}})).code,'SLIP_PENDING');
  assert.equal((await verify({success:false,error:{code:'QUOTA_EXCEEDED'}})).code,'QUOTA_EXCEEDED');
  assert.equal((await new EasySlip('key',async()=>{throw Error('timeout');}).verify(Buffer.from('image'),order)).code,'UNAVAILABLE');
  assert.equal((await new EasySlip(undefined,async()=>{throw Error('must not call');}).verify(Buffer.from('image'),{...order,receiver:null})).code,'CONFIGURATION');
  assert.equal((await new EasySlip('key',async()=>{throw Error('must not call');}).verify(Buffer.alloc(4_194_305),order)).code,'IMAGE_SIZE_TOO_LARGE');
});

let db,a;
before(async()=>{db=await openTestDatabase('easyslip');a=actors(db);});
after(async()=>{await db?.close();});
async function worker(sql,params,client) {
  const c=client??db; await c.exec?.('BEGIN; SET LOCAL ROLE fs_worker;');
  if(client) await client.query('BEGIN; SET LOCAL ROLE fs_worker;');
  try {const value=(await c.query(sql,params)).rows[0].value;await c.query('COMMIT');return value;}
  catch(e){await c.query('ROLLBACK');throw e;}
}
async function fixture() {
  const shop=await a.createShop('Slip');
  const inv=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,'72000000-0000-0000-0000-000000000001',randomUUID()])).invoice_id;
  await a.one('SELECT auth.freeze_invoice_receiver($1,$2,$3,$4::jsonb)',[shop.owner.userId,shop.organizationId,inv,JSON.stringify(receiver)]);
  const proof=randomUUID(),token=randomUUID();
  const args=[shop.owner.userId,shop.organizationId,inv,proof,`billing/${proof}.jpg`,'hash',100];
  assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,$7)',args)).outcome,'ok');
  return {shop,inv,proof,token,args};
}
const finish=(f,result)=>worker('SELECT worker.finish_slip($1,$2,$3::jsonb) AS value',[f.proof,f.token,JSON.stringify(result)]);
const claim=f=>worker('SELECT worker.claim_slip($1,$2) AS value',[f.proof,f.token]);
const evidence=async()=>({code:'VERIFIED',reference:randomUUID().replaceAll('-','').toUpperCase(),receivedAt:(await db.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString(),amountMinor:59000});
test('valid slip atomically opens expired shop, records payment/audit/notification and never extends on replay',async()=>{
  const f=await fixture();
  await db.query("UPDATE billing.subscription_periods SET start_at=start_at-interval '20 days',end_at=end_at-interval '20 days' WHERE organization_id=$1",[f.shop.organizationId]);
  assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)',[f.shop.owner.userId,f.shop.organizationId])).outcome,'inactive');
  assert.equal((await claim(f)).receiver.bankCode,'004');
  assert.equal(await worker('SELECT worker.claim_slip($1,$2) AS value',[f.proof,randomUUID()]),null,'one provider attempt');
  const result=await evidence(); assert.equal(await finish(f,result),'VERIFIED');
  assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)',[f.shop.owner.userId,f.shop.organizationId])).outcome,'ok');
  assert.equal(await finish(f,result),'existing');
  assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,$7)',f.args)).outcome,'existing','lost upload response is replayable after paid');
  assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,$7)',[...f.args.slice(0,5),'different',100])).outcome,'mismatch');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.payments WHERE invoice_id=$1',[f.inv])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscription_periods WHERE invoice_id=$1',[f.inv])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform.audit_logs WHERE target_id=$1 AND action='payment.auto_confirmed'",[f.inv])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM core.notifications WHERE organization_id=$1 AND event_key=$2",[f.shop.organizationId,`payment_confirmed:${f.inv}`])).rows[0].n,1);
});
test('problematic slips remain pending for admin without payment or paid entitlement',async()=>{
  for(const code of ['AMOUNT_MISMATCH','DUPLICATE','SLIP_PENDING','UNAVAILABLE','CONFIGURATION']){
    const f=await fixture();await claim(f);assert.equal(await finish(f,{code}),code);
    const row=(await db.query('SELECT i.status,pp.status AS proof_status,pp.verification_code FROM billing.invoices i JOIN billing.payment_proofs pp ON pp.invoice_id=i.id WHERE i.id=$1',[f.inv])).rows[0];
    assert.deepEqual(row,{status:'open',proof_status:'pending',verification_code:code});
    assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.payments WHERE invoice_id=$1',[f.inv])).rows[0].n,0);
  }
});
test('worker verdict is restricted, token checked and bank reference cannot pay another shop',async()=>{
  const first=await fixture(),second=await fixture();await claim(first);await claim(second);
  await assert.rejects(a.one('SELECT worker.finish_slip($1,$2,$3::jsonb)',[first.proof,first.token,JSON.stringify(await evidence())]),/permission denied/);
  assert.equal(await finish({...first,token:randomUUID()},await evidence()),'existing');
  const result=await evidence();assert.equal(await finish(first,result),'VERIFIED');assert.equal(await finish(second,result),'DUPLICATE');
  const other=await a.createShop('Other');
  assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,$7)',[other.owner.userId,other.organizationId,first.inv,first.proof,'x','hash',100])).outcome,'not_found');
});

test('upload controller and verification service activate synchronously and preserve immutable proof bytes on retries',async()=>{
  const shop=await a.createShop('Upload');
  const database={
    identity:async action=>{await db.exec('BEGIN;SET LOCAL ROLE fs_api;');try{const result=await action(db);await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}},
    withTenant:async(user,org,action)=>{await db.exec('BEGIN;SET LOCAL ROLE fs_api;');try{
      await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,org]);
      const result=await action(db);await db.exec('COMMIT');return result;
    }catch(e){await db.exec('ROLLBACK');throw e;}},
  };
  const slips=new SlipVerificationService();let checks=0,writes=0;
  // Inject a mock HTTP boundary; all controller/service SQL and fs_worker role checks still execute.
  slips.pool={connect:async()=>({query:async(sql,params)=>sql==='BEGIN'?db.exec('BEGIN;SET LOCAL ROLE fs_worker;'):db.query(sql,params),release(){}})};
  slips.provider=new EasySlip('synthetic-key',async()=>{checks++;const r=valid();r.data.rawSlip.transRef=randomUUID().replaceAll('-','').toUpperCase();r.data.rawSlip.date=(await db.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString();return Response.json(r);});
  const storage={put:async()=>{writes++;}};
  const controller=new BillingController(database,{production:false,payment:{...receiver,bankName:'Test',accountName:'Test'}},{maxStoredBytes:4_194_304},storage,slips);
  const session={userId:shop.owner.userId},tenant={organizationId:shop.organizationId,role:'owner'};
  const invoice=await controller.create(session,tenant,{price_version_id:'72000000-0000-0000-0000-000000000001',request_key:randomUUID()});
  const sharp=createRequire(new URL('../apps/api/package.json',import.meta.url))('sharp');
  const image=await sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).jpeg().toBuffer(),proof=randomUUID();
  const paid=await controller.proof(session,tenant,invoice.id,proof,{body:image});
  assert.equal(paid.status,'paid');assert.equal(paid.proofs[0].verification_code,'VERIFIED');assert.ok(paid.period);
  const replay=await controller.proof(session,tenant,invoice.id,proof,{body:image});
  assert.equal(replay.status,'paid');assert.deepEqual([checks,writes],[1,1]);
  const other=await sharp({create:{width:100,height:100,channels:3,background:'#000'}}).jpeg().toBuffer();
  await assert.rejects(controller.proof(session,tenant,invoice.id,proof,{body:other}),e=>e.getStatus()===409);
  assert.equal(writes,1,'an idempotency mismatch cannot overwrite the saved image');
});

test('automatic payments appear in console/reconciliation and exceptions remain manually confirmable',async()=>{
  const account=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Operator',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
  await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='billing_operator'",[account]);
  const f=await fixture();await claim(f);assert.equal(await finish(f,await evidence()),'VERIFIED');
  const detail=(await db.query('SELECT padmin.invoice_detail($1,$2) AS value',[account,f.inv])).rows[0].value;
  assert.equal(detail.payment.verified_by,'EasySlip');assert.equal(detail.payment.verification_source,'easyslip');
  const date=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day")).rows[0].day;
  const rows=(await db.query('SELECT * FROM padmin.reconciliation($1,$2::date,$2::date)',[account,date])).rows;
  assert.ok(rows.some(r=>r.number===detail.invoice.number&&r.actor==='EasySlip'));
  const manual=await fixture();await claim(manual);await finish(manual,{code:'UNAVAILABLE'});
  const payment=(await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),$4,NULL,$5)',[account,manual.inv,randomUUID(),manual.proof,randomUUID()])).rows[0];
  assert.equal(payment.outcome,'ok');assert.equal(await finish(manual,await evidence()),'existing','late automation cannot extend a manual confirmation');
});

test('concurrent verification takes one attempt and a reference pays only one invoice',{skip:!process.env.TEST_DATABASE_URL&&'requires PostgreSQL connections'},async()=>{
  const first=await fixture(),second=await fixture(),c1=await db.connect(),c2=await db.connect();
  try{
    const claims=await Promise.all([worker('SELECT worker.claim_slip($1,$2) AS value',[first.proof,first.token],c1),worker('SELECT worker.claim_slip($1,$2) AS value',[first.proof,randomUUID()],c2)]);
    assert.equal(claims.filter(Boolean).length,1);await claim(second);
    // Use the winning token, whichever caller claimed it.
    first.token=(await db.query('SELECT verification_token FROM billing.payment_proofs WHERE id=$1',[first.proof])).rows[0].verification_token;
    const result=await evidence();
    const outcomes=await Promise.all([worker('SELECT worker.finish_slip($1,$2,$3::jsonb) AS value',[first.proof,first.token,JSON.stringify(result)],c1),worker('SELECT worker.finish_slip($1,$2,$3::jsonb) AS value',[second.proof,second.token,JSON.stringify(result)],c2)]);
    assert.deepEqual(outcomes.sort(),['DUPLICATE','VERIFIED']);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.payments WHERE bank_reference=$1',[result.reference])).rows[0].n,1);
  }finally{c1.release();c2.release();}
});

test('automatic payment never restores a security-suspended shop',async()=>{
  const f=await fixture();await claim(f);
  await db.query("UPDATE core.organizations SET status='suspended' WHERE id=$1",[f.shop.organizationId]);
  assert.equal(await finish(f,await evidence()),'VERIFIED');
  assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)',[f.shop.owner.userId,f.shop.organizationId])).outcome,'suspended');
});

test('activation failure rolls back payment, invoice and proof together',async()=>{
  const f=await fixture();await claim(f);
  await db.exec("CREATE FUNCTION billing.test_fail_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated period failure'; END $$; CREATE TRIGGER test_fail_period BEFORE INSERT ON billing.subscription_periods FOR EACH ROW EXECUTE FUNCTION billing.test_fail_period();");
  try{await assert.rejects(finish(f,await evidence()),/simulated period failure/);}
  finally{await db.exec('DROP TRIGGER test_fail_period ON billing.subscription_periods; DROP FUNCTION billing.test_fail_period();');}
  assert.equal((await db.query('SELECT status FROM billing.invoices WHERE id=$1',[f.inv])).rows[0].status,'open');
  assert.equal((await db.query('SELECT status FROM billing.payment_proofs WHERE id=$1',[f.proof])).rows[0].status,'pending');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.payments WHERE invoice_id=$1',[f.inv])).rows[0].n,0);
});
