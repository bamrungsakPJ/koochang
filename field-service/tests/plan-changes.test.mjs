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
const webhook='whsec_synthetic123456',day=86400;
let db,a,key,credential;
const oldReturn=process.env.OWNER_WEB_URL;
before(async()=>{
 db=await openTestDatabase('plan_changes');a=actors(db);key=randomBytes(32);credential=randomUUID();
 process.env.OWNER_WEB_URL='http://127.0.0.1:3001/shop';
 const admin=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Plan tester',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='platform_admin'",[admin]);
 await db.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,$5,$6,true,true,0,$7)',[admin,credential,'acct_testplatform','test',encrypt(key,'sk_test_synthetic1234'),encrypt(key,webhook),randomUUID()]);
});
after(async()=>{if(oldReturn===undefined)delete process.env.OWNER_WEB_URL;else process.env.OWNER_WEB_URL=oldReturn;await db?.close();});

const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
const asWorker=async(sql,params)=>{await db.exec('BEGIN;SET LOCAL ROLE fs_worker;');try{const r=await db.query(sql,params);await db.query('COMMIT');return r.rows;}catch(e){await db.query('ROLLBACK');throw e;}};
const scan=()=>asWorker('SELECT worker.scan_plan_changes(now()) AS n').then(r=>r[0].n);
const inbox=async shop=>(await db.query('SELECT template_key,parameters FROM core.notifications WHERE organization_id=$1 ORDER BY created_at',[shop.organizationId])).rows;
const invoice=(shop,price)=>a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,price,randomUUID()]);
const offer=shop=>a.one('SELECT auth.renewal_offer($1,$2) AS v',[shop.owner.userId,shop.organizationId]).then(r=>r.v);

/** A paid plan with version 1; `version` publishes the next one. Each test uses its own plan. */
async function plan(amount,seats=3,storage=10e9){
 const code=`pc${randomUUID().slice(0,8)}`;
 const id=(await one("INSERT INTO billing.plans(code,name_th,name_en) VALUES($1,'แผนทดสอบ','Test plan') RETURNING id",[code])).id;
 const p={id,code,version:async(amount,seats=3,storage=10e9,at='now()')=>{
  const v=(await one('SELECT coalesce(max(version_no),0)+1 AS n FROM billing.plan_versions WHERE plan_id=$1',[id])).n;
  const pv=(await one(`INSERT INTO billing.plan_versions(plan_id,version_no,technician_seats,storage_bytes,ocr_per_period,published_at) VALUES($1,$2,$3,$4,0,${at}) RETURNING id`,[id,v,seats,storage])).id;
  return (await one(`INSERT INTO billing.price_versions(plan_version_id,amount_minor,effective_from) VALUES($1,$2,${at}) RETURNING id`,[pv,amount])).id;
 }};
 p.v1=await p.version(amount,seats,storage);
 return p;
}
/** Shop with one paid period at `price`, moved so it ends in `days`. */
async function paidShop(name,price,days){
 const shop=await a.createShop(name);
 const inv=(await invoice(shop,price)).invoice_id;
 const amount=(await one('SELECT amount_minor FROM billing.invoices WHERE id=$1',[inv])).amount_minor;
 await db.query("INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,verification_source,note) VALUES($1,$2,$3,'THB',$4,now(),NULL,now(),'stripe','card')",[shop.organizationId,inv,amount,'STRIPE:pi_'+randomUUID().replaceAll('-','')]);
 await db.query("UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=$1",[inv]);
 await db.query('SELECT * FROM billing.apply_paid_period($1,$2,$3,now())',[shop.organizationId,inv,price]);
 await endsIn(shop,days);
 return shop;
}
async function endsIn(shop,days){
 const end=(await one("SELECT max(end_at) AS e FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid'",[shop.organizationId])).e;
 // The paid period keeps its start (now) unless it must end in the past.
 const shift=days>0?'':'start_at=start_at-($2::timestamptz-(now()+make_interval(days=>$3))),';
 await db.query(`UPDATE billing.subscription_periods SET ${shift}end_at=end_at-($2::timestamptz-(now()+make_interval(days=>$3))) WHERE organization_id=$1 AND source='paid'`,[shop.organizationId,end,days]);
}

