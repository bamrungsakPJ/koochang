import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RequestId } from '../auth/session.guard.js';
import { apiError, Validation } from '../shared/api-error.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';
import { hashPassword, verifyPassword } from './secrets.js';
@Controller('platform/account') @UseGuards(PlatformGuard)
export class AccountSettingsController {
 constructor(private readonly database:PlatformDatabaseService){}
 @Get()
 get(@Account()a:PlatformAccount){return this.database.run(async c=>({
   profile:(await c.query('SELECT padmin.account_profile($1,$2) AS value',[a.accountId,a.tokenHash])).rows[0].value,
   sessions:(await c.query('SELECT padmin.account_sessions($1,$2) AS value',[a.accountId,a.tokenHash])).rows[0].value,
 }));}
 @Post('profile') @HttpCode(200)
 async profile(@Account()a:PlatformAccount,@RequestId()requestId:string,@Body()body:Record<string,unknown>={}){
   const check=new Validation(),name=check.text('display_name',body.display_name,{max:100});
   if(!['th','en'].includes(body.preferred_language as string))check.fail('preferred_language','field.required');
   if(!Number.isSafeInteger(body.version)||Number(body.version)<1)check.fail('version','field.required');check.done();
   const result=await this.database.run(async c=>(await c.query('SELECT padmin.update_profile($1,$2,$3,$4,$5,$6) AS value',[a.accountId,a.tokenHash,name,body.preferred_language,body.version,requestId])).rows[0].value);
   if(result!=='ok')throw apiError(409,'VERSION_CONFLICT');return this.get(a);
 }
 @Post('password') @HttpCode(200) @StepUp()
 async password(@Account()a:PlatformAccount,@RequestId()requestId:string,@Body()body:Record<string,unknown>={}){
   const check=new Validation();
   const old=typeof body.current_password==='string'&&body.current_password.length<=200?body.current_password:'';
   const next=typeof body.new_password==='string'?body.new_password:'';
   if(!old)check.fail('current_password','field.required');
   if(next.length<12||next.length>200||next===old)check.fail('new_password','field.required');check.done();
   const profile=await this.database.run(async c=>{
     await c.query('SELECT padmin.account_profile($1,$2)',[a.accountId,a.tokenHash]);
     return (await c.query('SELECT * FROM padmin.login_account($1)',[a.email])).rows[0];
   });
   if(profile?.locked_until&&new Date(profile.locked_until)>new Date())throw apiError(429,'RATE_LIMITED');
   if(!await verifyPassword(old,profile?.password_hash)){
     await this.database.run(c=>c.query('SELECT padmin.record_login_failure($1)',[a.accountId]));
     throw apiError(400,'LOGIN_FAILED');
   }
   const result=await this.database.run(async c=>(await c.query('SELECT padmin.change_password($1,$2,$3,$4,$5) AS value',[a.accountId,a.tokenHash,profile.password_hash,await hashPassword(next),requestId])).rows[0].value);
   if(result!=='ok')throw apiError(409,'VERSION_CONFLICT');return this.get(a);
 }
 @Post('logout-others') @HttpCode(200) @StepUp()
 async logoutOthers(@Account()a:PlatformAccount,@RequestId()requestId:string){
   await this.database.run(c=>c.query('SELECT padmin.revoke_other_sessions($1,$2,$3)',[a.accountId,a.tokenHash,requestId]));return this.get(a);
 }
}
