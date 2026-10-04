import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { AllowSuspended, TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';

/** Owner side of platform support: tickets, consent to (and revoke) time-limited read access by
 * a support agent, and data export requests. Technicians never reach it. */
@Controller('organizations/:organizationId/support')
@UseGuards(TenantGuard)
@AllowSuspended()
export class SupportController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async overview(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    return this.database.identity(async c => (await c.query('SELECT auth.support_overview($1,$2) AS v', [session.userId, tenant.organizationId])).rows[0].v);
  }

  @Post('tickets')
  async open(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const subject = check.text('subject', body.subject, { max: 200 });
    const text = check.text('body', body.body, { max: 4000 });
    check.done();
    const row = await this.database.identity(async c => (await c.query('SELECT * FROM auth.open_ticket($1,$2,$3,$4)', [session.userId, tenant.organizationId, subject, text])).rows[0]);
    if (row.outcome !== 'ok') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return { ticket_id: row.ticket_id };
  }

  @Post('tickets/:ticketId/messages')
  async reply(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('ticketId') ticketId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant); this.id(ticketId);
    const check = new Validation();
    const text = check.text('body', body.body, { max: 4000 });
    check.done();
    const outcome = await this.database.identity(async c => (await c.query('SELECT auth.reply_ticket($1,$2,$3,$4) AS o', [session.userId, tenant.organizationId, ticketId, text])).rows[0].o);
    if (outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (outcome === 'closed') throw apiError(422, 'INVALID_STATE_TRANSITION');
    if (outcome !== 'ok') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return { ok: true };
  }

  @Post('access/:grantId/:action')
  async access(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('grantId') grantId: string, @Param('action') action: string) {
    this.ownerOnly(tenant); this.id(grantId);
    if (!['consent', 'refuse', 'revoke'].includes(action)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const outcome = await this.database.identity(async c => (await c.query('SELECT auth.decide_support_access($1,$2,$3,$4) AS o', [session.userId, tenant.organizationId, grantId, action])).rows[0].o);
    if (outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (outcome === 'invalid_state') throw apiError(422, 'INVALID_STATE_TRANSITION');
    if (outcome !== 'ok') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return { ok: true };
  }

  @Post('data-requests')
  async export(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { required: false, max: 500 }) ?? null;
    check.done();
    const kind=body.request_type??'export';if(!['export','closure','deletion'].includes(kind as string))throw apiError(400,'VALIDATION_ERROR');
    const row = await this.database.identity(async c => (await c.query('SELECT auth.request_privacy($1,$2,$3,$4) AS value', [session.userId, tenant.organizationId,kind, reason])).rows[0].value);
    if (row.outcome === 'forbidden') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return { request_id: row.request_id, existing: row.outcome === 'exists' };
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }
}
