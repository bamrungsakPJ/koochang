import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {StripeService} from '../apps/api/dist/billing/stripe.service.js';
import {runAutopay} from '../apps/api/dist/billing/autopay.js';
import {encrypt} from '../apps/api/dist/shared/crypto.js';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
const Stripe=createRequire(new URL('../apps/api/package.json',import.meta.url))('stripe');
const price='72000000-0000-0000-0000-000000000001';
let db,a,key,credential,admin;
const oldReturn=process.env.OWNER_WEB_URL;
before(async()=>{
 db=await openTestDatabase('autopay');a=actors(db);key=randomBytes(32);credential=randomUUID();
 process.env.OWNER_WEB_URL='http://127.0.0.1:3001/shop';
 admin=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Autopay tester',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='platform_admin'",[admin]);
 await db.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,$5,$6,true,true,0,$7)',[admin,credential,'acct_testplatform','test',encrypt(key,'sk_test_synthetic1234'),encrypt(key,'whsec_synthetic123456'),randomUUID()]);
});
after(async()=>{if(oldReturn===undefined)delete process.env.OWNER_WEB_URL;else process.env.OWNER_WEB_URL=oldReturn;await db?.close();});

async function asWorker(sql,params){await db.exec('BEGIN;SET LOCAL ROLE fs_worker;');try{const r=await db.query(sql,params);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
const workerPool={query:asWorker};
function service(){const s=new StripeService({production:false,secretKey:key});
 s.pool={connect:async()=>({query:async(sql,params)=>sql==='BEGIN'?db.exec('BEGIN;SET LOCAL ROLE fs_worker;'):db.query(sql,params),release(){}})};return s;}
const id=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const inbox=async shop=>(await db.query('SELECT template_key,parameters,target_type FROM core.notifications WHERE organization_id=$1 ORDER BY created_at',[shop.organizationId])).rows;
const one=async(sql,params)=>(await db.query(sql,params)).rows[0];

/** Pays the first invoice by card with "save card" ticked, through Checkout and the canonical retrieval. */
async function enrolled(name='Autopay'){
 const shop=await a.createShop(name);
 const invoice=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,price,randomUUID()])).invoice_id;
 const provider=service(),pm=id('pm'),customer=id('cus');let params,retrieved=0,session;
 provider.client=()=>({
  checkout:{sessions:{create:async p=>{params=p;session={id:id('cs_test'),url:'https://checkout.stripe.com/c/pay/x',expires_at:p.expires_at};return session;},
   retrieve:async()=>({id:session.id,mode:'payment',livemode:false,status:'complete',payment_status:'paid',payment_intent:`pi_${params.metadata.attempt_id.replaceAll('-','')}`,
    amount_total:59000,currency:'thb',customer,client_reference_id:invoice,metadata:params.metadata})}},
  paymentIntents:{retrieve:async()=>{retrieved++;return{metadata:{attempt_id:params.metadata.attempt_id},payment_method:{id:pm,card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030}}};}},
 });
 const result=await provider.checkout(shop.owner.userId,shop.organizationId,invoice,'card',randomUUID(),true);
 await provider.refresh(result.id);await provider.refresh(result.id);
 return {shop,invoice,params,retrieved,pm,customer,checkout:result.id};
}
/** Moves every period so the paid one ends in `hours`. */
async function endsIn(shop,hours){
 const end=(await one("SELECT end_at FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid' ORDER BY end_at DESC LIMIT 1",[shop.organizationId])).end_at;
 await db.query("UPDATE billing.subscription_periods SET start_at=start_at-($2::timestamptz-(now()+make_interval(hours=>$3))),end_at=end_at-($2::timestamptz-(now()+make_interval(hours=>$3))) WHERE organization_id=$1",[shop.organizationId,end,hours]);
}
function stripeMock(behaviour){const calls=[];return {calls,client:()=>({paymentIntents:{
 create:async(p,o)=>{calls.push({p,o});return behaviour(p,calls.length);},
 retrieve:async pi=>behaviour({retrieve:pi},calls.length)}})};}
const succeeded=p=>({id:`pi_${p.metadata.autopay_charge_id.replaceAll('-','')}`,status:'succeeded',amount_received:p.amount,currency:'thb',metadata:p.metadata});
const deps=(mock,extra={})=>({pool:workerPool,secretKey:key,production:false,client:mock.client,...extra});
const charges=async shop=>(await db.query('SELECT status,reason,attempt_no,next_attempt_at FROM billing.autopay_charges WHERE organization_id=$1 ORDER BY attempt_no',[shop.organizationId])).rows;

