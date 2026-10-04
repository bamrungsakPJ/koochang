import { Body, Controller, Get, HttpCode, Inject, Optional, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { encrypt, decrypt } from '../shared/crypto.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { RequestId } from '../auth/session.guard.js';
import { StripeService } from '../billing/stripe.service.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { RuntimeSettingsService } from './runtime-settings.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';

@Controller('platform/payment-settings') @UseGuards(PlatformGuard)
export class PaymentSettingsController {
 constructor(private readonly database:PlatformDatabaseService,private readonly stripe:StripeService,
   @Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings,@Optional()private readonly runtime?:RuntimeSettingsService){}
 @Get() @Permission('payments.manage')
 async get(@Account()a:PlatformAccount){
   const result=await this.database.run(async c=>(await c.query('SELECT padmin.stripe_settings($1) AS value',[a.accountId])).rows[0].value);
   const nextId=randomUUID();
   return {...result,webhook_path:result.credential_id?`/v1/billing/stripe/webhook/${result.credential_id}`:null,
     next_credential_id:nextId,next_webhook_path:`/v1/billing/stripe/webhook/${nextId}`,
     server_ready:Boolean(this.settings.secretKey&&process.env.PAYMENT_DATABASE_URL&&process.env.OWNER_WEB_URL),
     transfer_configured:Boolean(this.runtime?await this.runtime.bank():this.settings.payment)};
 }
 @Post() @HttpCode(200) @Permission('payments.manage') @StepUp()
 async save(@Account()a:PlatformAccount,@RequestId()requestId:string,@Body()body:Record<string,unknown>={}){
   const check=new Validation();
   const version=typeof body.version==='number'&&Number.isSafeInteger(body.version)&&body.version>=0?body.version:(check.fail('version','field.required'),0);
   if(typeof body.card_enabled!=='boolean')check.fail('card_enabled','field.required');
   if(typeof body.qr_enabled!=='boolean')check.fail('qr_enabled','field.required');
   const key=typeof body.secret_key==='string'?body.secret_key.trim():'';
   const webhook=typeof body.webhook_secret==='string'?body.webhook_secret.trim():'';
   if(key&&!/^sk_(test|live)_[A-Za-z0-9]{8,}$/.test(key))check.fail('secret_key','field.required');
   if(webhook&&!/^whsec_[A-Za-z0-9]{8,}$/.test(webhook))check.fail('webhook_secret','field.required');
   if((key||webhook)&&(!key||!webhook))check.fail(!key?'secret_key':'webhook_secret','field.required');
   if(key.length>500||webhook.length>500)check.fail('secret_key','field.tooLong');
   if((key||webhook)&&!(typeof body.credential_id==='string'&&uuidPattern.test(body.credential_id)))check.fail('credential_id','field.required');
   check.done();
   if(!this.settings.secretKey)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
   const old=await this.stripe.config();
   if(!old&&(!key||!webhook))throw apiError(400,'VALIDATION_ERROR');
   const secret=key||(old?decrypt(this.settings.secretKey,old.secret_sealed):'');
   const webhookSecret=webhook||(old?decrypt(this.settings.secretKey,old.webhook_sealed):'');
   let account;
   try{account=await this.stripe.client(secret).accounts.retrieve(null);}catch{throw apiError(400,'VALIDATION_ERROR');}
   const mode=secret.startsWith('sk_live_')?'live':'test';
   if(body.qr_enabled&&account.country!=='TH')throw apiError(400,'VALIDATION_ERROR',{field_errors:{qr_enabled:'stripe.thaiAccountRequired'}});
   if((body.card_enabled||body.qr_enabled)&&mode==='live'&&!account.charges_enabled)throw apiError(422,'TEMPORARILY_UNAVAILABLE');
   const changed=Boolean(key||webhook),id=changed||!old?body.credential_id as string:old.id;
   const outcome=await this.database.run(async c=>(await c.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',
     [a.accountId,id,account.id,mode,changed||!old?encrypt(this.settings.secretKey!,secret):null,
       changed||!old?encrypt(this.settings.secretKey!,webhookSecret):null,body.card_enabled,body.qr_enabled,version,requestId])).rows[0].value);
   if(outcome!=='ok')throw apiError(409,'VERSION_CONFLICT');
   return this.get(a);
 }
}
