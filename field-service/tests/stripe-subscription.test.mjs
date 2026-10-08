import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {StripeService} from '../apps/api/dist/billing/stripe.service.js';
import {encrypt} from '../apps/api/dist/shared/crypto.js';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
const Stripe=createRequire(new URL('../apps/api/package.json',import.meta.url))('stripe');
const price='72000000-0000-0000-0000-000000000001',webhook='whsec_synthetic123456',day=86400;
let db,a,key,credential;
const oldReturn=process.env.OWNER_WEB_URL;
before(async()=>{
 db=await openTestDatabase('stripe_subscription');a=actors(db);key=randomBytes(32);credential=randomUUID();
 process.env.OWNER_WEB_URL='http://127.0.0.1:3001/shop';
 const admin=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Subscription tester',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='platform_admin'",[admin]);
 await db.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,$5,$6,true,true,0,$7)',[admin,credential,'acct_testplatform','test',encrypt(key,'sk_test_synthetic1234'),encrypt(key,webhook),randomUUID()]);
});
after(async()=>{if(oldReturn===undefined)delete process.env.OWNER_WEB_URL;else process.env.OWNER_WEB_URL=oldReturn;await db?.close();});

const id=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const now=()=>Math.floor(Date.now()/1000);
const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
const inbox=async shop=>(await db.query('SELECT template_key FROM core.notifications WHERE organization_id=$1',[shop.organizationId])).rows.map(r=>r.template_key);
const paid=async shop=>(await db.query("SELECT start_at,end_at FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid' ORDER BY start_at",[shop.organizationId])).rows;
const real=new Stripe('sk_test_synthetic1234');
const sign=body=>real.webhooks.generateTestHeaderString({payload:body,secret:webhook});
const event=(type,object)=>JSON.stringify({id:id('evt'),object:'event',type,livemode:false,created:now(),data:{object}});

/** A fake Stripe account: one subscription, its invoices, and the calls our code made. */
function fakeStripe(){
 const f={calls:[],invoices:new Map(),sub:null,session:null,params:null};
 f.client=()=>({webhooks:real.webhooks,
  checkout:{sessions:{create:async p=>{f.params=p;f.session={id:id('cs_test'),url:'https://checkout.stripe.com/c/pay/x',expires_at:p.expires_at};return f.session;},
   retrieve:async()=>({id:f.session.id,mode:'subscription',livemode:false,status:f.sub?'complete':'open',payment_status:f.sub?.status==='trialing'?'no_payment_required':'paid',
    subscription:f.sub?.id??null,customer:f.sub?.customer??null,amount_total:0,currency:'thb',client_reference_id:f.params.client_reference_id,metadata:f.params.metadata}),
   expire:async()=>({})}},
  subscriptions:{retrieve:async()=>({...f.sub,latest_invoice:f.latest?f.invoices.get(f.latest):null}),
   cancel:async(sid,o)=>{f.calls.push(['cancel',sid,o]);f.sub={...f.sub,status:'canceled'};return f.sub;},
   update:async(sid,p)=>{f.calls.push(['update',sid,p]);f.sub={...f.sub,...p};return f.sub;}},
  invoices:{retrieve:async iid=>f.invoices.get(iid)},
  billingPortal:{sessions:{create:async p=>{f.calls.push(['portal',p]);return{url:'https://billing.stripe.com/p/session/test'};}}},
 });
 /** Customer completes Checkout; Stripe creates the subscription (trialing when the first charge waits). */
 f.complete=()=>{const end=f.params.subscription_data.trial_end??now()+30*day;
  f.sub={id:id('sub'),object:'subscription',livemode:false,status:f.params.subscription_data.trial_end?'trialing':'active',cancel_at_period_end:false,customer:id('cus'),
   metadata:f.params.subscription_data.metadata,items:{data:[{current_period_end:end}]}};return f.sub;};
 /** Stripe charges a period and creates a paid invoice. */
 f.charge=(end,amount=59000,status='paid')=>{const inv={id:id('in'),object:'invoice',status,amount_paid:status==='paid'?amount:0,currency:'thb',livemode:false,
   lines:{data:[{period:{start:end-30*day,end}}]},parent:{type:'subscription_details',subscription_details:{subscription:f.sub.id,metadata:f.sub.metadata}}};
  f.invoices.set(inv.id,inv);f.latest=inv.id;f.sub={...f.sub,status:status==='paid'?'active':'past_due',items:{data:[{current_period_end:end}]}};return inv;};
 return f;
}
function service(fake,production=false){const s=new StripeService({production,secretKey:key});
 s.pool={connect:async()=>({query:async(sql,params)=>sql==='BEGIN'?db.exec('BEGIN;SET LOCAL ROLE fs_worker;'):db.query(sql,params),release(){}})};
 s.client=fake.client;return s;}