test('card checkout with "save card" saves the card off-session; replays do not ask Stripe again',async()=>{
 const f=await enrolled();
 assert.equal(f.params.payment_intent_data.setup_future_usage,'off_session');assert.equal(f.params.customer_creation,'always');
 assert.equal(f.retrieved,1,'card details fetched once');
 const card=await one('SELECT status,customer_id,payment_method_id,last4,brand FROM billing.card_autopay WHERE organization_id=$1',[f.shop.organizationId]);
 assert.deepEqual(card,{status:'active',customer_id:f.customer,payment_method_id:f.pm,last4:'4242',brand:'visa'});
 // A later card checkout reuses the same Stripe customer.
 const next=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[f.shop.owner.userId,f.shop.organizationId,price,randomUUID()])).invoice_id;
 const prepared=await service().run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5,true) AS v',[f.shop.owner.userId,f.shop.organizationId,next,'card',randomUUID()])).rows[0].v);
 assert.equal(prepared.customer_id,f.customer);
 const qr=await service().run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5,true) AS v',[f.shop.owner.userId,f.shop.organizationId,next,'promptpay',randomUUID()])).rows[0].v);
 assert.equal(qr.error,'VALIDATION_ERROR','PromptPay cannot be saved for automatic charges');
});

test('renewal charges the saved card once, a day before the end, and continues the period without a gap',async()=>{
 const f=await enrolled('Autopay renew');
 const mock=stripeMock(succeeded);
 await endsIn(f.shop,30);
 assert.equal(await runAutopay(deps(mock)),0,'not due 30 hours before');
 await endsIn(f.shop,12);
 const before=(await one("SELECT end_at FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid' ORDER BY end_at DESC LIMIT 1",[f.shop.organizationId])).end_at;
 assert.equal(await runAutopay(deps(mock)),1);
 assert.equal(await runAutopay(deps(mock)),0,'never charged twice');
 assert.equal(mock.calls.length,1);
 const {p,o}=mock.calls[0];
 assert.equal(p.off_session,true);assert.equal(p.confirm,true);assert.equal(p.amount,59000);assert.equal(p.customer,f.customer);assert.equal(p.payment_method,f.pm);
 assert.equal(o.idempotencyKey,`autopay:${p.metadata.autopay_charge_id}`);
 const periods=(await db.query("SELECT start_at,end_at FROM billing.subscription_periods WHERE organization_id=$1 AND source='paid' ORDER BY start_at",[f.shop.organizationId])).rows;
 assert.equal(periods.length,2);assert.equal(periods[1].start_at.getTime(),before.getTime(),'next period starts where the old one ends');
 const pay=await one("SELECT p.note,p.verification_source,i.status FROM billing.payments p JOIN billing.invoices i ON i.id=p.invoice_id WHERE p.organization_id=$1 AND p.note='card_autopay'",[f.shop.organizationId]);
 assert.deepEqual(pay,{note:'card_autopay',verification_source:'stripe',status:'paid'});
 assert.ok((await inbox(f.shop)).some(n=>n.template_key==='payment_confirmed'));
});

test('a declined card is retried a day later; a hard decline turns automatic renewal off and tells the owner',async()=>{
 const f=await enrolled('Autopay decline');
 await endsIn(f.shop,12);
 const declined=stripeMock(()=>{throw new Stripe.errors.StripeCardError({type:'card_error',code:'card_declined',decline_code:'insufficient_funds',message:'declined',payment_intent:{id:id('pi')}});});
 assert.equal(await runAutopay(deps(declined)),1);
 assert.equal(await runAutopay(deps(declined)),0,'waits for the retry time');
 let rows=await charges(f.shop);assert.equal(rows[0].status,'failed');assert.equal(rows[0].reason,'insufficient_funds');assert.ok(rows[0].next_attempt_at);
 assert.equal((await one('SELECT status FROM billing.card_autopay WHERE organization_id=$1',[f.shop.organizationId])).status,'active');
 assert.ok((await inbox(f.shop)).some(n=>n.template_key==='autopay_failed'&&n.parameters.last4==='4242'));
 await db.query("UPDATE billing.autopay_charges SET next_attempt_at=now()-interval '1 minute' WHERE organization_id=$1",[f.shop.organizationId]);
 const expired=stripeMock(()=>{throw new Stripe.errors.StripeCardError({type:'card_error',code:'expired_card',message:'expired'});});
 assert.equal(await runAutopay(deps(expired)),1);
 rows=await charges(f.shop);assert.deepEqual(rows.map(r=>[r.attempt_no,r.status,r.reason]),[[1,'failed','insufficient_funds'],[2,'failed','expired_card']]);
 assert.equal(rows[1].next_attempt_at,null);
 assert.deepEqual(await one('SELECT status,disabled_reason FROM billing.card_autopay WHERE organization_id=$1',[f.shop.organizationId]),{status:'disabled',disabled_reason:'expired_card'});
 assert.ok((await inbox(f.shop)).some(n=>n.template_key==='autopay_stopped'));
 assert.equal(await runAutopay(deps(stripeMock(succeeded))),0,'no further charges once stopped');
 // The open renewal invoice can still be paid by the owner.
 assert.equal((await one("SELECT count(*)::int AS n FROM billing.invoices WHERE organization_id=$1 AND status='open'",[f.shop.organizationId])).n,1);
});

