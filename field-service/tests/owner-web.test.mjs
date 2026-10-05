import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual browser transport with isolated tab storage and HTTP responses. No secrets,
// shop database or browser profiles are read. Native mobile modules are not loaded by this client.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const storageSource = await readFile(new URL('../apps/admin/app/shop/storage.ts', import.meta.url), 'utf8');
const storageUrl = dataUrl(compile(storageSource));
const source = await readFile(new URL('../apps/admin/app/shop/api.ts', import.meta.url), 'utf8');
const { Api, ApiFailure } = await import(dataUrl(compile(source).replace("'./storage'", JSON.stringify(storageUrl))));
const { storage, keys } = await import(storageUrl);
function memory() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function environment(t) {
  t.mock.method(globalThis, 'fetch');
  globalThis.sessionStorage = memory(); globalThis.localStorage = memory();
  t.after(() => { delete globalThis.sessionStorage; delete globalThis.localStorage; });
  return new Api();
}
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('owner list requests preserve search and filters while requesting another page', async t => {
  const client = environment(t); await client.setTokens({ access_token: 'owner', refresh_token: 'refresh' });
  const urls = []; globalThis.fetch.mock.mockImplementation(async url => { urls.push(new URL(url)); return response(200, { items: [], has_more: false, next_offset: null }); });
  await client.customers('shop', 'สมชาย & Sons', 50, 50);
  assert.equal(urls[0].searchParams.get('q'), 'สมชาย & Sons');
  assert.equal(urls[0].searchParams.get('offset'), '50'); assert.equal(urls[0].searchParams.get('limit'), '50');
  await client.jobs('shop', { status: 'completed', assignee: 'member', from: '2026-10-04', to: '2026-10-05', offset: '100', limit: '50' });
  assert.equal(urls[1].searchParams.get('status'), 'completed'); assert.equal(urls[1].searchParams.get('assignee'), 'member');
  assert.equal(urls[1].searchParams.get('from'), '2026-10-04'); assert.equal(urls[1].searchParams.get('offset'), '100');
});

test('owner web tab tokens are separate from platform sessions and survive an API network failure', async t => {
  const client = environment(t);
  sessionStorage.setItem('console.session', 'platform-token');
  await client.setTokens({ access_token: 'shop-access', refresh_token: 'shop-refresh' });
  globalThis.fetch.mock.mockImplementation(async () => { throw Error('API restarted'); });
  let signedOut = false; client.onSignedOut = () => { signedOut = true; };
  await assert.rejects(client.me(), e => e instanceof ApiFailure && e.code === 'NETWORK_ERROR');
  assert.equal(signedOut, false); assert.equal(await storage.get(keys.access), 'shop-access');
  const restored = new Api(); assert.equal(await restored.restore(), true);
  globalThis.fetch.mock.mockImplementation(async () => response(200, { user: { id: 'owner' }, memberships: [] }));
  assert.equal((await restored.me()).user.id, 'owner');
  assert.equal(sessionStorage.getItem('console.session'), 'platform-token');
});
test('an expired owner web session rotates tokens once and retries with the new identity', async t => {
  const client = environment(t); await client.setTokens({ access_token: 'old-access', refresh_token: 'old-refresh' });
  const calls = [];
  globalThis.fetch.mock.mockImplementation(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/refresh')) return response(200, { access_token: 'new-access', refresh_token: 'new-refresh' });
    return init.headers.authorization === 'Bearer new-access' ? response(200, { user: { id: 'owner' } }) : response(401, { code: 'SESSION_EXPIRED' });
  });
  assert.equal((await client.me()).user.id, 'owner');
  assert.equal(calls.filter(c => c.url.endsWith('/auth/refresh')).length, 1);
  assert.equal(await storage.get(keys.refresh), 'new-refresh');
});
test('refresh service outage keeps the owner signed in; revoked refresh clears only shop tokens', async t => {
  const client = environment(t); await client.setTokens({ access_token: 'old', refresh_token: 'refresh' });
  sessionStorage.setItem('console.session', 'staff'); let signedOut = 0; client.onSignedOut = () => signedOut++;
  globalThis.fetch.mock.mockImplementation(async url => response(url.endsWith('/auth/refresh') ? 503 : 401, { code: url.endsWith('/auth/refresh') ? 'DATABASE_UNAVAILABLE' : 'SESSION_EXPIRED' }));
  await assert.rejects(client.me(), e => e.code === 'NETWORK_ERROR');
  assert.equal(client.signedIn, true); assert.equal(signedOut, 0);
  globalThis.fetch.mock.mockImplementation(async () => response(401, { code: 'SESSION_EXPIRED' }));
  await assert.rejects(client.me()); assert.equal(client.signedIn, false); assert.equal(signedOut, 1);
  assert.equal(sessionStorage.getItem('console.session'), 'staff');
});
test('owner photo upload sends raw bytes and explicit mime type rather than JSON', async t => {
  const client = environment(t); await client.setTokens({ access_token: 'owner', refresh_token: 'refresh' });
  let sent; globalThis.fetch.mock.mockImplementation(async (url, init) => { sent = init; return response(200, { id: 'asset', status: 'ready' }); });
  const bytes = new Blob(['synthetic image bytes'], { type: 'image/png' });
  await client.uploadMedia('shop', 'asset', bytes, 'image/png');
  assert.equal(sent.body, bytes); assert.equal(sent.headers['content-type'], 'image/png'); assert.equal(sent.headers.authorization, 'Bearer owner');
});

test('saves report success or failure once; reads, sign-in, photo steps and duplicate questions do not', async t => {
  const client = environment(t); await client.setTokens({ access_token: 'owner', refresh_token: 'refresh' });
  const events = []; client.onSave = (ok, error) => events.push([ok, error?.code ?? null]);
  const replies = [];
  globalThis.fetch.mock.mockImplementation(async () => replies.shift() ?? response(200, {}));
  await client.customers('shop', '', 0, 50);
  await client.updateCustomer('shop', 'c1', { expected_version: 1, name: 'A' });
  replies.push(response(409, { code: 'VERSION_CONFLICT', message: 'ข้อมูลถูกแก้ไขแล้ว' }));
  await assert.rejects(client.updateCustomer('shop', 'c1', { expected_version: 1, name: 'B' }));
  replies.push(response(409, { code: 'DUPLICATE_WARNING', message: '', candidates: [{ id: 'x', name: 'A', phone_normalized: null }] }));
  await assert.rejects(client.createCustomer('shop', { request_key: 'k', name: 'A' }));
  await client.markRead('shop');
  await client.createMedia('shop', { request_key: 'k', mime_type: 'image/jpeg', byte_size: 10, purpose: 'equipment' });
  await client.requestOtp('+66812345678');
  replies.push(response(503, {})); 
  await assert.rejects(client.changeJoinLink('shop', 'rotate'));
  assert.deepEqual(events, [[true, null], [false, 'VERSION_CONFLICT'], [false, 'INTERNAL_ERROR']]);
});
