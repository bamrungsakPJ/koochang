import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const storageUrl=url(`export const values=new Map(); export const keys={tokens:'tokens',access:'access',refresh:'refresh'}; export const storage={get:async k=>values.get(k)??null,set:async(k,v)=>{if(v===null)values.delete(k);else values.set(k,v)}};`);
// The offline copy (./cache) uses the device file system; these tests run with no saved copy.
const cacheUrl=url(`export const cacheable=()=>false; export const clearCache=()=>{}; export const readCache=async()=>null; export const writeCache=()=>{};`);
const source=await readFile(new URL('../apps/mobile/src/api.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./storage'",JSON.stringify(storageUrl)).replace("'./cache'",JSON.stringify(cacheUrl));
const {Api}=await import(url(code));const {values,keys,storage}=await import(storageUrl);
const response=(status,data)=>new Response(JSON.stringify(data),{status});
function setup(t,fn){values.clear();t.mock.method(globalThis,'fetch',fn);t.after(()=>t.mock.restoreAll());}
test('mobile raw image upload sends original binary bytes and mime type',async t=>{
 const bytes=new Uint8Array([255,216,255,224,42]).buffer;
 setup(t,async(_url,opts)=>{assert.equal(opts.body,bytes);assert.equal(opts.headers['content-type'],'image/jpeg');assert.equal(opts.headers.authorization,'Bearer access');return response(200,{id:'photo',status:'ready'});});
 const client=new Api();await client.setTokens({access_token:'access',refresh_token:'refresh'});
 assert.equal((await client.uploadMedia('shop','photo',bytes,'image/jpeg')).status,'ready');
});
test('mobile session persists as one pair and rotates expired tokens on reopen',async t=>{
 let calls=0;setup(t,async(url,opts)=>{calls++;if(url.endsWith('/auth/refresh')){assert.equal(JSON.parse(opts.body).refresh_token,'old-refresh');return response(200,{access_token:'new-access',refresh_token:'new-refresh'});}return opts.headers.authorization==='Bearer old-access'?response(401,{code:'SESSION_EXPIRED'}):response(200,{user:{id:'user'}});});
 const first=new Api();await first.setTokens({access_token:'old-access',refresh_token:'old-refresh'});
 const reopened=new Api();assert.equal(await reopened.restore(),true);assert.equal((await reopened.me()).user.id,'user');assert.equal(calls,3);assert.equal(JSON.parse(values.get(keys.tokens)).refresh_token,'new-refresh');
});
test('legacy split tokens restore and migrate on rotation',async t=>{
 setup(t,async()=>response(200,{}));values.set(keys.access,'legacy-access');values.set(keys.refresh,'legacy-refresh');const client=new Api();assert.equal(await client.restore(),true);
 await client.setTokens({access_token:'new',refresh_token:'new-refresh'});assert.ok(values.has(keys.tokens));assert.ok(!values.has(keys.access));assert.ok(!values.has(keys.refresh));
});
test('refresh-only stored session survives network failure and recovers',async t=>{
 let online=false;setup(t,async url=>{if(!online)throw Error('offline');return response(200,url.endsWith('/auth/refresh')?{access_token:'access',refresh_token:'rotated'}:{user:{id:'user'}});});
 values.set(keys.tokens,JSON.stringify({access_token:null,refresh_token:'refresh'}));const client=new Api();assert.equal(await client.restore(),true);let signedOut=false;client.onSignedOut=()=>signedOut=true;
 await assert.rejects(client.me(),e=>e.code==='NETWORK_ERROR');assert.equal(client.signedIn,true);assert.equal(signedOut,false);assert.ok(values.has(keys.tokens));online=true;assert.equal((await client.me()).user.id,'user');
});
test('revoked refresh clears local session and calls signed-out callback',async t=>{
 setup(t,async()=>response(401,{code:'SESSION_EXPIRED'}));const client=new Api();await client.setTokens({access_token:'access',refresh_token:'refresh'});let signedOut=false;client.onSignedOut=()=>signedOut=true;
 await assert.rejects(client.me());assert.equal(client.signedIn,false);assert.equal(signedOut,true);assert.ok(!values.has(keys.tokens));
});
test('failed secure token write does not report a signed-in persistent session',async t=>{
 setup(t,async()=>response(200,{}));t.mock.method(storage,'set',async()=>{throw Error('SESSION_STORAGE_UNAVAILABLE')});const client=new Api();await assert.rejects(client.setTokens({access_token:'access',refresh_token:'refresh'}),/SESSION_STORAGE_UNAVAILABLE/);assert.equal(client.signedIn,false);
});
