import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { RequestId, Session, type SessionContext } from '../auth/session.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
/** Only what these handlers use; the API does not depend on express types directly. */
type Response = { setHeader: (name: string, value: string) => void; json: (body: unknown) => void; send: (body: string | Buffer) => void };
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { decrypt, encrypt } from '../shared/crypto.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';
function identifier(value:string){if(!uuidPattern.test(value))throw apiError(404,'RESOURCE_NOT_FOUND');return value;}
@Controller('platform/privacy') @UseGuards(PlatformGuard)
export class PrivacyController {
 constructor(private readonly database:PlatformDatabaseService,@Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 private one(sql:string,p:unknown[]){return this.database.run(async c=>(await c.query(sql,p)).rows[0].v);}
 @Get('requests/:id') @Permission('data.manage')
 async preview(@Account()a:PlatformAccount,@Param('id')id:string){const v=await this.one('SELECT padmin.privacy_preview($1,$2) AS v',[a.accountId,identifier(id)]);if(!v)throw apiError(404,'RESOURCE_NOT_FOUND');return v;}
 @Post('requests/:id/export') @HttpCode(200) @Permission('data.manage') @StepUp()
 async generate(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')id:string){identifier(id);if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
  // Snapshot and artifact commit together; a failed encryption or size check never completes a request.
  await this.database.run(async c=>{await c.query("SET LOCAL statement_timeout='15s'");const snapshot=(await c.query('SELECT padmin.export_snapshot($1,$2,$3) AS v',[a.accountId,id,request])).rows[0].v;
   if(!snapshot)throw apiError(422,'INVALID_STATE_TRANSITION');const body=JSON.stringify(snapshot),bytes=Buffer.byteLength(body);
   if(bytes>20*1024*1024)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
   const result=(await c.query('SELECT padmin.store_export($1,$2,$3,$4) AS v',[a.accountId,id,encrypt(this.settings.secretKey!,body),bytes])).rows[0].v;if(result!=='ok')throw apiError(422,'INVALID_STATE_TRANSITION');});return this.preview(a,id);
 }
 @Post('requests/:id/execute') @HttpCode(200) @Permission('data.manage') @StepUp()
 async execute(@Account()a:PlatformAccount,@RequestId()request:string,@Param('id')id:string,@Body()b:Record<string,unknown>={}){
  const v=new Validation(),note=v.text('note',b.note,{max:1000});if(typeof b.version!=='number'||!Number.isSafeInteger(b.version)||b.version<1)v.fail('version','field.required');v.done();
  const r=await this.one('SELECT padmin.execute_privacy($1,$2,$3,$4,$5) AS v',[a.accountId,identifier(id),b.version,note,request]);
  if(r==='self')throw apiError(403,'SELF_APPROVAL_FORBIDDEN');if(r==='conflict')throw apiError(409,'VERSION_CONFLICT');if(r!=='ok')throw apiError(422,'INVALID_STATE_TRANSITION');return this.preview(a,id);
 }
 @Post('holds') @HttpCode(200) @Permission('data.manage') @StepUp()
 async hold(@Account()a:PlatformAccount,@RequestId()request:string,@Body()b:Record<string,unknown>={}){const v=new Validation(),reason=v.text('reason',b.reason,{max:500});v.done();
  const r=await this.one('SELECT padmin.legal_hold($1,$2,$3,$4,$5) AS v',[a.accountId,identifier(String(b.organization_id)),b.release_id?identifier(String(b.release_id)):null,reason,request]);if(r!=='ok')throw apiError(422,'INVALID_STATE_TRANSITION');return {ok:true};}
 @Get('tombstones') @Permission('operations.manage') @StepUp()
 async tombstones(@Account()a:PlatformAccount,@Res()response:Response){const data=await this.one('SELECT padmin.tombstones($1) AS v',[a.accountId]);response.setHeader('Cache-Control','no-store');response.setHeader('Content-Disposition','attachment; filename="erasure-ledger.json"');response.json({format:'field-service-erasure-ledger-v1',exported_at:new Date().toISOString(),items:data});}
}
/** Downloads are bound to the requesting owner and expiry, rather than a publicly reusable URL. */
@Controller('me/exports') @UseGuards(SessionGuard)
export class ExportDownloadController {
 constructor(private readonly database:DatabaseService,@Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 @Get(':organizationId/:id')
 async download(@Session()s:SessionContext,@Param('organizationId')org:string,@Param('id')id:string,@Res()res:Response){identifier(org);identifier(id);if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
  const sealed=await this.database.identity(async c=>(await c.query('SELECT auth.download_export($1,$2,$3) AS v',[s.userId,org,id])).rows[0].v);if(!sealed)throw apiError(404,'RESOURCE_NOT_FOUND');
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="shop-export-${id}.json"`);res.send(decrypt(this.settings.secretKey,sealed));
 }
}