async function subscribed(name,{paidUntilHours}={}){
 const shop=await a.createShop(name);
 if(paidUntilHours!==undefined){
  // Pay one month one-time first, then move it so it ends in `paidUntilHours`.
  const inv=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,price,randomUUID()])).invoice_id;
  await db.query("INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,verification_source,note) VALUES($1,$2,59000,'THB',$3,now(),NULL,now(),'stripe','card')",[shop.organizationId,inv,'STRIPE:pi_'+randomUUID().replaceAll('-','')]);
  await db.query("UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=$1",[inv]);
  await db.query('SELECT * FROM billing.apply_paid_period($1,$2,$3,now())',[shop.organizationId,inv,price]);
  const end=(await paid(shop)).at(-1).end_at;
  await db.query("UPDATE billing.subscription_periods SET start_at=start_at-($2::timestamptz-(now()+make_interval(hours=>$3))),end_at=end_at-($2::timestamptz-(now()+make_interval(hours=>$3))) WHERE organization_id=$1",[shop.organizationId,end,paidUntilHours]);
 }
 const invoice=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,price,randomUUID()])).invoice_id;
 const fake=fakeStripe(),provider=service(fake);
 const checkout=await provider.checkout(shop.owner.userId,shop.organizationId,invoice,'card',randomUUID(),true);
 return {shop,invoice,fake,provider,checkout};
}

test('subscription checkout: recurring THB price, card only, first charge waits for time the shop already has',async()=>{
 const trial=await subscribed('Sub trial');
 const p=trial.fake.params;
 assert.equal(p.mode,'subscription');assert.deepEqual(p.allowed_payment_method_types,['card']);
 assert.deepEqual(p.line_items[0].price_data.recurring,{interval:'month'});assert.equal(p.line_items[0].price_data.unit_amount,59000);
 const trialEnd=(await one("SELECT end_at FROM billing.subscription_periods WHERE organization_id=$1 AND source='trial'",[trial.shop.organizationId])).end_at;
 assert.equal(p.subscription_data.trial_end,Math.floor(trialEnd.getTime()/1000),'trial shop is first charged when the trial ends');
 assert.equal(p.subscription_data.metadata.attempt_id,trial.checkout.id);assert.equal(p.payment_intent_data,undefined);
 const late=await subscribed('Sub late',{paidUntilHours:20});
 assert.equal(late.fake.params.subscription_data.trial_end,undefined,'under 48 hours left: Stripe charges now');
 const qr=await late.provider.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5,true) AS v',[late.shop.owner.userId,late.shop.organizationId,late.invoice,'promptpay',randomUUID()])).rows[0].v);
 assert.equal(qr.error,'VALIDATION_ERROR','PromptPay cannot subscribe');
 assert.equal((await one('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ($2,$3,$4)',['billing','last4','brand','payment_method_id'])).n,0,'no card details stored');
});

