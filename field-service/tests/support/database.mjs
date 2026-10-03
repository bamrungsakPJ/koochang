import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';

const { Pool } = pg;
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** Fresh migrated + seeded database for one test file.
 * With TEST_DATABASE_URL (loopback host, name ending _test) each file gets its own database
 * `<base>_<name>_test`, recreated on every run, so files and repeated runs never collide.
 * Without it, an in-process PGlite instance is used (single connection, no concurrency). */
export async function openTestDatabase(name) {
  const db = process.env.TEST_DATABASE_URL ? await openPostgres(name) : await openPglite();
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_api') THEN CREATE ROLE fs_api NOSUPERUSER NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_migrator') THEN CREATE ROLE fs_migrator NOSUPERUSER NOBYPASSRLS; END IF;
  END $$;`);
  const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
  await db.exec(`GRANT CREATE ON DATABASE "${database.replaceAll('"', '""')}" TO fs_migrator; SET ROLE fs_migrator;`);
  await migrate(db.migrationAdapter());
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL('../../database/seeds/development.sql', import.meta.url), 'utf8'));
  return db;
}

function wrap(run) {
  const query = (sql, params) => run(sql, params);
  const exec = async sql => { const r = await run(sql); return Array.isArray(r) ? r : [r]; };
  return {
    query, exec,
    migrationAdapter: () => ({ connect: async () => ({
      query: async (sql, params) => {
        const r = params ? await query(sql, params) : (await exec(sql)).at(-1);
        return { ...r, rowCount: r.rows?.length || r.affectedRows || r.rowCount || 0 };
      },
      release: () => {},
    }) }),
  };
}

async function openPglite() {
  const lite = new PGlite(); await lite.waitReady;
  const run = async (sql, params) => params ? lite.query(sql, params) : (await lite.exec(sql)).at(-1);
  return { ...wrap(run), engine: 'pglite', close: () => lite.close() };
}

async function openPostgres(name) {
  const base = new URL(process.env.TEST_DATABASE_URL);
  if (!loopback.includes(base.hostname) || !base.pathname.endsWith('_test')) throw Error('ISOLATED_LOCAL_TEST_DATABASE_REQUIRED');
  const databaseName = `${base.pathname.slice(1).replace(/_test$/, '')}_${name}_test`;
  if (!/^[a-z0-9_]+$/.test(databaseName)) throw Error('INVALID_TEST_DATABASE_NAME');
  const admin = new Pool({ connectionString: base.toString(), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally { await admin.end(); }
  const url = new URL(base); url.pathname = `/${databaseName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 20 });
  const main = await pool.connect();
  const run = (sql, params) => main.query(sql, params);
  return {
    ...wrap(run), engine: 'postgres', url,
    /** Extra connection for concurrency tests. Caller must release it. */
    connect: () => pool.connect(),
    close: async () => { main.release(); await pool.end(); },
  };
}
