import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { RequestId } from '../auth/session.guard.js';
import { apiError, Validation } from '../shared/api-error.js';
import { encrypt } from '../shared/crypto.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { RuntimeSettingsService } from './runtime-settings.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';
@Controller('platform/settings') @UseGuards(PlatformGuard)
export class ConsoleSettingsController {
 constructor(private readonly database:PlatformDatabaseService,private readonly runtime:RuntimeSettingsService,
   @Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 @Get() @Permission('settings.manage')
 async get(@Account()a:PlatformAccount){
   const value=await this.database.run(async c=>(await c.query('SELECT padmin.console_settings($1) AS value',[a.accountId])).rows[0].value);
   return {...value,bank:value.bank??(this.settings.payment?{...this.settings.payment,enabled:true}:null),
     sms:value.sms??{enabled:process.env.SMS_PROVIDER==='deesmsx',sender:process.env.DEESMSX_SENDER??'',key_configured:Boolean(process.env.DEESMSX_API_KEY&&process.env.DEESMSX_SECRET_KEY)},
     easyslip:value.easyslip??{enabled:Boolean(process.env.EASYSLIP_API_KEY),key_configured:Boolean(process.env.EASYSLIP_API_KEY)},
     ocr:value.ocr??{enabled:process.env.OCR_PROVIDER==='claude'&&Boolean(process.env.ANTHROPIC_API_KEY),model:process.env.OCR_CLAUDE_MODEL||'claude-opus-5',key_configured:Boolean(process.env.ANTHROPIC_API_KEY)},
     ocr_worker_ready:Boolean(process.env.WORKER_DATABASE_URL&&this.settings.secretKey),
     server_ready:Boolean(this.settings.secretKey),slip_worker_ready:Boolean(process.env.SLIP_DATABASE_URL)};
 }
 @Post() @HttpCode(200) @Permission('settings.manage') @StepUp()
 async save(@Account()a:PlatformAccount,@RequestId()requestId:string,@Body()body:Record<string,unknown>={}){
   const check=new Validation();
   const version=typeof body.version==='number'&&Number.isSafeInteger(body.version)&&body.version>=0?body.version:(check.fail('version','field.required'),0);
   const section=body.section as string;
   if(!['bank','sms','easyslip','ocr'].includes(section))check.fail('section','field.required');
   if(typeof body.enabled!=='boolean')check.fail('enabled','field.required');
   const value:Record<string,unknown>={enabled:body.enabled};
   if(section==='bank'){
     for(const name of ['bankName','accountName','accountNumber'])value[name]=check.text(name,body[name],{required:body.enabled===true,max:150})??'';
     value.bankCode=check.text('bankCode',body.bankCode,{required:body.enabled===true,max:3})??'';
     value.promptPayId=check.text('promptPayId',body.promptPayId,{required:false,max:20})??'';
     if(body.enabled&&(!/^\d{3}$/.test(value.bankCode as string)||!/^\d[\d -]{4,29}$/.test(value.accountNumber as string)))check.fail('accountNumber','field.required');
     if(value.promptPayId&&!/^\d[\d -]{8,18}$/.test(value.promptPayId as string))check.fail('promptPayId','field.required');
   }else if(section==='sms'){
     value.sender=check.text('sender',body.sender,{required:body.enabled===true,max:100})??'';
     const apiKey=check.text('api_key',body.api_key,{required:false,max:500});
     const secret=check.text('secret_key',body.secret_key,{required:false,max:500});
     if(Boolean(apiKey)!==Boolean(secret))check.fail(!apiKey?'api_key':'secret_key','field.required');
     if(apiKey&&secret){if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
       value.apiKeySealed=encrypt(this.settings.secretKey,apiKey);value.secretKeySealed=encrypt(this.settings.secretKey,secret);}
   }else if(section==='easyslip'||section==='ocr'){
     if(section==='ocr'){value.model=check.text('model',body.model,{required:true,max:100});if(!/^claude-[a-z0-9.-]+$/.test(String(value.model)))check.fail('model','field.required');}
     const key=check.text('api_key',body.api_key,{required:false,max:500});
     if(key){if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');value.keySealed=encrypt(this.settings.secretKey,key);}
   }
   check.done();
   const old=await this.runtime.read();
   // Copy environment credentials once when keeping existing keys; explicit disabled rows override env.
   if(section==='sms'&&!value.apiKeySealed&&!old?.sms){
     if(this.settings.secretKey&&process.env.DEESMSX_API_KEY&&process.env.DEESMSX_SECRET_KEY){
       value.apiKeySealed=encrypt(this.settings.secretKey,process.env.DEESMSX_API_KEY);value.secretKeySealed=encrypt(this.settings.secretKey,process.env.DEESMSX_SECRET_KEY);}
   }
   if(section==='easyslip'&&!value.keySealed&&!old?.easyslip&&this.settings.secretKey&&process.env.EASYSLIP_API_KEY)value.keySealed=encrypt(this.settings.secretKey,process.env.EASYSLIP_API_KEY);
   if(section==='ocr'&&!value.keySealed&&!old?.ocr&&this.settings.secretKey&&process.env.ANTHROPIC_API_KEY)value.keySealed=encrypt(this.settings.secretKey,process.env.ANTHROPIC_API_KEY);
   if(body.enabled&&section==='ocr'&&!(value.keySealed||old?.ocr?.keySealed))throw apiError(400,'VALIDATION_ERROR',{field_errors:{api_key:'field.required'}});
   if(body.enabled&&section==='sms'&&!(value.apiKeySealed||old?.sms?.apiKeySealed))throw apiError(400,'VALIDATION_ERROR',{field_errors:{api_key:'field.required'}});
   if(body.enabled&&section==='easyslip'&&!(value.keySealed||old?.easyslip?.keySealed))throw apiError(400,'VALIDATION_ERROR',{field_errors:{api_key:'field.required'}});
   const result=await this.database.run(async c=>(await c.query('SELECT padmin.save_console_settings($1,$2,$3::jsonb,$4,$5) AS value',[a.accountId,section,JSON.stringify(value),version,requestId])).rows[0].value);
   if(result!=='ok')throw apiError(409,'VERSION_CONFLICT');
   return this.get(a);
 }
}
