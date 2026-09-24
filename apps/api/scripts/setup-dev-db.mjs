// One-time dev database setup, run from the Windows dev machine:
//   node scripts/setup-dev-db.mjs
// Reads DB_HOST / SQL_ADMIN_USER / SQL_ADMIN_PASSWORD / DEV_DB_PASSWORD from .env,
// creates the databases + login on the Ubuntu SQL Server, writes DATABASE_URL(_TEST)
// into .env and then removes SQL_ADMIN_PASSWORD from the file. Secrets are never printed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env');
const sqlPath = path.join(here, '..', '..', '..', 'deploy', 'sql', 'dev-setup.sql');

const text = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), unquote(l.slice(l.indexOf('=') + 1).trim())]),
);

function unquote(v) {
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

const required = ['DB_HOST', 'SQL_ADMIN_USER', 'SQL_ADMIN_PASSWORD', 'DEV_DB_PASSWORD'];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Fill these in apps/api/.env first: ${missing.join(', ')}`);
  process.exit(1);
}

const [host, port = '1433'] = env.DB_HOST.split(':');
const result = spawnSync(
  'sqlcmd',
  ['-S', `${host},${port}`, '-U', env.SQL_ADMIN_USER, '-C', '-b', '-v', `DEV_DB_PASSWORD=${env.DEV_DB_PASSWORD}`, '-i', sqlPath],
  { env: { ...process.env, SQLCMDPASSWORD: env.SQL_ADMIN_PASSWORD }, encoding: 'utf8' },
);
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replaceAll(env.DEV_DB_PASSWORD, '***');
console.log(output.trim());
if (result.status !== 0) {
  console.error(`sqlcmd failed (exit ${result.status ?? result.error?.message})`);
  process.exit(1);
}

const url = (db) =>
  `sqlserver://${host}:${port};database=${db};user=serviceflow_dev;password={${env.DEV_DB_PASSWORD}};encrypt=true;trustServerCertificate=true`;

const updated = text
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url('serviceflow_dev')}`)
  .replace(/^DATABASE_URL_TEST=.*$/m, `DATABASE_URL_TEST=${url('serviceflow_test')}`)
  .replace(/^SQL_ADMIN_PASSWORD=.*$/m, 'SQL_ADMIN_PASSWORD=');
writeFileSync(envPath, updated);
console.log('Wrote DATABASE_URL and DATABASE_URL_TEST to .env; cleared SQL_ADMIN_PASSWORD.');