test('completed checkout links the subscription; while live the owner cannot pay another way or change plan',async()=>{
 const f=await subscribed('Sub live',{paidUntilHours:24*10});
 f.fake.complete();
 assert.equal((await f.provider.refresh(f.checkout.id)).status,'subscribed');
 const row=await one('SELECT status,subscription_id,customer_id FROM billing.stripe_subscriptions WHERE organization_id=$1',[f.shop.organizationId]);
 assert.deepEqual(row,{status:'trialing',subscription_id:f.fake.sub.id,customer_id:f.fake.sub.customer});
 assert.equal((await one('SELECT status FROM billing.invoices WHERE id=$1',[f.invoice])).status,'open','nothing charged yet');
 assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,10)',[f.shop.owner.userId,f.shop.organizationId,f.invoice,randomUUID(),randomUUID(),'c'])).outcome,'checkout_active');
 assert.equal((await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[f.shop.owner.userId,f.shop.organizationId,price,randomUUID()])).outcome,'subscribed');
 const once=await f.provider.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS v',[f.shop.owner.userId,f.shop.organizationId,f.invoice,'promptpay',randomUUID()])).rows[0].v);
 assert.equal(once.error,'PAYMENT_IN_PROGRESS');
});

test('signed invoice.paid pays the subscribed invoice, then each renewal adds a period ending at Stripe period end',async()=>{
 const f=await subscribed('Sub paid',{paidUntilHours:24*10});
 const sub=f.fake.complete(),firstEnd=sub.items.data[0].current_period_end;
 await f.provider.refresh(f.checkout.id);
 const ourEnd=(await paid(f.shop)).at(-1).end_at;
 const first=f.fake.charge(firstEnd+30*day),raw=event('invoice.paid',first);
 await f.provider.webhook(credential,Buffer.from(raw),sign(raw));
 await f.provider.webhook(credential,Buffer.from(raw),sign(raw));
 assert.equal((await one('SELECT status FROM billing.invoices WHERE id=$1',[f.invoice])).status,'paid');
 let periods=await paid(f.shop);
 assert.equal(periods.length,2,'one period per Stripe invoice, replays ignored');
 assert.equal(periods[1].start_at.getTime(),ourEnd.getTime(),'no gap after the period already paid');
 assert.equal(periods[1].end_at.getTime(),(firstEnd+30*day)*1000,'ends where Stripe will charge next');
 const second=f.fake.charge(firstEnd+60*day),raw2=event('invoice.paid',second);
 await f.provider.webhook(credential,Buffer.from(raw2),sign(raw2));
 periods=await paid(f.shop);
 assert.equal(periods.length,3);assert.equal(periods[2].start_at.getTime(),periods[1].end_at.getTime());
 const pays=(await db.query("SELECT bank_reference,note FROM billing.payments WHERE organization_id=$1 AND note='stripe_subscription' ORDER BY created_at",[f.shop.organizationId])).rows;
 assert.deepEqual(pays.map(p=>p.bank_reference),[`STRIPE:${first.id}`,`STRIPE:${second.id}`]);
 assert.ok((await inbox(f.shop)).includes('payment_confirmed'));
});

