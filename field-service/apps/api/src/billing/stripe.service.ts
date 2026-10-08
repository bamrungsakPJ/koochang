import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import Stripe from 'stripe';
import { PLATFORM_SETTINGS, type PlatformSettings } from '../config.js';
import { decrypt } from '../shared/crypto.js';
import { apiError, uuidPattern } from '../shared/api-error.js';
import { errorCodes, type ErrorCode } from '@field-service/core';

export interface StripeConfig { id: string; account_id: string; mode: 'test'|'live'; secret_sealed: string; webhook_sealed: string; card_enabled: boolean; qr_enabled: boolean }
export interface StripeAttempt { id: string; organization_id: string; invoice_id: string; credential_id: string; method: 'card'|'promptpay'; session_id: string|null;
  checkout_url: string|null; expires_at: string; amount_minor: number|string; status: string; number: string; error?: string;
  save_card?: boolean; autopay_saved?: boolean; customer_id?: string|null }

@Injectable()
export class StripeService implements OnModuleDestroy {
  private readonly pool = process.env.PAYMENT_DATABASE_URL ? new Pool({ connectionString: process.env.PAYMENT_DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 }) : undefined;
  constructor(@Inject(PLATFORM_SETTINGS) private readonly settings: PlatformSettings) {}
  async run<T>(operation: (client: PoolClient)=>Promise<T>):Promise<T> {
    if(!this.pool) throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const role=(await c.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if(role?.name!=='fs_worker'||role.rolsuper||role.rolbypassrls) throw apiError(503,'TEMPORARILY_UNAVAILABLE');
      const result=await operation(c);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async config(id?:string):Promise<StripeConfig|null> {
    return this.run(async c=>(await c.query('SELECT worker.stripe_config($1) AS value',[id??null])).rows[0].value);
  }
  client(key:string) { return new Stripe(key,{timeout:20_000,maxNetworkRetries:1}); }
  private credentials(config:StripeConfig) {
    if(!this.settings.secretKey) throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    return {key:decrypt(this.settings.secretKey,config.secret_sealed),webhook:decrypt(this.settings.secretKey,config.webhook_sealed)};
  }
  private base() {
    const raw=process.env.OWNER_WEB_URL;
    try {const url=new URL(raw!);if(url.protocol!=='https:'&&!( !this.settings.production&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error();return url;}
    catch{throw apiError(503,'TEMPORARILY_UNAVAILABLE');}
  }
  async methods():Promise<{stripe_card:boolean;stripe_qr:boolean;stripe_test:boolean}> {
    const off={stripe_card:false,stripe_qr:false,stripe_test:false};
    if(!this.pool||!this.settings.secretKey)return off;
    try {const c=await this.config();this.base();if(!c||(this.settings.production&&c.mode!=='live'))return off;
      return {stripe_card:c.card_enabled,stripe_qr:c.qr_enabled,stripe_test:c.mode==='test'};
    }catch{return off;}
  }
  /** `saveCard` (card only): the owner agreed to automatic renewal; the card is saved for off-session charges. */
  async checkout(user:string,org:string,invoice:string,method:'card'|'promptpay',requestKey:string,saveCard=false) {
    const available=await this.methods();
    if(!(method==='card'?available.stripe_card:available.stripe_qr)) throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const a:StripeAttempt=await this.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5,$6) AS value',[user,org,invoice,method,requestKey,saveCard])).rows[0].value);
    if(a.error)throw apiError(a.error==='RESOURCE_NOT_FOUND'?404:a.error==='TENANT_ACCESS_DENIED'?403:422,errorCodes.includes(a.error as ErrorCode)?a.error as ErrorCode:'INVALID_REQUEST');
    const config=await this.config(a.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    if(this.settings.production&&config.mode!=='live')throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const stripe=this.client(this.credentials(config).key);
    const target=this.base();target.search=new URLSearchParams({section:'invoice',id:invoice,organization_id:org}).toString();
    if(a.session_id){
      const result=await this.refresh(a.id);
      if(['expired','failed','manual_review'].includes(result.status))throw apiError(422,'INVALID_STATE_TRANSITION');
      if(result.status==='pending'&&!a.checkout_url)throw apiError(422,'PAYMENT_IN_PROGRESS');
      return {id:a.id,url:['paid','existing'].includes(result.status)?target.toString():a.checkout_url};
    }
    try {
      const session=await stripe.checkout.sessions.create({
        mode:'payment',allowed_payment_method_types:[method],client_reference_id:invoice,
        metadata:{attempt_id:a.id,invoice_id:invoice,organization_id:org,credential_id:config.id},
        payment_intent_data:{metadata:{invoice_id:invoice,organization_id:org,attempt_id:a.id},...(a.save_card?{setup_future_usage:'off_session' as const}:{})},
        ...(a.save_card?a.customer_id?{customer:a.customer_id}:{customer_creation:'always' as const}:{}),
        line_items:[{quantity:1,price_data:{currency:'thb',unit_amount:Number(a.amount_minor),product_data:{name:a.number}}}],
        success_url:target.toString(),cancel_url:target.toString(),locale:'auto',expires_at:Math.floor(Date.parse(a.expires_at)/1000),
      },{idempotencyKey:`checkout:${a.id}`});
      if(!session.url||new URL(session.url).origin!=='https://checkout.stripe.com')throw apiError(503,'TEMPORARILY_UNAVAILABLE');
      await this.run(c=>c.query('SELECT worker.attach_stripe($1,$2,$3,$4)',[a.id,session.id,session.url,new Date(session.expires_at*1000)]));
      return {id:a.id,url:session.url};
    }catch(e){
      if(e instanceof Stripe.errors.StripeInvalidRequestError)await this.run(c=>c.query("SELECT worker.finish_stripe($1,NULL,NULL,0,'thb','failed','PROVIDER_ERROR')",[a.id]));
      throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    }
  }
  async refresh(id:string) {
    const a:StripeAttempt|null=await this.run(async c=>(await c.query('SELECT worker.stripe_attempt($1) AS value',[id])).rows[0].value);
    if(!a)throw apiError(404,'RESOURCE_NOT_FOUND');
    if(!a.session_id)return {status:a.status};
    const config=await this.config(a.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const session=await this.client(this.credentials(config).key).checkout.sessions.retrieve(a.session_id);
    return this.fulfill(a,config,session);
  }
  private async fulfill(a:StripeAttempt,config:StripeConfig,s:Stripe.Checkout.Session) {
    if(s.metadata?.attempt_id!==a.id||s.metadata.invoice_id!==a.invoice_id||s.metadata.organization_id!==a.organization_id||s.metadata.credential_id!==config.id||
      s.client_reference_id!==a.invoice_id||s.livemode!==(config.mode==='live')||s.mode!=='payment')throw apiError(400,'VALIDATION_ERROR');
    // A test payment must never activate a production entitlement, including callbacks for old keys.
    if(this.settings.production&&!s.livemode)throw apiError(400,'VALIDATION_ERROR');
    const intent=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id??null;
    const status=s.payment_status==='paid'?'paid':s.status==='expired'?'expired':'pending';
    const outcome=await this.run(async c=>(await c.query('SELECT worker.finish_stripe($1,$2,$3,$4,$5,$6,NULL) AS value',
      [a.id,s.id,intent,s.amount_total,s.currency,status])).rows[0].value);
    if(a.save_card&&!a.autopay_saved&&intent&&['paid','existing'].includes(outcome))await this.saveCard(a,config,s,intent);
    return {status:outcome};
  }
  /** Card from the paid PaymentIntent, retrieved from Stripe. A failure throws so the signed webhook is retried. */
  private async saveCard(a:StripeAttempt,config:StripeConfig,s:Stripe.Checkout.Session,intentId:string) {
    const customer=typeof s.customer==='string'?s.customer:s.customer?.id;
    const intent=await this.client(this.credentials(config).key).paymentIntents.retrieve(intentId,{expand:['payment_method']});
    const pm=intent.payment_method;
    if(!customer||intent.metadata?.attempt_id!==a.id||!pm||typeof pm==='string'||!pm.card)return;
    await this.run(c=>c.query('SELECT worker.save_autopay($1,$2,$3,$4,$5,$6,$7)',[a.id,customer,pm.id,pm.card!.brand,pm.card!.last4,pm.card!.exp_month,pm.card!.exp_year]));
  }
  async cancel(id:string) {
    const a:StripeAttempt|null=await this.run(async c=>(await c.query('SELECT worker.stripe_attempt($1) AS value',[id])).rows[0].value);
    if(!a?.session_id)throw apiError(422,'PAYMENT_IN_PROGRESS');
    const config=await this.config(a.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const stripe=this.client(this.credentials(config).key),current=await stripe.checkout.sessions.retrieve(a.session_id);
    if(current.payment_status==='paid')return this.fulfill(a,config,current);
    const expired=current.status==='expired'?current:await stripe.checkout.sessions.expire(a.session_id);
    return this.fulfill(a,config,expired);
  }
  async webhook(credentialId:string,body:Buffer,signature:string) {
    const config=await this.config(credentialId);if(!config)throw apiError(400,'VALIDATION_ERROR');
    if(this.settings.production&&config.mode!=='live')throw apiError(400,'VALIDATION_ERROR');
    const credentials=this.credentials(config),stripe=this.client(credentials.key);
    let event:Stripe.Event;
    try{event=stripe.webhooks.constructEvent(body,signature,credentials.webhook,300);}catch{throw apiError(400,'VALIDATION_ERROR');}
    if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))return {received:true};
    const s=event.data.object as Stripe.Checkout.Session;
    if(s.metadata?.credential_id!==credentialId)return {received:true};
    const id=s.metadata?.attempt_id;if(!id||!uuidPattern.test(id))return {received:true};
    const a:StripeAttempt|null=await this.run(async c=>(await c.query('SELECT worker.stripe_attempt($1) AS value',[id])).rows[0].value);
    if(!a||a.credential_id!==credentialId)return {received:true};
    if(a.session_id&&a.session_id!==s.id)throw apiError(400,'VALIDATION_ERROR');
    // Recover the creation/attach crash window using a session signed by this credential's endpoint.
    if(!a.session_id){await this.run(c=>c.query('SELECT worker.attach_stripe($1,$2,$3,$4)',[a.id,s.id,s.url??null,new Date(s.expires_at*1000)]));a.session_id=s.id;}
    const result=await this.refresh(a.id); // Retrieve the canonical session from Stripe, never trust redirect/body alone.
    if(event.type==='checkout.session.async_payment_failed'&&result.status==='pending') {
      await this.run(c=>c.query("SELECT worker.finish_stripe($1,$2,NULL,0,'thb','failed','PAYMENT_FAILED')",[a.id,a.session_id]));
    }
    return {received:true};
  }
  async onModuleDestroy(){await this.pool?.end();}
}
