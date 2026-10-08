import { readFile, rename, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { translate, type TranslationKey } from '@field-service/i18n';
import { normalizeLanguage } from '@field-service/core';
import { loadMediaSettings, loadPlatformSettings } from './config.js';
import { createStorage, type ObjectStorage } from './media/object-storage.js';
import { RuntimeOcrProvider, TemporaryOcrError, type OcrProvider } from './ocr/ocr.provider.js';
import { createPushSender, TemporaryPushError, type PushSender } from './notifications/push.sender.js';
import { StripeService } from './billing/stripe.service.js';

/** Background worker: OCR queue, push deliveries, subscription reminders and housekeeping.
 * Connects as fs_worker, which can only call worker.* functions. Every job is claimed with
 * SKIP LOCKED and finished idempotently, so several workers or a restart never double-count. */
export interface WorkerDeps { pool: Pool; storage: ObjectStorage | null; ocr: OcrProvider | null; push: PushSender | null; log?: (message: string) => void }

export async function verifyWorkerRole(pool: Pool): Promise<void> {
  const r = await pool.query('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (r.rows[0]?.role !== 'fs_worker' || r.rows[0]?.rolsuper || r.rows[0]?.rolbypassrls) throw new Error('WORKER_ROLE_REQUIRED');
}

export async function runOcr(deps: WorkerDeps, limit = 5): Promise<number> {
  const jobs = (await deps.pool.query('SELECT * FROM worker.claim_ocr($1)', [limit])).rows;
  const provider = jobs.length ? await deps.ocr?.resolve() : null;
  for (const job of jobs) {
    let outcome = 'failed', result: unknown = null, error: string | null = null;
    try {
      if (!provider || !deps.storage) throw new Error('OCR_UNAVAILABLE');
      const read = await provider.read(await deps.storage.get(job.object_key));
      outcome = 'succeeded'; result = read;
    } catch (e) {
      outcome = e instanceof TemporaryOcrError ? 'retry' : 'failed';
      error = e instanceof Error ? e.message.slice(0, 80) : 'OCR_FAILED';
    }
    await deps.pool.query('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)', [job.id, outcome, provider?.name ?? null, result, error, 30 * job.attempts]);
  }
  return jobs.length;
}

/** Push text comes from the shared catalog in the recipient's language. Lock-screen text avoids
 * customer details; opening it re-checks permissions in the app. */
export function pushText(template: string, parameters: Record<string, string>, language: string) {
  const lang = normalizeLanguage(language);
  const key = `notify.${template}` as TranslationKey;
  return { title: translate(lang, 'appName'), body: translate(lang, key, parameters) };
}

export async function runPush(deps: WorkerDeps, limit = 20): Promise<number> {
  const jobs = (await deps.pool.query('SELECT * FROM worker.claim_deliveries($1)', [limit])).rows;
  for (const job of jobs) {
    let outcome = 'skipped', error: string | null = null;
    if (deps.push) {
      try {
        const text = pushText(job.template_key, job.parameters ?? {}, job.language);
        outcome = await deps.push.send({ token: job.token, platform: job.platform, ...text,
          data: { organization_id: job.organization_id, target_type: job.target_type ?? '', target_id: job.target_id ?? '' } });
      } catch (e) {
        outcome = e instanceof TemporaryPushError ? 'retry' : 'failed';
        error = e instanceof Error ? e.message.slice(0, 120) : 'PUSH_FAILED';
      }
    }
    await deps.pool.query('SELECT worker.finish_delivery($1,$2,$3)', [job.id, outcome, error]);
  }
  return jobs.length;
}

export async function runScheduled(deps: WorkerDeps): Promise<{ reminders: number; housekeeping: unknown }> {
  await deps.pool.query('SELECT worker.expire_exports()');
  await deps.pool.query('SELECT worker.requeue_stale_ocr(600)');
  const reminders = (await deps.pool.query('SELECT worker.scan_subscriptions(now()) AS n')).rows[0].n as number
    + ((await deps.pool.query('SELECT worker.scan_suspensions(now()) AS n')).rows[0].n as number)
    + ((await deps.pool.query('SELECT worker.scan_maintenance(now()) AS n')).rows[0].n as number)
    + ((await deps.pool.query('SELECT worker.scan_plan_changes(now()) AS n')).rows[0].n as number);
  const housekeeping = (await deps.pool.query('SELECT worker.housekeeping() AS r')).rows[0].r;
  return { reminders, housekeeping };
}

/** Delete only private image keys queued by approved privacy execution. Failed deletes remain retryable. */
export async function runErasure(deps:WorkerDeps,limit=20):Promise<number>{
 if(!deps.storage)return 0;
 const jobs=(await deps.pool.query('SELECT * FROM worker.claim_erasure($1)',[limit])).rows;
 for(const job of jobs){let ok=false;try{await deps.storage.delete(job.object_key);ok=true;}catch{/* Keep keys and provider errors out of logs. */}
  await deps.pool.query('SELECT worker.finish_erasure($1,$2)',[job.id,ok]);}
 return jobs.length;
}

type RegistryEntry = { organization_id: string; erased_at: string };

async function readRegistry(file: string): Promise<RegistryEntry[]> {
  try { const data = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(data) ? data.filter(e => typeof e?.organization_id === 'string') : []; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}

/** Erased shops are also kept in a file outside the database (ERASURE_REGISTRY_FILE, on storage that is
 * not restored together with the database). The file only grows: a restore that loses a tombstone does
 * not remove it from here. Returns the number of entries after the merge. */
export async function syncErasureRegistry(deps: WorkerDeps, file: string): Promise<number> {
  const current = (await deps.pool.query('SELECT worker.erasure_registry() AS v')).rows[0].v as RegistryEntry[];
  const merged = new Map((await readRegistry(file)).map(e => [e.organization_id, e]));
  let changed = false;
  for (const e of current) if (!merged.has(e.organization_id)) { merged.set(e.organization_id, e); changed = true; }
  if (changed) {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify([...merged.values()], null, 1));
    await rename(tmp, file);
  }
  return merged.size;
}

/** After restoring a backup, run before the API is opened: re-applies every erasure known to the
 * database or the registry file and queues the image keys for deletion again. */
export async function replayErasure(deps: WorkerDeps, file: string | undefined): Promise<number> {
  const ids = file ? (await readRegistry(file)).map(e => e.organization_id) : [];
  return (await deps.pool.query('SELECT worker.replay_erasure($1::uuid[]) AS n', [ids])).rows[0].n as number;
}

async function main() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url) throw new Error('WORKER_DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: url, max: 4 });
  await verifyWorkerRole(pool);
  const platform = loadPlatformSettings();
  const deps: WorkerDeps = { pool, storage: createStorage(loadMediaSettings().mediaDir), ocr: new RuntimeOcrProvider(async () => (await pool.query('SELECT worker.ocr_settings() AS value')).rows[0].value, platform.secretKey), push: createPushSender(), log: console.log };
  const stripe = StripeService.forPool(platform, pool);
  const registry = process.env.ERASURE_REGISTRY_FILE || undefined;
  if (process.argv.includes('replay-erasure')) {
    const n = await replayErasure(deps, registry);
    console.log(`erasure replayed for ${n} shop(s); registry=${registry ? 'file' : 'database only'}. Keep the worker running to delete restored images.`);
    await pool.end();
    return;
  }
  console.log(`worker started: ocr=${deps.ocr?.name ?? 'none'} push=${deps.push?.name ?? 'none'} storage=${deps.storage?.kind ?? 'none'} erasure-registry=${registry ? 'file' : 'none'}`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let lastScheduled = 0;
  while (!stopping) {
    try {
      const busy = (await runOcr(deps)) + (await runPush(deps)) + (await runErasure(deps));
      if (registry) await syncErasureRegistry(deps, registry);
      if (Date.now() - lastScheduled > 15 * 60_000) {
        await runScheduled(deps); lastScheduled = Date.now();
        // "Stop renewal" set by the platform (e.g. privacy erasure) must reach Stripe before it charges.
        await stripe.pushRenewalFlags().catch(error => console.error('STRIPE_RENEWAL_SYNC_ERROR', error instanceof Error ? error.message.slice(0, 120) : ''));
        // Plan changes that reached a card subscription must reach Stripe before its next charge.
        await stripe.pushPrices().catch(error => console.error('STRIPE_PRICE_SYNC_ERROR', error instanceof Error ? error.message.slice(0, 120) : ''));
        // Permanently suspended shops (made permanent by runScheduled above) stop being charged.
        await stripe.stopSuspendedSubscriptions().catch(error => console.error('STRIPE_SUSPENSION_SYNC_ERROR', error instanceof Error ? error.message.slice(0, 120) : ''));
      }
      if (!busy) await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('WORKER_LOOP_ERROR', error instanceof Error ? error.message : error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  await pool.end();
}

// pm2 starts scripts through its own wrapper; the real path is then in pm_exec_path.
const entry = process.env.pm_exec_path ?? process.argv[1];
if (entry && /worker\.js$/.test(entry)) void main().catch(error => { console.error('WORKER_START_FAILED', error instanceof Error ? error.message : ''); process.exitCode = 1; });
