import { Body, Controller, Get, Headers, HttpCode, Optional, Param, Post, UseGuards } from '@nestjs/common';
import { RuntimeSettingsService } from '../platform/runtime-settings.service.js';
import { randomUUID } from 'node:crypto';
import { normalizePhone, memberActions, type MemberAction } from '@field-service/core';
import { RequestId, Session, SessionGuard, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { tokenPattern } from '../shared/crypto.js';
import { JoinLinksService, type JoinLinkRow } from './join-links.service.js';

const joinLinkColumns = 'id, status, generation, token_ciphertext, version, updated_at';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly database: DatabaseService, private readonly links: JoinLinksService, @Optional()private readonly runtime?:RuntimeSettingsService) {}

  /** Creates the shop, the owner membership and the first join link in one transaction.
   * An Idempotency-Key (uuid) makes a retried request return the same shop. */
  @Post() @UseGuards(SessionGuard)
  async create(@Session() session: SessionContext, @Body() body: Record<string, unknown> = {}, @Headers('idempotency-key') idempotencyKey?: string) {
    const check = new Validation();
    const name = check.text('name', body.name, { max: 120 });
    let contactPhone: string | null = null;
    if (body.contact_phone !== undefined && body.contact_phone !== null && body.contact_phone !== '') {
      contactPhone = normalizePhone(body.contact_phone);
      if (!contactPhone) check.fail('contact_phone', 'field.phone');
    }
    if (idempotencyKey !== undefined && !uuidPattern.test(idempotencyKey)) check.fail('idempotency_key', 'field.required');
    check.done();
    if((await this.runtime?.read())?.policy?.new_shops_enabled===false)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const link = this.links.issue();
    const language = body.preferred_language === 'en' || body.preferred_language === 'th' ? body.preferred_language : null;
    return this.database.identity(async client => {
      const row = (await client.query('SELECT outcome, organization_id, member_id FROM auth.create_organization($1,$2,$3,$4,$5,$6,$7)',
        [session.userId, name, contactPhone, language, link.hash, link.ciphertext, idempotencyKey ?? randomUUID()])).rows[0];
      if (row?.outcome === 'forbidden') throw apiError(403, 'ACCOUNT_DISABLED');
      if (row?.outcome !== 'created' && row?.outcome !== 'existing') throw apiError(400, 'VALIDATION_ERROR', { field_errors: { name: 'field.required' } });
      const current = (await client.query(`SELECT ${joinLinkColumns} FROM auth.current_join_link($1,$2)`, [session.userId, row.organization_id])).rows[0] as JoinLinkRow | undefined;
      return {
        organization: { id: row.organization_id, name },
        membership: { member_id: row.member_id, role: 'owner', status: 'active' },
        join_link: current ? await this.links.present(current) : null,
      };
    });
  }

  @Get(':organizationId') @UseGuards(TenantGuard)
  get(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const organization = (await client.query('SELECT id, name, timezone, default_language, status, version FROM core.organizations WHERE id = $1', [tenant.organizationId])).rows[0];
      return { organization, membership: { member_id: tenant.memberId, role: tenant.role, status: 'active' } };
    });
  }

  // team ------------------------------------------------------------------------------------
  @Get(':organizationId/announcements') @UseGuards(TenantGuard)
  announcements(@Session()s:SessionContext,@Tenant()t:TenantContext){this.ownerOnly(t);return this.database.identity(async c=>({items:(await c.query('SELECT auth.announcements($1,$2) AS v',[s.userId,t.organizationId])).rows[0].v??[]}));}

  @Get(':organizationId/members') @UseGuards(TenantGuard)
  team(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    return this.database.identity(async client => {
      const members = (await client.query(
        'SELECT member_id, user_id, role, status, display_name, phone_e164, version, requested_at, status_changed_at, open_jobs FROM auth.team($1,$2)',
        [session.userId, tenant.organizationId])).rows;
      const seats = (await client.query('SELECT active_technicians, seat_limit FROM auth.seat_usage($1,$2)', [session.userId, tenant.organizationId])).rows[0];
      if (!seats) throw apiError(403, 'TENANT_ACCESS_DENIED');
      return { members, seats };
    });
  }

  @Post(':organizationId/members/:memberId/:action') @HttpCode(200) @UseGuards(TenantGuard)
  async changeMember(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('memberId') memberId: string, @Param('action') action: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    if (!uuidPattern.test(memberId) || !memberActions.includes(action as MemberAction)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const check = new Validation();
    const expected = Number(body.expected_version);
    if (!Number.isInteger(expected) || expected < 1) check.fail('expected_version', 'field.required');
    const reason = check.text('reason', body.reason, { required: false, max: 500 });
    check.done();
    const row = await this.database.identity(async client => (await client.query(
      'SELECT outcome, member_id, status, version, active_technicians, seat_limit, open_jobs FROM auth.change_member_status($1,$2,$3,$4,$5,$6,$7)',
      [session.userId, tenant.organizationId, memberId, action, expected, reason ?? null, requestId])).rows[0]);
    switch (row?.outcome) {
      case 'ok': return { member_id: row.member_id, status: row.status, version: row.version, open_jobs: row.open_jobs,
        seats: { active_technicians: row.active_technicians, seat_limit: row.seat_limit } };
      case 'not_found': throw apiError(404, 'RESOURCE_NOT_FOUND');
      case 'version_conflict': throw apiError(409, 'VERSION_CONFLICT', { latest_version: row.version });
      case 'invalid_transition': throw apiError(422, 'INVALID_STATE_TRANSITION', { latest_version: row.version });
      case 'seat_limit_reached': throw apiError(409, 'SEAT_LIMIT_REACHED');
      case 'subscription_inactive': throw apiError(403, 'SUBSCRIPTION_EXPIRED');
      default: throw apiError(403, 'TENANT_ACCESS_DENIED');
    }
  }

  // subscription ----------------------------------------------------------------------------
  /** Effective entitlement computed from server time. Technicians only learn whether work can be saved. */
  @Get(':organizationId/subscription') @UseGuards(TenantGuard)
  async subscription(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    const row = await this.database.identity(async client => (await client.query(
      `SELECT role, state, writable, source, plan_code, name_th, name_en, technician_seats, storage_bytes, ocr_per_period,
        period_end, grace_until, cancel_at_period_end, active_technicians, storage_used, ocr_used
       FROM auth.subscription_summary($1,$2)`, [session.userId, tenant.organizationId])).rows[0]);
    if (!row) throw apiError(403, 'TENANT_ACCESS_DENIED');
    if (row.role !== 'owner') return { state: row.state, writable: row.writable };
    return {
      state: row.state, writable: row.writable, source: row.source,
      plan: row.plan_code ? { code: row.plan_code, name_th: row.name_th, name_en: row.name_en } : null,
      period_end: row.period_end, grace_until: row.grace_until, cancel_at_period_end: row.cancel_at_period_end,
      limits: { technician_seats: row.technician_seats, storage_bytes: Number(row.storage_bytes), ocr_per_period: row.ocr_per_period },
      usage: { technician_seats: row.active_technicians, storage_bytes: Number(row.storage_used), ocr: Number(row.ocr_used) },
    };
  }

  @Post(':organizationId/subscription/:action') @HttpCode(200) @UseGuards(TenantGuard)
  async changeRenewal(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param('action') action: string) {
    this.ownerOnly(tenant);
    if (action !== 'cancel-renewal' && action !== 'resume-renewal') throw apiError(404, 'RESOURCE_NOT_FOUND');
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.set_cancel_at_period_end($1,$2,$3,$4)',
      [session.userId, tenant.organizationId, action === 'cancel-renewal', requestId])).rows[0]);
    if (row?.outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (row?.outcome !== 'ok') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return this.subscription(session, tenant);
  }

  // join link -------------------------------------------------------------------------------
  @Get(':organizationId/join-link') @UseGuards(TenantGuard)
  async joinLink(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    const row = await this.database.identity(async client =>
      (await client.query(`SELECT ${joinLinkColumns} FROM auth.current_join_link($1,$2)`, [session.userId, tenant.organizationId])).rows[0] as JoinLinkRow | undefined);
    if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return this.links.present(row);
  }

  @Post(':organizationId/join-link/:action') @HttpCode(200) @UseGuards(TenantGuard)
  async changeJoinLink(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param('action') action: string) {
    this.ownerOnly(tenant);
    if (!['open', 'close', 'rotate'].includes(action)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const next = action === 'rotate' ? this.links.issue() : undefined;
    const row = await this.database.identity(async client => (await client.query(
      `SELECT outcome, ${joinLinkColumns} FROM auth.change_join_link($1,$2,$3,$4,$5,$6)`,
      [session.userId, tenant.organizationId, action, next?.hash ?? null, next?.ciphertext ?? null, requestId])).rows[0]);
    if (row?.outcome === 'ok') return this.links.present(row);
    if (row?.outcome === 'invalid') throw apiError(422, 'INVALID_STATE_TRANSITION');
    throw apiError(403, 'TENANT_ACCESS_DENIED');
  }

  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }
}

