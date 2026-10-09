import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { RequestId } from '../auth/session.guard.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { decrypt, encrypt, randomToken, sha256Hex, tokenPattern } from '../shared/crypto.js';
import { hashPassword, newTotpSecret, otpauthUri, verifyTotp } from './secrets.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';

function id(value:unknown){if(typeof value!=='string'||!uuidPattern.test(value))throw apiError(404,'RESOURCE_NOT_FOUND');return value;}
function version(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw apiError(400,'VALIDATION_ERROR');return value;}
function outcome(value:string){if(value==='ok')return {ok:true};if(value==='not_found')throw apiError(404,'RESOURCE_NOT_FOUND');if(value==='conflict'||value==='exists')throw apiError(409,'VERSION_CONFLICT');if(value==='self')throw apiError(403,'SELF_APPROVAL_FORBIDDEN');throw apiError(422,'INVALID_STATE_TRANSITION');}
function reason(value:unknown){const v=new Validation();const text=v.text('reason',value,{max:500});v.done();return text;}

/** Enrollment links are bearer credentials: opaque, hashed in storage, limited to 48h and five attempts. */
@Controller('platform/enrollment')
export class StaffEnrollmentController {
 constructor(private readonly database:PlatformDatabaseService,@Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 private async context(token:unknown){if(typeof token!=='string'||!tokenPattern.test(token)||!this.settings.secretKey)throw apiError(404,'RESOURCE_NOT_FOUND');
  const row=await this.database.run(async c=>(await c.query('SELECT padmin.invitation_context($1) AS v',[sha256Hex(token)])).rows[0].v);
  if(!row)throw apiError(404,'RESOURCE_NOT_FOUND');return row;}
 @Post('setup') @HttpCode(200)
 async setup(@Body()body:Record<string,unknown>={}){const row=await this.context(body.token);const secret=decrypt(this.settings.secretKey!,row.totp_sealed);return {email:row.email,display_name:row.display_name,secret,otpauth_uri:otpauthUri(secret,row.email)};}
 @Post() @HttpCode(200)
 async enroll(@Body()body:Record<string,unknown>={}){
  const row=await this.context(body.token);const v=new Validation();
  // Preserve password bytes, including intentional whitespace.
  if(typeof body.password!=='string'||body.password.length<12||body.password.length>200)v.fail('password','field.required');
  if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code))v.fail('code','field.required');v.done();
  const step=verifyTotp(decrypt(this.settings.secretKey!,row.totp_sealed),body.code as string);
  const result=await this.database.run(async c=>(await c.query('SELECT padmin.enroll_staff($1,$2,$3) AS v',[sha256Hex(body.token as string),step===null?'':await hashPassword(body.password as string),step])).rows[0].v);
  if(result!=='ok')throw apiError(400,'VALIDATION_ERROR');return {ok:true};
 }
}

