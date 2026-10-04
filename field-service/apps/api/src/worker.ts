import { Pool } from 'pg';
import { translate, type TranslationKey } from '@field-service/i18n';
import { normalizeLanguage } from '@field-service/core';
import { loadMediaSettings } from './config.js';
import { createStorage, type ObjectStorage } from './media/object-storage.js';
import { createOcrProvider, TemporaryOcrError, type OcrProvider } from './ocr/ocr.provider.js';
import { createPushSender, TemporaryPushError, type PushSender } from './notifications/push.sender.js';

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
  for (const job of jobs) {
    let outcome = 'failed', result: unknown = null, error: string | null = null;
    try {
      if (!deps.ocr || !deps.storage) throw new Error('OCR_UNAVAILABLE');
      const read = await deps.ocr.read(await deps.storage.get(job.object_key));
      outcome = 'succeeded'; result = read;
    } catch (e) {
      outcome = e instanceof TemporaryOcrError ? 'retry' : 'failed';
      error = e instanceof Error ? e.message.slice(0, 80) : 'OCR_FAILED';
    }
    await deps.pool.query('SELECT worker.finish_ocr($1,$2,$3,$4,$5,$6)', [job.id, outcome, deps.ocr?.name ?? null, result, error, 30 * job.attempts]);
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
  await deps.pool.query('SELECT worker.requeue_stale_ocr(600)');
  const reminders = (await deps.pool.query('SELECT worker.scan_subscriptions(now()) AS n')).rows[0].n as number
    + ((await deps.pool.query('SELECT worker.scan_maintenance(now()) AS n')).rows[0].n as number);
  const housekeeping = (await deps.pool.query('SELECT worker.housekeeping() AS r')).rows[0].r;
  return { reminders, housekeeping };
}

async function main() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url) throw new Error('WORKER_DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: url, max: 4 });
  await verifyWorkerRole(pool);
  const deps: WorkerDeps = { pool, storage: createStorage(loadMediaSettings().mediaDir), ocr: createOcrProvider(), push: createPushSender(), log: console.log };
  console.log(`worker started: ocr=${deps.ocr?.name ?? 'none'} push=${deps.push?.name ?? 'none'} storage=${deps.storage?.kind ?? 'none'}`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let lastScheduled = 0;
  while (!stopping) {
    try {
      const busy = (await runOcr(deps)) + (await runPush(deps));
      if (Date.now() - lastScheduled > 15 * 60_000) { await runScheduled(deps); lastScheduled = Date.now(); }
      if (!busy) await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('WORKER_LOOP_ERROR', error instanceof Error ? error.message : error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  await pool.end();
}

if (process.argv[1] && /worker\.js$/.test(process.argv[1])) void main().catch(error => { console.error('WORKER_START_FAILED', error instanceof Error ? error.message : ''); process.exitCode = 1; });
