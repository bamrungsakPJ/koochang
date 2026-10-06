import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsSender } from '../apps/api/dist/sms/sms.sender.js';
import { productionProblems } from '../apps/api/dist/config-check.js';
import { AuthService } from '../apps/api/dist/auth/auth.service.js';
import { loadAuthSettings } from '../apps/api/dist/config.js';
import { randomBytes } from 'node:crypto';

const env = { NODE_ENV:'production', SMS_PROVIDER:'deesmsx', DEESMSX_API_KEY:'synthetic-api', DEESMSX_SECRET_KEY:'synthetic-secret', DEESMSX_SENDER:'TestSender' };
test('DeeSMSx requires all server settings and unknown providers stay closed', () => {
  assert.equal(createSmsSender(env).delivery,'sms');
  for(const key of ['DEESMSX_API_KEY','DEESMSX_SECRET_KEY','DEESMSX_SENDER']) {
    const incomplete={...env,[key]:' '};
    assert.equal(createSmsSender(incomplete),null);
    assert.ok(productionProblems(incomplete).includes(key));
  }
  assert.equal(createSmsSender({...env,SMS_PROVIDER:'unknown'}),null);
  assert.ok(productionProblems({...env,SMS_PROVIDER:'unknown'}).some(p=>p.startsWith('SMS_PROVIDER')));
});
test('DeeSMSx sends official JSON with normalized recipient and Thai/English OTP', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response('{}',{status:200});});
  const sender=createSmsSender(env);
  for(const message of ['รหัสยืนยัน 123456 ใช้ได้ 5 นาที','Your verification code is 123456.']) await sender.send('+66912345678',message);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://apicall.deesmsx.com/v1/SMSWebService');
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].options.body),{apiKey:env.DEESMSX_API_KEY,secretKey:env.DEESMSX_SECRET_KEY,sender:env.DEESMSX_SENDER,to:'66912345678',msg:'รหัสยืนยัน 123456 ใช้ได้ 5 นาที'});
  await assert.rejects(sender.send('0912345678','123456'),/SMS_INVALID_REQUEST/);
  assert.equal(calls.length,2);
});
test('DeeSMSx rejects failures, malformed acknowledgments and timeouts without retries or leaked secrets', async t => {
  const sender=createSmsSender(env);let calls=0;
  let outcome;
  t.mock.method(globalThis,'fetch',async()=>{calls++;if(outcome instanceof Error)throw outcome;return outcome;});
  for(const result of [new Response('synthetic-secret',{status:400}),new Response('{}',{status:500}),new Response('invalid',{status:200}),new Response('[]',{status:200}),new Response('null',{status:200}),new DOMException('synthetic-secret','TimeoutError')]) {
    outcome=result;const before=calls;
    await assert.rejects(sender.send('+66912345678','OTP 123456'),error=>error.message==='SMS_DELIVERY_UNAVAILABLE');
    assert.equal(calls,before+1);
  }
});
test('OTP service uses DeeSMSx acknowledgment and maps provider failure to generic 503', async t => {
  let status=200;const messages=[];const stored=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{messages.push(JSON.parse(options.body));return new Response('{}',{status});});
  const database={identity:async action=>action({query:async(_sql,args)=>{stored.push(args);return {rows:[{challenge_id:args[0],expires_at:'2030-01-01T00:00:00Z'}]};}})};
  const settings=loadAuthSettings({NODE_ENV:'production',OTP_SECRET:randomBytes(32).toString('base64')});
  const service=new AuthService(database,settings,createSmsSender(env));
  const result=await service.requestOtp({phone:'0912345678'},'127.0.0.1','th');
  assert.equal(result.delivery,'sms');assert.equal(result.code,undefined);
  assert.equal(messages[0].to,'66912345678');assert.match(messages[0].msg,/\d{6}/);
  assert.notEqual(stored[0][2],messages[0].msg.match(/\d{6}/)[0]);
  status=400;
  await assert.rejects(service.requestOtp({phone:'0912345678'},'127.0.0.1','en'),error=>error.getStatus()===503&&error.getResponse().code==='TEMPORARILY_UNAVAILABLE');
  assert.match(messages[1].msg,/Your verification code/);
});

const thsmsEnv = { NODE_ENV:'production', SMS_PROVIDER:'thsms', THSMS_TOKEN:'synthetic-token', THSMS_SENDER:'TestSender' };
test('THSMS requires token and sender', () => {
  assert.equal(createSmsSender(thsmsEnv).delivery,'sms');
  for(const key of ['THSMS_TOKEN','THSMS_SENDER']) {
    const incomplete={...thsmsEnv,[key]:' '};
    assert.equal(createSmsSender(incomplete),null);
    assert.ok(productionProblems(incomplete).includes(key));
  }
  assert.ok(!productionProblems(thsmsEnv).some(p=>p.startsWith('SMS_PROVIDER')||p.startsWith('THSMS')));
});
test('THSMS sends V2 JSON with a Bearer token and a local Thai number, no retries', async t => {
  const calls=[];let reply=()=>new Response(JSON.stringify({success:true,code:200,message:'OK',data:{credit_usage:1,remaining_credit:5008}}),{status:200});
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return reply();});
  const sender=createSmsSender(thsmsEnv);
  await sender.send('+66912345678','รหัสยืนยัน 123456');
  assert.equal(calls[0].url,'https://thsms.com/api/send-sms');
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(calls[0].options.body),{sender:'TestSender',msisdn:['0912345678'],message:'รหัสยืนยัน 123456'});
  await assert.rejects(sender.send('+14155550100','x'),/SMS_INVALID_REQUEST/);
  for(const r of [()=>new Response('{"success":false}',{status:200}),()=>new Response('nope',{status:401}),()=>new Response('[]',{status:200}),()=>new Response('{}',{status:200})]) {
    reply=r;const before=calls.length;
    await assert.rejects(sender.send('+66912345678','OTP 123456'),e=>e.message==='SMS_DELIVERY_UNAVAILABLE');
    assert.equal(calls.length,before+1);
  }
});
