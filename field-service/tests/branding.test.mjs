import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { openTestDatabase } from './support/database.mjs';
import { BrandingController, BrandingSettingsController } from '../apps/api/dist/platform/branding.controller.js';
import { PlatformDatabaseService } from '../apps/api/dist/platform/platform-database.service.js';
import { PlatformGuard } from '../apps/api/dist/platform/platform.guard.js';
import { randomToken, sha256Hex } from '../apps/api/dist/shared/crypto.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
let db, app, base, superAdmin, platformAdmin;

async function role(name, fn) { await db.exec(`BEGIN;SET LOCAL ROLE ${name};`); try { const r = await fn(db); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } }
async function account(roleCode) {
  const id = (await db.query("INSERT INTO platform.accounts(display_name,email,password_hash,mfa_enrolled) VALUES('Brand tester',$1,'x',true) RETURNING id", [`${randomUUID()}@test.invalid`])).rows[0].id;
  await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2', [id, roleCode]);
  const token = randomToken();
  await db.query("INSERT INTO platform.sessions(account_id,token_hash,mfa_verified_at,step_up_at,expires_at) VALUES($1,$2,now(),now(),now()+interval '1 hour')", [id, sha256Hex(token)]);
  return { id, token };
}
const image = (width, height, format = 'png') => sharp({ create: { width, height, channels: 4, background: { r: 20, g: 90, b: 200, alpha: 1 } } })[format]().toBuffer();
const upload = (who, kind, version, body, type = 'image/png') => fetch(`${base}/platform/branding/${kind}?version=${version}`,
  { method: 'POST', headers: { authorization: `Bearer ${who.token}`, 'content-type': type }, body });
const reset = (who, kind, version) => fetch(`${base}/platform/branding/reset`,
  { method: 'POST', headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind, version }) });
const summary = async () => (await fetch(`${base}/branding`)).json();
const fetchImage = async (kind, v) => { const r = await fetch(`${base}/branding/${kind}.png${v ? `?v=${v}` : ''}`); return { r, body: Buffer.from(await r.arrayBuffer()) }; };

before(async () => {
  db = await openTestDatabase('branding');
  superAdmin = await account('super_admin'); platformAdmin = await account('platform_admin');
  const database = { configured: true, run: fn => role('fs_platform', fn) };
  const { Module } = require('@nestjs/common'), { NestFactory } = require('@nestjs/core');
  class TestModule {}
  Module({ controllers: [BrandingController, BrandingSettingsController], providers: [PlatformGuard, { provide: PlatformDatabaseService, useValue: database }] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false, rawBody: true });
  app.useBodyParser('raw', { type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '12mb' });
  app.setGlobalPrefix('v1');
  app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
  await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/v1`;
});
after(async () => { await app?.close(); await db?.close(); });

test('nothing is set at first; images answer 404 and the summary is public', async () => {
  assert.deepEqual(await summary(), { version: 0, logo: false, favicon: false, favicon_custom: false, updated_at: null });
  assert.equal((await fetchImage('logo')).r.status, 404);
});

test('only a super admin may change the brand', async () => {
  const response = await upload(platformAdmin, 'logo', 0, await image(100, 100));
  assert.equal(response.status, 403);
  assert.equal((await fetch(`${base}/platform/branding/logo?version=0`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await image(10, 10) })).status, 401);
});

test('a logo is re-encoded (max 512 px PNG) and also becomes the 64 px favicon', async () => {
  const response = await upload(superAdmin, 'logo', 0, await image(1200, 300, 'jpeg'), 'image/jpeg');
  assert.equal(response.status, 200);
  const brand = await response.json();
  assert.equal(brand.version, 1); assert.equal(brand.logo, true); assert.equal(brand.favicon, true); assert.equal(brand.favicon_custom, false);
  const logo = await fetchImage('logo', 1);
  assert.equal(logo.r.headers.get('content-type'), 'image/png');
  assert.match(logo.r.headers.get('cache-control'), /immutable/);
  assert.equal(logo.r.headers.get('content-security-policy'), "default-src 'none'");
  const meta = await sharp(logo.body).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 512, 128]);
  const favicon = await sharp((await fetchImage('favicon')).body).metadata();
  assert.deepEqual([favicon.width, favicon.height], [64, 64]);
  assert.match((await fetchImage('favicon', 999)).r.headers.get('cache-control'), /max-age=300/, 'stale version is cached briefly');
  const audit = (await db.query("SELECT details FROM platform.audit_logs WHERE action='branding.updated' AND actor_account_id=$1", [superAdmin.id])).rows;
  assert.deepEqual(audit.map(r => r.details.change), ['logo']);
});

test('stale versions conflict; SVG, other files and broken images are refused', async () => {
  assert.equal((await upload(superAdmin, 'logo', 0, await image(50, 50))).status, 409);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  for (const [body, type] of [[svg, 'application/octet-stream'], [Buffer.from('not an image'), 'image/png'], [Buffer.from('GIF89a'), 'image/png']]) {
    const response = await upload(superAdmin, 'logo', 1, body, type);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal((await fetch(`${base}/platform/branding/banner?version=1`, { method: 'POST', headers: { authorization: `Bearer ${superAdmin.token}`, 'content-type': 'image/png' }, body: await image(10, 10) })).status, 404);
  assert.equal((await summary()).version, 1, 'refused uploads change nothing');
});

test('a custom favicon survives a new logo; resets go back to the logo favicon, then to nothing', async () => {
  const red = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  let brand = await (await upload(superAdmin, 'favicon', 1, red)).json();
  assert.equal(brand.favicon_custom, true); assert.equal(brand.version, 2);
  const customFavicon = (await fetchImage('favicon')).body;
  brand = await (await upload(superAdmin, 'logo', 2, await image(400, 400))).json();
  assert.equal(brand.version, 3);
  assert.ok((await fetchImage('favicon')).body.equals(customFavicon), 'custom favicon kept when the logo changes');

  brand = await (await reset(superAdmin, 'favicon', 3)).json();
  assert.equal(brand.favicon_custom, false); assert.equal(brand.favicon, true);
  assert.ok(!(await fetchImage('favicon')).body.equals(customFavicon), 'favicon now made from the logo');

  brand = await (await reset(superAdmin, 'logo', 4)).json();
  assert.deepEqual([brand.logo, brand.favicon], [false, false]);
  assert.equal((await fetchImage('favicon')).r.status, 404);
  assert.equal((await reset(superAdmin, 'logo', 4)).status, 409);
});

test('the API role cannot read or write branding directly', async () => {
  await assert.rejects(role('fs_api', c => c.query('SELECT padmin.branding()')), e => e.code === '42501');
  await assert.rejects(role('fs_platform', c => c.query('SELECT * FROM platform.branding')), e => e.code === '42501');
});
