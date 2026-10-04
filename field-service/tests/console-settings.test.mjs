import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
import {RuntimeSettingsService} from '../apps/api/dist/platform/runtime-settings.service.js';
import {ConsoleSettingsController} from '../apps/api/dist/platform/console-settings.controller.js';
import {AccountSettingsController} from '../apps/api/dist/platform/account-settings.controller.js';
import {PlatformDatabaseService} from '../apps/api/dist/platform/platform-database.service.js';
import {PlatformGuard} from '../apps/api/dist/platform/platform.guard.js';
import {BillingController} from '../apps/api/dist/billing/billing.controller.js';
import {PLATFORM_SETTINGS} from '../apps/api/dist/config.js';
import {productionProblems} from '../apps/api/dist/config-check.js';
import {encrypt,decrypt,randomToken,sha256Hex} from '../apps/api/dist/shared/crypto.js';
import {hashPassword,verifyPassword} from '../apps/api/dist/platform/secrets.js';
let db,a,admin,operator,other,settings,runtime,controller,accountController,database,app,base;
const initialPassword='synthetic-current-password';
async function role(name,fn){await db.exec(`BEGIN;SET LOCAL ROLE ${name};`);try{const result=await fn(db);await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}}
async function account(roleCode){
 const id=(await db.query("INSERT INTO platform.accounts(display_name,email,password_hash,mfa_enrolled) VALUES('Settings tester',$1,$2,true) RETURNING id",[`${randomUUID()}@test.invalid`,await hashPassword(initialPassword)])).rows[0].id;
 await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2',[id,roleCode]);
 const token=randomToken(),hash=sha256Hex(token);
 const session=(await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,step_up_at,expires_at,client) VALUES($1,$2,now(),now(),now()+interval '1 hour','Synthetic browser') RETURNING id",[id,hash])).rows[0].id;
 return {accountId:id,tokenHash:hash,sessionId:session,token,email:(await db.query('SELECT email FROM platform.accounts WHERE id=$1',[id])).rows[0].email};
}
before(async()=>{
 db=await openTestDatabase('console_settings');a=actors(db);admin=await account('platform_admin');operator=await account('billing_operator');other=await account('platform_admin');
 settings={production:false,secretKey:randomBytes(32),payment:{bankName:'Environment bank',bankCode:'004',accountName:'Environment platform',accountNumber:'1234567890'}};
 database={configured:true,run:fn=>role('fs_platform',fn)};runtime=new RuntimeSettingsService(database,settings);
 controller=new ConsoleSettingsController(database,runtime,settings);accountController=new AccountSettingsController(database);
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
 class TestModule{};
 Module({controllers:[ConsoleSettingsController,AccountSettingsController],providers:[PlatformGuard,{provide:PlatformDatabaseService,useValue:database},{provide:RuntimeSettingsService,useValue:runtime},{provide:PLATFORM_SETTINGS,useValue:settings}]})(TestModule);
 app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('v1');
 // Match the production request-id middleware.
 app.use((req,_res,next)=>{req.requestId=randomUUID();next();});
 await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${app.getHttpServer().address().port}/v1`;
});
after(async()=>{await app?.close();await db?.close();});
async function http(who,path,body){const r=await fetch(`${base}${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:`Bearer ${who.token}`},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function save(section,value){const d=await controller.get(admin);return controller.save(admin,randomUUID(),{section,version:d.version,...value});}
const bank={enabled:true,bankName:'Console bank',bankCode:'004',accountName:'Platform account',accountNumber:'9876543210',promptPayId:'0812345678'};
test('console settings HTTP enforces permission and TOTP; raw settings are inaccessible to shop role',async()=>{
 assert.equal((await http(operator,'/platform/settings')).status,403);
 assert.equal((await http(operator,'/platform/settings',{section:'bank',version:0,...bank})).status,403);
 await db.query('UPDATE platform.sessions SET step_up_at=NULL WHERE id=$1',[admin.sessionId]);
 assert.equal((await http(admin,'/platform/settings',{section:'bank',version:0,...bank})).status,403);
 await db.query('UPDATE platform.sessions SET step_up_at=now() WHERE id=$1',[admin.sessionId]);
 assert.equal((await http(admin,'/platform/settings',{section:'bank',version:0,...bank})).status,200);
 await assert.rejects(role('fs_api',c=>c.query('SELECT padmin.runtime_settings()')),e=>e.code==='42501');
 await assert.rejects(role('fs_platform',c=>c.query('SELECT * FROM platform.runtime_settings')),e=>e.code==='42501');
});
test('settings preserve existing secrets, sanitize reads/audit and reject stale versions or invalid receiver',async()=>{
 const d=await save('sms',{enabled:true,sender:'ApprovedTest',api_key:'synthetic-dee-api',secret_key:'synthetic-dee-secret'});
 assert.equal(d.sms.key_configured,true);assert.ok(!JSON.stringify(d).includes('synthetic-dee'));
 const raw=(await runtime.read()).sms;assert.equal(decrypt(settings.secretKey,raw.apiKeySealed),'synthetic-dee-api');
 const kept=await save('sms',{enabled:true,sender:'ChangedTest'});assert.equal(kept.sms.sender,'ChangedTest');assert.equal((await runtime.read()).sms.apiKeySealed,raw.apiKeySealed);
 await assert.rejects(controller.save(admin,randomUUID(),{section:'bank',version:0,...bank}),e=>e.getStatus()===409);
 const latest=await controller.get(admin);
 await assert.rejects(controller.save(admin,randomUUID(),{section:'bank',version:latest.version,...bank,bankCode:'bad'}),e=>e.getStatus()===400);
 await assert.rejects(controller.save(admin,randomUUID(),{section:'sms',version:latest.version,enabled:true,sender:'Test',api_key:'partial'}),e=>e.getStatus()===400);
 const audit=(await db.query("SELECT details FROM platform.audit_logs WHERE action='console_settings.updated'")).rows;
 assert.ok(!JSON.stringify(audit).includes('synthetic-dee'));assert.ok(!JSON.stringify(audit).includes('Sealed'));
});
test('console bank changes apply to new invoices and retain the immutable old receiver',async()=>{
 const shop=await a.createShop('Receiver');const session={userId:shop.owner.userId},tenant={organizationId:shop.organizationId,role:'owner'};
 const stripe={methods:async()=>({stripe_card:false,stripe_qr:false,stripe_test:false})};
 const shopDatabase={identity:fn=>role('fs_api',fn),withTenant:(user,org,fn)=>role('fs_api',async c=>{await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,org]);return fn(c);})};
 const billing=new BillingController(shopDatabase,settings,{},null,{},stripe,runtime);
 const invoice=await billing.create(session,tenant,{price_version_id:'72000000-0000-0000-0000-000000000001',request_key:randomUUID()});
 assert.equal(invoice.pay_to.account_number,bank.accountNumber);
 await save('bank',{...bank,accountNumber:'1112223334'});
 const original=await billing.get(session,tenant,invoice.id);assert.equal(original.pay_to.account_number,bank.accountNumber);
 const nextShop=await a.createShop('New receiver');
 const next=await billing.create({userId:nextShop.owner.userId},{organizationId:nextShop.organizationId,role:'owner'},{price_version_id:'72000000-0000-0000-0000-000000000001',request_key:randomUUID()});
 assert.equal(next.pay_to.account_number,'1112223334');
 await save('bank',{...bank,enabled:false});assert.equal(await runtime.bank(),undefined);
 const plans=await billing.plans(session,tenant);assert.equal(plans.payment_available,false);
});
test('runtime DeeSMSx uses saved credentials immediately and disabled services override environment',async t=>{
 const old={api:process.env.DEESMSX_API_KEY,secret:process.env.DEESMSX_SECRET_KEY,sender:process.env.DEESMSX_SENDER,slip:process.env.EASYSLIP_API_KEY};
 process.env.DEESMSX_API_KEY='synthetic-env-api';process.env.DEESMSX_SECRET_KEY='synthetic-env-secret';process.env.DEESMSX_SENDER='Env';process.env.EASYSLIP_API_KEY='synthetic-env-slip';
 try{
   let request;t.mock.method(globalThis,'fetch',async(_url,options)=>{request=JSON.parse(options.body);return new Response('{}',{status:200});});
   await (await runtime.sms()).send('+66912345678','OTP 123456');assert.equal(request.apiKey,'synthetic-dee-api');assert.equal(request.sender,'ChangedTest');
   await save('sms',{enabled:false,sender:'ChangedTest'});assert.equal(await runtime.sms(),null);
   await save('easyslip',{enabled:true,api_key:'synthetic-console-slip'});assert.equal(await runtime.slipKey(),'synthetic-console-slip');
   await save('easyslip',{enabled:false});assert.equal(await runtime.slipKey(),undefined);
 }finally{for(const [name,value] of Object.entries({DEESMSX_API_KEY:old.api,DEESMSX_SECRET_KEY:old.secret,DEESMSX_SENDER:old.sender,EASYSLIP_API_KEY:old.slip}))value===undefined?delete process.env[name]:process.env[name]=value;}
});
test('own profile works for ordinary staff but cannot edit another account or replay stale updates',async()=>{
 const d=await accountController.get(operator);
 assert.ok(!JSON.stringify(d).includes('password_hash'));assert.ok(!JSON.stringify(d).includes(operator.tokenHash));
 const changed=await accountController.profile(operator,randomUUID(),{version:d.profile.version,display_name:'Billing staff',preferred_language:'en'});
 assert.equal(changed.profile.display_name,'Billing staff');assert.equal(changed.profile.preferred_language,'en');
 await assert.rejects(accountController.profile(operator,randomUUID(),{version:d.profile.version,display_name:'Stale',preferred_language:'th'}),e=>e.getStatus()===409);
 await assert.rejects(role('fs_platform',c=>c.query('SELECT padmin.update_profile($1,$2,$3,$4,$5,$6)',[other.accountId,operator.tokenHash,'Impersonation','th',1,randomUUID()])),e=>e.code==='42501');
 assert.equal((await http(operator,'/platform/account')).status,200);
});
test('password change checks old password and TOTP, revokes other sessions, and never writes secrets to audit',async()=>{
 const second=randomToken();await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,now(),now()+interval '1 hour')",[operator.accountId,sha256Hex(second)]);
 await db.query('UPDATE platform.sessions SET step_up_at=NULL WHERE id=$1',[operator.sessionId]);
 assert.equal((await http(operator,'/platform/account/password',{current_password:initialPassword,new_password:'synthetic-new-password'})).status,403);
 await db.query('UPDATE platform.sessions SET step_up_at=now() WHERE id=$1',[operator.sessionId]);
 await assert.rejects(accountController.password(operator,randomUUID(),{current_password:'wrong',new_password:'synthetic-new-password'}),e=>e.getStatus()===400);
 await db.query("UPDATE platform.accounts SET locked_until=now()+interval '10 minutes' WHERE id=$1",[operator.accountId]);
 await assert.rejects(accountController.password(operator,randomUUID(),{current_password:initialPassword,new_password:'synthetic-new-password'}),e=>e.getStatus()===429);
 await db.query('UPDATE platform.accounts SET locked_until=NULL WHERE id=$1',[operator.accountId]);
 await assert.rejects(accountController.password(operator,randomUUID(),{current_password:initialPassword,new_password:'short'}),e=>e.getStatus()===400);
 const result=await http(operator,'/platform/account/password',{current_password:initialPassword,new_password:'synthetic-new-password'});assert.equal(result.status,200);assert.equal(result.data.sessions.length,1);assert.equal(result.data.sessions[0].current,true);
 assert.equal((await db.query('SELECT * FROM padmin.resolve_session($1)',[sha256Hex(second)])).rows.length,0);
 const hash=(await db.query('SELECT password_hash FROM platform.accounts WHERE id=$1',[operator.accountId])).rows[0].password_hash;
 assert.equal(await verifyPassword('synthetic-new-password',hash),true);assert.equal(await verifyPassword(initialPassword,hash),false);
 assert.ok(!JSON.stringify((await db.query('SELECT details FROM platform.audit_logs')).rows).includes('synthetic-new-password'));
 assert.equal((await db.query('SELECT * FROM padmin.resolve_session($1)',[other.tokenHash])).rows.length,1);
});
test('logout other devices keeps current session, denies cross-account session access and revoked callers',async()=>{
 const token=randomToken();await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,expires_at) VALUES($1,$2,now(),now()+interval '1 hour')",[admin.accountId,sha256Hex(token)]);
 assert.equal((await accountController.get(admin)).sessions.length,2);
 const response=await http(admin,'/platform/account/logout-others',{});assert.equal(response.status,200);assert.equal(response.data.sessions.length,1);
 await assert.rejects(role('fs_platform',c=>c.query('SELECT padmin.account_sessions($1,$2)',[other.accountId,admin.tokenHash])),e=>e.code==='42501');
 assert.equal((await http({...admin,token},'/platform/account')).status,401);
});
test('startup diagnostics honor console overrides without reading or leaking secret values',()=>{
 const saved={version:1,bank,sms:{enabled:true,sender:'Test',apiKeySealed:'sealed',secretKeySealed:'sealed'},easyslip:{enabled:true,keySealed:'sealed'}};
 const problems=productionProblems({NODE_ENV:'production'},saved);
 assert.ok(!problems.some(p=>p.startsWith('SMS_PROVIDER')||p.startsWith('DEESMSX')||p.startsWith('PAYMENT_BANK_NAME')||p.startsWith('PAYMENT_BANK_CODE')||p==='EASYSLIP_API_KEY'));
 const disabled=productionProblems({NODE_ENV:'production',SMS_PROVIDER:'deesmsx',DEESMSX_API_KEY:'env',DEESMSX_SECRET_KEY:'env',DEESMSX_SENDER:'Env',EASYSLIP_API_KEY:'env'},
   {...saved,sms:{...saved.sms,enabled:false},easyslip:{enabled:false}});
 assert.ok(disabled.some(p=>p.startsWith('SMS_PROVIDER')));assert.ok(disabled.includes('EASYSLIP_API_KEY'));
});