test('worse change: owners are told, renewals keep the old price until the first period starting 30+ days after the notice',async()=>{
 const p=await plan(59000);
 const shop=await paidShop('Worse',p.v1,10);
 const v2=await p.version(69000);
 const first=await invoice(shop,p.v1);
 assert.equal(first.outcome,'ok','before the notice the shop still renews at its price');
 assert.equal(await scan(),1);assert.equal(await scan(),0,'one notice per version');
 const n=(await inbox(shop)).find(x=>x.template_key==='plan_change_notice');
 assert.equal(n.parameters.price,'690');assert.equal(n.parameters.plan_en,'Test plan');
 const notice=await one('SELECT notified_at,effective_at FROM billing.plan_change_notices WHERE organization_id=$1',[shop.organizationId]);
 assert.equal(notice.effective_at.getTime()-notice.notified_at.getTime(),30*day*1000);

 let o=await offer(shop);
 assert.equal(o.price_version_id,p.v1);assert.equal(o.renewal,true);
 assert.equal(o.change.amount_minor,69000);assert.equal(new Date(o.change.effective_at).getTime(),notice.effective_at.getTime());
 const kept=await invoice(shop,p.v1);
 assert.deepEqual(kept,{outcome:'existing',invoice_id:first.invoice_id},'next period starts in 10 days: old price');
 assert.equal((await one('SELECT amount_minor FROM billing.invoices WHERE id=$1',[kept.invoice_id])).amount_minor,59000);
 assert.equal((await invoice(shop,v2)).outcome,'ok','the current price can always be bought');
 const again=await invoice(shop,p.v1);
 assert.equal(again.outcome,'ok','switching back to the kept price after the notice');
 assert.equal((await one('SELECT amount_minor FROM billing.invoices WHERE id=$1',[again.invoice_id])).amount_minor,59000);

 await endsIn(shop,31);
 assert.equal((await invoice(shop,p.v1)).outcome,'not_found','next period starts after the 30 days: new price only');
 o=await offer(shop);assert.equal(o.price_version_id,v2);assert.equal(o.change,null);
});

test('better change applies from the next renewal and is announced once; lapsed and other plans pay today\'s price',async()=>{
 const p=await plan(129000,10,30e9);
 const shop=await paidShop('Better',p.v1,10);
 const v2=await p.version(99000,12,30e9);
 assert.equal(await scan(),1);
 assert.ok((await inbox(shop)).some(x=>x.template_key==='plan_change_better'));
 assert.equal(await one('SELECT count(*)::int AS n FROM billing.plan_change_notices WHERE organization_id=$1',[shop.organizationId]).then(r=>r.n),0);
 assert.equal((await offer(shop)).price_version_id,v2);
 assert.equal((await invoice(shop,p.v1)).outcome,'not_found','a better version replaces the old price at once for the next renewal');

 const worse=await plan(59000);
 const lapsed=await paidShop('Lapsed',worse.v1,-30);
 await worse.version(69000);
 await scan();
 assert.equal((await inbox(lapsed)).filter(x=>x.template_key.startsWith('plan_change')).length,0,'shops past grace are not renewing');
 assert.equal(await offer(lapsed),null);
 assert.equal((await invoice(lapsed,worse.v1)).outcome,'not_found');
});

test('fewer seats in the new version never blocks renewing; buying another plan still checks seats',async()=>{
 const p=await plan(59000,2);
 const shop=await paidShop('Seats',p.v1,10);
 for(let i=0;i<2;i++){const t=await a.addTechnician(shop);assert.equal((await a.change(shop.owner,shop.organizationId,t.memberId,'approve')).outcome,'ok');}
 const v2=await p.version(59000,1);
 await scan();
 await endsIn(shop,40);
 assert.equal((await invoice(shop,v2)).outcome,'ok','renewal at the new version with 2 technicians on a 1-seat plan');
 const solo=await plan(29000,0);
 assert.equal((await invoice(shop,solo.v1)).outcome,'seats');
});