/** Public preview and the join request itself. */
@Controller()
export class JoinController {
  constructor(private readonly database: DatabaseService, private readonly links: JoinLinksService) {}

  /** No sign-in needed. Only an active link reveals the shop name. */
  @Get('join-links/:token')
  async preview(@Param('token') token: string) {
    if (!tokenPattern.test(token)) return { state: 'invalid', organization_name: null };
    const row = await this.database.identity(async client =>
      (await client.query('SELECT state, organization_name FROM auth.join_link_preview($1)', [this.links.hash(token)])).rows[0]);
    return { state: row?.state ?? 'invalid', organization_name: row?.organization_name ?? null };
  }

  @Post('join-requests') @HttpCode(200) @UseGuards(SessionGuard)
  async request(@Session() session: SessionContext, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const token = typeof body.token === 'string' && tokenPattern.test(body.token) ? body.token : undefined;
    if (!token) check.fail('token', 'field.required');
    const displayName = check.text('display_name', body.display_name, { max: 80 });
    check.done();
    const row = await this.database.identity(async client => (await client.query(
      'SELECT outcome, organization_id, organization_name, member_id, status FROM auth.request_join($1,$2,$3,$4)',
      [session.userId, this.links.hash(token!), displayName, requestId])).rows[0]);
    switch (row?.outcome) {
      case 'pending': case 'active': case 'suspended':
        return { organization_id: row.organization_id, organization_name: row.organization_name, member_id: row.member_id, status: row.status };
      case 'closed': throw apiError(409, 'JOIN_LINK_CLOSED');
      case 'forbidden': throw apiError(403, 'ACCOUNT_DISABLED');
      default: throw apiError(404, 'JOIN_LINK_INVALID');
    }
  }
}
