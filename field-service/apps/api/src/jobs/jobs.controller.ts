import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RequestId, Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';

const jobTypes = ['installation', 'repair', 'inspection', 'maintenance', 'other'];
const open = ['unassigned', 'scheduled', 'in_progress'];
interface JobRow { id: string; status: string; version: number; current_assignee_id: string | null; location_id: string; customer_id: string; scheduled_start: Date | null; scheduled_end: Date | null }

/** Planned work. Owners create, schedule, assign and cancel; the assignee starts the job.
 * Visibility is RLS: technicians only see jobs currently assigned to them. Every change checks
 * the version, writes a state change and audit row, and the database notifies technicians. */
@Controller('organizations/:organizationId/jobs')
@UseGuards(TenantGuard)
export class JobsController {
  constructor(private readonly database: DatabaseService) {}

  /** Jobs in a time window; unscheduled history uses start/creation time. Open unscheduled
   * work remains visible so owners can assign it even without an appointment. */
  @Get()
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Query('from') from?: string, @Query('to') to?: string,
    @Query('status') status?: string, @Query('assignee') assignee?: string) {
    const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(Date.now() - 86400000);
    const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date(start.getTime() + 14 * 86400000);
    const statuses = status ? status.split(',').filter(s => [...open, 'completed', 'cancelled'].includes(s)) : open;
    return this.database.withTenant(session.userId, tenant.organizationId, async client => ({
      items: (await client.query(
        `${this.selectJobs} WHERE j.organization_id = $1 AND j.status = ANY($2::text[])
           AND ((coalesce(j.scheduled_start, j.started_at, j.created_at) >= $3 AND coalesce(j.scheduled_start, j.started_at, j.created_at) < $4)
             OR (j.scheduled_start IS NULL AND j.status IN ('unassigned','scheduled','in_progress')))
           AND ($5::uuid IS NULL OR j.current_assignee_id = $5)
         ORDER BY j.scheduled_start NULLS FIRST, j.created_at LIMIT 200`,
        [tenant.organizationId, statuses, start, end, assignee && uuidPattern.test(assignee) ? assignee : null])).rows,
    }));
  }

  /** Create a job for a customer location. Same request_key → same job. With an assignee the job
   * is scheduled; overlapping jobs of that assignee come back as conflicts (a warning). */
  @Post()
  async create(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const requestKey = this.uuid(check, 'request_key', body.request_key)!;
    const customerId = this.uuid(check, 'customer_id', body.customer_id)!;
    const locationId = this.uuid(check, 'location_id', body.location_id)!;
    const jobType = jobTypes.includes(body.job_type as string) ? body.job_type as string : (check.fail('job_type', 'field.required'), 'other');
    const description = check.text('description', body.description, { required: false, max: 2000 }) ?? null;
    const times = this.times(check, body);
    const estimated = this.estimate(check, body.estimated_equipment_count);
    const equipmentIds = this.ids(check, 'equipment_ids', body.equipment_ids);
    const assignee = body.assignee_member_id ? this.uuid(check, 'assignee_member_id', body.assignee_member_id) : null;
    check.done();
    await this.requireWritable(session, tenant);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const existing = (await client.query('SELECT id FROM core.jobs WHERE organization_id = $1 AND create_request_key = $2', [tenant.organizationId, requestKey])).rows[0];
      if (existing) return { job: await this.detail(client, tenant, existing.id), conflicts: [] };
      const location = (await client.query('SELECT id FROM core.customer_locations WHERE organization_id = $1 AND id = $2 AND customer_id = $3 AND archived_at IS NULL',
        [tenant.organizationId, locationId, customerId])).rows[0];
      if (!location) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { location_id: 'field.required' } });
      if (assignee) await this.requireAssignable(session, tenant, assignee);
      const job = (await client.query(
        `INSERT INTO core.jobs(organization_id, customer_id, location_id, job_type, status, current_assignee_id, scheduled_start, scheduled_end,
           description, estimated_equipment_count, created_by_member_id, create_request_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tenant.organizationId, customerId, locationId, jobType, assignee ? 'scheduled' : 'unassigned', assignee, times.start, times.end,
          description, estimated, tenant.memberId, requestKey])).rows[0];
      await this.setEquipment(client, tenant, job.id, locationId, equipmentIds, jobType);
      if (assignee) await this.openAssignment(client, session, tenant, job.id, assignee, null);
      await this.stateChange(client, tenant, job.id, null, assignee ? 'scheduled' : 'unassigned', null);
      await this.audit(client, session, tenant, requestId, 'job.created', job.id);
      return { job: await this.detail(client, tenant, job.id), conflicts: assignee ? await this.conflicts(client, tenant, job.id, assignee, times.start, times.end) : [] };
    });
  }

  @Get(':jobId')
  get(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('jobId') jobId: string) {
    this.id(jobId);
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, jobId));
  }

  /** Change description, type, estimate or the planned equipment of an open job. */
  @Patch(':jobId')
  async update(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const jobType = body.job_type === undefined ? undefined : jobTypes.includes(body.job_type as string) ? body.job_type as string : (check.fail('job_type', 'field.required'), undefined);
    const description = body.description === undefined ? undefined : check.text('description', body.description, { required: false, max: 2000 }) ?? null;
    const estimated = body.estimated_equipment_count === undefined ? undefined : this.estimate(check, body.estimated_equipment_count);
    const equipmentIds = body.equipment_ids === undefined ? undefined : this.ids(check, 'equipment_ids', body.equipment_ids);
    check.done();
    return this.mutate(session, tenant, requestId, jobId, expected, 'job.updated', async (client, job) => {
      if (!open.includes(job.status)) throw apiError(422, 'INVALID_STATE_TRANSITION');
      await client.query(`UPDATE core.jobs SET job_type = coalesce($3, job_type), description = CASE WHEN $4::boolean THEN $5 ELSE description END,
          estimated_equipment_count = CASE WHEN $6::boolean THEN $7 ELSE estimated_equipment_count END WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, jobId, jobType ?? null, description !== undefined, description ?? null, estimated !== undefined, estimated ?? null]);
      if (equipmentIds) await this.setEquipment(client, tenant, jobId, job.location_id, equipmentIds, jobType ?? null, true);
    });
  }

  /** Assign or reassign. The previous assignment is closed with the reason; the previous
   * technician loses access immediately. A job in progress keeps its status. */
  @Post(':jobId/assign')
  async assign(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const assignee = this.uuid(check, 'assignee_member_id', body.assignee_member_id)!;
    const reason = check.text('reason', body.reason, { required: false, max: 500 }) ?? null;
    check.done();
    let conflicts: unknown[] = [];
    const job = await this.mutate(session, tenant, requestId, jobId, expected, 'job.assigned', async (client, current) => {
      if (!open.includes(current.status)) throw apiError(422, 'INVALID_STATE_TRANSITION');
      if (current.current_assignee_id === assignee) return;
      if (current.status === 'in_progress' && !reason) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { reason: 'field.required' } });
      await this.requireAssignable(session, tenant, assignee);
      await client.query('UPDATE core.job_assignments SET ended_at = now(), reason = coalesce(reason, $3) WHERE organization_id = $1 AND job_id = $2 AND ended_at IS NULL',
        [tenant.organizationId, jobId, reason]);
      const next = current.status === 'unassigned' ? 'scheduled' : current.status;
      await client.query('UPDATE core.jobs SET current_assignee_id = $3, status = $4 WHERE organization_id = $1 AND id = $2', [tenant.organizationId, jobId, assignee, next]);
      await this.openAssignment(client, session, tenant, jobId, assignee, reason);
      if (next !== current.status) await this.stateChange(client, tenant, jobId, current.status, next, reason);
      conflicts = await this.conflicts(client, tenant, jobId, assignee, current.scheduled_start, current.scheduled_end);
    });
    return { job, conflicts };
  }

  @Post(':jobId/unassign')
  unassign(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    check.done();
    return this.mutate(session, tenant, requestId, jobId, expected, 'job.unassigned', async (client, job) => {
      if (job.status !== 'scheduled') throw apiError(422, 'INVALID_STATE_TRANSITION');
      await client.query('UPDATE core.job_assignments SET ended_at = now() WHERE organization_id = $1 AND job_id = $2 AND ended_at IS NULL', [tenant.organizationId, jobId]);
      await client.query("UPDATE core.jobs SET current_assignee_id = NULL, status = 'unassigned' WHERE organization_id = $1 AND id = $2", [tenant.organizationId, jobId]);
      await this.stateChange(client, tenant, jobId, 'scheduled', 'unassigned', null);
    });
  }

  @Post(':jobId/reschedule')
  async reschedule(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const times = this.times(check, body);
    check.done();
    let conflicts: unknown[] = [];
    const job = await this.mutate(session, tenant, requestId, jobId, expected, 'job.rescheduled', async (client, current) => {
      if (!open.includes(current.status)) throw apiError(422, 'INVALID_STATE_TRANSITION');
      await client.query('UPDATE core.jobs SET scheduled_start = $3, scheduled_end = $4 WHERE organization_id = $1 AND id = $2', [tenant.organizationId, jobId, times.start, times.end]);
      if (current.current_assignee_id) conflicts = await this.conflicts(client, tenant, jobId, current.current_assignee_id, times.start, times.end);
    });
    return { job, conflicts };
  }

  /** Cancel with a reason. A cancelled plan never creates service history; service already
   * recorded on the job (B04) stays. */
  @Post(':jobId/cancel')
  cancel(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const reason = check.text('reason', body.reason, { max: 500 })!;
    check.done();
    return this.mutate(session, tenant, requestId, jobId, expected, 'job.cancelled', async (client, job) => {
      if (!open.includes(job.status)) throw apiError(422, 'INVALID_STATE_TRANSITION');
      await client.query('UPDATE core.job_assignments SET ended_at = now() WHERE organization_id = $1 AND job_id = $2 AND ended_at IS NULL', [tenant.organizationId, jobId]);
      await client.query("UPDATE core.jobs SET status = 'cancelled', cancellation_reason = $3, cancelled_at = now() WHERE organization_id = $1 AND id = $2", [tenant.organizationId, jobId, reason]);
      await this.stateChange(client, tenant, jobId, job.status, 'cancelled', reason);
    }, true);
  }

  /** The assignee starts the work. Only a status change and a timestamp — no location. */
  @Post(':jobId/start')
  start(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    check.done();
    return this.mutate(session, tenant, requestId, jobId, expected, 'job.started', async (client, job) => {
      if (job.current_assignee_id !== tenant.memberId) throw apiError(403, 'TENANT_ACCESS_DENIED');
      if (job.status === 'in_progress') return;
      if (job.status !== 'scheduled') throw apiError(422, 'INVALID_STATE_TRANSITION');
      await client.query("UPDATE core.jobs SET status = 'in_progress', started_at = now() WHERE organization_id = $1 AND id = $2", [tenant.organizationId, jobId]);
      await this.stateChange(client, tenant, jobId, 'scheduled', 'in_progress', null);
    });
  }

  // helpers ---------------------------------------------------------------------------------
  private readonly selectJobs = `SELECT j.id, j.status, j.job_type, j.description, j.scheduled_start, j.scheduled_end, j.estimated_equipment_count, j.version,
      j.customer_id, c.name AS customer_name, c.phone_normalized AS customer_phone, j.location_id, l.name AS location_label, l.address AS location_address,
      j.current_assignee_id, core.member_name(j.organization_id, j.current_assignee_id) AS assignee_name,
      (SELECT count(*)::int FROM core.job_equipment je WHERE je.organization_id = j.organization_id AND je.job_id = j.id) AS equipment_count
    FROM core.jobs j
    LEFT JOIN core.customers c ON c.organization_id = j.organization_id AND c.id = j.customer_id
    LEFT JOIN core.customer_locations l ON l.organization_id = j.organization_id AND l.id = j.location_id`;

  /** Locks the job, checks the version and the plan, runs the change, records audit. */
  private async mutate(session: SessionContext, tenant: TenantContext, requestId: string, jobId: string, expected: number, action: string,
    change: (client: PoolClient, job: JobRow) => Promise<void>, allowInactive = false) {
    this.id(jobId);
    if (!allowInactive) await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const job = (await client.query('SELECT id, status, version, current_assignee_id, location_id, customer_id, scheduled_start, scheduled_end FROM core.jobs WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [tenant.organizationId, jobId])).rows[0] as JobRow | undefined;
      if (!job) throw apiError(404, 'RESOURCE_NOT_FOUND');
      if (job.version !== expected) throw apiError(409, 'VERSION_CONFLICT', { latest_version: job.version });
      await change(client, job);
      await this.audit(client, session, tenant, requestId, action, jobId);
      return this.detail(client, tenant, jobId);
    });
  }

  private async detail(client: PoolClient, tenant: TenantContext, jobId: string) {
    const job = (await client.query(`${this.selectJobs} WHERE j.organization_id = $1 AND j.id = $2`, [tenant.organizationId, jobId])).rows[0];
    if (!job) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const extra = (await client.query(`SELECT j.cancellation_reason, j.started_at, j.completed_at, j.created_at, l.travel_note, l.latitude::float8 AS latitude,
        l.longitude::float8 AS longitude, l.version AS location_version FROM core.jobs j
      LEFT JOIN core.customer_locations l ON l.organization_id = j.organization_id AND l.id = j.location_id WHERE j.organization_id = $1 AND j.id = $2`,
      [tenant.organizationId, jobId])).rows[0];
    const equipment = (await client.query(
      `SELECT e.id, e.name, e.equipment_type AS category, e.brand, e.model, e.serial_number, je.requested_service_type FROM core.job_equipment je
       JOIN core.equipment e ON e.organization_id = je.organization_id AND e.id = je.equipment_id
       WHERE je.organization_id = $1 AND je.job_id = $2 ORDER BY je.created_at`, [tenant.organizationId, jobId])).rows;
    const history = (await client.query(
      `SELECT s.from_status, s.to_status, s.reason, s.created_at, core.member_name(s.organization_id, s.actor_member_id) AS actor FROM core.job_state_changes s
       WHERE s.organization_id = $1 AND s.job_id = $2 ORDER BY s.created_at`, [tenant.organizationId, jobId])).rows;
    return { ...job, ...extra, equipment, history };
  }

  private async conflicts(client: PoolClient, tenant: TenantContext, jobId: string, assignee: string, start: Date | null, end: Date | null) {
    if (!start) return [];
    const finish = end ?? new Date(new Date(start).getTime() + 3600000);
    return (await client.query(
      `SELECT j.id, j.scheduled_start, j.scheduled_end FROM core.jobs j WHERE j.organization_id = $1 AND j.id <> $2 AND j.current_assignee_id = $3
         AND j.status IN ('scheduled','in_progress') AND j.scheduled_start IS NOT NULL
         AND j.scheduled_start < $5 AND coalesce(j.scheduled_end, j.scheduled_start + interval '1 hour') > $4`,
      [tenant.organizationId, jobId, assignee, start, finish])).rows;
  }

  /** Assignee must be an active member (technician, or the owner doing the work). */
  private async requireAssignable(session: SessionContext, tenant: TenantContext, memberId: string) {
    const ok = await this.database.identity(async c => (await c.query(
      "SELECT 1 FROM auth.team($1,$2) WHERE member_id = $3 AND status = 'active'", [session.userId, tenant.organizationId, memberId])).rows[0]);
    if (!ok) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { assignee_member_id: 'field.required' } });
  }

  private async openAssignment(client: PoolClient, session: SessionContext, tenant: TenantContext, jobId: string, memberId: string, reason: string | null) {
    await client.query('INSERT INTO core.job_assignments(organization_id, job_id, member_id, assigned_by, reason) VALUES ($1,$2,$3,$4,$5)',
      [tenant.organizationId, jobId, memberId, session.userId, reason]);
  }

  private async setEquipment(client: PoolClient, tenant: TenantContext, jobId: string, locationId: string, ids: string[], serviceType: string | null, replace = false) {
    if (replace) await client.query('DELETE FROM core.job_equipment WHERE organization_id = $1 AND job_id = $2', [tenant.organizationId, jobId]);
    for (const id of ids) {
      const found = (await client.query('SELECT id FROM core.equipment WHERE organization_id = $1 AND id = $2 AND location_id = $3', [tenant.organizationId, id, locationId])).rows[0];
      if (!found) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { equipment_ids: 'field.required' } });
      await client.query(`INSERT INTO core.job_equipment(organization_id, job_id, equipment_id, location_id, requested_service_type) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (organization_id, job_id, equipment_id) DO NOTHING`, [tenant.organizationId, jobId, id, locationId, serviceType]);
    }
  }

  private async stateChange(client: PoolClient, tenant: TenantContext, jobId: string, from: string | null, to: string, reason: string | null) {
    await client.query('INSERT INTO core.job_state_changes(organization_id, job_id, from_status, to_status, actor_member_id, reason) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenant.organizationId, jobId, from, to, tenant.memberId, reason]);
  }

  private times(check: Validation, body: Record<string, unknown>) {
    const parse = (field: string, value: unknown) => {
      if (value === undefined || value === null || value === '') return null;
      const date = typeof value === 'string' && /[T ]\d{2}:\d{2}/.test(value) && /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) { check.fail(field, 'field.required'); return null; }
      return date;
    };
    const start = parse('scheduled_start', body.scheduled_start);
    const end = parse('scheduled_end', body.scheduled_end);
    if (end && (!start || end <= start)) check.fail('scheduled_end', 'field.required');
    return { start, end };
  }

  private estimate(check: Validation, value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 500) { check.fail('estimated_equipment_count', 'field.required'); return null; }
    return n;
  }

  private ids(check: Validation, field: string, value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 50 || !value.every(v => typeof v === 'string' && uuidPattern.test(v))) { check.fail(field, 'field.required'); return []; }
    return [...new Set(value as string[])];
  }

  private uuid(check: Validation, field: string, value: unknown): string | null {
    if (typeof value === 'string' && uuidPattern.test(value)) return value;
    check.fail(field, 'field.required');
    return null;
  }

  private version(check: Validation, value: unknown): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) check.fail('expected_version', 'field.required');
    return n;
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }

  private async requireWritable(session: SessionContext, tenant: TenantContext) {
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.require_writable($1,$2)', [session.userId, tenant.organizationId])).rows[0]);
    if (row?.outcome === 'ok') return;
    throw row?.outcome === 'inactive' ? apiError(403, 'SUBSCRIPTION_EXPIRED') : row?.outcome === 'suspended' ? apiError(403, 'ORGANIZATION_SUSPENDED') : apiError(403, 'TENANT_ACCESS_DENIED');
  }

  private async audit(client: PoolClient, session: SessionContext, tenant: TenantContext, requestId: string, action: string, id: string) {
    await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenant.organizationId, session.userId, action, 'job', id, requestId]);
  }
}
