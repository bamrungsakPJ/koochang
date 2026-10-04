import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RequestId, Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';

const contactResults = ['no_answer', 'interested', 'call_later', 'declined', 'booked'];

/** Owner follow-up of maintenance cycles: due list, contact log, book a job from cycles,
 * postpone or stop reminders. Booking or contacting never changes the due date; only real
 * service (B04) closes a cycle. */
@Controller('organizations/:organizationId/maintenance')
@UseGuards(TenantGuard)
export class MaintenanceController {
  constructor(private readonly database: DatabaseService) {}

  /** Open cycles due within `days` (default 30) plus all overdue, in the shop's calendar.
   * Each row says whether it is overdue, due within 7 days, or later, so counts never overlap. */
  @Get()
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Query('days') days?: string) {
    this.ownerOnly(tenant);
    const window = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const today = (await client.query('SELECT (now() AT TIME ZONE timezone)::date AS d FROM core.organizations WHERE id = $1', [tenant.organizationId])).rows[0].d;
      const rows = (await client.query(
        `SELECT cy.id, cy.due_date, cy.version, s.service_type, s.interval_months, e.id AS equipment_id, e.name AS equipment_name, e.equipment_type AS category,
           e.brand, e.model, l.id AS location_id, l.name AS location_label, l.address AS location_address, c.id AS customer_id, c.name AS customer_name,
           c.phone_normalized AS customer_phone,
           (SELECT max(se.occurred_at) FROM core.service_event_equipment i JOIN core.service_events se ON se.organization_id = i.organization_id AND se.id = i.service_event_id
             WHERE i.organization_id = e.organization_id AND i.equipment_id = e.id AND i.outcome = 'done' AND se.status = 'committed') AS last_service_at,
           (SELECT b.job_id FROM core.maintenance_bookings b WHERE b.organization_id = cy.organization_id AND b.cycle_id = cy.id AND b.status = 'active') AS booked_job_id,
           (SELECT jsonb_build_object('result', cl.result, 'note', cl.note, 'next_contact_on', cl.next_contact_on, 'created_at', cl.created_at)
             FROM core.maintenance_contact_logs cl WHERE cl.organization_id = cy.organization_id AND cl.cycle_id = cy.id ORDER BY cl.created_at DESC LIMIT 1) AS last_contact,
           CASE WHEN cy.due_date < $2 THEN 'overdue' WHEN cy.due_date <= $2 + 7 THEN 'within_7' ELSE 'within_30' END AS bucket
         FROM core.maintenance_cycles cy
         JOIN core.maintenance_schedules s ON s.organization_id = cy.organization_id AND s.id = cy.schedule_id AND s.enabled
         JOIN core.equipment e ON e.organization_id = s.organization_id AND e.id = s.equipment_id AND e.status = 'active'
         JOIN core.customer_locations l ON l.organization_id = e.organization_id AND l.id = e.location_id
         JOIN core.customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id AND c.archived_at IS NULL
         WHERE cy.organization_id = $1 AND cy.status = 'open' AND cy.due_date <= $2 + $3::int
         ORDER BY cy.due_date, c.name NULLS LAST LIMIT 300`, [tenant.organizationId, today, window])).rows;
      const items = rows.map(r => ({ ...r, due_date: toDate(r.due_date) }));
      return {
        today: toDate(today), items,
        counts: { overdue: items.filter(i => i.bucket === 'overdue').length, within_7: items.filter(i => i.bucket === 'within_7').length,
          within_30: items.filter(i => i.bucket === 'within_30').length },
      };
    });
  }

  @Post('cycles/:cycleId/contacts')
  contact(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('cycleId') cycleId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant); this.id(cycleId);
    const check = new Validation();
    if (!contactResults.includes(body.result as string)) check.fail('result', 'field.required');
    const note = check.text('note', body.note, { required: false, max: 1000 }) ?? null;
    const next = this.date(check, 'next_contact_on', body.next_contact_on, false);
    check.done();
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      await this.cycle(client, tenant, cycleId);
      const row = (await client.query(
        'INSERT INTO core.maintenance_contact_logs(organization_id, cycle_id, result, note, next_contact_on, created_by_member_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
        [tenant.organizationId, cycleId, body.result, note, next, tenant.memberId])).rows[0];
      await this.audit(client, session, tenant, requestId, 'maintenance.contacted', cycleId);
      return { id: row.id, result: body.result, note, next_contact_on: next, created_at: row.created_at };
    });
  }

  /** Book a job from one or more cycles at the same location: customer, location, equipment and
   * service type come from the cycles. A cycle that already has an active booking returns
   * ALREADY_BOOKED with that job, and a retried request key returns the same job. */
  @Post('book')
  async book(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const requestKey = typeof body.request_key === 'string' && uuidPattern.test(body.request_key) ? body.request_key : (check.fail('request_key', 'field.required'), '');
    const cycleIds = Array.isArray(body.cycle_ids) && body.cycle_ids.length && body.cycle_ids.length <= 20 && body.cycle_ids.every(v => typeof v === 'string' && uuidPattern.test(v))
      ? [...new Set(body.cycle_ids as string[])] : (check.fail('cycle_ids', 'field.required'), []);
    const start = this.time(check, 'scheduled_start', body.scheduled_start);
    const end = this.time(check, 'scheduled_end', body.scheduled_end);
    if (end && (!start || end <= start)) check.fail('scheduled_end', 'field.required');
    const assignee = body.assignee_member_id ? (typeof body.assignee_member_id === 'string' && uuidPattern.test(body.assignee_member_id) ? body.assignee_member_id : (check.fail('assignee_member_id', 'field.required'), null)) : null;
    const description = check.text('description', body.description, { required: false, max: 2000 }) ?? null;
    check.done();
    await this.requireWritable(session, tenant);
    if (assignee) await this.requireAssignable(session, tenant, assignee);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const existing = (await client.query('SELECT id FROM core.jobs WHERE organization_id = $1 AND create_request_key = $2', [tenant.organizationId, requestKey])).rows[0];
      if (existing) return { job_id: existing.id, replayed: true };
      // Lock the cycles in id order, then check they are open, unbooked and at one location.
      const cycles = (await client.query(
        `SELECT cy.id, s.service_type, e.id AS equipment_id, e.location_id, l.customer_id FROM core.maintenance_cycles cy
         JOIN core.maintenance_schedules s ON s.organization_id = cy.organization_id AND s.id = cy.schedule_id
         JOIN core.equipment e ON e.organization_id = s.organization_id AND e.id = s.equipment_id
         JOIN core.customer_locations l ON l.organization_id = e.organization_id AND l.id = e.location_id
         WHERE cy.organization_id = $1 AND cy.id = ANY($2::uuid[]) AND cy.status = 'open' ORDER BY cy.id FOR UPDATE OF cy`,
        [tenant.organizationId, cycleIds])).rows;
      if (cycles.length !== cycleIds.length) throw apiError(404, 'RESOURCE_NOT_FOUND');
      if (new Set(cycles.map(c => c.location_id)).size !== 1) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { cycle_ids: 'field.sameLocation' } });
      const booked = (await client.query("SELECT job_id FROM core.maintenance_bookings WHERE organization_id = $1 AND cycle_id = ANY($2::uuid[]) AND status = 'active' LIMIT 1",
        [tenant.organizationId, cycleIds])).rows[0];
      if (booked) throw apiError(409, 'ALREADY_BOOKED', { candidates: [{ job_id: booked.job_id }] });
      const first = cycles[0];
      const types = [...new Set(cycles.map(c => c.service_type))];
      const job = (await client.query(
        `INSERT INTO core.jobs(organization_id, customer_id, location_id, job_type, source, status, current_assignee_id, scheduled_start, scheduled_end,
           description, created_by_member_id, create_request_key)
         VALUES ($1,$2,$3,$4,'maintenance',$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenant.organizationId, first.customer_id, first.location_id, types.length === 1 ? types[0] : 'maintenance', assignee ? 'scheduled' : 'unassigned', assignee,
          start, end, description, tenant.memberId, requestKey])).rows[0];
      for (const c of cycles) {
        await client.query(`INSERT INTO core.job_equipment(organization_id, job_id, equipment_id, location_id, requested_service_type) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (organization_id, job_id, equipment_id) DO NOTHING`, [tenant.organizationId, job.id, c.equipment_id, c.location_id, c.service_type]);
        await client.query('INSERT INTO core.maintenance_bookings(organization_id, cycle_id, job_id, created_by_member_id) VALUES ($1,$2,$3,$4)',
          [tenant.organizationId, c.id, job.id, tenant.memberId]);
      }
      if (assignee) await client.query('INSERT INTO core.job_assignments(organization_id, job_id, member_id, assigned_by) VALUES ($1,$2,$3,$4)', [tenant.organizationId, job.id, assignee, session.userId]);
      await client.query('INSERT INTO core.job_state_changes(organization_id, job_id, from_status, to_status, actor_member_id) VALUES ($1,$2,NULL,$3,$4)',
        [tenant.organizationId, job.id, assignee ? 'scheduled' : 'unassigned', tenant.memberId]);
      await this.audit(client, session, tenant, requestId, 'maintenance.booked', job.id);
      return { job_id: job.id };
    });
  }

  /** Move the due date with a reason (owner decision, audited). The reminder milestones restart
   * for the new date because the cycle version changes. */
  @Post('cycles/:cycleId/postpone')
  postpone(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('cycleId') cycleId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant); this.id(cycleId);
    const check = new Validation();
    const expected = Number(body.expected_version);
    if (!Number.isInteger(expected) || expected < 1) check.fail('expected_version', 'field.required');
    const due = this.date(check, 'due_date', body.due_date, true);
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const current = await this.cycle(client, tenant, cycleId);
      if (current.version !== expected) throw apiError(409, 'VERSION_CONFLICT', { latest_version: current.version });
      const row = (await client.query("UPDATE core.maintenance_cycles SET due_date = $3 WHERE organization_id = $1 AND id = $2 AND status = 'open' RETURNING due_date, version",
        [tenant.organizationId, cycleId, due])).rows[0];
      await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, reason, request_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tenant.organizationId, session.userId, 'maintenance.postponed', 'maintenance_cycle', cycleId, reason, requestId, { from: toDate(current.due_date), to: due }]);
      return { id: cycleId, due_date: toDate(row.due_date), version: row.version };
    });
  }

  /** Stop reminders for this unit and service type: the cycle closes as disabled and the schedule
   * is switched off. History stays. */
  @Post('cycles/:cycleId/stop')
  stop(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('cycleId') cycleId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant); this.id(cycleId);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const current = await this.cycle(client, tenant, cycleId);
      await client.query("UPDATE core.maintenance_cycles SET status = 'disabled', closed_at = now(), close_reason = $3 WHERE organization_id = $1 AND id = $2",
        [tenant.organizationId, cycleId, reason]);
      await client.query('UPDATE core.maintenance_schedules SET enabled = false WHERE organization_id = $1 AND id = $2', [tenant.organizationId, current.schedule_id]);
      await client.query("UPDATE core.maintenance_bookings SET status = 'cancelled' WHERE organization_id = $1 AND cycle_id = $2 AND status = 'active'", [tenant.organizationId, cycleId]);
      await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, reason, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [tenant.organizationId, session.userId, 'maintenance.stopped', 'maintenance_cycle', cycleId, reason, requestId]);
      return { id: cycleId, status: 'disabled' };
    });
  }

  // helpers ---------------------------------------------------------------------------------
  private async cycle(client: PoolClient, tenant: TenantContext, cycleId: string) {
    const row = (await client.query("SELECT id, schedule_id, due_date, version FROM core.maintenance_cycles WHERE organization_id = $1 AND id = $2 AND status = 'open' FOR UPDATE",
      [tenant.organizationId, cycleId])).rows[0];
    if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return row;
  }

  private date(check: Validation, field: string, value: unknown, required: boolean): string | null {
    if (!required && (value === undefined || value === null || value === '')) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) return value;
    check.fail(field, 'field.required');
    return null;
  }

  private time(check: Validation, field: string, value: unknown): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const date = typeof value === 'string' && /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) { check.fail(field, 'field.required'); return null; }
    return date;
  }

  private async requireAssignable(session: SessionContext, tenant: TenantContext, memberId: string) {
    const ok = await this.database.identity(async c => (await c.query("SELECT 1 FROM auth.team($1,$2) WHERE member_id = $3 AND status = 'active'", [session.userId, tenant.organizationId, memberId])).rows[0]);
    if (!ok) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { assignee_member_id: 'field.required' } });
  }

  private async requireWritable(session: SessionContext, tenant: TenantContext) {
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.require_writable($1,$2)', [session.userId, tenant.organizationId])).rows[0]);
    if (row?.outcome === 'ok') return;
    throw row?.outcome === 'inactive' ? apiError(403, 'SUBSCRIPTION_EXPIRED') : row?.outcome === 'suspended' ? apiError(403, 'ORGANIZATION_SUSPENDED') : apiError(403, 'TENANT_ACCESS_DENIED');
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }

  private async audit(client: PoolClient, session: SessionContext, tenant: TenantContext, requestId: string, action: string, id: string) {
    await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenant.organizationId, session.userId, action, 'maintenance_cycle', id, requestId]);
  }
}

function toDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
