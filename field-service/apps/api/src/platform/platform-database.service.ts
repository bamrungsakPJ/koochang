import { ForbiddenException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { apiError } from '../shared/api-error.js';

/** Platform console connection (fs_platform). It reaches data only through padmin.* functions,
 * which check the account's permission themselves; the API checks it first as well. Without
 * PLATFORM_DATABASE_URL every platform route answers 503 (fail closed). */
@Injectable()
export class PlatformDatabaseService implements OnModuleDestroy {
  private readonly pool = process.env.PLATFORM_DATABASE_URL
    ? new Pool({ connectionString: process.env.PLATFORM_DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 }) : undefined;
  get configured(): boolean { return Boolean(this.pool); }

  async run<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch { throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' }); }
    try {
      await client.query('BEGIN');
      const identity = await client.query('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      if (identity.rows[0]?.role !== 'fs_platform' || identity.rows[0]?.rolsuper || identity.rows[0]?.rolbypassrls) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      // padmin.require raises insufficient_privilege when the account lacks the permission.
      if ((error as { code?: string }).code === '42501') throw apiError(403, 'PERMISSION_DENIED');
      throw error;
    } finally { client.release(); }
  }

  async onModuleDestroy() { await this.pool?.end(); }
}