test('failed charge notifies the owner; Stripe cancelling the subscription releases manual payment; mismatches go to review',async()=>{
 const f=await subscribed('Sub fail',{paidUntilHours:24*10});
 f.fake.complete();await f.provider.refresh(f.checkout.id);
 const failed=f.fake.charge(now()+20*day,59000,'open'),raw=event('invoice.payment_failed',failed);
 await f.provider.webhook(credential,Buffer.from(raw),sign(raw));
 assert.ok((await inbox(f.shop)).includes('autopay_failed'));
 const odd=f.fake.charge(now()+20*day,1000),raw2=event('invoice.paid',odd);
 await f.provider.webhook(credential,Buffer.from(raw2),sign(raw2));
 assert.deepEqual(await one('SELECT status,reason FROM billing.stripe_subscription_invoices WHERE stripe_invoice_id=$1',[odd.id]),{status:'manual_review',reason:'PAYMENT_MISMATCH'});
 assert.equal((await one('SELECT status FROM billing.invoices WHERE id=$1',[f.invoice])).status,'open','wrong amount never activates');
 f.fake.sub={...f.fake.sub,status:'canceled'};f.fake.latest=null;
 const raw3=event('customer.subscription.deleted',f.fake.sub);
 await f.provider.webhook(credential,Buffer.from(raw3),sign(raw3));
 assert.ok((await inbox(f.shop)).includes('autopay_stopped'));
 assert.equal((await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,10)',[f.shop.owner.userId,f.shop.organizationId,f.invoice,randomUUID(),randomUUID(),'c'])).outcome,'ok');
});

test('owner cancel, stop-renewal sync and the card portal',async()=>{
 const f=await subscribed('Sub owner',{paidUntilHours:24*10});
 f.fake.complete();await f.provider.refresh(f.checkout.id);
 await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,true,$3)',[f.shop.owner.userId,f.shop.organizationId,randomUUID()]);
 assert.equal(await f.provider.pushRenewalFlags(f.shop.organizationId),1);
 assert.deepEqual(f.fake.calls.at(-1),['update',f.fake.sub.id,{cancel_at_period_end:true}]);
 assert.equal(await f.provider.pushRenewalFlags(f.shop.organizationId),0,'already in sync');
 const portal=await f.provider.portal(f.shop.owner.userId,f.shop.organizationId);
 assert.equal(new URL(portal.url).origin,'https://billing.stripe.com');assert.equal(f.fake.calls.at(-1)[1].customer,f.fake.sub.customer);
 const other=await a.createShop('Sub stranger');
 await assert.rejects(f.provider.cancelSubscription(other.owner.userId,f.shop.organizationId),e=>e.getStatus()===404);
 await f.provider.cancelSubscription(f.shop.owner.userId,f.shop.organizationId);
 assert.deepEqual(f.fake.calls.at(-1),['cancel',f.fake.sub.id,{invoice_now:false,prorate:false}]);
 const raw=event('customer.subscription.deleted',f.fake.sub);
 await f.provider.webhook(credential,Buffer.from(raw),sign(raw));
 assert.equal((await one('SELECT status FROM billing.stripe_subscriptions WHERE organization_id=$1',[f.shop.organizationId])).status,'canceled');
 assert.ok(!(await inbox(f.shop)).includes('autopay_stopped'),'no "stopped" notice for the owner\'s own cancel');
 assert.equal((await paid(f.shop)).length,1,'the paid period stays');
});

test('reminders say the card will be charged; test-mode subscriptions never activate production',async()=>{
 const f=await subscribed('Sub remind',{paidUntilHours:24*5});
 f.fake.complete();await f.provider.refresh(f.checkout.id);
 await db.exec('BEGIN;SET LOCAL ROLE fs_worker;');await db.query('SELECT worker.scan_subscriptions(now())');await db.query('COMMIT');
 const n=await inbox(f.shop);
 assert.ok(n.includes('autopay_upcoming'));assert.ok(!n.includes('renewal_due'));
 const prod=service(f.fake,true);
 await assert.rejects(prod.refresh(f.checkout.id),e=>e.getStatus()>=400);
 await assert.rejects(a.one('SELECT worker.apply_subscription_invoice($1,$2,1,$3,now())',[randomUUID(),'in_x','thb']),/permission denied/);
});

