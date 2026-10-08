import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequestId } from '../auth/session.guard.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';

const scopes = ['customers', 'equipment', 'jobs', 'service_history'];

/** Lists return 50 rows per page; the database returns one extra row to signal another page. */
export function pageOffset(value: string | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) throw apiError(400, 'VALIDATION_ERROR');
  return n;
}
export function page<T>(rows: T[], offset: number) { return { items: rows.slice(0, 50), has_more: rows.length > 50, offset }; }

/** Platform administration: shops (metadata only), suspend/restore, temporary grants, support
 * tickets and owner-consented access, audit, system health and data requests. Every call is
 * checked here and again inside the padmin function. */
@Controller('platform')
@UseGuards(PlatformGuard)
export class PlatformAdminController {
  constructor(private readonly database: PlatformDatabaseService) {}

  @Get('overview') @Permission('shops.read')
  overview(@Account() a: PlatformAccount) {
    return this.one('SELECT padmin.overview($1) AS v', [a.accountId]);
  }

  /** Pilot indicators (aggregates only). */
  @Get('metrics') @Permission('shops.read')
  metrics(@Account() a: PlatformAccount, @Query('days') days?: string) {
    return this.one('SELECT padmin.metrics($1,$2) AS v', [a.accountId, Math.min(Math.max(Number(days) || 30, 1), 365)]);
  }

  @Get('shops') @Permission('shops.read')
  shops(@Account() a: PlatformAccount, @Query('q') q?: string, @Query('state') state?: string, @Query('offset') offset?: string) {
    const n = pageOffset(offset);
    return this.database.run(async c => page((await c.query('SELECT * FROM padmin.organizations($1,$2,$3,$4)', [a.accountId, (q ?? '').slice(0, 100), state ?? '', n])).rows, n));
  }

  /** Unresolved incidents and the latest resolution, for the console home. */
  @Get('incidents/summary') @Permission('system.read')
  incidentSummary(@Account() a: PlatformAccount) {
    return this.one('SELECT padmin.incident_summary($1) AS v', [a.accountId]);
  }

  @Get('shops/:id') @Permission('shops.read')
  async shop(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string) {
    this.id(id);
    const v = await this.one('SELECT padmin.organization_detail($1,$2,$3) AS v', [a.accountId, id, requestId]);
    if (!v) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return v;
  }

  @Post('shops/:id/suspend') @HttpCode(200) @Permission('shops.suspend') @StepUp()
  suspend(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.setStatus(a, requestId, id, 'suspended', body);
  }

  @Post('shops/:id/restore') @HttpCode(200) @Permission('shops.suspend') @StepUp()
  restore(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.setStatus(a, requestId, id, 'active', body);
  }

