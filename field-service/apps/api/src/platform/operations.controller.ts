import { Body, Controller, Get, HttpCode, Optional, Param, Post, UseGuards } from '@nestjs/common';
import { StripeService } from '../billing/stripe.service.js';
import { RequestId } from '../auth/session.guard.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, type PlatformAccount } from './platform.guard.js';
@Controller('platform') @UseGuards(PlatformGuard)
export class OperationsController {
 constructor(private readonly database:PlatformDatabaseService,@Optional()private readonly stripe?:StripeService){}
 private one(sql:string,p:unknown[]){return this.database.run(async c=>(await c.query(sql,p)).rows[0].v);}
 private target(body:Record<string,unknown>){if(body.id!==undefined&&(typeof body.id!=='string'||!uuidPattern.test(body.id)))throw apiError(400,'VALIDATION_ERROR');if(body.id&&(typeof body.version!=='number'||!Number.isSafeInteger(body.version)||body.version<1))throw apiError(400,'VALIDATION_ERROR');return [body.id??null,body.version??0];}
 private result(value:string){if(value==='ok')return {ok:true};if(value==='conflict')throw apiError(409,'VERSION_CONFLICT');if(value==='not_found')throw apiError(404,'RESOURCE_NOT_FOUND');throw apiError(422,'INVALID_STATE_TRANSITION');}
 @Get('communications') @Permission('communications.manage')
 communications(@Account()a:PlatformAccount){return this.one('SELECT padmin.communications($1) AS v',[a.accountId]);}
 @Post('announcements') @HttpCode(200) @Permission('communications.manage')
 async announcement(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),payload:Record<string,unknown>={};for(const k of ['title_th','title_en','body_th','body_en'])payload[k]=v.text(k,b[k],{max:k.startsWith('title')?150:4000});
  for(const [k,values] of [['audience',['all','trial','paid','shops']],['status',['draft','scheduled','published','cancelled']]] as const){if(!values.includes(b[k] as never))v.fail(k,'field.required');payload[k]=b[k];}
  if(!Array.isArray(b.organization_ids)||b.organization_ids.length>200||!b.organization_ids.every(x=>typeof x==='string'&&uuidPattern.test(x)))v.fail('organization_ids','field.required');payload.organization_ids=b.organization_ids;
  for(const k of ['publish_at','expires_at']){if(typeof b[k]!=='string'||Number.isNaN(Date.parse(b[k] as string)))v.fail(k,'field.required');else payload[k]=new Date(b[k] as string).toISOString();}
  if(Date.parse(payload.expires_at as string)<=Date.parse(payload.publish_at as string))v.fail('expires_at','field.required');v.done();const target=this.target(b);
  return this.result(await this.one('SELECT padmin.save_announcement($1,$2,$3,$4::jsonb,$5) AS v',[a.accountId,...target,JSON.stringify(payload),request]));
 }
 @Post('incidents') @HttpCode(200) @Permission('communications.manage')
 async incident(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),title=v.text('title',b.title,{max:150}),note=v.text('note',b.note,{max:1000});
  if(!['low','medium','high','critical'].includes(b.severity as string))v.fail('severity','field.required');
  if(!['investigating','identified','monitoring','resolved'].includes(b.status as string))v.fail('status','field.required');
  if(!Array.isArray(b.services)||!b.services.length||!b.services.every(x=>['api','database','storage','ocr','sms','payment','push','web'].includes(x as string)))v.fail('services','field.required');v.done();
  return this.result(await this.one('SELECT padmin.save_incident($1,$2,$3,$4,$5,$6,$7,$8,$9) AS v',[a.accountId,...this.target(b),title,b.severity,b.status,b.services,note,request]));
 }
 @Get('operations') @Permission('system.read')
 operations(@Account()a:PlatformAccount){return this.one('SELECT padmin.operations($1) AS v',[a.accountId]);}
 @Post('operations/checks') @HttpCode(200) @Permission('operations.manage')
 async record(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),evidence=v.text('evidence',b.evidence,{max:1000});
  if(!['backup','restore','api','storage','ocr','webhook'].includes(b.kind as string))v.fail('kind','field.required');if(!['passed','failed'].includes(b.result as string))v.fail('result','field.required');
  if(typeof b.checked_at!=='string'||Number.isNaN(Date.parse(b.checked_at)))v.fail('checked_at','field.required');v.done();
  return this.result(await this.one('SELECT padmin.record_operation($1,$2,$3,$4,$5,$6) AS v',[a.accountId,b.kind,b.result,evidence,b.checked_at,request]));
 }
 @Post('operations/deliveries/:id/retry') @HttpCode(200) @Permission('operations.manage')
 async retry(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')id:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),reason=v.text('reason',b.reason,{max:500});v.done();const target=this.target({...b,id});
  return this.result(await this.one('SELECT padmin.retry_delivery($1,$2,$3,$4,$5) AS v',[a.accountId,...target,reason,request]));
 }
 @Post('operations/ocr/:id/retry') @HttpCode(200) @Permission('operations.manage')
 async retryOcr(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')id:string,@Body()b:Record<string,unknown>={}){const v=new Validation(),reason=v.text('reason',b.reason,{max:500});v.done();return this.result(await this.one('SELECT padmin.retry_ocr($1,$2,$3,$4,$5) AS v',[a.accountId,...this.target({...b,id}),reason,request]));}
 @Post('operations/checkouts/:id/refresh') @HttpCode(200) @Permission('operations.manage')
 async refresh(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')id:string,@Body()b:Record<string,unknown>={}){if(!uuidPattern.test(id))throw apiError(404,'RESOURCE_NOT_FOUND');const v=new Validation(),reason=v.text('reason',b.reason,{max:500});v.done();if(!this.stripe)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
  const row=await this.one('SELECT padmin.refresh_checkout($1,$2,$3,$4) AS v',[a.accountId,id,reason,request]);if(!row)throw apiError(422,'INVALID_STATE_TRANSITION');await this.stripe.refresh(id);return {ok:true};}
}