async function asRole(role,sql,params){await db.exec(`BEGIN;SET LOCAL ROLE ${role};`);try{const r=await db.query(sql,params);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
async function platformAccount(role){const aid=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Suspension tester',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2',[aid,role]);return aid;}
const setStatus=(account,org,status)=>asRole('fs_platform','SELECT padmin.set_organization_status($1,$2,$3,$4,$5) AS v',[account,org,status,'test',randomUUID()]).then(r=>r.rows[0].v);
const scan=at=>asRole('fs_worker','SELECT worker.scan_suspensions($1) AS n',[at]).then(r=>r.rows[0].n);

test('temporary suspension: 14 days, Stripe keeps charging, owners warned 3 and 1 days before; then permanent stops Stripe',async()=>{
 const f=await subscribed('Sub suspend',{paidUntilHours:24*10});
 f.fake.complete();await f.provider.refresh(f.checkout.id);
 const admin=await platformAccount('platform_admin'),root=await platformAccount('super_admin');
 assert.equal(await setStatus(admin,f.shop.organizationId,'suspended'),'ok');
 const o=await one('SELECT suspension_kind,suspended_at,suspended_until FROM core.organizations WHERE id=$1',[f.shop.organizationId]);
 assert.equal(o.suspension_kind,'temporary');assert.equal(o.suspended_until.getTime()-o.suspended_at.getTime(),14*day*1000);
 const member=await one('SELECT suspension_kind,suspended_until FROM auth.user_memberships($1) WHERE organization_id=$2',[f.shop.owner.userId,f.shop.organizationId]);
 assert.equal(member.suspension_kind,'temporary');
 assert.equal(await f.provider.stopSuspendedSubscriptions(),0,'temporary: Stripe keeps charging');
 const until=o.suspended_until.getTime();
 await scan(new Date(until-5*day*1000));
 await scan(new Date(until-2*day*1000));await scan(new Date(until-2*day*1000));
 await scan(new Date(until-12*3600*1000));
 const warnings=(await inbox(f.shop)).filter(n=>n==='suspension_warning');
 assert.equal(warnings.length,2,'3-day and 1-day warnings, once each');
 await scan(new Date(until+60*1000));
 assert.equal((await one('SELECT suspension_kind FROM core.organizations WHERE id=$1',[f.shop.organizationId])).suspension_kind,'permanent');
 assert.ok((await inbox(f.shop)).includes('suspension_permanent'));
 assert.equal(await f.provider.stopSuspendedSubscriptions(),1);
 assert.deepEqual(f.fake.calls.at(-1),['cancel',f.fake.sub.id,{invoice_now:false,prorate:false}]);
 assert.equal((await one('SELECT status FROM billing.stripe_subscriptions WHERE organization_id=$1',[f.shop.organizationId])).status,'canceled');
 assert.equal(await f.provider.stopSuspendedSubscriptions(),0,'stopped once');
 assert.ok(!(await inbox(f.shop)).includes('autopay_stopped'),'the permanent-suspension notice already says charges stopped');
 assert.equal(await setStatus(admin,f.shop.organizationId,'active'),'super_admin_required');
 assert.equal(await setStatus(root,f.shop.organizationId,'active'),'ok');
 assert.deepEqual(await one('SELECT status,suspension_kind,suspended_until FROM core.organizations WHERE id=$1',[f.shop.organizationId]),{status:'active',suspension_kind:null,suspended_until:null});
});

test('a temporary suspension restored in time never becomes permanent; Stripe payments needing review reach the console queue',async()=>{
 const shop=await a.createShop('Sub restore');
 const admin=await platformAccount('platform_admin'),operator=await platformAccount('billing_operator');
 await setStatus(admin,shop.organizationId,'suspended');
 assert.equal(await setStatus(admin,shop.organizationId,'active'),'ok','platform_admin can lift a temporary suspension');
 await scan(new Date(Date.now()+20*day*1000));
 assert.equal((await one('SELECT status FROM core.organizations WHERE id=$1',[shop.organizationId])).status,'active');

 const f=await subscribed('Sub review',{paidUntilHours:24*10});
 f.fake.complete();await f.provider.refresh(f.checkout.id);
 const odd=f.fake.charge(now()+20*day,1000),raw=event('invoice.paid',odd);
 await f.provider.webhook(credential,Buffer.from(raw),sign(raw));
 const queue=(await asRole('fs_platform','SELECT invoice_id FROM padmin.payment_queue($1,$2,0)',[operator,'pending'])).rows.map(r=>r.invoice_id);
 assert.ok(queue.includes(f.invoice));
 const only=async org=>(await asRole('fs_platform','SELECT invoice_id FROM padmin.payment_queue($1,$2,0,$3)',[operator,'all',org])).rows.map(r=>r.invoice_id);
 assert.ok((await only(f.shop.organizationId)).includes(f.invoice),'shop filter keeps that shop');
 assert.ok(!(await only(shop.organizationId)).includes(f.invoice),'shop filter drops other shops');
 assert.ok((await only(null)).includes(f.invoice),'no filter means every shop');
 const detail=(await asRole('fs_platform','SELECT padmin.invoice_detail($1,$2) AS v',[operator,f.invoice])).rows[0].v;
 assert.deepEqual(detail.subscription_payments.map(p=>[p.stripe_invoice_id,p.status,p.reason]),[[odd.id,'manual_review','PAYMENT_MISMATCH']]);
});