  @Post('shops/:id/grants') @Permission('grants.manage') @StepUp()
  async grant(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const kind = ['pilot', 'compensation', 'temporary_upgrade'].includes(body.kind as string) ? body.kind as string : (check.fail('kind', 'field.required'), '');
    const reason = check.text('reason', body.reason, { max: 500 });
    const until = typeof body.valid_until === 'string' && !Number.isNaN(Date.parse(body.valid_until)) ? new Date(body.valid_until) : (check.fail('valid_until', 'field.required'), null);
    const entitlements: Record<string, number> = {};
    for (const key of ['technician_seats', 'storage_bytes', 'ocr_per_period']) {
      const value = (body.entitlements as Record<string, unknown> | undefined)?.[key];
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) check.fail(`entitlements.${key}`, 'field.required');
        else entitlements[key] = value;
      }
    }
    if (!Object.keys(entitlements).length) check.fail('entitlements', 'field.required');
    check.done();
    const row = await this.database.run(async c => (await c.query('SELECT * FROM padmin.create_grant($1,$2,$3,$4,$5,$6,$7)',
      [a.accountId, id, kind, reason, until, entitlements, requestId])).rows[0]);
    if (row.outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (row.outcome !== 'ok') throw apiError(400, 'VALIDATION_ERROR', { field_errors: { valid_until: 'field.required' } });
    return { grant_id: row.grant_id };
  }

  @Post('grants/:id/end') @HttpCode(200) @Permission('grants.manage') @StepUp()
  async endGrant(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    const o = await this.one('SELECT padmin.end_grant($1,$2,$3,$4) AS v', [a.accountId, id, reason, requestId]);
    if (o === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (o !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  @Get('tickets') @Permission('support.read')
  tickets(@Account() a: PlatformAccount, @Query('status') status?: string, @Query('organization_id') organizationId?: string) {
    const filter = ['open', 'resolved', 'closed', 'all'].includes(status ?? '') ? status : 'open';
    return this.database.run(async c => ({ items: (await c.query('SELECT * FROM padmin.tickets($1,$2,$3)', [a.accountId, filter, organizationId && uuidPattern.test(organizationId) ? organizationId : null])).rows }));
  }

  @Get('tickets/:id') @Permission('support.read')
  async ticket(@Account() a: PlatformAccount, @Param('id') id: string) {
    this.id(id);
    const v = await this.one('SELECT padmin.ticket_detail($1,$2) AS v', [a.accountId, id]);
    if (!v) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return v;
  }

  @Post('tickets/:id') @HttpCode(200) @Permission('support.manage')
  async updateTicket(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const text = check.text('body', body.body, { required: false, max: 4000 }) ?? null;
    const status = body.status === undefined || body.status === null ? null
      : ['open', 'in_progress', 'resolved', 'closed'].includes(body.status as string) ? body.status as string : (check.fail('status', 'field.required'), null);
    check.done();
    const o = await this.one('SELECT padmin.update_ticket($1,$2,$3,$4,$5,$6,$7) AS v', [a.accountId, id, text, body.internal === true, status, body.assign_to_me === true, requestId]);
    if (o !== 'ok') throw apiError(404, 'RESOURCE_NOT_FOUND');
    return { ok: true };
  }

  /** Ask the shop owner for read-only access (5–60 minutes) to parts of the shop's data. */
  @Post('tickets/:id/access') @Permission('access.request')
  async requestAccess(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const scope = Array.isArray(body.scope) && body.scope.length && body.scope.every(s => scopes.includes(s as string)) ? [...new Set(body.scope as string[])] : (check.fail('scope', 'field.required'), []);
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60) check.fail('minutes', 'field.required');
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    const row = await this.database.run(async c => (await c.query('SELECT * FROM padmin.request_access($1,$2,$3,$4,$5,$6)', [a.accountId, id, scope, minutes, reason, requestId])).rows[0]);
    if (row.outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (row.outcome !== 'ok') throw apiError(400, 'VALIDATION_ERROR', { field_errors: { scope: 'field.required' } });
    return { grant_id: row.grant_id };
  }

  @Get('access') @Permission('access.approve')
  accessQueue(@Account() a: PlatformAccount) {
    return this.database.run(async c => ({ items: (await c.query('SELECT * FROM padmin.access_queue($1)', [a.accountId])).rows }));
  }

  @Post('access/:id/approve') @HttpCode(200) @Permission('access.approve') @StepUp()
  approve(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.decide(a, requestId, id, true, body);
  }

  @Post('access/:id/reject') @HttpCode(200) @Permission('access.approve')
  reject(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.decide(a, requestId, id, false, body);
  }

  /** Content under an active grant (requesting agent only, consented scope, until expiry). */
  @Get('access/:id/read/:what') @Permission('support.read') @StepUp()
  async read(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Param('what') what: string) {
    this.id(id);
    if (!scopes.includes(what)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const v = await this.one('SELECT padmin.support_read($1,$2,$3,$4) AS v', [a.accountId, id, what, requestId]);
    if (!v) throw apiError(403, 'PERMISSION_DENIED');
    return v;
  }

  @Get('audit') @Permission('audit.read')
  audit(@Account() a: PlatformAccount, @Query('organization_id') organizationId?: string, @Query('action') action?: string, @Query('before') before?: string) {
    return this.database.run(async c => ({ items: (await c.query('SELECT * FROM padmin.audit($1,$2,$3,$4)', [a.accountId,
      organizationId && uuidPattern.test(organizationId) ? organizationId : null, (action ?? '').slice(0, 60),
      before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null])).rows }));
  }

  @Get('system') @Permission('system.read')
  system(@Account() a: PlatformAccount) {
    return this.one('SELECT padmin.system_health($1) AS v', [a.accountId]);
  }

  @Get('data-requests') @Permission('data.manage')
  dataRequests(@Account() a: PlatformAccount, @Query('offset') offset?: string) {
    const n = pageOffset(offset);
    return this.database.run(async c => page((await c.query('SELECT * FROM padmin.data_requests($1,$2)', [a.accountId, n])).rows, n));
  }

  @Post('data-requests/:id') @HttpCode(200) @Permission('data.manage') @StepUp()
  async updateDataRequest(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const status = ['approved', 'rejected', 'running', 'succeeded', 'cancelled'].includes(body.status as string) ? body.status as string : (check.fail('status', 'field.required'), '');
    const note = check.text('note', body.note, { required: status === 'rejected', max: 500 }) ?? null;
    check.done();
    const o = await this.one('SELECT padmin.update_data_request($1,$2,$3,$4,$5) AS v', [a.accountId, id, status, note, requestId]);
    if (o === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (o !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  private async setStatus(a: PlatformAccount, requestId: string, id: string, status: string, body: Record<string, unknown>) {
    this.id(id);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    const o = await this.one('SELECT padmin.set_organization_status($1,$2,$3,$4,$5) AS v', [a.accountId, id, status, reason, requestId]);
    if (o === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    // A permanent suspension can only be lifted by super_admin.
    if (o === 'super_admin_required') throw apiError(403, 'PERMISSION_DENIED');
    if (o !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  private async decide(a: PlatformAccount, requestId: string, id: string, approve: boolean, body: Record<string, unknown>) {
    this.id(id);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { required: !approve, max: 500 }) ?? null;
    check.done();
    const o = await this.one('SELECT padmin.decide_access($1,$2,$3,$4,$5) AS v', [a.accountId, id, approve, reason, requestId]);
    if (o === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (o === 'self_approval') throw apiError(403, 'SELF_APPROVAL_FORBIDDEN');
    if (o === 'no_consent') throw apiError(422, 'OWNER_CONSENT_REQUIRED');
    if (o !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  private async one(sql: string, params: unknown[]) {
    return this.database.run(async c => (await c.query(sql, params)).rows[0]?.v);
  }
  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
}
