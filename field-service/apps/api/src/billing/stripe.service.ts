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
  mode?: 'payment'|'subscription'; interval_unit?: 'month'|'year'; plan_name?: string; first_charge_at?: string|null; customer_id?: string|null }
const subscriptionEvents=['invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'];
const seconds=(value?:number|null)=>value?new Date(value*1000):null;

@Injectable()
export class StripeService implements OnModuleDestroy {
  protected pool = process.env.PAYMENT_DATABASE_URL ? new Pool({ connectionString: process.env.PAYMENT_DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 }) : undefined;
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
  /** Where Stripe sends the owner back: the /shop page, on the web origin they started from when it is one
   * of ADMIN_ORIGIN (sign-in lives per origin), otherwise OWNER_WEB_URL. A bare OWNER_WEB_URL host means /shop. */
  private base(origin?:string) {
    const raw=process.env.OWNER_WEB_URL;
    const allowed=(u:URL)=>u.protocol==='https:'||(!this.settings.production&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));
    try {
      const url=new URL(raw!);if(!allowed(url))throw Error();
      const from=origin&&(process.env.ADMIN_ORIGIN??'').split(',').map(o=>o.trim()).includes(origin)?new URL(origin):null;
      if(from&&allowed(from)){url.protocol=from.protocol;url.host=from.host;}
      if(url.pathname==='/')url.pathname='/shop';
      return url;
    }
    catch{throw apiError(503,'TEMPORARILY_UNAVAILABLE');}
  }
  /** Paying from the mobile app: Stripe returns to a page on our site that hands the owner back to the app
   * (the phone browser has no sign-in). The app refreshes the invoice when it comes to the front. */
  private appReturn(kind:'payment'|'card') {const url=this.base();url.pathname='/pay-return';url.search=new URLSearchParams({to:'app',kind}).toString();return url;}
  async methods():Promise<{stripe_card:boolean;stripe_qr:boolean;stripe_test:boolean}> {
    const off={stripe_card:false,stripe_qr:false,stripe_test:false};
    if(!this.pool||!this.settings.secretKey)return off;
    try {const c=await this.config();this.base();if(!c||(this.settings.production&&c.mode!=='live'))return off;
      return {stripe_card:c.card_enabled,stripe_qr:c.qr_enabled,stripe_test:c.mode==='test'};
    }catch{return off;}
  }
  /** Worker use: the same service on the worker's own fs_worker pool. */
  static forPool(settings:PlatformSettings,pool:Pool){const s=new StripeService(settings);void s.pool?.end();s.pool=pool;return s;}
  /** `subscribe` (card only): Stripe Subscription for automatic renewal instead of a one-time payment. */
  async checkout(user:string,org:string,invoice:string,method:'card'|'promptpay',requestKey:string,subscribe=false,origin?:string,app=false) {
    const available=await this.methods();
    if(!(method==='card'?available.stripe_card:available.stripe_qr)) throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const a:StripeAttempt=await this.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5,$6) AS value',[user,org,invoice,method,requestKey,subscribe])).rows[0].value);
    if(a.error)throw apiError(a.error==='RESOURCE_NOT_FOUND'?404:a.error==='TENANT_ACCESS_DENIED'?403:422,errorCodes.includes(a.error as ErrorCode)?a.error as ErrorCode:'INVALID_REQUEST');
    const config=await this.config(a.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    if(this.settings.production&&config.mode!=='live')throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const stripe=this.client(this.credentials(config).key);
    const target=app?this.appReturn('payment'):this.base(origin);if(!app)target.search=new URLSearchParams({section:'invoice',id:invoice,organization_id:org}).toString();
    if(a.session_id){
      const result=await this.refresh(a.id);
      if(['expired','failed','manual_review'].includes(result.status))throw apiError(422,'INVALID_STATE_TRANSITION');
      if(result.status==='pending'&&!a.checkout_url)throw apiError(422,'PAYMENT_IN_PROGRESS');
      return {id:a.id,url:['paid','existing','subscribed'].includes(result.status)?target.toString():a.checkout_url};
    }
    try {
      const metadata={attempt_id:a.id,invoice_id:invoice,organization_id:org,credential_id:config.id};
      const common={allowed_payment_method_types:[method],client_reference_id:invoice,metadata,
        success_url:target.toString(),cancel_url:target.toString(),locale:'auto' as const,expires_at:Math.floor(Date.parse(a.expires_at)/1000)};
      // Stripe keeps the card and charges each period; the first charge waits for time the shop already has.
      const session=await stripe.checkout.sessions.create(a.mode==='subscription'?{...common,mode:'subscription',
        ...(a.customer_id?{customer:a.customer_id}:{}),
        line_items:[{quantity:1,price_data:{currency:'thb',unit_amount:Number(a.amount_minor),recurring:{interval:a.interval_unit==='year'?'year':'month'},
          product_data:{name:`KooChang ${a.plan_name??''}`.trim()}}}],
        subscription_data:{metadata,...(a.first_charge_at?{trial_end:Math.floor(Date.parse(a.first_charge_at)/1000)}:{})},
      }:{...common,mode:'payment',
        payment_intent_data:{metadata:{invoice_id:invoice,organization_id:org,attempt_id:a.id}},
        line_items:[{quantity:1,price_data:{currency:'thb',unit_amount:Number(a.amount_minor),product_data:{name:a.number}}}],
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
      s.client_reference_id!==a.invoice_id||s.livemode!==(config.mode==='live')||s.mode!==(a.mode??'payment'))throw apiError(400,'VALIDATION_ERROR');
    // A test payment must never activate a production entitlement, including callbacks for old keys.
    if(this.settings.production&&!s.livemode)throw apiError(400,'VALIDATION_ERROR');
    if(s.mode==='subscription'){
      if(s.status==='expired')
        return {status:await this.run(async c=>(await c.query("SELECT worker.finish_stripe($1,$2,NULL,0,'thb','expired',NULL) AS value",[a.id,s.id])).rows[0].value)};
      if(s.status!=='complete'||!s.subscription)return {status:'pending'};
      await this.syncSubscription(config,typeof s.subscription==='string'?s.subscription:s.subscription.id,a.id);
      return {status:'subscribed'};
    }
    const intent=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id??null;
    const status=s.payment_status==='paid'?'paid':s.status==='expired'?'expired':'pending';
    const outcome=await this.run(async c=>(await c.query('SELECT worker.finish_stripe($1,$2,$3,$4,$5,$6,NULL) AS value',
      [a.id,s.id,intent,s.amount_total,s.currency,status])).rows[0].value);
    return {status:outcome};
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
  /** Canonical subscription from Stripe: attach it to its checkout, store its status, and apply the
   * latest invoice when paid (covers a missed invoice webhook). Returns our subscription row id. */
  private async syncSubscription(config:StripeConfig,subscriptionId:string,attemptId?:string):Promise<string> {
    const stripe=this.client(this.credentials(config).key);
    const sub=await stripe.subscriptions.retrieve(subscriptionId,{expand:['latest_invoice']});
    const id=sub.metadata?.attempt_id;
    if(!id||!uuidPattern.test(id)||(attemptId&&id!==attemptId)||sub.metadata.credential_id!==config.id||sub.livemode!==(config.mode==='live')||(this.settings.production&&!sub.livemode))
      throw apiError(400,'VALIDATION_ERROR');
    const a:StripeAttempt|null=await this.run(async c=>(await c.query('SELECT worker.stripe_attempt($1) AS value',[id])).rows[0].value);
    if(!a||a.mode!=='subscription'||a.credential_id!==config.id||a.organization_id!==sub.metadata.organization_id)throw apiError(400,'VALIDATION_ERROR');
    const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id,end=seconds(sub.items.data[0]?.current_period_end);
    const row:string=await this.run(async c=>{
      const r=(await c.query('SELECT worker.attach_subscription($1,$2,$3,$4,$5,$6) AS id',[a.id,sub.id,customer,sub.status,sub.cancel_at_period_end,end])).rows[0].id;
      await c.query('SELECT worker.sync_subscription($1,$2,$3,$4)',[sub.id,sub.status,sub.cancel_at_period_end,end]);return r;});
    const invoice=sub.latest_invoice;
    if(invoice&&typeof invoice!=='string')await this.applyInvoice(row,invoice);
    return row;
  }
  private async applyInvoice(row:string,invoice:Stripe.Invoice) {
    if(invoice.status!=='paid'||!invoice.id||invoice.amount_paid<=0)return;
    const end=seconds(invoice.lines?.data[0]?.period?.end);
    await this.run(c=>c.query('SELECT worker.apply_subscription_invoice($1,$2,$3,$4,$5)',[row,invoice.id,invoice.amount_paid,invoice.currency,end]));
  }
  private async subscriptionEvent(config:StripeConfig,event:Stripe.Event) {
    if(event.type.startsWith('customer.subscription.')){
      const sub=event.data.object as Stripe.Subscription;
      if(sub.metadata?.credential_id!==config.id)return;
      await this.syncSubscription(config,sub.id);return;
    }
    const body=event.data.object as Stripe.Invoice;
    if(!body.id)return;
    // Retrieve the canonical invoice; the event body alone is never trusted.
    const invoice=await this.client(this.credentials(config).key).invoices.retrieve(body.id);
    const parent=invoice.parent?.subscription_details,sub=parent?.subscription;
    if(!sub||parent?.metadata?.credential_id!==config.id)return;
    const row=await this.syncSubscription(config,typeof sub==='string'?sub:sub.id);
    if(event.type==='invoice.paid')await this.applyInvoice(row,invoice);
    else await this.run(c=>c.query('SELECT worker.subscription_payment_failed($1,$2)',[row,invoice.id]));
  }

  /** Owner turns automatic renewal off now; the period already paid is kept, nothing is refunded. */
  async cancelSubscription(user:string,org:string) {
    const info=await this.ownerSubscription(user,org);
    if(!info?.live)throw apiError(404,'RESOURCE_NOT_FOUND');
    const config=await this.config(info.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    await this.run(c=>c.query('SELECT worker.owner_canceled_subscription($1,$2,$3)',[user,org,info.subscription_id]));
    const sub=await this.client(this.credentials(config).key).subscriptions.cancel(info.subscription_id,{invoice_now:false,prorate:false});
    await this.run(c=>c.query('SELECT worker.sync_subscription($1,$2,$3,$4)',[sub.id,sub.status,sub.cancel_at_period_end,seconds(sub.items?.data[0]?.current_period_end)]));
  }
  /** Stripe's customer portal: the owner changes the card or downloads receipts at Stripe. */
  async portal(user:string,org:string,origin?:string,app=false) {
    const info=await this.ownerSubscription(user,org);
    if(!info)throw apiError(404,'RESOURCE_NOT_FOUND');
    const config=await this.config(info.credential_id);if(!config)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const back=app?this.appReturn('card'):this.base(origin);if(!app)back.search=new URLSearchParams({section:'billing',organization_id:org}).toString();
    const session=await this.client(this.credentials(config).key).billingPortal.sessions.create({customer:info.customer_id,return_url:back.toString(),locale:'auto'});
    if(new URL(session.url).origin!=='https://billing.stripe.com')throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    return {url:session.url};
  }
  private async ownerSubscription(user:string,org:string):Promise<{subscription_id:string;customer_id:string;credential_id:string;live:boolean}|null> {
    return this.run(async c=>(await c.query('SELECT worker.owner_subscription($1,$2) AS v',[user,org])).rows[0]?.v??null);
  }
  /** Copies our "stop renewal" flag (owner, privacy erasure) to live Stripe subscriptions. */
  async pushRenewalFlags(org?:string):Promise<number> {
    const rows:{subscription_id:string;credential_id:string;cancel_at_period_end:boolean}[]=(await this.run(async c=>(await c.query('SELECT worker.subscription_flags_to_push($1) AS v',[org??null])).rows)).map(r=>r.v);
    for(const r of rows){
      const config=await this.config(r.credential_id);if(!config)continue;
      const sub=await this.client(this.credentials(config).key).subscriptions.update(r.subscription_id,{cancel_at_period_end:r.cancel_at_period_end});
      await this.run(c=>c.query('SELECT worker.sync_subscription($1,$2,$3,$4)',[sub.id,sub.status,sub.cancel_at_period_end,seconds(sub.items?.data[0]?.current_period_end)]));
    }
    return rows.length;
  }
  /** Plan changes that reached a card subscription: Stripe charges the new price from the next
   * period, without proration. The product stays the same. */
  async pushPrices():Promise<number> {
    const rows:{subscription_id:string;credential_id:string;price_version_id:string;amount_minor:number|string;interval_unit:'month'|'year'}[]=
      (await this.run(async c=>(await c.query('SELECT worker.subscription_prices_to_push() AS v')).rows)).map(r=>r.v);
    for(const r of rows){
      const config=await this.config(r.credential_id);if(!config)continue;
      const stripe=this.client(this.credentials(config).key),sub=await stripe.subscriptions.retrieve(r.subscription_id),item=sub.items.data[0];
      if(!item)continue;
      const product=typeof item.price.product==='string'?item.price.product:item.price.product.id;
      await stripe.subscriptions.update(r.subscription_id,{proration_behavior:'none',
        items:[{id:item.id,price_data:{currency:'thb',unit_amount:Number(r.amount_minor),recurring:{interval:r.interval_unit==='year'?'year':'month'},product}}]},
        {idempotencyKey:`price:${r.subscription_id}:${r.price_version_id}`});
      await this.run(c=>c.query('SELECT worker.subscription_price_pushed($1,$2)',[r.subscription_id,r.price_version_id]));
    }
    return rows.length;
  }
  /** Permanent suspension: Stripe stops charging now (no refund, no final invoice). */
  async stopSuspendedSubscriptions():Promise<number> {
    const rows:{subscription_id:string;credential_id:string}[]=(await this.run(async c=>(await c.query('SELECT worker.subscriptions_to_stop() AS v')).rows)).map(r=>r.v);
    for(const r of rows){
      const config=await this.config(r.credential_id);if(!config)continue;
      await this.run(c=>c.query('SELECT worker.platform_canceling_subscription($1)',[r.subscription_id]));
      const sub=await this.client(this.credentials(config).key).subscriptions.cancel(r.subscription_id,{invoice_now:false,prorate:false});
      await this.run(c=>c.query('SELECT worker.sync_subscription($1,$2,$3,$4)',[sub.id,sub.status,sub.cancel_at_period_end,seconds(sub.items?.data[0]?.current_period_end)]));
    }
    return rows.length;
  }
  async webhook(credentialId:string,body:Buffer,signature:string) {
    const config=await this.config(credentialId);if(!config)throw apiError(400,'VALIDATION_ERROR');
    if(this.settings.production&&config.mode!=='live')throw apiError(400,'VALIDATION_ERROR');
    const credentials=this.credentials(config),stripe=this.client(credentials.key);
    let event:Stripe.Event;
    try{event=stripe.webhooks.constructEvent(body,signature,credentials.webhook,300);}catch{throw apiError(400,'VALIDATION_ERROR');}
    if(subscriptionEvents.includes(event.type)){await this.subscriptionEvent(config,event);return {received:true};}
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
