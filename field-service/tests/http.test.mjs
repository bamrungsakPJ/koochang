import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
let child,base;
before(async()=>{
  const reservation=createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
  const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve)); base=`http://127.0.0.1:${port}`;
  const { DATABASE_URL, ...safeEnv }=process.env;
  child=spawn(process.execPath,[fileURLToPath(new URL('../apps/api/dist/main.js',import.meta.url))],{env:{...safeEnv,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  let spawnError; child.on('error',e=>{spawnError=e;});
  for(let i=0;i<600;i++) {
    if(spawnError) throw spawnError;
    if(child.exitCode!==null) throw Error('API exited before readiness');
    try {if((await fetch(base+'/v1/health')).ok) return;} catch {}
    await setTimeout(100);
  }
  throw Error('API startup timeout');
});
after(async()=>{if(child && child.exitCode===null){child.kill();await once(child,'exit');}});
test('API liveness exposes only a safe health result',async()=>{
  const r=await fetch(base+'/v1/health');assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok',version:'0.1.0'});
});
test('API readiness fails without a configured runtime database',async()=>{
  const r=await fetch(base+'/v1/ready',{headers:{'accept-language':'en'}});assert.equal(r.status,503);assert.equal((await r.json()).code,'DATABASE_UNAVAILABLE');
});
test('business API cannot be unlocked with forged user and tenant headers',async()=>{
  const r=await fetch(base+'/v1/organizations/20000000-0000-0000-0000-000000000001/customers',{
    headers:{'accept-language':'en','x-user-id':'10000000-0000-0000-0000-000000000001','x-organization-id':'20000000-0000-0000-0000-000000000001',authorization:'Bearer forged'},
  });
  assert.equal(r.status,401);const body=await r.json();assert.equal(body.code,'AUTHENTICATION_REQUIRED');assert.match(body.message,/Sign in/);
});
test('business API error code stays constant when switching language',async()=>{
  const url=base+'/v1/organizations/20000000-0000-0000-0000-000000000001/customers';
  const th=await (await fetch(url,{headers:{'accept-language':'th'}})).json();
  const en=await (await fetch(url,{headers:{'accept-language':'en'}})).json();
  assert.equal(th.code,en.code);assert.notEqual(th.message,en.message);assert.match(th.message,/เข้าสู่ระบบ/);
});
