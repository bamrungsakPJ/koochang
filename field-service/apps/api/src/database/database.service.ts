import { ForbiddenException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 3000 }) : undefined;
  get configured(): boolean { return Boolean(this.pool); }
  async isReady(): Promise<boolean> {
    if (!this.pool) return false;
    try { const r = await this.pool.query('SELECT current_user AS role, rolsuper, rolbypassrls, to_regclass($1) AS table_name FROM pg_roles WHERE rolname=current_user', ['core.customers']);
      return r.rows[0]?.role === 'fs_api' && !r.rows[0]?.rolsuper && !r.rows[0]?.rolbypassrls && Boolean(r.rows[0]?.table_name);
    } catch { return false; }
  }
  /** Internal use only: userId must come from a verified server-side session.
   * Do not call this with x-user-id, unverified JWT claims, or arbitrary body fields.
   * Role, assignment, subscription, quota and optimistic version checks belong inside the transaction.
   */
  async withTenant<T>(verifiedUserId: string, organizationId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool || !uuid.test(verifiedUserId) || !uuid.test(organizationId)) throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
    return this.transaction(async client => {
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.organization_id', $2, true)", [verifiedUserId, organizationId]);
      const result = await client.query('SELECT core.tenant_allowed($1::uuid) AS allowed', [organizationId]);
      if (!result.rows[0]?.allowed) throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
      return operation(client);
    }, () => new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' }));
  }
  /** Identity work that happens before a tenant context exists. Only the auth.* functions are
   * reachable for fs_api here; they check the caller themselves. */
  async identity<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    return this.transaction(operation, () => new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' }));
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>, privileged: () => Error): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool!.connect(); }
    catch { throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' }); }
    try {
      await client.query('BEGIN');
      const identity = await client.query('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
      if (identity.rows[0]?.role !== 'fs_api' || identity.rows[0]?.rolsuper || identity.rows[0]?.rolbypassrls) throw privileged();
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool?.end(); }
}
