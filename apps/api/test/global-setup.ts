import { execSync } from 'node:child_process';

/** Applies migrations to the test database once per run. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return;
  assertTestDatabase(url);
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

/** Tests wipe every table, so refuse anything that isn't obviously a test database. */
export function assertTestDatabase(url: string) {
  const db = /database=([^;]+)/i.exec(url)?.[1] ?? '';
  if (!/test/i.test(db)) {
    throw new Error(`DATABASE_URL_TEST must point at a database whose name contains "test" (got "${db}")`);
  }
}
