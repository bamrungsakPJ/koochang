// Connection check for the ITISME receipts integration, with the settings saved in the console (the same ones the
// worker uses; the password stays sealed and is never printed). Calls only dbo.sp_KC_Company, which reads the
// company row: no document is issued.
//   node --env-file=/etc/field-service/staging.env scripts/itisme-check.mjs [--database ITISME_Test]
import { Pool } from 'pg';
import { loadPlatformSettings } from '../apps/api/dist/config.js';
import { connectItisme } from '../apps/api/dist/billing/tax-documents.js';
import { decrypt } from '../apps/api/dist/shared/crypto.js';

const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error('WORKER_DATABASE_URL_REQUIRED');
const override = process.argv.includes('--database') ? process.argv[process.argv.indexOf('--database') + 1] : undefined;
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const s = (await pool.query('SELECT worker.itisme_settings() AS v')).rows[0]?.v;
  const key = loadPlatformSettings().secretKey;
  if (!s) { console.log('ITISME_NOT_CONFIGURED'); process.exit(2); }
  const database = override ?? s.database;
  console.log(`settings: enabled=${s.enabled} server=${s.server}:${s.port ?? 1433} database=${database}${override ? ' (override)' : ''} user=${s.user} password=${s.passwordSealed ? 'saved' : 'missing'}`);
  if (!s.passwordSealed || !key) { console.log('ITISME_PASSWORD_OR_SECRET_MISSING'); process.exit(2); }
  const started = Date.now();
  let client;
  try {
    client = await connectItisme({ server: s.server, port: s.port ?? 1433, database, user: s.user, password: decrypt(key, s.passwordSealed) });
    const company = await client.company();
    console.log(`OK in ${Date.now() - started} ms: ${company.CompanyName} / tax id ${company.TaxID ?? '-'} / ${company.HQ === '1' ? 'head office' : `branch ${company.BranchNo ?? '-'}`}`);
  } catch (error) {
    console.log(`FAILED in ${Date.now() - started} ms: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally { await client?.close().catch(() => {}); }
} finally { await pool.end(); }
