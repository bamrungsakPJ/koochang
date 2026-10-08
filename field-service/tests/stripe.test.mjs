import 'reflect-metadata';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {StripeService} from '../apps/api/dist/billing/stripe.service.js';
import {BillingController} from '../apps/api/dist/billing/billing.controller.js';
import {PaymentSettingsController} from '../apps/api/dist/platform/payment-settings.controller.js';
import {StripeWebhookController} from '../apps/api/dist/billing/stripe-webhook.controller.js';
import {encrypt,decrypt} from '../apps/api/dist/shared/crypto.js';
import {openTestDatabase} from './support/database.mjs';
import {actors} from './support/actors.mjs';
const Stripe=createRequire(new URL('../apps/api/package.json',import.meta.url))('stripe');
let db,a,admin,operator,credential,key,webhook,stripe,settings;
const oldReturn=process.env.OWNER_WEB_URL;
before(async()=>{
 db=await openTestDatabase('stripe');a=actors(db);key=randomBytes(32);webhook='whsec_synthetic123456';
 process.env.OWNER_WEB_URL='http://127.0.0.1:3001/shop';
 async function account(role){const id=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Stripe tester',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2',[id,role]);return id;}
 admin=await account('platform_admin');operator=await account('billing_operator');
 settings={production:false,secretKey:key};stripe=service();
 credential=randomUUID();
 await db.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,$5,$6,true,true,0,$7)',[admin,credential,'acct_testplatform','test',encrypt(key,'sk_test_synthetic1234'),encrypt(key,webhook),randomUUID()]);
});
after(async()=>{if(oldReturn===undefined)delete process.env.OWNER_WEB_URL;else process.env.OWNER_WEB_URL=oldReturn;await db?.close();});
function service(production=false){const s=new StripeService({...settings,production});
 s.pool={connect:async()=>({query:async(sql,params)=>sql==='BEGIN'?db.exec('BEGIN;SET LOCAL ROLE fs_worker;'):db.query(sql,params),release(){}})};return s;}
async function role(roleName,operation,client){const c=client??db;if(client)await c.query(`BEGIN;SET LOCAL ROLE ${roleName};`);else await db.exec(`BEGIN;SET LOCAL ROLE ${roleName};`);
 try{const r=await operation(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
async function fixture(method='card'){
 const shop=await a.createShop('Stripe');
 const invoice=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,'72000000-0000-0000-0000-000000000001',randomUUID()])).invoice_id;
 const request=randomUUID();
 const attempt=await stripe.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS value',[shop.owner.userId,shop.organizationId,invoice,method,request])).rows[0].value);
 assert.ok(attempt.id,JSON.stringify(attempt));
 const id=`cs_test_${randomUUID().replaceAll('-','')}`;
 await stripe.run(c=>c.query('SELECT worker.attach_stripe($1,$2,$3,$4)',[attempt.id,id,`https://checkout.stripe.com/c/pay/${id}`,attempt.expires_at]));
 return {shop,invoice,attempt:{...attempt,session_id:id},request};
}
function session(f,paid=true){return {id:f.attempt.session_id,object:'checkout.session',mode:'payment',livemode:false,payment_status:paid?'paid':'unpaid',status:paid?'complete':'open',
 payment_intent:`pi_${f.attempt.id.replaceAll('-','')}`,amount_total:59000,currency:'thb',client_reference_id:f.invoice,
 expires_at:Math.floor(Date.parse(f.attempt.expires_at)/1000),url:`https://checkout.stripe.com/c/pay/${f.attempt.session_id}`,
 metadata:{attempt_id:f.attempt.id,invoice_id:f.invoice,organization_id:f.shop.organizationId,credential_id:credential}};}
function mockClient(provider,s){const real=new Stripe('sk_test_synthetic1234');provider.client=()=>({webhooks:real.webhooks,checkout:{sessions:{retrieve:async()=>s,expire:async()=>({...s,status:'expired'})}}});return real;}
const sign=(sdk,body)=>sdk.webhooks.generateTestHeaderString({payload:body,secret:webhook});
function event(f,type='checkout.session.completed'){return JSON.stringify({id:`evt_${randomUUID().replaceAll('-','')}`,object:'event',type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:session(f)}});}