test('owner opt-out, stopped renewal, production test keys and disabled card payments never charge',async()=>{
 const f=await enrolled('Autopay off');await endsIn(f.shop,12);
 const mock=stripeMock(succeeded);
 assert.equal(await runAutopay(deps(mock,{production:true})),0,'test key on production');
 await db.query('UPDATE platform.payment_settings SET card_enabled=false');
 assert.equal(await runAutopay(deps(mock)),0,'platform card payments off');
 await db.query('UPDATE platform.payment_settings SET card_enabled=true');
 await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,true,$3)',[f.shop.owner.userId,f.shop.organizationId,randomUUID()]);
 assert.equal((await asWorker('SELECT count(*)::int AS n FROM worker.autopay_candidates(now(),100) id WHERE id=$1',[f.shop.organizationId])).rows[0].n,0,'renewal cancelled');
 await a.one('SELECT * FROM auth.set_cancel_at_period_end($1,$2,false,$3)',[f.shop.owner.userId,f.shop.organizationId,randomUUID()]);
 const other=await a.createShop('Not owner');
 assert.equal((await a.one('SELECT auth.disable_card_autopay($1,$2,$3) AS v',[other.owner.userId,f.shop.organizationId,randomUUID()])).v,'forbidden');
 assert.equal((await a.one('SELECT auth.disable_card_autopay($1,$2,$3) AS v',[f.shop.owner.userId,f.shop.organizationId,randomUUID()])).v,'ok');
 assert.equal(await runAutopay(deps(mock)),0,'owner turned it off');
 assert.equal(mock.calls.length,0);
});

test('reminders name the card on automatic renewal and add a 1-day reminder; a charge in flight blocks slips and checkouts',async()=>{
 const f=await enrolled('Autopay remind');
 await endsIn(f.shop,24*6);
 await asWorker('SELECT worker.scan_subscriptions(now())');
 await endsIn(f.shop,20);
 await asWorker('SELECT worker.scan_subscriptions(now())');await asWorker('SELECT worker.scan_subscriptions(now())');
 const reminders=(await inbox(f.shop)).filter(n=>n.template_key==='autopay_upcoming');
 assert.equal(reminders.length,2,'7-day and 1-day reminders, each once');assert.equal(reminders[0].parameters.last4,'4242');
 assert.equal((await inbox(f.shop)).filter(n=>n.template_key==='renewal_due').length,0);

 // Network failure: the charge stays in flight, blocks the owner paying the same invoice twice,
 // and is resent with the same idempotency key once stale.
 await endsIn(f.shop,12);
 const down=stripeMock(()=>{throw new Stripe.errors.StripeConnectionError({message:'offline'});});
 await runAutopay(deps(down));
 const charge=await one("SELECT id,invoice_id,status FROM billing.autopay_charges WHERE organization_id=$1",[f.shop.organizationId]);
 assert.equal(charge.status,'charging');
 const proof=await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,10)',[f.shop.owner.userId,f.shop.organizationId,charge.invoice_id,randomUUID(),randomUUID(),'checksum']);
 assert.equal(proof.outcome,'checkout_active');
 const checkout=await service().run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS v',[f.shop.owner.userId,f.shop.organizationId,charge.invoice_id,'promptpay',randomUUID()])).rows[0].v);
 assert.equal(checkout.error,'PAYMENT_IN_PROGRESS');
 await db.query("UPDATE billing.autopay_charges SET updated_at=now()-interval '5 minutes' WHERE id=$1",[charge.id]);
 const up=stripeMock(succeeded);
 await runAutopay(deps(up));
 assert.equal(up.calls[0].o.idempotencyKey,`autopay:${charge.id}`);
 assert.equal((await one('SELECT status FROM billing.autopay_charges WHERE id=$1',[charge.id])).status,'paid');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.autopay_charges WHERE organization_id=$1',[f.shop.organizationId])).rows[0].n,1);
});

test('owners read their own card summary only; the API role cannot run charges',async()=>{
 const f=await enrolled('Autopay rls');const other=await a.createShop('Other autopay');
 await assert.rejects(a.one('SELECT * FROM worker.autopay_candidates(now(),10)'),/permission denied/);
 await assert.rejects(a.one('SELECT worker.finish_autopay($1,NULL,0,$2,$3,NULL,false)',[randomUUID(),'thb','failed']),/permission denied/);
 const read=async(user,org)=>{await db.exec('BEGIN;SET LOCAL ROLE fs_api;');try{await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,org]);
  return (await db.query('SELECT last4 FROM billing.card_autopay')).rows;}finally{await db.query('ROLLBACK');}};
 assert.deepEqual(await read(f.shop.owner.userId,f.shop.organizationId),[{last4:'4242'}]);
 assert.deepEqual(await read(other.owner.userId,other.organizationId),[]);
});
