import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(724005)');
    const role = await client.query('SELECT current_user AS name');
    if (role.rows[0].name !== 'fs_migrator') throw Error('MIGRATION_ROLE_REQUIRED');
    await client.query('CREATE SCHEMA IF NOT EXISTS migration');
    await client.query('CREATE TABLE IF NOT EXISTS migration.history (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../database/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = await client.query('SELECT checksum FROM migration.history WHERE name=$1', [name]);
      if (old.rowCount) { if (old.rows[0].checksum !== checksum) throw Error('MIGRATION_CHECKSUM_CHANGED'); continue; }
      try {
        await client.query('BEGIN'); await client.query(sql);
        await client.query('INSERT INTO migration.history(name,checksum) VALUES($1,$2)', [name,checksum]);
        await client.query('COMMIT'); console.log('Applied', name);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(724005)').catch(() => {}); client.release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw Error('MIGRATION_DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: url });
  try { await migrate(pool); } catch { console.error('MIGRATION_FAILED: inspect database logs without publishing credentials'); process.exitCode = 1; }
  finally { await pool.end(); }
}