test('Stripe settings permissions, optimistic saves, encryption and secret-free output',async()=>{
 const value=(await role('fs_platform',c=>c.query('SELECT padmin.stripe_settings($1) AS value',[admin]))).rows[0].value;
 assert.equal(value.mode,'test');assert.equal(value.account_id,'acct_testplatform');assert.ok(!JSON.stringify(value).includes('sk_test_'));
 await assert.rejects(role('fs_platform',c=>c.query('SELECT padmin.stripe_settings($1)',[operator])),/permission/);
 await assert.rejects(a.one('SELECT worker.stripe_config(NULL)'),/permission denied/);
 assert.equal((await db.query('SELECT padmin.save_stripe_settings($1,$2,$3,$4,NULL,NULL,false,false,0,$5) AS v',[admin,credential,'acct_testplatform','test',randomUUID()])).rows[0].v,'conflict');
 const sealed=(await db.query('SELECT secret_sealed FROM platform.stripe_credentials WHERE id=$1',[credential])).rows[0].secret_sealed;
 assert.ok(!sealed.includes('synthetic'));assert.equal(decrypt(key,sealed),'sk_test_synthetic1234');
 assert.deepEqual(await service(true).methods(),{stripe_card:false,stripe_qr:false,stripe_test:false},'production refuses test mode');
});
test('Stripe QR/card checkout binds server amount, method, metadata, safe return URL and stable idempotency',async()=>{
 for(const method of ['card','promptpay']){
 const shop=await a.createShop('Stripe create'),invoice=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,'72000000-0000-0000-0000-000000000001',randomUUID()])).invoice_id;
 const provider=service();let count=0,params,options;
 provider.client=()=>({checkout:{sessions:{create:async(p,o)=>{count++;params=p;options=o;return{id:'cs_test_create'+count+invoice.replaceAll('-',''),url:'https://checkout.stripe.com/c/pay/test',expires_at:p.expires_at};},retrieve:async()=>({id:'cs_test_create1'+invoice.replaceAll('-',''),mode:'payment',livemode:false,status:'open',payment_status:'unpaid',amount_total:59000,currency:'thb',metadata:params.metadata,client_reference_id:invoice})}}});
 const request=randomUUID(),result=await provider.checkout(shop.owner.userId,shop.organizationId,invoice,method,request);
 assert.equal(params.mode,'payment');assert.deepEqual(params.allowed_payment_method_types,[method]);assert.equal(params.line_items[0].price_data.unit_amount,59000);
 assert.equal(new URL(params.success_url).origin,'http://127.0.0.1:3001');assert.equal(new URL(params.success_url).searchParams.get('organization_id'),shop.organizationId);
 assert.equal(options.idempotencyKey,`checkout:${result.id}`);
 await provider.checkout(shop.owner.userId,shop.organizationId,invoice,method,request);assert.equal(count,1);
 await assert.rejects(provider.checkout(shop.owner.userId,shop.organizationId,invoice,method==='card'?'promptpay':'card',randomUUID()),e=>e.getStatus()===422);
 const proof=await a.one('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,10)',[shop.owner.userId,shop.organizationId,invoice,randomUUID(),randomUUID(),'checksum']);assert.equal(proof.outcome,'checkout_active');
 }
});
test('signed webhook and canonical Stripe retrieval activate immediately, with one payment/period on replay',async()=>{
 const f=await fixture('promptpay'),provider=service(),sdk=mockClient(provider,session(f));
 await db.query("UPDATE billing.subscription_periods SET start_at=start_at-interval '20 days',end_at=end_at-interval '20 days' WHERE organization_id=$1",[f.shop.organizationId]);
 const raw=event(f);assert.deepEqual(await provider.webhook(credential,Buffer.from(raw),sign(sdk,raw)),{received:true});
 assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)',[f.shop.owner.userId,f.shop.organizationId])).outcome,'ok');
 await provider.webhook(credential,Buffer.from(raw),sign(sdk,raw));await provider.refresh(f.attempt.id);
 for(const table of ['payments','subscription_periods'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM billing.${table} WHERE invoice_id=$1`,[f.invoice])).rows[0].n,1);
 const detail=(await db.query('SELECT padmin.invoice_detail($1,$2) AS v',[operator,f.invoice])).rows[0].v;
 assert.equal(detail.payment.verified_by,'Stripe');assert.equal(detail.payment.verification_source,'stripe');
});
test('Stripe rejects forged/tampered/stale signatures and cross-invoice metadata; unpaid never grants access',async()=>{
 const f=await fixture(),provider=service(),sdk=mockClient(provider,session(f,false)),raw=event(f);
 await assert.rejects(provider.webhook(credential,Buffer.from(raw),'t=1,v1=bad'),e=>e.getStatus()===400);
 await assert.rejects(provider.webhook(credential,Buffer.from(raw+' '),sign(sdk,raw)),e=>e.getStatus()===400);
 const stale=sdk.webhooks.generateTestHeaderString({payload:raw,secret:webhook,timestamp:Math.floor(Date.now()/1000)-1000});
 await assert.rejects(provider.webhook(credential,Buffer.from(raw),stale),e=>e.getStatus()===400);
 await provider.webhook(credential,Buffer.from(raw),sign(sdk,raw));assert.equal((await db.query('SELECT status FROM billing.invoices WHERE id=$1',[f.invoice])).rows[0].status,'open');
 const wrong=session(f);wrong.metadata.organization_id=randomUUID();mockClient(provider,wrong);
 await assert.rejects(provider.refresh(f.attempt.id),e=>e.getStatus()===400);
 const prod=service(true);mockClient(prod,session(f));await assert.rejects(prod.webhook(credential,Buffer.from(raw),sign(sdk,raw)),e=>e.getStatus()===400);
});
test('amount mismatch enters admin exception queue; cancellation/expiry allows a new method',async()=>{
 const f=await fixture(),provider=service(),wrong=session(f);wrong.amount_total=58000;mockClient(provider,wrong);
 assert.equal((await provider.refresh(f.attempt.id)).status,'manual_review');
 const queue=(await db.query("SELECT * FROM padmin.payment_queue($1,'pending')",[operator])).rows;assert.ok(queue.some(x=>x.invoice_id===f.invoice));
 const expired=await fixture();mockClient(provider,session(expired,false));assert.equal((await provider.cancel(expired.attempt.id)).status,'expired');
 const next=await provider.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS v',[expired.shop.owner.userId,expired.shop.organizationId,expired.invoice,'promptpay',randomUUID()])).rows[0].v);
 assert.ok(next.id);assert.equal(next.method,'promptpay');
});
test('actual HTTP webhook preserves the exact signed JSON bytes',async()=>{
 const f=await fixture(),provider=service(),sdk=mockClient(provider,session(f));
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
 const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
 class TestModule{};Module({controllers:[StripeWebhookController],providers:[{provide:StripeService,useValue:provider}]})(TestModule);
 const app=await NestFactory.create(TestModule,{rawBody:true,logger:false});app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
 try{
 const raw=JSON.stringify(JSON.parse(event(f)),null,2),url=`${await app.getUrl()}/v1/billing/stripe/webhook/${credential}`;
 const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':sign(sdk,raw)},body:raw});
 assert.equal(result.status,200,await result.text());
 const altered=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':sign(sdk,raw)},body:raw+' '});assert.equal(altered.status,400);
 }finally{await app.close();}
});
test('lost Stripe create response retries with identical parameters and idempotency key',async()=>{
 const shop=await a.createShop('Stripe retry'),invoice=(await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,'72000000-0000-0000-0000-000000000001',randomUUID()])).invoice_id;
 const provider=service(),request=randomUUID(),calls=[];
 provider.client=()=>({checkout:{sessions:{create:async(p,o)=>{calls.push({p,o});if(calls.length===1)throw new Stripe.errors.StripeConnectionError({message:'synthetic lost response'});return{id:'cs_test_retry'+invoice.replaceAll('-',''),url:'https://checkout.stripe.com/c/pay/retry',expires_at:p.expires_at};}}}});
 await assert.rejects(provider.checkout(shop.owner.userId,shop.organizationId,invoice,'card',request),e=>e.getStatus()===503);
 const retry=await provider.checkout(shop.owner.userId,shop.organizationId,invoice,'card',request);assert.ok(retry.id);assert.deepEqual(calls[0],calls[1]);
 const replaced=await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)',[shop.owner.userId,shop.organizationId,'72000000-0000-0000-0000-000000000002',randomUUID()]);assert.equal(replaced.invoice_id,invoice,'active checkout prevents voiding the invoice');
});
test('stripe checkouts are owner-only and cannot be created for another shop',async()=>{
 const f=await fixture(),other=await a.createShop('Stripe other');
 const result=await stripe.run(async c=>(await c.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS v',[other.owner.userId,f.shop.organizationId,f.invoice,'card',randomUUID()])).rows[0].v);assert.equal(result.error,'TENANT_ACCESS_DENIED');
 const rows=await role('fs_api',async c=>{await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[other.owner.userId,f.shop.organizationId]);return (await c.query('SELECT id FROM billing.stripe_checkouts WHERE invoice_id=$1',[f.invoice])).rows;});assert.deepEqual(rows,[]);
});
test('Stripe-only owner invoice works without a transfer account and refresh returns activated entitlement',async()=>{
 const shop=await a.createShop('Stripe only'),provider=service(),database={
   identity:action=>role('fs_api',action),
   withTenant:(user,org,action)=>role('fs_api',async c=>{await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.organization_id',$2,true)",[user,org]);return action(c);}),
 };
 provider.methods=async()=>({stripe_card:true,stripe_qr:true,stripe_test:true});
 let created,paid=false;
 provider.client=()=>({checkout:{sessions:{create:async params=>{created={...params,id:'cs_test_owner'+params.metadata.attempt_id.replaceAll('-',''),amount_total:59000,currency:'thb',livemode:false,payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/c/pay/owner',payment_intent:'pi_owner'+params.metadata.attempt_id.replaceAll('-','')};return created;},retrieve:async()=>({...created,payment_status:paid?'paid':'unpaid',status:paid?'complete':'open'})}}});
 const controller=new BillingController(database,{production:false},{maxStoredBytes:4_194_304},null,null,provider),session={userId:shop.owner.userId},tenant={organizationId:shop.organizationId,role:'owner'};
 const plans=await controller.plans(session,tenant);assert.equal(plans.payment_available,true);assert.equal(plans.methods.transfer,false);
 const invoice=await controller.create(session,tenant,{price_version_id:'72000000-0000-0000-0000-000000000001',request_key:randomUUID()});
 assert.equal(invoice.pay_to,null);assert.equal(invoice.methods.stripe_qr,true);
 const checkout=await controller.checkout(session,tenant,invoice.id,{method:'card',request_key:randomUUID()});paid=true;
 const result=await controller.refreshCheckout(session,tenant,invoice.id,checkout.id);assert.equal(result.status,'paid');assert.equal(result.checkouts[0].status,'paid');assert.ok(result.period);
 const other=await a.createShop('Stripe unrelated');
 await assert.rejects(controller.refreshCheckout({userId:other.owner.userId},{organizationId:shop.organizationId,role:'owner'},invoice.id,checkout.id),e=>e.getStatus()===404);
});
test('Stripe activation preserves suspension and rolls back all state if applying a period fails',async()=>{
 const f=await fixture(),provider=service();mockClient(provider,session(f));
 await db.query("UPDATE core.organizations SET status='suspended' WHERE id=$1",[f.shop.organizationId]);await provider.refresh(f.attempt.id);
 assert.equal((await a.one('SELECT * FROM auth.require_writable($1,$2)',[f.shop.owner.userId,f.shop.organizationId])).outcome,'suspended');
 const bad=await fixture();mockClient(provider,session(bad));
 await db.exec("CREATE FUNCTION billing.test_stripe_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stripe simulated period failure'; END $$; CREATE TRIGGER test_stripe_fail BEFORE INSERT ON billing.subscription_periods FOR EACH ROW EXECUTE FUNCTION billing.test_stripe_fail();");
 try{await assert.rejects(provider.refresh(bad.attempt.id),/stripe simulated period failure/);}
 finally{await db.exec('DROP TRIGGER test_stripe_fail ON billing.subscription_periods;DROP FUNCTION billing.test_stripe_fail();');}
 assert.equal((await db.query('SELECT status FROM billing.invoices WHERE id=$1',[bad.invoice])).rows[0].status,'open');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.payments WHERE invoice_id=$1',[bad.invoice])).rows[0].n,0);
 assert.equal((await db.query('SELECT status FROM billing.stripe_checkouts WHERE id=$1',[bad.attempt.id])).rows[0].status,'open');
 await provider.refresh(bad.attempt.id);assert.equal((await db.query('SELECT status FROM billing.invoices WHERE id=$1',[bad.invoice])).rows[0].status,'paid');
});
test('late Stripe payment for an already-paid invoice enters admin queue without another period',async()=>{
 const f=await fixture(),provider=service();mockClient(provider,session(f));
 await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)',[operator,f.invoice,randomUUID(),randomUUID()]);
 assert.equal((await provider.refresh(f.attempt.id)).status,'manual_review');
 const queue=(await db.query("SELECT * FROM padmin.payment_queue($1,'pending')",[operator])).rows;assert.ok(queue.some(x=>x.invoice_id===f.invoice));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscription_periods WHERE invoice_id=$1',[f.invoice])).rows[0].n,1);
});
test('concurrent checkout preparation and confirmation create one checkout/payment/period',{skip:!process.env.TEST_DATABASE_URL&&'requires PostgreSQL connections'},async()=>{
 const f=await fixture(),c1=await db.connect(),c2=await db.connect();
 try{
 const prepare=c=>role('fs_worker',async x=>(await x.query('SELECT worker.prepare_stripe($1,$2,$3,$4,$5) AS v',[f.shop.owner.userId,f.shop.organizationId,f.invoice,'card',randomUUID()])).rows[0].v,c);
 const values=await Promise.all([prepare(c1),prepare(c2)]);assert.equal(values[0].id,values[1].id);
 const confirm=c=>role('fs_worker',async x=>(await x.query("SELECT worker.finish_stripe($1,$2,$3,59000,'thb','paid',NULL) AS v",[f.attempt.id,f.attempt.session_id,`pi_${f.attempt.id.replaceAll('-','')}`])).rows[0].v,c);
 assert.deepEqual((await Promise.all([confirm(c1),confirm(c2)])).sort(),['existing','paid']);
 }finally{c1.release();c2.release();}
});
test('Stripe credentials rotate without losing existing sessions or exposing secrets in settings',async()=>{
 const old=await fixture();
 const provider=service(),platform={run:operation=>role('fs_platform',operation)},controller=new PaymentSettingsController(platform,provider,settings);
 const account={accountId:admin},before=await controller.get(account);assert.ok(before.next_webhook_path);assert.ok(!JSON.stringify(before).includes('sealed'));
 provider.client=()=>({accounts:{retrieve:async()=>({id:'acct_testplatform',country:'TH',charges_enabled:true})}});
 const saved=await controller.save(account,randomUUID(),{version:before.version,credential_id:before.next_credential_id,secret_key:'sk_test_rotated1234',webhook_secret:'whsec_rotated1234',card_enabled:true,qr_enabled:true});
 assert.notEqual(saved.credential_id,credential);assert.ok(await provider.config(credential),'old webhook/session credentials retained');
 const sdk=mockClient(provider,session(old)),raw=event(old);await provider.webhook(credential,Buffer.from(raw),sign(sdk,raw));
 assert.equal((await db.query('SELECT status FROM billing.invoices WHERE id=$1',[old.invoice])).rows[0].status,'paid','a payment begun before rotation still activates');
 const bad=service();bad.client=()=>({accounts:{retrieve:async()=>({id:'acct_foreign',country:'US',charges_enabled:true})}});
 await assert.rejects(new PaymentSettingsController(platform,bad,settings).save(account,randomUUID(),{version:saved.version,credential_id:randomUUID(),secret_key:'sk_test_foreign1234',webhook_secret:'whsec_foreign1234',card_enabled:true,qr_enabled:true}),e=>e.getStatus()===400);
});
test('approving a refund of a Stripe payment refunds through Stripe once; refused marks failed; bank payments stay manual',async()=>{
 const {PlatformBillingController}=await import('../apps/api/dist/platform/platform-billing.controller.js');
 const f=await fixture(),provider=service(),paid=session(f);paid.metadata.credential_id=f.attempt.credential_id; // the test before rotated the credential
 mockClient(provider,paid);await provider.refresh(f.attempt.id);
 const payment=(await db.query('SELECT id FROM billing.payments WHERE invoice_id=$1',[f.invoice])).rows[0].id;
 const approver=(await db.query("INSERT INTO platform.accounts(display_name,email) VALUES('Refund approver',$1) RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
 await db.query("INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code='billing_approver'",[approver]);
 const calls=[],refunds=[];let refuse=false;
 provider.client=()=>({refunds:{list:async p=>({data:refunds.filter(r=>r.payment_intent===p.payment_intent)}),
  create:async(p,o)=>{calls.push({p,o});if(refuse)throw new Stripe.errors.StripeInvalidRequestError({message:'synthetic',code:'charge_already_refunded'});
   const r={id:`re_${randomUUID().replaceAll('-','')}`,status:'succeeded',payment_intent:p.payment_intent,metadata:p.metadata};refunds.push(r);return r;}}});
 const platform={run:operation=>role('fs_platform',operation)},controller=new PlatformBillingController(platform,null,provider);
 const op={accountId:operator},ap={accountId:approver};
 const one=await controller.requestRefund(op,randomUUID(),payment,{amount_minor:20000,reason:'ทดสอบคืนผ่าน Stripe'});
 assert.ok((await controller.refunds(ap)).items.find(r=>r.refund_id===one.refund_id).via_stripe);
 assert.deepEqual(await controller.approve(ap,randomUUID(),one.refund_id,{}),{ok:true,stripe:'succeeded'});
 assert.equal(calls.length,1);assert.equal(calls[0].p.amount,20000);assert.equal(calls[0].p.payment_intent,`pi_${f.attempt.id.replaceAll('-','')}`);assert.equal(calls[0].o.idempotencyKey,`refund:${one.refund_id}`);
 const row=(await db.query('SELECT status,bank_reference FROM billing.refunds WHERE id=$1',[one.refund_id])).rows[0];
 assert.equal(row.status,'succeeded');assert.equal(row.bank_reference,`STRIPE:${refunds[0].id}`);
 await assert.rejects(controller.stripeRetry(ap,randomUUID(),one.refund_id),e=>e.getStatus()===422,'a finished refund is not refunded again');
 // Approved earlier while Stripe was unreachable: the retry finds the Stripe refund already carrying our id.
 const two=await controller.requestRefund(op,randomUUID(),payment,{amount_minor:10000,reason:'ส่วนที่สอง'});
 provider.client=(()=>{const c=provider.client();return()=>({refunds:{list:async()=>{throw new Stripe.errors.StripeConnectionError({message:'down'});},create:c.refunds.create}});})();
 assert.deepEqual(await controller.approve(ap,randomUUID(),two.refund_id,{}),{ok:true,stripe:'retry'});
 assert.equal((await db.query('SELECT status FROM billing.refunds WHERE id=$1',[two.refund_id])).rows[0].status,'approved');
 refunds.push({id:'re_lostresponse1',status:'succeeded',payment_intent:calls[0].p.payment_intent,metadata:{refund_id:two.refund_id}});
 provider.client=()=>({refunds:{list:async p=>({data:refunds.filter(r=>r.payment_intent===p.payment_intent)}),create:async()=>{throw Error('must not create twice');}}});
 assert.deepEqual(await controller.stripeRetry(ap,randomUUID(),two.refund_id),{ok:true,stripe:'succeeded'});
 assert.equal((await db.query('SELECT bank_reference FROM billing.refunds WHERE id=$1',[two.refund_id])).rows[0].bank_reference,'STRIPE:re_lostresponse1');
 await assert.rejects(controller.requestRefund(op,randomUUID(),payment,{amount_minor:59000-30000+1,reason:'เกิน'}),e=>e.getStatus()===422);
 // Stripe refuses: the refund is marked failed and its amount can be requested again.
 const three=await controller.requestRefund(op,randomUUID(),payment,{amount_minor:29000,reason:'ส่วนที่สาม'});refuse=true;
 provider.client=()=>({refunds:{list:async()=>({data:[]}),create:async()=>{throw new Stripe.errors.StripeInvalidRequestError({message:'synthetic',code:'charge_already_refunded'});}}});
 assert.deepEqual(await controller.approve(ap,randomUUID(),three.refund_id,{}),{ok:true,stripe:'refused'});
 assert.equal((await db.query('SELECT status FROM billing.refunds WHERE id=$1',[three.refund_id])).rows[0].status,'failed');
 assert.ok((await controller.requestRefund(op,randomUUID(),payment,{amount_minor:29000,reason:'ขอใหม่'})).refund_id);
 const audit=(await db.query("SELECT details FROM platform.audit_logs WHERE target_id=$1 AND action='refund.failed'",[three.refund_id])).rows[0].details;
 assert.equal(audit.via,'stripe');assert.equal(audit.error,'charge_already_refunded');
 // Only refund.approve triggers Stripe.
 await assert.rejects(role('fs_platform',c=>c.query('SELECT padmin.stripe_refund_target($1,$2)',[operator,one.refund_id])),/permission/);
});
