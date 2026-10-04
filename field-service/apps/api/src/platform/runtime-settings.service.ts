import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { decrypt } from '../shared/crypto.js';
import { createSmsSender, SmsSender } from '../sms/sms.sender.js';
export interface RuntimeSettings {
 version:number;
 policy?:{new_shops_enabled:boolean;new_payments_enabled:boolean;business_retention_days?:number|null;deletion_cooling_days?:number|null}|null;
 bank?: {enabled:boolean;bankName:string;accountName:string;accountNumber:string;bankCode?:string;promptPayId?:string};
 sms?: {enabled:boolean;sender:string;apiKeySealed?:string;secretKeySealed?:string};
 easyslip?: {enabled:boolean;keySealed?:string};
}
@Injectable()
export class RuntimeSettingsService {
 constructor(private readonly database:PlatformDatabaseService,@Inject(PLATFORM_SETTINGS)private readonly settings:PlatformSettings){}
 async read():Promise<RuntimeSettings|null> {
   if(!this.database.configured)return null;
   return this.database.run(async c=>(await c.query('SELECT padmin.runtime_settings() AS value')).rows[0].value);
 }
 async bank():Promise<PlatformSettings['payment']>{
   const row=await this.read();
   if(!row?.bank)return this.settings.payment;
   if(!row.bank.enabled)return undefined;
   const {enabled:_,...bank}=row.bank;return bank;
 }
 open(value:string|undefined){return value&&this.settings.secretKey?decrypt(this.settings.secretKey,value):undefined;}
 async sms():Promise<SmsSender|null>{
   const row=await this.read();
   if(!row?.sms)return createSmsSender();
   if(!row.sms.enabled)return null;
   return createSmsSender({NODE_ENV:process.env.NODE_ENV,SMS_PROVIDER:'deesmsx',DEESMSX_API_KEY:this.open(row.sms.apiKeySealed),
     DEESMSX_SECRET_KEY:this.open(row.sms.secretKeySealed),DEESMSX_SENDER:row.sms.sender});
 }
 async slipKey():Promise<string|undefined>{
   const row=await this.read();
   if(!row?.easyslip)return process.env.EASYSLIP_API_KEY;
   return row.easyslip.enabled?this.open(row.easyslip.keySealed):undefined;
 }
}
export class RuntimeSmsSender extends SmsSender {
 readonly delivery='sms' as const;
 constructor(private readonly runtime:RuntimeSettingsService){super();}
 override resolve(){return this.runtime.sms();}
 async send(phone:string,message:string){const sender=await this.resolve();if(!sender)throw Error('SMS_UNAVAILABLE');await sender.send(phone,message);}
}
