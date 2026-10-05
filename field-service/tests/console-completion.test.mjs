import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
import {ManagementController,StaffEnrollmentController} from '../apps/api/dist/platform/management.controller.js';
import {OperationsController} from '../apps/api/dist/platform/operations.controller.js';
import {PrivacyController} from '../apps/api/dist/platform/privacy.controller.js';
import {PlatformAdminController} from '../apps/api/dist/platform/platform-admin.controller.js';
import {PlatformBillingController} from '../apps/api/dist/platform/platform-billing.controller.js';
import {PlatformDatabaseService} from '../apps/api/dist/platform/platform-database.service.js';
import {PlatformGuard} from '../apps/api/dist/platform/platform.guard.js';
import {StripeService} from '../apps/api/dist/billing/stripe.service.js';
import {OBJECT_STORAGE} from '../apps/api/dist/media/object-storage.js';
import {PLATFORM_SETTINGS} from '../apps/api/dist/config.js';
import {randomToken,sha256Hex} from '../apps/api/dist/shared/crypto.js';
import {totpCode} from '../apps/api/dist/platform/secrets.js';
import {runErasure,replayErasure,syncErasureRegistry} from '../apps/api/dist/worker.js';
import {apiError} from '../apps/api/dist/shared/api-error.js';

let db,a,one,two,ops,operator,approver,settings,app,base,stripeRefreshed=[];
async function role(name,fn){await db.exec(`BEGIN;SET LOCAL ROLE ${name};`);try{const r=await fn(db);await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
async function account(code){const id=(await db.query("INSERT INTO platform.accounts(display_name,email,mfa_enrolled,password_hash,totp_secret_sealed) VALUES('Completion tester',$1,true,'synthetic-hash','synthetic-sealed') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2',[id,code]);const token=randomToken();
 const session=(await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,step_up_at,expires_at) VALUES($1,$2,now(),now(),now()+interval '1 hour') RETURNING id",[id,sha256Hex(token)])).rows[0].id;
 return {accountId:id,id,token,session};}
const version=async id=>(await db.query('SELECT version FROM platform.accounts WHERE id=$1',[id])).rows[0].version;
const worker=sql=>({query:(q,p)=>role('fs_worker',c=>c.query(q,p))});
before(async()=>{db=await openTestDatabase('console_completion');a=actors(db);one=await account('super_admin');two=await account('super_admin');ops=await account('operations');operator=await account('billing_operator');approver=await account('billing_approver');
 settings={production:false,secretKey:randomBytes(32),payment:{bankName:'Synthetic bank',accountName:'Synthetic platform',accountNumber:'1234567890',bankCode:'004'}};
 const database={configured:true,run:async fn=>{try{return await role('fs_platform',fn);}catch(e){if(e.code==='42501')throw apiError(403,'PERMISSION_DENIED');if(['40001','23505'].includes(e.code))throw apiError(409,'VERSION_CONFLICT');if(e.code==='22023')throw apiError(400,'VALIDATION_ERROR');throw e;}}};
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');class TestModule{};
 Module({controllers:[ManagementController,StaffEnrollmentController,OperationsController,PrivacyController,PlatformAdminController,PlatformBillingController],providers:[PlatformGuard,{provide:PlatformDatabaseService,useValue:database},{provide:PLATFORM_SETTINGS,useValue:settings},{provide:OBJECT_STORAGE,useValue:null},{provide:StripeService,useValue:{refresh:async id=>{stripeRefreshed.push(id);}}}]})(TestModule);
 app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('v1');app.use((req,_res,next)=>{req.requestId=randomUUID();next();});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${app.getHttpServer().address().port}/v1`;
});
after(async()=>{await app?.close();await db?.close();});
async function http(who,path,body){const r=await fetch(`${base}/platform${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(who?{authorization:`Bearer ${who.token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};}
async function ok(who,path,body){const r=await http(who,path,body);assert.ok(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
async function enroll(token){const setup=await ok(null,'/enrollment/setup',{token});await ok(null,'/enrollment',{token,password:'synthetic-long-password',code:totpCode(setup.secret,Math.floor(Date.now()/30000))});}

test('super admin account recovery applies at once, resets credentials and only the newest invitation works',async()=>{
 const invite=await ok(one,'/staff/invite',{email:'recover@test.invalid',display_name:'Recover me',roles:['support_agent']});await enroll(invite.token);
 const target=invite.account_id,login=randomToken();await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,now(),now()+interval '1 hour')",[target,sha256Hex(login)]);
 const change=await ok(one,'/changes',{kind:'recovery',target_id:target,version:await version(target),reason:'Lost authenticator'});
 assert.equal((await http(two,`/changes/${change.id}/decision`,{approve:true,note:'Already applied'})).status,422);
 assert.equal((await http(one,'/changes',{kind:'recovery',target_id:one.id,version:await version(one.id),reason:'Own account'})).status,403);
 const row=(await db.query('SELECT status,password_hash,totp_secret_sealed,mfa_enrolled FROM platform.accounts WHERE id=$1',[target])).rows[0];
 assert.deepEqual([row.status,row.password_hash,row.totp_secret_sealed,row.mfa_enrolled],['invited',null,null,false]);
 assert.equal((await http({token:login},'/overview')).status,401);
 const first=await ok(one,`/staff/${target}/reinvite`,{version:await version(target),reason:'New authenticator'});
 const second=await ok(one,`/staff/${target}/reinvite`,{version:await version(target),reason:'Link sent to wrong chat'});
 assert.equal((await http(null,'/enrollment/setup',{token:first.token})).status,404);
 await enroll(second.token);assert.equal((await db.query('SELECT status FROM platform.accounts WHERE id=$1',[target])).rows[0].status,'active');
 assert.equal((await http(one,`/staff/${target}/reinvite`,{version:await version(target),reason:'Active account'})).status,409);
 const audit=(await db.query("SELECT action,details::text AS d FROM platform.audit_logs WHERE target_id=$1 OR target_id=$2",[target,change.id])).rows;
 assert.ok(audit.some(x=>x.action==='staff.reinvited'));assert.ok(audit.every(x=>!x.d.includes(second.token)));
});
test('platform admins still need a second person; a super admin publishes directly and may decide any request',async()=>{
 const admin=await account('platform_admin'),admin2=await account('platform_admin');
 const draft=await ok(admin,'/catalog/drafts',{payload:{code:'two-person',name_th:'สองคน',name_en:'Two person',kind:'paid',technician_seats:2,storage_bytes:1000000000,ocr_per_period:5,trial_days:0,grace_days:3,effective_at:new Date().toISOString(),prices:[{interval_unit:'month',amount_minor:100}]}});
 const c=await ok(admin,'/changes',{kind:'plan',target_id:draft.id,version:draft.version,reason:'Needs review'});
 assert.equal((await db.query('SELECT status FROM platform.change_requests WHERE id=$1',[c.id])).rows[0].status,'pending');
 assert.equal((await http(admin,`/changes/${c.id}/decision`,{approve:true,note:'About my own request'})).status,403);
 await ok(admin2,`/changes/${c.id}/decision`,{approve:false,note:'Fix the price'});
 const again=(await db.query('SELECT version FROM platform.plan_drafts WHERE id=$1',[draft.id])).rows[0].version;
 const c2=await ok(admin,'/changes',{kind:'plan',target_id:draft.id,version:again,reason:'Second try'});
 await ok(one,`/changes/${c2.id}/decision`,{approve:true,note:'Super admin decides'});
 assert.equal((await db.query("SELECT count(*)::int AS n FROM billing.plans WHERE code='two-person'")).rows[0].n,1);
 const own=await ok(one,'/catalog/drafts',{payload:{code:'super-direct',name_th:'ตรง',name_en:'Direct',kind:'paid',technician_seats:2,storage_bytes:1000000000,ocr_per_period:5,trial_days:0,grace_days:3,effective_at:new Date().toISOString(),prices:[{interval_unit:'month',amount_minor:200}]}});
 await ok(one,'/changes',{kind:'plan',target_id:own.id,version:own.version,reason:'Publish directly'});
 assert.equal((await db.query("SELECT count(*)::int AS n FROM billing.plans WHERE code='super-direct'")).rows[0].n,1);
});
test('a plan may have no technician seats and needs no OCR limit (migration 023)',async()=>{
 const solo=await ok(one,'/catalog/drafts',{payload:{code:'solo-test',name_th:'เดี่ยว',name_en:'Solo',kind:'paid',technician_seats:0,storage_bytes:10000000000,trial_days:0,grace_days:7,effective_at:new Date().toISOString(),prices:[{interval_unit:'month',amount_minor:29000}]}});
 await ok(one,'/changes',{kind:'plan',target_id:solo.id,version:solo.version,reason:'Owner-only plan'});
 const v=(await db.query("SELECT pv.technician_seats,pv.ocr_per_period FROM billing.plan_versions pv JOIN billing.plans p ON p.id=pv.plan_id WHERE p.code='solo-test'")).rows[0];
 assert.deepEqual([v.technician_seats,v.ocr_per_period],[0,0]);
 assert.equal((await http(one,'/catalog/drafts',{payload:{code:'negative-seats',name_th:'ผิด',name_en:'Bad',kind:'paid',technician_seats:-1,storage_bytes:1000000000,trial_days:0,grace_days:0,effective_at:new Date().toISOString(),prices:[{interval_unit:'month',amount_minor:100}]}})).status,400);
});
test('a new trial version applies only to shops created after it takes effect',async()=>{
 const before=await a.createShop('Old trial');const days=async s=>(await db.query("SELECT round(extract(epoch FROM trial_end_at-trial_started_at)/86400)::int AS d FROM billing.subscriptions WHERE organization_id=$1",[s.organizationId])).rows[0].d;
 assert.equal(await days(before),14);
 const trial={code:'trial',name_th:'ทดลองใช้',name_en:'Trial',kind:'trial',technician_seats:2,storage_bytes:1000000000,ocr_per_period:10,trial_days:30,grace_days:0,prices:[]};
 const later=await ok(one,'/catalog/drafts',{payload:{...trial,trial_days:45,effective_at:new Date(Date.now()+86400000).toISOString()}});
 await ok(one,'/changes',{kind:'plan',target_id:later.id,version:later.version,reason:'Scheduled trial'});
 assert.equal(await days(await a.createShop('Before schedule')),14);
 const now=await ok(one,'/catalog/drafts',{payload:{...trial,effective_at:new Date(Date.now()-60000).toISOString()}});
 await ok(one,'/changes',{kind:'plan',target_id:now.id,version:now.version,reason:'Longer trial'});
 const after=await a.createShop('New trial');assert.equal(await days(after),30);assert.equal(await days(before),14);
 const period=(await db.query("SELECT plan_snapshot FROM billing.subscription_periods WHERE organization_id=$1",[after.organizationId])).rows[0].plan_snapshot;assert.equal(period.technician_seats,2);
 assert.equal((await db.query("SELECT plan_snapshot FROM billing.subscription_periods WHERE organization_id=$1",[before.organizationId])).rows[0].plan_snapshot.technician_seats,3);
 const zero=(await db.query("SELECT pr.amount_minor FROM billing.price_versions pr JOIN billing.plan_versions pv ON pv.id=pr.plan_version_id JOIN billing.plans p ON p.id=pv.plan_id WHERE p.code='trial' ORDER BY pv.version_no DESC LIMIT 1")).rows[0];assert.equal(Number(zero.amount_minor),0);
 const other=await ok(one,'/catalog/drafts',{payload:{...trial,code:'second-trial',effective_at:new Date().toISOString()}});
 assert.equal((await http(one,'/changes',{kind:'plan',target_id:other.id,version:other.version,reason:'Second trial plan'})).status,400);
 assert.equal((await db.query('SELECT status FROM platform.plan_drafts WHERE id=$1',[other.id])).rows[0].status,'draft');
});
async function readyAsset(shop,status='ready'){return (await db.query(`INSERT INTO core.media_assets(organization_id,object_key,mime_type,size_bytes,status,uploaded_by,request_key,thumbnail_key,checksum,gps_metadata_stripped_at) VALUES($1,$2,'image/jpeg',1000,$3,$4,$5,$6,repeat('a',64),now()) RETURNING id`,[shop.organizationId,`${shop.organizationId}/t/${randomUUID()}.jpg`,status,shop.owner.userId,randomUUID(),`${shop.organizationId}/t/${randomUUID()}_thumb.jpg`])).rows[0].id;}
async function failedOcr(shop){const key=randomUUID();assert.equal((await a.one('SELECT * FROM auth.reserve_usage($1,$2,$3,$4,1,600)',[shop.owner.userId,shop.organizationId,'ocr',key])).outcome,'reserved');
 const id=(await db.query('INSERT INTO core.ocr_requests(organization_id,request_key,media_asset_id,requested_by) VALUES($1,$2,$3,$4) RETURNING id',[shop.organizationId,key,await readyAsset(shop),shop.owner.userId])).rows[0].id;
 for(let i=0;i<3;i++){await db.query('UPDATE core.ocr_requests SET next_attempt_at=now() WHERE id=$1',[id]);await role('fs_worker',c=>c.query('SELECT * FROM worker.claim_ocr(10)'));await role('fs_worker',c=>c.query('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)',[id,'retry','development',null,'TIMEOUT',0]));}
 return {id,key};}
const ocrRow=async id=>(await db.query('SELECT status,version FROM core.ocr_requests WHERE id=$1',[id])).rows[0];
test('OCR retry re-reserves quota once, refuses non-failed jobs, deleted images and expired shops',async()=>{
 const shop=await a.createShop('Retry OCR');const job=await failedOcr(shop);let row=await ocrRow(job.id);assert.equal(row.status,'failed');
 assert.equal((await http(operator,`/operations/ocr/${job.id}/retry`,{version:row.version,reason:'Provider recovered'})).status,403);
 await ok(one,`/operations/ocr/${job.id}/retry`,{version:row.version,reason:'Provider recovered'});
 assert.equal((await ocrRow(job.id)).status,'queued');
 assert.equal((await db.query("SELECT status FROM billing.usage_reservations WHERE organization_id=$1 AND request_key=$2",[shop.organizationId,job.key])).rows[0].status,'reserved');
 assert.equal((await http(one,`/operations/ocr/${job.id}/retry`,{version:row.version,reason:'Replay'})).status,409);
 const second=await failedOcr(shop);await db.query("UPDATE core.media_assets SET status='deleted' WHERE id=(SELECT media_asset_id FROM core.ocr_requests WHERE id=$1)",[second.id]);
 assert.equal((await http(one,`/operations/ocr/${second.id}/retry`,{version:(await ocrRow(second.id)).version,reason:'Deleted image'})).status,422);
 const third=await failedOcr(shop);await db.query("UPDATE core.organizations SET status='suspended' WHERE id=$1",[shop.organizationId]);
 assert.equal((await http(one,`/operations/ocr/${third.id}/retry`,{version:(await ocrRow(third.id)).version,reason:'Suspended shop'})).status,422);
 await db.query("UPDATE core.organizations SET status='active' WHERE id=$1",[shop.organizationId]);
 const quota=await a.createShop('Quota OCR');const jobs=[];for(let i=0;i<3;i++)jobs.push(await failedOcr(quota));
 const limit=(await db.query('SELECT ocr_per_period FROM billing.entitlement($1)',[quota.organizationId])).rows[0].ocr_per_period;
 await db.query("INSERT INTO billing.usage_counters(organization_id,metric,window_key,used) SELECT $1,'ocr',billing.usage_window('ocr',(SELECT period_id FROM billing.entitlement($1))),$2-2 ON CONFLICT(organization_id,metric,window_key) DO UPDATE SET used=excluded.used",[quota.organizationId,limit]);
 const results=[];for(const j of jobs)results.push((await http(one,`/operations/ocr/${j.id}/retry`,{version:(await ocrRow(j.id)).version,reason:'Quota check'})).status);
 assert.deepEqual(results,[200,200,200],'OCR has no per-period quota (migration 023)');
});
test('Stripe refresh goes through the trusted service only for open checkouts',async()=>{
 const r=await http(one,`/operations/checkouts/${randomUUID()}/refresh`,{reason:'Missing checkout'});assert.equal(r.status,422);assert.equal(stripeRefreshed.length,0);
 assert.equal((await http(operator,`/operations/checkouts/${randomUUID()}/refresh`,{reason:'No permission'})).status,403);
});
async function invoice(shop){const price=(await db.query("SELECT id FROM billing.price_versions WHERE id='72000000-0000-0000-0000-000000000001'")).rows[0].id;const r=await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,price,randomUUID()]);assert.equal(r.outcome,'ok');return r.invoice_id;}
test('finance report totals payments and refunds by source, plan and day, and validates the range',async()=>{
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const shop=await a.createShop('Finance');const inv=await invoice(shop);
 const pay=(await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)',[operator.id,inv,`REF-${randomUUID()}`,randomUUID()])).rows[0];assert.equal(pay.outcome,'ok');
 const refund=(await db.query('SELECT padmin.request_refund($1,$2,9000,$3,$4) AS v',[operator.id,pay.payment_id,'Synthetic refund',randomUUID()])).rows[0].v;
 const refundId=(await db.query('SELECT id FROM billing.refunds WHERE payment_id=$1',[pay.payment_id])).rows[0].id;assert.ok(refund);
 await db.query('SELECT padmin.decide_refund($1,$2,true,$3,$4)',[approver.id,refundId,'Approved',randomUUID()]);await db.query('SELECT padmin.complete_refund($1,$2,true,$3,$4)',[operator.id,refundId,`RF-${randomUUID()}`,randomUUID()]);
 const other=await a.createShop('Open invoice');await invoice(other);
 const report=await ok(operator,`/billing/report?from=${today}&to=${today}`);
 assert.equal(Number(report.received_minor),59000);assert.equal(Number(report.refunded_minor),9000);assert.equal(Number(report.net_minor),50000);
 assert.equal(report.by_source[0].source,'admin');assert.equal(report.by_plan[0].plan_code,'starter');assert.equal(report.by_plan[0].interval_unit,'month');
 assert.equal(report.by_day.length,1);assert.ok(Number(report.open_invoices)>=1);assert.ok(Number(report.paid_shops)>=1);
 assert.equal((await http(operator,`/billing/report?from=${today}&to=2020-01-01`)).status,400);
 assert.equal((await http(operator,'/billing/report?from=2024-01-01&to=2026-01-01')).status,400);
 assert.equal((await http(ops,`/billing/report?from=${today}&to=${today}`)).status,403);
});
test('paying shop count matches per-shop entitlement now, in grace and after expiry',async()=>{
 const paid=await a.createShop('Paid count');const inv=await invoice(paid);
 assert.equal((await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)',[operator.id,inv,`REF-${randomUUID()}`,randomUUID()])).rows[0].outcome,'ok');
 const cancelled=await a.createShop('Paid cancelled');const inv2=await invoice(cancelled);
 assert.equal((await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)',[operator.id,inv2,`REF-${randomUUID()}`,randomUUID()])).rows[0].outcome,'ok');
 await db.query('UPDATE billing.subscriptions SET cancel_at_period_end=true WHERE organization_id=$1',[cancelled.organizationId]);
 for(const days of [0,20,33,40,45,400]){
  const at=new Date(Date.now()+days*86400000).toISOString();
  const expected=(await db.query("SELECT count(*)::int AS n FROM core.organizations o CROSS JOIN LATERAL billing.entitlement(o.id,$1) e WHERE e.source='paid' AND e.state IN ('active','past_due')",[at])).rows[0].n;
  assert.equal((await db.query('SELECT billing.paid_shop_count($1)::int AS n',[at])).rows[0].n,expected,`day ${days}`);
 }
 assert.ok((await db.query('SELECT billing.paid_shop_count()::int AS n')).rows[0].n>=2);
});
test('shop, invoice and data request lists page past their first 50 rows',async()=>{
 for(let i=0;i<52;i++){const s=await a.createShop(`Paged ${String(i).padStart(2,'0')}`);await invoice(s);if(i<51)await a.one('SELECT auth.request_privacy($1,$2,$3,$4) AS v',[s.owner.userId,s.organizationId,'export','Paged request']);}
 const first=await ok(one,'/shops?q=Paged'),second=await ok(one,'/shops?q=Paged&offset=50');
 assert.equal(first.items.length,50);assert.equal(first.has_more,true);assert.equal(second.items.length,2);assert.equal(second.has_more,false);
 assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,52);
 const inv=await ok(operator,'/billing/invoices?status=open'),inv2=await ok(operator,`/billing/invoices?status=open&offset=50`);assert.equal(inv.items.length,50);assert.ok(inv.has_more);assert.ok(inv2.items.length>=2);
 const dr=await ok(one,'/data-requests'),dr2=await ok(one,'/data-requests?offset=50');assert.equal(dr.items.length,50);assert.ok(dr.has_more);assert.ok(dr2.items.length>=1);
 assert.equal((await http(one,'/shops?offset=-1')).status,400);
});
test('incident summary lists unresolved incidents by severity and the latest resolution',async()=>{
 await ok(one,'/incidents',{title:'Low noise',severity:'low',status:'investigating',services:['web'],note:'Looking'});
 await ok(one,'/incidents',{title:'Payments down',severity:'critical',status:'identified',services:['payment'],note:'Found'});
 await ok(one,'/incidents',{title:'Fixed already',severity:'medium',status:'investigating',services:['api'],note:'Start'});
 const fixed=(await ok(one,'/communications')).incidents.find(x=>x.title==='Fixed already');await ok(one,'/incidents',{...fixed,status:'resolved',note:'Done'});
 const s=await ok(ops,'/incidents/summary');assert.deepEqual(s.open.map(x=>x.title),['Payments down','Low noise']);assert.equal(s.last_resolved.title,'Fixed already');assert.equal(Number(s.resolved_30d),1);
 assert.equal((await http(operator,'/incidents/summary')).status,403);
});
test('restore replay re-erases content, re-deletes restored images and recovers tombstones from the off-database registry',async()=>{
 const policy=await ok(one,'/policy'),c=await ok(one,'/changes',{kind:'policy',version:policy.version,payload:{...policy.payload,new_shops_enabled:true,new_payments_enabled:true,business_retention_days:1,deletion_cooling_days:1},reason:'Retention'});assert.ok(c.id);
 const shop=await a.createShop('Replay shop');await db.query('INSERT INTO core.customers(organization_id,name,phone,phone_normalized) VALUES($1,$2,$3,$3)',[shop.organizationId,'Replay customer','+66990000001']);await readyAsset(shop);
 const note=(await db.query('SELECT core.notify($1,$2,$3,$4,$5,$6,$7) AS id',[shop.organizationId,shop.owner.userId,randomUUID(),'renewal_due',{},'subscription',null])).rows[0].id;
 await db.query("UPDATE core.notifications SET sent_snapshot='Replay customer is due' WHERE id=$1",[note]);
 const req=(await a.one('SELECT auth.request_privacy($1,$2,$3,$4) AS v',[shop.owner.userId,shop.organizationId,'deletion','Delete everything'])).v.request_id;
 await ok(one,`/data-requests/${req}`,{status:'approved',note:'Owner verified'});await db.query("UPDATE platform.data_requests SET created_at=now()-interval '2 days' WHERE id=$1",[req]);
 const preview=await ok(two,`/privacy/requests/${req}`);await ok(two,`/privacy/requests/${req}/execute`,{version:preview.request.version,note:'Erase'});
 await db.query("UPDATE platform.media_erasure_jobs SET updated_at=now()-interval '1 minute' WHERE organization_id=$1",[shop.organizationId]);
 const deleted=[];const deps={pool:worker(),storage:{delete:async k=>deleted.push(k)}};await runErasure(deps);assert.equal(deleted.length,2);
 const dir=await mkdtemp(join(tmpdir(),'registry-')),file=join(dir,'erasure-registry.json');
 try{
  assert.ok(await syncErasureRegistry(deps,file)>=1);assert.ok(JSON.parse(await readFile(file,'utf8')).some(x=>x.organization_id===shop.organizationId));
  // Simulate restoring a backup taken before the erasure: content back, tombstone gone, job rows say done.
  await db.query("UPDATE core.customers SET name='Replay customer',phone='+66990000001' WHERE organization_id=$1",[shop.organizationId]);
  await db.query("UPDATE core.organizations SET status='active',name='Replay shop' WHERE id=$1",[shop.organizationId]);
  await db.query('DELETE FROM platform.deletion_tombstones WHERE organization_id=$1',[shop.organizationId]);
  await db.query("UPDATE core.notifications SET sent_snapshot='Replay customer is due' WHERE id=$1",[note]);
  assert.ok(await replayErasure(deps,file)>=1);
  assert.equal((await db.query('SELECT name,phone FROM core.customers WHERE organization_id=$1',[shop.organizationId])).rows[0].name,'Deleted customer');
  assert.equal((await db.query('SELECT status FROM core.organizations WHERE id=$1',[shop.organizationId])).rows[0].status,'closed');
  assert.equal((await db.query('SELECT sent_snapshot FROM core.notifications WHERE id=$1',[note])).rows[0].sent_snapshot,null);
  assert.equal((await db.query('SELECT source FROM platform.deletion_tombstones WHERE organization_id=$1',[shop.organizationId])).rows[0].source,'registry');
  await db.query("UPDATE platform.media_erasure_jobs SET updated_at=now()-interval '1 minute' WHERE organization_id=$1",[shop.organizationId]);
  deleted.length=0;await runErasure(deps);assert.equal(deleted.length,2);
  // The registry never shrinks, even when the database lost the tombstone.
  await writeFile(file,JSON.stringify([{organization_id:shop.organizationId,erased_at:new Date().toISOString()},{organization_id:randomUUID(),erased_at:new Date().toISOString()}]));
  assert.equal(await syncErasureRegistry(deps,file),2);
  await assert.rejects(role('fs_platform',c=>c.query('SELECT worker.replay_erasure($1)',[[]])),e=>e.code==='42501');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a super admin may approve their own refund; other accounts still need a second person',async()=>{
 const shop=await a.createShop('Refund direct');const inv=await invoice(shop);
 const pay=(await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)',[operator.id,inv,`REF-${randomUUID()}`,randomUUID()])).rows[0];
 const req=(await db.query('SELECT * FROM padmin.request_refund($1,$2,1000,$3,$4)',[one.id,pay.payment_id,'Super admin refund',randomUUID()])).rows[0];assert.equal(req.outcome,'ok');
 assert.equal((await db.query('SELECT padmin.decide_refund($1,$2,true,$3,$4) AS v',[one.id,req.refund_id,'Own refund',randomUUID()])).rows[0].v,'ok');
 const both=await account('billing_operator');await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='billing_approver'",[both.id]);
 const req2=(await db.query('SELECT * FROM padmin.request_refund($1,$2,1000,$3,$4)',[both.id,pay.payment_id,'Operator refund',randomUUID()])).rows[0];
 assert.equal((await db.query('SELECT padmin.decide_refund($1,$2,true,$3,$4) AS v',[both.id,req2.refund_id,'Own refund',randomUUID()])).rows[0].v,'self_approval');
});
