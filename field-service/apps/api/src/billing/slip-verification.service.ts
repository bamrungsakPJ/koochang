import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { EasySlip } from './easyslip.js';

/** Trusted worker connection: fs_api cannot confirm a payment or grant an entitlement. */
@Injectable()
export class SlipVerificationService implements OnModuleDestroy {
  private readonly pool = process.env.SLIP_DATABASE_URL ? new Pool({ connectionString: process.env.SLIP_DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 }) : undefined;
  private readonly provider = new EasySlip();
  async verify(proofId: string, image: Buffer): Promise<void> {
    if (!this.pool) return; // submit defaults to manual review, so missing credentials never strand a proof.
    const token = randomUUID();
    const run = async <T>(operation: (client: import('pg').PoolClient) => Promise<T>): Promise<T> => {
      const client = await this.pool!.connect();
      try {
        await client.query('BEGIN');
        const role = (await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
        if (role?.name !== 'fs_worker' || role.rolsuper || role.rolbypassrls) throw Error('SLIP_WORKER_ROLE_REQUIRED');
        const value = await operation(client); await client.query('COMMIT'); return value;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    try {
      const order = await run(async c => (await c.query('SELECT worker.claim_slip($1,$2) AS value', [proofId, token])).rows[0].value);
      if (!order) return;
      const result = await this.provider.verify(image, order);
      await run(c => c.query('SELECT worker.finish_slip($1,$2,$3::jsonb)', [proofId, token, JSON.stringify(result)]));
    } catch {
      // The proof remains pending and visible to admin. Never log provider keys or slip bodies.
      console.warn('Slip verification unavailable; proof remains in the billing review queue.');
    }
  }
  async onModuleDestroy() { await this.pool?.end(); }
}
