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
     ocr:value.ocr??{enabled:process.env.OCR_PROVIDER==='claude'&&Boolean(process.env.ANTHROPIC_API_KEY),model:process.env.OCR_CLAUDE_MODEL||'claude-haiku-4-5-20251001',key_configured:Boolean(process.env.ANTHROPIC_API_KEY)},
     itisme:value.itisme??{enabled:false,server:'localhost',port:1433,database:'ITISME',user:'koochang_billing',key_configured:false},
     ocr_worker_ready:Boolean(process.env.WORKER_DATABASE_URL&&this.settings.secretKey),
     server_ready:Boolean(this.settings.secretKey),slip_worker_ready:Boolean(process.env.SLIP_DATABASE_URL)};
 }
 @Post() @HttpCode(200) @Permission('settings.manage') @StepUp()
 async save(@Account()a:PlatformAccount,@RequestId()requestId:string,@Body()body:Record<string,unknown>={}){
   const check=new Validation();
   const version=typeof body.version==='number'&&Number.isSafeInteger(body.version)&&body.version>=0?body.version:(check.fail('version','field.required'),0);
   const section=body.section as string;
   if(!['bank','sms','easyslip','ocr','itisme'].includes(section))check.fail('section','field.required');
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
   }else if(section==='itisme'){
     // SQL Server of the company documents (ใบเสร็จ/ใบกำกับภาษี). The login may only run the sp_KC_* procedures.
     value.server=check.text('server',body.server,{required:true,max:100});
     if(value.server&&!/^[A-Za-z0-9.-]+$/.test(String(value.server)))check.fail('server','field.required');
     const port=typeof body.port==='number'?body.port:Number(body.port);
     if(!Number.isInteger(port)||port<1||port>65535)check.fail('port','field.required');else value.port=port;
     value.database=check.text('database',body.database,{required:true,max:128});
     if(value.database&&!/^[A-Za-z0-9_]+$/.test(String(value.database)))check.fail('database','field.required');
     value.user=check.text('user',body.user,{required:true,max:128});
     const seller=(body.seller&&typeof body.seller==='object'?body.seller:{}) as Record<string,unknown>,out:Record<string,string>={};
     for(const [k,max] of [['name_th',300],['name_en',300],['tax_id',13],['branch_no',5],['address_th',500],['address_en',500],['phone',60]] as const){
       const x=check.text(`seller.${k}`,seller[k],{required:false,max});if(x)out[k]=x;}
     if(out.tax_id&&!/^\d{13}$/.test(out.tax_id))check.fail('seller.tax_id','field.taxId');
     if(out.branch_no&&!/^\d{5}$/.test(out.branch_no))check.fail('seller.branch_no','field.branchNo');
     value.seller=out;
     // Header logo: PNG or JPEG as base64, at most 300 KB. Empty string removes it; absent keeps the saved one.
     if(typeof body.logo==='string'){
       const data=body.logo.replace(/^data:image\/(png|jpeg);base64,/,'');
       if(data){const bytes=Buffer.from(data,'base64');
         const png=bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),jpeg=bytes[0]===0xff&&bytes[1]===0xd8;
         if(!(png||jpeg)||bytes.length>300_000)check.fail('logo','field.image');else value.logo=bytes.toString('base64');}
       else value.logo='';
     }
     const password=check.text('password',body.password,{required:false,max:200});
     if(password){if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');value.passwordSealed=encrypt(this.settings.secretKey,password);}
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
   if(body.enabled&&section==='itisme'&&!(value.passwordSealed||old?.itisme?.passwordSealed))throw apiError(400,'VALIDATION_ERROR',{field_errors:{password:'field.required'}});
   if(body.enabled&&section==='easyslip'&&!(value.keySealed||old?.easyslip?.keySealed))throw apiError(400,'VALIDATION_ERROR',{field_errors:{api_key:'field.required'}});
   const result=await this.database.run(async c=>(await c.query('SELECT padmin.save_console_settings($1,$2,$3::jsonb,$4,$5) AS value',[a.accountId,section,JSON.stringify(value),version,requestId])).rows[0].value);
   if(result!=='ok')throw apiError(409,'VERSION_CONFLICT');
   return this.get(a);
 }
}