@Controller('platform') @UseGuards(PlatformGuard)
export class ManagementController {
 constructor(private readonly database:PlatformDatabaseService,@Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 private one(sql:string,params:unknown[]){return this.database.run(async c=>(await c.query(sql,params)).rows[0].v);}
 @Get('staff') @Permission('accounts.manage')
 async staff(@Account()a:PlatformAccount,@Query('q')q='',@Query('offset')offset='0'){
  const n=Number(offset);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw apiError(400,'VALIDATION_ERROR');
  const d=await this.one('SELECT padmin.staff($1,$2,$3) AS v',[a.accountId,q.slice(0,100),n]);return {...d,items:d.items.slice(0,50),has_more:d.items.length>50,offset:n,roles:await this.one('SELECT padmin.role_catalog($1) AS v',[a.accountId])};
 }
 @Post('staff/invite') @Permission('accounts.manage') @StepUp()
 async invite(@Account()a:PlatformAccount,@RequestId()request:string,@Body()body:Record<string,unknown>={}){
  const v=new Validation();const email=v.text('email',body.email,{max:200}),name=v.text('display_name',body.display_name,{max:100});
  if(!email||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))v.fail('email','field.required');
  if(!Array.isArray(body.roles)||!body.roles.length||body.roles.length>20||!body.roles.every(r=>typeof r==='string'))v.fail('roles','field.required');v.done();
  if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');const token=randomToken();
  const d=await this.one('SELECT padmin.invite_staff($1,$2,$3,$4,$5,$6,$7) AS v',[a.accountId,email,name,body.roles,sha256Hex(token),encrypt(this.settings.secretKey,newTotpSecret()),request]);
  outcome(d.outcome);return {account_id:d.account_id,token,expires_in_hours:48};
 }
 @Post('staff/:id/action') @HttpCode(200) @Permission('accounts.manage') @StepUp()
 async staffAction(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')target:string,@Body()b:Record<string,unknown>={}){
  if(!['disable','enable','revoke_sessions'].includes(b.action as string))throw apiError(400,'VALIDATION_ERROR');
  return outcome(await this.one('SELECT padmin.staff_action($1,$2,$3,$4,$5,$6) AS v',[a.accountId,id(target),b.action,version(b.version),reason(b.reason),request]));
 }
 @Post('staff/:id/reinvite') @HttpCode(200) @Permission('accounts.manage') @StepUp()
 async reinvite(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')target:string,@Body()b:Record<string,unknown>={}){
  if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');const token=randomToken();
  outcome(await this.one('SELECT padmin.refresh_invitation($1,$2,$3,$4,$5,$6,$7) AS v',[a.accountId,id(target),version(b.version),sha256Hex(token),encrypt(this.settings.secretKey,newTotpSecret()),reason(b.reason),request]));return {token,expires_in_hours:48};
 }
 @Get('catalog') @Permission('plans.manage')
 catalog(@Account()a:PlatformAccount){return this.one('SELECT padmin.catalog($1) AS v',[a.accountId]);}
 @Post('catalog/drafts') @Permission('plans.manage')
 async draft(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),payload:Record<string,unknown>={};const p=(b.payload??{}) as Record<string,unknown>;
  for(const key of ['code','name_th','name_en'])payload[key]=v.text(key,p[key],{max:key==='code'?50:150});
  if(!/^[a-z][a-z0-9_-]{1,49}$/.test(payload.code as string))v.fail('code','field.required');
  if(!['paid','trial'].includes(p.kind as string))v.fail('kind','field.required');payload.kind=p.kind;
  // OCR is not a plan limit (migration 023); older clients may still send ocr_per_period.
  if(p.ocr_per_period===undefined)p.ocr_per_period=0;
  for(const key of ['technician_seats','storage_bytes','ocr_per_period','trial_days','grace_days']){
   const val=p[key];if(typeof val!=='number'||!Number.isSafeInteger(val)||val<(key==='storage_bytes'?1:0)||(['trial_days','grace_days'].includes(key)&&val>365))v.fail(key,'field.required');payload[key]=val;
  }
  if(typeof p.effective_at!=='string'||Number.isNaN(Date.parse(p.effective_at)))v.fail('effective_at','field.required');else payload.effective_at=new Date(p.effective_at).toISOString();
  if(!Array.isArray(p.prices)||(p.kind==='paid'&&!p.prices.length)||p.prices.length>2)v.fail('prices','field.required');
  else{const intervals=new Set();payload.prices=p.prices.map(item=>{if(!item||typeof item!=='object'){v.fail('prices','field.required');return {};}
   const x=item as Record<string,unknown>;if(!['month','year'].includes(x.interval_unit as string)||intervals.has(x.interval_unit)||typeof x.amount_minor!=='number'||!Number.isSafeInteger(x.amount_minor)||x.amount_minor<1)v.fail('prices','field.required');intervals.add(x.interval_unit);return {interval_unit:x.interval_unit,amount_minor:x.amount_minor};});}
  if(p.kind==='trial'&&Array.isArray(p.prices)&&p.prices.length)v.fail('prices','field.required');v.done();
  if(p.kind==='trial'&&Number(p.trial_days)<1)throw apiError(400,'VALIDATION_ERROR');
  const d=await this.one('SELECT padmin.save_plan_draft($1,$2,$3,$4::jsonb,$5) AS v',[a.accountId,b.id?id(b.id):null,b.id?version(b.version):0,JSON.stringify(payload),request]);outcome(d.outcome);return d;
 }
 @Post('catalog/:id/archive') @HttpCode(200) @Permission('plans.publish') @StepUp()
 async archive(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')target:string,@Body()b:Record<string,unknown>={}){return outcome(await this.one('SELECT padmin.archive_plan($1,$2,$3,$4,$5) AS v',[a.accountId,id(target),version(b.version),reason(b.reason),request]));}
 @Get('policy') @Permission('settings.manage')
 policy(@Account()a:PlatformAccount){return this.one('SELECT padmin.policy($1) AS v',[a.accountId]);}
 @Post('changes') @StepUp()
 async submit(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){
  if(!['roles','recovery','plan','policy'].includes(b.kind as string))throw apiError(400,'VALIDATION_ERROR');const p=b.payload as Record<string,unknown>|undefined;
  if(b.kind==='policy'){
   if(!p||typeof p.new_shops_enabled!=='boolean'||typeof p.new_payments_enabled!=='boolean'||Object.keys(p).some(k=>!['new_shops_enabled','new_payments_enabled','business_retention_days','deletion_cooling_days','step_up_enabled','step_up_minutes'].includes(k)))throw apiError(400,'VALIDATION_ERROR');
   if(p.step_up_enabled!==undefined&&typeof p.step_up_enabled!=='boolean')throw apiError(400,'VALIDATION_ERROR');
   if(p.step_up_minutes!==undefined&&(typeof p.step_up_minutes!=='number'||!Number.isInteger(p.step_up_minutes)||p.step_up_minutes<5||p.step_up_minutes>720))throw apiError(400,'VALIDATION_ERROR');
   for(const k of ['business_retention_days','deletion_cooling_days']){const x=p[k];if(x!==undefined&&x!==null&&(typeof x!=='number'||!Number.isSafeInteger(x)||x<1||x>36500))throw apiError(400,'VALIDATION_ERROR');}
  }
  if(b.kind==='roles'&&(!Array.isArray(p?.roles)||!p.roles.length||p.roles.length>20||!p.roles.every(x=>typeof x==='string')))throw apiError(400,'VALIDATION_ERROR');
  const result=await this.one('SELECT padmin.submit_change($1,$2,$3,$4,$5::jsonb,$6,$7) AS v',[a.accountId,b.kind,b.kind==='policy'?null:id(b.target_id),version(b.version),JSON.stringify(p??{}),reason(b.reason),request]);return {id:result};
 }
 @Get('changes')
 approvals(@Account()a:PlatformAccount){return this.one('SELECT padmin.approvals($1) AS v',[a.accountId]);}
 @Post('changes/:id/decision') @HttpCode(200) @StepUp()
 async decide(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')target:string,@Body()b:Record<string,unknown>={}){
  if(typeof b.approve!=='boolean')throw apiError(400,'VALIDATION_ERROR');return outcome(await this.one('SELECT padmin.decide_change($1,$2,$3,$4,$5) AS v',[a.accountId,id(target),b.approve,reason(b.note),request]));
 }
}
