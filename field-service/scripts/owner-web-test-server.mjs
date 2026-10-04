/** Isolated owner-web QA fixture. Never starts against a dev/production shop database.
 * Run after API build: node --env-file=.env scripts/owner-web-test-server.mjs
 * API :4101, web :3101. Each run recreates only the guarded owner_web test database.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { openTestDatabase } from '../tests/support/database.mjs';

if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL_REQUIRED');
const base = new URL(process.env.TEST_DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(base.hostname) || !base.pathname.endsWith('_test')) throw Error('ISOLATED_LOCAL_TEST_DATABASE_REQUIRED');
const db = await openTestDatabase('owner_web');
const password = randomBytes(24).toString('hex');
await db.exec(`ALTER ROLE fs_api LOGIN PASSWORD '${password}'`);
const url = new URL(db.url); url.username = 'fs_api'; url.password = password;
// The API has its own connection pool. Holding the setup connection idle can terminate the
// fixture process when an SSH tunnel reconnects, so close it as soon as setup is finished.
await db.close();
const mediaDir = await mkdtemp(join(tmpdir(), 'fs-owner-web-'));
const { TEST_DATABASE_URL, MIGRATION_DATABASE_URL, SEED_DATABASE_URL, PLATFORM_DATABASE_URL, WORKER_DATABASE_URL, DATABASE_URL, SLIP_DATABASE_URL, EASYSLIP_API_KEY, ...safeEnv } = process.env;
const api = spawn(process.execPath, [fileURLToPath(new URL('../apps/api/dist/main.js', import.meta.url))], {
  env: { ...safeEnv, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '4101', DATABASE_URL: url.toString(),
    SMS_PROVIDER: 'development', OCR_PROVIDER: 'development', PUSH_PROVIDER: 'development',
    OTP_SECRET: randomBytes(32).toString('base64'), JOIN_LINK_KEY: randomBytes(32).toString('base64'), MEDIA_URL_SECRET: randomBytes(32).toString('base64'),
    MEDIA_DIR: mediaDir, ADMIN_ORIGIN: 'http://127.0.0.1:3101,http://localhost:3101', JOIN_LINK_BASE_URL: 'http://127.0.0.1:3101/join', OTP_CLIENT_HOURLY_LIMIT: '1000',
    PAYMENT_BANK_NAME: 'QA Test Bank', PAYMENT_ACCOUNT_NAME: 'QA Synthetic Platform', PAYMENT_ACCOUNT_NUMBER: '000-0-00000-0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
api.stdout.on('data', chunk => { output += chunk; for (const line of output.split('\n').slice(0, -1)) if (line.includes('[development SMS]')) console.log(line.trim()); output = output.split('\n').at(-1); });
api.stderr.on('data', chunk => process.stderr.write(chunk));
const require = createRequire(new URL('../apps/admin/package.json', import.meta.url));
const nextBin = require.resolve('next/dist/bin/next');
const web = spawn(process.execPath, [nextBin, 'dev', '--port', '3101', '--hostname', '127.0.0.1'], {
  cwd: fileURLToPath(new URL('../apps/admin/', import.meta.url)),
  env: { ...safeEnv, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4101', NEXT_DIST_DIR: '.next-owner-test', DEV_ALLOWED_ORIGINS: '127.0.0.1,localhost' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
web.stdout.on('data', chunk => process.stdout.write(chunk)); web.stderr.on('data', chunk => process.stderr.write(chunk));
let closing = false;
async function stopServer(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Next dev may spawn a server child; stop only this fixture's child process tree.
    await new Promise(resolve => { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); killer.once('exit', resolve); killer.once('error', resolve); });
  } else child.kill();
}
async function close(code = 0) {
  if (closing) return; closing = true; await Promise.all([stopServer(api), stopServer(web)]);
  const target = resolve(mediaDir), temporaryRoot = resolve(tmpdir());
  if (target.startsWith(`${temporaryRoot}\\`) || target.startsWith(`${temporaryRoot}/`)) {
    if (basename(target).startsWith('fs-owner-web-')) await rm(target, { recursive: true, force: true });
  }
  process.exit(code);
}
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
api.on('error', error => { console.error(error.message); void close(1); });
web.on('error', error => { console.error(error.message); void close(1); });
let ready = false;
for (let n = 0; n < 300; n++) {
  if (api.exitCode !== null || web.exitCode !== null) { console.error('QA server exited'); await close(1); }
  try { if ((await fetch('http://127.0.0.1:4101/v1/ready', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; console.log('OWNER WEB QA ready: http://127.0.0.1:3101/shop (isolated PostgreSQL test database)'); break; } } catch {}
  await setTimeout(200);
}
if (!ready) { console.error('QA API readiness timed out'); await close(1); }