// Stripe ---------------------------------------------------------------------------------------
const sid=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const now=()=>Math.floor(Date.now()/1000);
const real=new Stripe('sk_test_synthetic1234');
const sign=body=>real.webhooks.generateTestHeaderString({payload:body,secret:webhook});
const event=(type,object)=>JSON.stringify({id:sid('evt'),object:'event',type,livemode:false,created:now(),data:{object}});
function fakeStripe(){
 const f={calls:[],invoices:new Map(),sub:null,session:null,params:null};
 const item=end=>({id:sid('si'),current_period_end:end,price:{id:sid('price'),product:'prod_koochang'}});
 f.client=()=>({webhooks:real.webhooks,
  checkout:{sessions:{create:async p=>{f.params=p;f.session={id:sid('cs_test'),url:'https://checkout.stripe.com/c/pay/x',expires_at:p.expires_at};return f.session;},
   retrieve:async()=>({id:f.session.id,mode:'subscription',livemode:false,status:f.sub?'complete':'open',payment_status:'no_payment_required',
    subscription:f.sub?.id??null,customer:f.sub?.customer??null,amount_total:0,currency:'thb',client_reference_id:f.params.client_reference_id,metadata:f.params.metadata})}},
  subscriptions:{retrieve:async()=>({...f.sub,latest_invoice:f.latest?f.invoices.get(f.latest):null}),
   update:async(id,p,o)=>{f.calls.push(['update',id,p,o]);return f.sub;}},
  invoices:{retrieve:async id=>f.invoices.get(id)},
 });
 f.complete=()=>{f.sub={id:sid('sub'),object:'subscription',livemode:false,status:'trialing',cancel_at_period_end:false,customer:sid('cus'),
   metadata:f.params.subscription_data.metadata,items:{data:[item(f.params.subscription_data.trial_end)]}};return f.sub;};
 f.charge=(end,amount)=>{const inv={id:sid('in'),object:'invoice',status:'paid',amount_paid:amount,currency:'thb',livemode:false,
   lines:{data:[{period:{start:end-30*day,end}}]},parent:{type:'subscription_details',subscription_details:{subscription:f.sub.id,metadata:f.sub.metadata}}};
  f.invoices.set(inv.id,inv);f.latest=inv.id;f.sub={...f.sub,status:'active',items:{data:[{...f.sub.items.data[0],current_period_end:end}]}};return inv;};
 return f;
}
function service(fake){const s=new StripeService({production:false,secretKey:key});
 s.pool={connect:async()=>({query:async(sql,params)=>sql==='BEGIN'?db.exec('BEGIN;SET LOCAL ROLE fs_worker;'):db.query(sql,params),release(){}})};
 s.client=fake.client;return s;}

test('card auto-renewal: a worse change reaches Stripe after the notice period, without proration; late old-price invoices still match',async()=>{
 const p=await plan(59000);
 const shop=await paidShop('Card',p.v1,10);
 const inv=(await invoice(shop,p.v1)).invoice_id;
 const fake=fakeStripe(),provider=service(fake);
 const checkout=await provider.checkout(shop.owner.userId,shop.organizationId,inv,'card',randomUUID(),true);
 fake.complete();await provider.refresh(checkout.id);
 const v2=await p.version(69000);
 assert.equal(await provider.pushPrices(),0,'not announced yet');
 await scan();
 assert.ok((await inbox(shop)).some(x=>x.template_key==='plan_change_notice'),'card shops are told too');
 assert.equal(await provider.pushPrices(),0,'next charge (10 days) is inside the 30 days');

 // Stripe charges the first period at the old price; the next charge is 40 days away.
 const first=fake.charge(now()+40*day,59000),raw=event('invoice.paid',first);
 await provider.webhook(credential,Buffer.from(raw),sign(raw));
 assert.equal((await one('SELECT status FROM billing.invoices WHERE id=$1',[inv])).status,'paid');
 assert.equal(await provider.pushPrices(),1);
 const [,subId,params,opts]=fake.calls.at(-1);
 assert.equal(subId,fake.sub.id);assert.equal(params.proration_behavior,'none');
 assert.deepEqual(params.items,[{id:fake.sub.items.data[0].id,price_data:{currency:'thb',unit_amount:69000,recurring:{interval:'month'},product:'prod_koochang'}}]);
 assert.equal(opts.idempotencyKey,`price:${fake.sub.id}:${v2}`);
 assert.deepEqual(await one('SELECT price_version_id,previous_price_version_id FROM billing.stripe_subscriptions WHERE organization_id=$1',[shop.organizationId]),{price_version_id:v2,previous_price_version_id:p.v1});
 assert.equal(await provider.pushPrices(),0,'pushed once');

 const late=fake.charge(now()+41*day,59000),raw2=event('invoice.paid',late);
 await provider.webhook(credential,Buffer.from(raw2),sign(raw2));
 const next=fake.charge(now()+70*day,69000),raw3=event('invoice.paid',next);
 await provider.webhook(credential,Buffer.from(raw3),sign(raw3));
 const rows=(await db.query("SELECT i.amount_minor,i.price_version_id,s.status FROM billing.stripe_subscription_invoices s JOIN billing.invoices i ON i.id=s.invoice_id WHERE s.organization_id=$1 ORDER BY s.created_at",[shop.organizationId])).rows;
 assert.deepEqual(rows.map(r=>[Number(r.amount_minor),r.price_version_id,r.status]),[[59000,p.v1,'paid'],[59000,p.v1,'paid'],[69000,v2,'paid']]);
 const last=(await db.query("SELECT plan_snapshot->>'plan_version_id' AS v FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid' ORDER BY end_at DESC LIMIT 1",[shop.organizationId])).rows[0];
 assert.equal(last.v,(await one('SELECT plan_version_id FROM billing.price_versions WHERE id=$1',[v2])).plan_version_id,'the moved period gets the new limits');
});
