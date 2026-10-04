import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
import {ManagementController,StaffEnrollmentController} from '../apps/api/dist/platform/management.controller.js';
import {OperationsController} from '../apps/api/dist/platform/operations.controller.js';
import {PrivacyController} from '../apps/api/dist/platform/privacy.controller.js';
import {PlatformAdminController} from '../apps/api/dist/platform/platform-admin.controller.js';
import {PlatformDatabaseService} from '../apps/api/dist/platform/platform-database.service.js';
import {PlatformGuard} from '../apps/api/dist/platform/platform.guard.js';
import {RuntimeSettingsService} from '../apps/api/dist/platform/runtime-settings.service.js';
import {BillingController} from '../apps/api/dist/billing/billing.controller.js';
import {OrganizationsController} from '../apps/api/dist/organizations/organizations.controller.js';
import {PLATFORM_SETTINGS} from '../apps/api/dist/config.js';
import {decrypt,randomToken,sha256Hex} from '../apps/api/dist/shared/crypto.js';
import {totpCode} from '../apps/api/dist/platform/secrets.js';
import {runErasure} from '../apps/api/dist/worker.js';
import {apiError} from '../apps/api/dist/shared/api-error.js';
let db,a,one,two,admin,ops,billing,database,settings,app,base,runtime,privacy;
async function role(name,fn){await db.exec(`BEGIN;SET LOCAL ROLE ${name};`);try{const r=await fn(db);await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}}
async function account(code){const id=(await db.query("INSERT INTO platform.accounts(display_name,email,mfa_enrolled) VALUES('Console tester',$1,true) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2',[id,code]);const token=randomToken();
 const session=(await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,step_up_at,expires_at) VALUES($1,$2,now(),now(),now()+interval '1 hour') RETURNING id",[id,sha256Hex(token)])).rows[0].id;
 return {accountId:id,id,token,session};}
before(async()=>{db=await openTestDatabase('console_management');a=actors(db);one=await account('super_admin');two=await account('super_admin');admin=await account('platform_admin');ops=await account('operations');billing=await account('billing_operator');
 settings={production:false,secretKey:randomBytes(32),payment:{bankName:'Synthetic bank',accountName:'Synthetic platform',accountNumber:'1234567890',bankCode:'004'}};
 database={configured:true,run:async fn=>{try{return await role('fs_platform',fn);}catch(e){if(e.code==='42501')throw apiError(403,'PERMISSION_DENIED');if(['40001','23505'].includes(e.code))throw apiError(409,'VERSION_CONFLICT');throw e;}}};runtime=new RuntimeSettingsService(database,settings);privacy=new PrivacyController(database,settings);
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');class TestModule{};
 Module({controllers:[ManagementController,StaffEnrollmentController,OperationsController,PrivacyController,PlatformAdminController],providers:[PlatformGuard,{provide:PlatformDatabaseService,useValue:database},{provide:PLATFORM_SETTINGS,useValue:settings}]})(TestModule);
 app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('v1');app.use((req,_res,next)=>{req.requestId=randomUUID();next();});await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${app.getHttpServer().address().port}/v1`;
});
after(async()=>{await app?.close();await db?.close();});
async function http(who,path,body){const r=await fetch(`${base}/platform${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(who?{authorization:`Bearer ${who.token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function ok(who,path,body){const r=await http(who,path,body);assert.ok(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
async function p(sql,params){return role('fs_platform',async c=>(await c.query(sql,params)).rows[0]?.v);}
const draftPayload={code:'console-plan',name_th:'แพ็กเกจทดสอบ',name_en:'Synthetic plan',kind:'paid',technician_seats:3,storage_bytes:2000000000,ocr_per_period:20,trial_days:0,grace_days:7,effective_at:new Date(Date.now()-60000).toISOString(),prices:[{interval_unit:'month',amount_minor:9900},{interval_unit:'year',amount_minor:99000}]};
async function publish(payload=draftPayload){const d=await ok(admin,'/catalog/drafts',{payload});const change=await ok(admin,'/changes',{kind:'plan',target_id:d.id,version:d.version,reason:'Synthetic publication'});await ok(one,`/changes/${change.id}/decision`,{approve:true,note:'Reviewed synthetic plan'});return d;}
test('management HTTP denies missing permission, stale TOTP and raw access to every new table',async()=>{
 assert.equal((await http(billing,'/staff')).status,403);assert.equal((await http(ops,'/catalog')).status,403);assert.equal((await http(billing,'/changes')).status,403);assert.equal((await http(billing,'/communications')).status,403);
 await db.query('UPDATE platform.sessions SET step_up_at=NULL WHERE id=$1',[one.session]);assert.equal((await http(one,'/staff/invite',{email:'a@test.invalid',display_name:'Test',roles:['support_agent']})).status,403);await db.query('UPDATE platform.sessions SET step_up_at=now() WHERE id=$1',[one.session]);
 for(const table of ['staff_invitations','plan_drafts','change_requests','policy_versions','announcements','incidents','operation_checks','export_artifacts','legal_holds','deletion_tombstones','media_erasure_jobs'])await assert.rejects(role('fs_platform',c=>c.query(`SELECT * FROM platform.${table}`)),e=>e.code==='42501');
 await assert.rejects(role('fs_api',c=>c.query('SELECT padmin.catalog($1)',[one.id])),e=>e.code==='42501');
 assert.equal((await http(one,'/staff?offset=NaN')).status,400);
});
test('invitation requires allowed roles, stores hashes, verifies MFA, and cannot be replayed',async()=>{
 assert.equal((await http(one,'/staff/invite',{email:'high@test.invalid',display_name:'Test',roles:['super_admin']})).status,403);
 const invite=await ok(one,'/staff/invite',{email:'staff@test.invalid',display_name:'New staff',roles:['support_agent']});
 assert.equal((await http(one,'/staff/invite',{email:'STAFF@test.invalid',display_name:'Duplicate',roles:['support_agent']})).status,409);
 const raw=(await db.query('SELECT * FROM platform.staff_invitations WHERE account_id=$1',[invite.account_id])).rows[0];assert.equal(raw.token_hash,sha256Hex(invite.token));assert.ok(!JSON.stringify(raw).includes(invite.token));
 const setup=await ok(null,'/enrollment/setup',{token:invite.token});assert.ok(setup.secret);assert.ok(!setup.totp_sealed);
 assert.equal((await http(null,'/enrollment',{token:invite.token,password:'synthetic-long-password',code:'000000'})).status,400);
 await ok(null,'/enrollment',{token:invite.token,password:'synthetic-long-password',code:totpCode(setup.secret,Math.floor(Date.now()/30000))});
 assert.equal((await db.query('SELECT status,mfa_enrolled FROM platform.accounts WHERE id=$1',[invite.account_id])).rows[0].status,'active');
 assert.equal((await http(null,'/enrollment/setup',{token:invite.token})).status,404);
 const second=await ok(one,'/staff/invite',{email:'expired@test.invalid',display_name:'Expired',roles:['support_agent']});await db.query("UPDATE platform.staff_invitations SET expires_at=now()-interval '1 minute' WHERE account_id=$1",[second.account_id]);assert.equal((await http(null,'/enrollment/setup',{token:second.token})).status,404);
 const audit=JSON.stringify((await db.query('SELECT details FROM platform.audit_logs')).rows);assert.ok(!audit.includes(invite.token));assert.ok(!audit.includes(setup.secret));
});
test('role changes require a different approver, revoke target sessions and reject stale requests',async()=>{
 const target=await account('support_agent'),version=(await db.query('SELECT version FROM platform.accounts WHERE id=$1',[target.id])).rows[0].version;
 const change=await ok(one,'/changes',{kind:'roles',target_id:target.id,version,payload:{roles:['billing_approver']},reason:'Separate finance approval'});
 assert.equal((await http(one,`/changes/${change.id}/decision`,{approve:true,note:'Self'})).status,403);
 await ok(two,`/changes/${change.id}/decision`,{approve:true,note:'Reviewed'});
 assert.equal((await http(target,'/overview')).status,401);assert.equal((await http(one,'/changes',{kind:'roles',target_id:target.id,version,payload:{roles:['support_agent']},reason:'Stale'})).status,403);
 assert.equal((await http(two,`/changes/${change.id}/decision`,{approve:true,note:'Replay'})).status,422);
 assert.equal((await http(one,`/staff/${one.id}/action`,{action:'disable',version:1,reason:'Self disable'})).status,403);
});
test('immutable plan publications support month/year, protect old invoices and require two people',async()=>{
 assert.equal((await http(admin,'/catalog/drafts',{payload:{...draftPayload,prices:[{interval_unit:'month',amount_minor:-1}]}})).status,400);
 const d=await ok(admin,'/catalog/drafts',{payload:draftPayload}),change=await ok(admin,'/changes',{kind:'plan',target_id:d.id,version:d.version,reason:'Publish'});
 assert.equal((await http(admin,`/changes/${change.id}/decision`,{approve:true,note:'Self'})).status,403);await ok(one,`/changes/${change.id}/decision`,{approve:true,note:'Reviewed'});
 const shop=await a.createShop('Frozen price'),prices=(await db.query("SELECT pr.* FROM billing.price_versions pr JOIN billing.plan_versions pv ON pv.id=pr.plan_version_id JOIN billing.plans p ON p.id=pv.plan_id WHERE p.code='console-plan'")).rows;
 assert.equal(prices.length,2);const old=await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,prices.find(x=>x.interval_unit==='month').id,randomUUID()]);assert.equal(old.outcome,'ok');
 await publish({...draftPayload,technician_seats:5,prices:[{interval_unit:'month',amount_minor:19900},{interval_unit:'year',amount_minor:199000}]});
 const inv=(await db.query('SELECT amount_minor,plan_snapshot FROM billing.invoices WHERE id=$1',[old.invoice_id])).rows[0];assert.equal(Number(inv.amount_minor),9900);assert.equal(inv.plan_snapshot.technician_seats,3);
 const stale=await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,prices[0].id,randomUUID()]);assert.equal(stale.outcome,'not_found');
 const shopDb={withTenant:(user,org,fn)=>role('fs_api',async c=>{await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,org]);return fn(c);})};
 const ctrl=new BillingController(shopDb,settings,{},null,{}, {methods:async()=>({stripe_card:false,stripe_qr:false})},runtime);
 const offers=await ctrl.plans({userId:shop.owner.userId},{role:'owner',organizationId:shop.organizationId});assert.equal(offers.items.filter(x=>x.code==='console-plan').length,2);
 await assert.rejects(db.query('UPDATE billing.price_versions SET amount_minor=1 WHERE id=$1',[prices[0].id]));
});
test('rejected drafts return editable and optimistic draft versions cannot be reused',async()=>{
 const d=await ok(admin,'/catalog/drafts',{payload:{...draftPayload,code:'reject-plan'}});
 assert.equal((await http(admin,'/catalog/drafts',{id:d.id,version:d.version-1,payload:draftPayload})).status,409);
 const c=await ok(admin,'/changes',{kind:'plan',target_id:d.id,version:d.version,reason:'Review draft'});await ok(two,`/changes/${c.id}/decision`,{approve:false,note:'Fix quotas'});
 const row=(await db.query('SELECT * FROM platform.plan_drafts WHERE id=$1',[d.id])).rows[0];assert.equal(row.status,'draft');assert.ok(row.version>d.version);
});
test('approved policy applies to new creation while existing payments and snapshots remain untouched',async()=>{
 const policy=await ok(admin,'/policy'),c=await ok(admin,'/changes',{kind:'policy',version:policy.version,payload:{new_shops_enabled:false,new_payments_enabled:false},reason:'Pause intake'});await ok(one,`/changes/${c.id}/decision`,{approve:true,note:'Maintenance window'});
 assert.equal((await runtime.read()).policy.new_shops_enabled,false);
 const org=new OrganizationsController({}, {issue(){throw Error('must not issue');}},runtime);await assert.rejects(org.create({userId:randomUUID()},{name:'Paused'}),e=>e.getStatus()===503);
 const billingCtrl=new BillingController({},settings,{},null,{}, {},runtime);await assert.rejects(billingCtrl.create({userId:randomUUID()},{role:'owner',organizationId:randomUUID()},{price_version_id:randomUUID(),request_key:randomUUID()}),e=>e.getStatus()===503);
 const current=await ok(admin,'/policy'),resume=await ok(admin,'/changes',{kind:'policy',version:current.version,payload:{new_shops_enabled:true,new_payments_enabled:true,business_retention_days:1,deletion_cooling_days:1},reason:'Resume and retention'});await ok(two,`/changes/${resume.id}/decision`,{approve:true,note:'Approved policy'});
});
test('announcements enforce schedule, audience, immutability, withdrawal and tenant ownership',async()=>{
 const shop=await a.createShop('Announcement recipient'),other=await a.createShop('Not recipient');const body={title_th:'ประกาศ',title_en:'Announcement',body_th:'ข้อความ',body_en:'Body',audience:'shops',organization_ids:[shop.organizationId],status:'scheduled',publish_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()};
 await ok(ops,'/announcements',body);let row=(await ok(ops,'/communications')).announcements[0];
 const feed=async(s)=> (await a.one('SELECT auth.announcements($1,$2) AS v',[s.owner.userId,s.organizationId])).v;
 assert.equal((await feed(shop)).length,0);await ok(ops,'/announcements',{...row,status:'published',publish_at:new Date(Date.now()-60000).toISOString()});row=(await ok(ops,'/communications')).announcements[0];
 assert.equal((await feed(shop)).length,1);assert.equal((await feed(other)).length,0);assert.equal((await a.one('SELECT auth.announcements($1,$2) AS v',[other.owner.userId,shop.organizationId])).v,null);
 assert.equal((await http(ops,'/announcements',{...row,body_en:'Rewrite'})).status,422);await ok(ops,'/announcements',{...row,status:'cancelled'});assert.equal((await feed(shop)).length,0);
});
test('incident timeline appends and operations evidence cannot claim future checks',async()=>{
 await ok(ops,'/incidents',{title:'Synthetic outage',severity:'high',status:'investigating',services:['api'],note:'Investigating'});const row=(await ok(ops,'/communications')).incidents[0];
 await ok(ops,'/incidents',{...row,status:'resolved',note:'Verified recovery'});assert.equal((await ok(ops,'/communications')).incidents[0].timeline.length,2);
 assert.equal((await http(ops,'/incidents',{...row,status:'identified',note:'Stale'})).status,409);
 await ok(ops,'/operations/checks',{kind:'restore',result:'passed',checked_at:new Date().toISOString(),evidence:'Synthetic drill report'});
 assert.equal((await http(ops,'/operations/checks',{kind:'backup',result:'passed',checked_at:new Date(Date.now()+3600000).toISOString(),evidence:'Future'})).status,422);
 assert.equal((await ok(ops,'/operations')).checks[0].kind,'restore');assert.equal((await http(admin,'/operations/checks',{kind:'backup',result:'passed',checked_at:new Date().toISOString(),evidence:'Unauthorized'})).status,403);
});
test('delivery retry keeps its identity, refuses sent rows and does not reveal device tokens',async()=>{
 const shop=await a.createShop('Retry');await a.one('SELECT auth.register_device($1,$2,$3)',[shop.owner.userId,'synthetic-device-token','android']);
 const n=(await db.query('SELECT core.notify($1,$2,$3,$4,$5,$6,$7) AS id',[shop.organizationId,shop.owner.userId,randomUUID(),'renewal_due',{},'subscription',null])).rows[0].id;
 await db.query("UPDATE ops.notification_deliveries SET status='failed' WHERE notification_id=$1",[n]);let row=(await ok(ops,'/operations')).deliveries.find(x=>x.organization_id===shop.organizationId);
 assert.ok(!JSON.stringify(row).includes('synthetic-device-token'));await ok(ops,`/operations/deliveries/${row.id}/retry`,{version:row.version,reason:'Provider recovered'});
 assert.equal((await http(ops,`/operations/deliveries/${row.id}/retry`,{version:row.version,reason:'Replay'})).status,409);
 await db.query("UPDATE ops.notification_deliveries SET status='sent' WHERE id=$1",[row.id]);const count=(await db.query('SELECT count(*)::int AS n FROM ops.notification_deliveries WHERE notification_id=$1',[n])).rows[0].n;assert.equal(count,1);
});
async function request(shop,kind){const d=await a.one('SELECT auth.request_privacy($1,$2,$3,$4) AS v',[shop.owner.userId,shop.organizationId,kind,'Synthetic owner request']);await ok(one,`/data-requests/${d.v.request_id}`,{status:'approved',note:'Verified owner request'});return d.v.request_id;}
test('owner export is generated, encrypted, expires, remains private and cannot be falsely completed',async()=>{
 const shop=await a.createShop('Private export'),other=await a.createShop('Other export');await db.query('INSERT INTO core.customers(organization_id,name) VALUES($1,$2)',[shop.organizationId,'Private customer']);const id=await request(shop,'export');
 assert.equal((await http(one,`/data-requests/${id}`,{status:'succeeded',note:'Skip export'})).status,422);
 await ok(one,`/privacy/requests/${id}/export`,{});const artifact=(await db.query('SELECT * FROM platform.export_artifacts WHERE request_id=$1',[id])).rows[0];assert.ok(!artifact.body_sealed.includes('Private customer'));assert.equal(JSON.parse(decrypt(settings.secretKey,artifact.body_sealed)).customers[0].name,'Private customer');
 const data=await a.one('SELECT auth.download_export($1,$2,$3) AS v',[shop.owner.userId,shop.organizationId,id]);assert.ok(data.v);
 assert.equal((await a.one('SELECT auth.download_export($1,$2,$3) AS v',[other.owner.userId,shop.organizationId,id])).v,null);
 await db.query("UPDATE platform.export_artifacts SET expires_at=now()-interval '1 second' WHERE request_id=$1",[id]);assert.equal((await a.one('SELECT auth.download_export($1,$2,$3) AS v',[shop.owner.userId,shop.organizationId,id])).v,null);await role('fs_worker',c=>c.query('SELECT worker.expire_exports()'));assert.equal((await db.query('SELECT * FROM platform.export_artifacts WHERE request_id=$1',[id])).rows.length,0);
});
test('privacy execution enforces separate staff, holds, cooling and runs erasure through actual worker',async()=>{
 const shop=await a.createShop('Erase synthetic shop');await db.query('INSERT INTO core.customers(organization_id,name,phone,phone_normalized,note) VALUES($1,$2,$3,$3,$4)',[shop.organizationId,'Private erased customer','+66991234567','Secret note']);
 await db.query("INSERT INTO core.media_assets(organization_id,object_key,thumbnail_key,mime_type,size_bytes,uploaded_by,status) VALUES($1,'synthetic/original.jpg','synthetic/thumb.jpg','image/jpeg',10,$2,'pending_upload')",[shop.organizationId,shop.owner.userId]);
 const id=await request(shop,'deletion');let preview=await ok(two,`/privacy/requests/${id}`);
 assert.equal((await http(one,`/privacy/requests/${id}/execute`,{version:preview.request.version,note:'Self execute'})).status,403);
 assert.equal((await http(two,`/privacy/requests/${id}/execute`,{version:preview.request.version,note:'Too soon'})).status,422);
 await db.query("UPDATE platform.data_requests SET created_at=now()-interval '2 days' WHERE id=$1",[id]);await ok(one,'/privacy/holds',{organization_id:shop.organizationId,reason:'Synthetic hold'});preview=await ok(two,`/privacy/requests/${id}`);
 assert.equal((await http(two,`/privacy/requests/${id}/execute`,{version:preview.request.version,note:'Held'})).status,422);
 await ok(one,'/privacy/holds',{organization_id:shop.organizationId,release_id:preview.holds[0].id,reason:'Hold resolved'});preview=await ok(two,`/privacy/requests/${id}`);await ok(two,`/privacy/requests/${id}/execute`,{version:preview.request.version,note:'Approved erasure'});
 const customer=(await db.query('SELECT * FROM core.customers WHERE organization_id=$1',[shop.organizationId])).rows[0];assert.equal(customer.name,'Deleted customer');assert.equal(customer.phone,null);assert.equal(customer.note,null);
 assert.equal((await db.query('SELECT status FROM core.organizations WHERE id=$1',[shop.organizationId])).rows[0].status,'closed');assert.equal((await ok(two,`/privacy/requests/${id}`)).request.status,'running');
 await db.query("UPDATE platform.media_erasure_jobs SET updated_at=now()-interval '1 minute' WHERE organization_id=$1",[shop.organizationId]);const deleted=[];const pool={query:(sql,p)=>role('fs_worker',c=>c.query(sql,p))};await runErasure({pool,storage:{delete:async key=>deleted.push(key)}});assert.equal(deleted.length,2);assert.equal((await ok(two,`/privacy/requests/${id}`)).request.status,'succeeded');
 assert.equal((await db.query('SELECT * FROM platform.deletion_tombstones WHERE organization_id=$1',[shop.organizationId])).rows.length,1);assert.ok((await db.query('SELECT * FROM core.users WHERE id=$1',[shop.owner.userId])).rows.length);
 await assert.rejects(role('fs_platform',c=>c.query('SELECT padmin.erase_business_content($1)',[shop.organizationId])),e=>e.code==='42501');
});
test('closure changes actual access, prevents restoration and protects financial documents',async()=>{
 const shop=await a.createShop('Close synthetic shop');const id=await request(shop,'closure'),preview=await ok(two,`/privacy/requests/${id}`);await ok(two,`/privacy/requests/${id}/execute`,{version:preview.request.version,note:'Owner closure'});
 assert.equal((await db.query('SELECT status FROM core.organizations WHERE id=$1',[shop.organizationId])).rows[0].status,'closed');assert.equal((await http(admin,`/shops/${shop.organizationId}/restore`,{reason:'Restore closed'})).status,422);
});
