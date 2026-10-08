import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { RequestId, Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { MEDIA_SETTINGS, type MediaSettings } from '../config.js';
import { DatabaseService } from '../database/database.service.js';
import { signedFileUrl, type UrlRequest } from '../media/urls.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { pageRows, pagination } from '../shared/pagination.js';

const serviceTypes = ['installation', 'repair', 'inspection', 'maintenance', 'other'];
const outcomes = ['done', 'not_done', 'deferred'];
const photoTypes = ['before', 'after', 'issue', 'other'];

type NextMaintenance = { mode: 'months'; interval_months: number } | { mode: 'custom_date'; due_on: string } | { mode: 'none' } | null;
interface Item {
  equipment_id: string; service_type: string; outcome: string; work_note: string | null; problem_note: string | null; not_done_reason: string | null;
  photos: { media_asset_id: string; photo_type: string }[]; next_maintenance: NextMaintenance;
}
interface ServiceInput { clientEventId: string; occurredAt: Date; note: string | null; items: Item[]; hash: string }

/** Actual service. A job is completed in one transaction with its per-equipment results,
 * photos and next maintenance cycles; retrying with the same client_event_id returns the same
 * result. Technicians can also record on-site work without a planned job (ad-hoc). */
@Controller('organizations/:organizationId')
@UseGuards(TenantGuard)
export class ServiceController {
  constructor(private readonly database: DatabaseService, @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings) {}

  @Post('jobs/:jobId/complete')
  async complete(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('jobId') jobId: string, @Body() body: Record<string, unknown> = {}) {
    this.id(jobId);
    const check = new Validation();
    const expected = Number(body.expected_version);
    if (!Number.isInteger(expected) || expected < 1) check.fail('expected_version', 'field.required');
    const input = this.input(check, body);
    check.done();
    await this.requireWritable(session, tenant, jobId);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const replay = await this.replay(client, tenant, input);
      if (replay) return replay;
      const job = (await client.query('SELECT id, status, version, current_assignee_id, customer_id, location_id FROM core.jobs WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [tenant.organizationId, jobId])).rows[0];
      if (!job) throw apiError(404, 'RESOURCE_NOT_FOUND');
      if (job.current_assignee_id !== tenant.memberId) throw apiError(403, 'TENANT_ACCESS_DENIED');
      if (job.version !== expected) throw apiError(409, 'VERSION_CONFLICT', { latest_version: job.version });
      if (job.status !== 'in_progress') throw apiError(422, 'INVALID_STATE_TRANSITION');
      const result = await this.record(client, session, tenant, requestId, input, job.id, job.customer_id, job.location_id);
      await client.query("UPDATE core.jobs SET status = 'completed', completed_at = now() WHERE organization_id = $1 AND id = $2", [tenant.organizationId, jobId]);
      await client.query("INSERT INTO core.job_state_changes(organization_id, job_id, from_status, to_status, actor_member_id) VALUES ($1,$2,'in_progress','completed',$3)",
        [tenant.organizationId, jobId, tenant.memberId]);
      return { ...result, job_status: 'completed' };
    });
  }

  /** On-site work without a planned job: the server creates a technician_adhoc job assigned to
   * the person who did the work and completes it with the service in the same transaction. */
  @Post('service-events')
  async adhoc(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const customerId = typeof body.customer_id === 'string' && uuidPattern.test(body.customer_id) ? body.customer_id : (check.fail('customer_id', 'field.required'), '');
    const locationId = typeof body.location_id === 'string' && uuidPattern.test(body.location_id) ? body.location_id : (check.fail('location_id', 'field.required'), '');
    const input = this.input(check, body);
    check.done();
    await this.requireWritable(session, tenant, null);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const replay = await this.replay(client, tenant, input);
      if (replay) return replay;
      const location = (await client.query('SELECT id FROM core.customer_locations WHERE organization_id = $1 AND id = $2 AND customer_id = $3 AND archived_at IS NULL',
        [tenant.organizationId, locationId, customerId])).rows[0];
      if (!location) throw apiError(404, 'RESOURCE_NOT_FOUND');
      const types = [...new Set(input.items.map(i => i.service_type))];
      const job = (await client.query(
        `INSERT INTO core.jobs(organization_id, customer_id, location_id, job_type, source, status, current_assignee_id, started_at, created_by_member_id)
         VALUES ($1,$2,$3,$4,'technician_adhoc','in_progress',$5,now(),$5) RETURNING id`,
        [tenant.organizationId, customerId, locationId, types.length === 1 ? types[0] : 'other', tenant.memberId])).rows[0];
      await client.query('INSERT INTO core.job_assignments(organization_id, job_id, member_id, assigned_by) VALUES ($1,$2,$3,$4)', [tenant.organizationId, job.id, tenant.memberId, session.userId]);
      await client.query("INSERT INTO core.job_state_changes(organization_id, job_id, from_status, to_status, actor_member_id) VALUES ($1,$2,NULL,'in_progress',$3)", [tenant.organizationId, job.id, tenant.memberId]);
      const result = await this.record(client, session, tenant, requestId, input, job.id, customerId, locationId);
      await client.query("UPDATE core.jobs SET status = 'completed', completed_at = now() WHERE organization_id = $1 AND id = $2", [tenant.organizationId, job.id]);
      await client.query("INSERT INTO core.job_state_changes(organization_id, job_id, from_status, to_status, actor_member_id) VALUES ($1,$2,'in_progress','completed',$3)",
        [tenant.organizationId, job.id, tenant.memberId]);
      return { ...result, job_status: 'completed' };
    });
  }

  /** Timeline of one unit: every recorded service, who did it, results, photos, next due. */
  @Get('equipment/:equipmentId/history')
  history(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('equipmentId') equipmentId: string, @Req() request: UrlRequest) {
    this.id(equipmentId);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const equipment = (await client.query('SELECT id FROM core.equipment WHERE organization_id = $1 AND id = $2', [tenant.organizationId, equipmentId])).rows[0];
      if (!equipment) throw apiError(404, 'RESOURCE_NOT_FOUND');
      const items = (await client.query(
        `SELECT i.id, e.id AS service_event_id, e.job_id, e.occurred_at, core.member_name(e.organization_id, e.performed_by) AS performed_by_name,
           i.service_type, i.outcome, i.work_note, i.problem_note, i.not_done_reason, i.next_due_on, e.note
         FROM core.service_event_equipment i JOIN core.service_events e ON e.organization_id = i.organization_id AND e.id = i.service_event_id
         WHERE i.organization_id = $1 AND i.equipment_id = $2 AND e.status = 'committed' ORDER BY e.occurred_at DESC LIMIT 100`,
        [tenant.organizationId, equipmentId])).rows;
      const photos = items.length ? (await client.query(
        `SELECT p.service_event_equipment_id, p.photo_type, m.object_key, m.thumbnail_key FROM core.service_photos p
         JOIN core.media_assets m ON m.organization_id = p.organization_id AND m.id = p.media_asset_id
         WHERE p.organization_id = $1 AND p.service_event_equipment_id = ANY($2::uuid[]) AND m.status = 'ready' ORDER BY p.sort_order`,
        [tenant.organizationId, items.map(i => i.id)])).rows : [];
      const cycles = (await client.query(
        `SELECT s.service_type, s.enabled, s.schedule_mode, s.interval_months, c.due_date FROM core.maintenance_schedules s
         LEFT JOIN core.maintenance_cycles c ON c.organization_id = s.organization_id AND c.schedule_id = s.id AND c.status = 'open'
         WHERE s.organization_id = $1 AND s.equipment_id = $2 ORDER BY s.service_type`, [tenant.organizationId, equipmentId])).rows;
      return {
        maintenance: cycles.map(c => ({ ...c, due_date: c.due_date ? toDate(c.due_date) : null })),
        items: items.map(i => ({ ...i, next_due_on: i.next_due_on ? toDate(i.next_due_on) : null,
          photos: photos.filter(p => p.service_event_equipment_id === i.id).map(p => ({ photo_type: p.photo_type,
            url: signedFileUrl(this.settings, request, p.object_key), thumbnail_url: signedFileUrl(this.settings, request, p.thumbnail_key) })) })),
      };
    });
  }

  /** Customer timeline for planning a new job: open jobs (to avoid duplicates) and committed
   * service events, newest first, with per-equipment results and photos. location_id narrows
   * both to one location. */
  @Get('customers/:customerId/service-history')
  customerHistory(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('customerId') customerId: string, @Req() request: UrlRequest,
    @Query('location_id') locationId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    this.id(customerId); if (locationId) this.id(locationId);
    const page = pagination(limit, offset, 5, 50);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const customer = (await client.query('SELECT id FROM core.customers WHERE organization_id = $1 AND id = $2', [tenant.organizationId, customerId])).rows[0];
      if (!customer) throw apiError(404, 'RESOURCE_NOT_FOUND');
      const location = locationId ?? null;
      const openJobs = (await client.query(
        `SELECT j.id, j.status, j.job_type, j.scheduled_start, j.location_id, l.name AS location_label, core.member_name(j.organization_id, j.current_assignee_id) AS assignee_name
         FROM core.jobs j LEFT JOIN core.customer_locations l ON l.organization_id = j.organization_id AND l.id = j.location_id
         WHERE j.organization_id = $1 AND j.customer_id = $2 AND ($3::uuid IS NULL OR j.location_id = $3) AND j.status IN ('unassigned','scheduled','in_progress')
         ORDER BY j.scheduled_start NULLS FIRST, j.created_at LIMIT 20`, [tenant.organizationId, customerId, location])).rows;
      const events = pageRows((await client.query(
        `SELECT e.id, e.job_id, j.job_type, e.occurred_at, e.location_id, l.name AS location_label, e.note,
           core.member_name(e.organization_id, e.performed_by) AS performed_by_name
         FROM core.service_events e
         LEFT JOIN core.jobs j ON j.organization_id = e.organization_id AND j.id = e.job_id
         LEFT JOIN core.customer_locations l ON l.organization_id = e.organization_id AND l.id = e.location_id
         WHERE e.organization_id = $1 AND e.customer_id = $2 AND ($3::uuid IS NULL OR e.location_id = $3) AND e.status = 'committed'
         ORDER BY e.occurred_at DESC, e.id DESC LIMIT $4 OFFSET $5`, [tenant.organizationId, customerId, location, page.limit + 1, page.offset])).rows, page);
      const ids = events.items.map(e => e.id);
      const items = ids.length ? (await client.query(
        `SELECT i.id, i.service_event_id, i.equipment_id, q.name, q.equipment_type AS category, q.brand, q.model, i.service_type, i.outcome,
           i.work_note, i.problem_note, i.not_done_reason, i.next_due_on
         FROM core.service_event_equipment i JOIN core.equipment q ON q.organization_id = i.organization_id AND q.id = i.equipment_id
         WHERE i.organization_id = $1 AND i.service_event_id = ANY($2::uuid[]) ORDER BY i.created_at`, [tenant.organizationId, ids])).rows : [];
      const photos = items.length ? (await client.query(
        `SELECT p.service_event_equipment_id, p.photo_type, m.object_key, m.thumbnail_key FROM core.service_photos p
         JOIN core.media_assets m ON m.organization_id = p.organization_id AND m.id = p.media_asset_id
         WHERE p.organization_id = $1 AND p.service_event_equipment_id = ANY($2::uuid[]) AND m.status = 'ready' ORDER BY p.sort_order`,
        [tenant.organizationId, items.map(i => i.id)])).rows : [];
      return {
        open_jobs: openJobs,
        ...events,
        items: events.items.map(e => ({ ...e, equipment: items.filter(i => i.service_event_id === e.id).map(({ id, service_event_id: _event, ...i }) => ({ ...i,
          next_due_on: i.next_due_on ? toDate(i.next_due_on) : null,
          photos: photos.filter(p => p.service_event_equipment_id === id).map(p => ({ photo_type: p.photo_type,
            url: signedFileUrl(this.settings, request, p.object_key), thumbnail_url: signedFileUrl(this.settings, request, p.thumbnail_key) })) })) })),
      };
    });
  }

  // recording -------------------------------------------------------------------------------
  private async record(client: PoolClient, session: SessionContext, tenant: TenantContext, requestId: string, input: ServiceInput,
    jobId: string, customerId: string, locationId: string) {
    if (input.items.some(i => i.photos.length)) await this.checkPhotos(client, session, tenant, input.items);
    const equipment = (await client.query(
      `SELECT id, name, equipment_type, brand, model, serial_number FROM core.equipment WHERE organization_id = $1 AND location_id = $2 AND id = ANY($3::uuid[])`,
      [tenant.organizationId, locationId, input.items.map(i => i.equipment_id)])).rows;
    if (new Set(input.items.map(i => i.equipment_id)).size !== equipment.length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { items: 'field.required' } });

    const event = (await client.query(
      `INSERT INTO core.service_events(organization_id, client_event_id, job_id, customer_id, location_id, performed_by, occurred_at, note, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [tenant.organizationId, input.clientEventId, jobId, customerId, locationId, tenant.memberId, input.occurredAt, input.note, input.hash])).rows[0];
    const serviceDate = (await client.query('SELECT (($1::timestamptz) AT TIME ZONE o.timezone)::date AS d FROM core.organizations o WHERE o.id = $2',
      [input.occurredAt, tenant.organizationId])).rows[0].d as Date;

    // Lock the affected schedules in a fixed order so concurrent completions cannot deadlock.
    const done = input.items.filter(i => i.outcome === 'done');
    if (done.length) await client.query(
      `SELECT id FROM core.maintenance_schedules WHERE organization_id = $1 AND (equipment_id, service_type) IN (SELECT * FROM unnest($2::uuid[], $3::text[])) ORDER BY id FOR UPDATE`,
      [tenant.organizationId, done.map(i => i.equipment_id), done.map(i => i.service_type)]);

    const results = [];
    for (const [index, item] of input.items.entries()) {
      const unit = equipment.find(e => e.id === item.equipment_id)!;
      const row = (await client.query(
        `INSERT INTO core.service_event_equipment(organization_id, service_event_id, equipment_id, location_id, service_type, outcome, note, work_note, problem_note, not_done_reason, equipment_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10) RETURNING id`,
        [tenant.organizationId, event.id, item.equipment_id, locationId, item.service_type, item.outcome, item.work_note, item.problem_note, item.not_done_reason,
          { name: unit.name, category: unit.equipment_type, brand: unit.brand, model: unit.model, serial_number: unit.serial_number }])).rows[0];
      for (const [order, photo] of item.photos.entries()) {
        await client.query('INSERT INTO core.service_photos(organization_id, service_event_equipment_id, media_asset_id, photo_type, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [tenant.organizationId, row.id, photo.media_asset_id, photo.photo_type, order]);
      }
      const nextDue = item.outcome === 'done' ? await this.maintenance(client, tenant, item, row.id, input.occurredAt, serviceDate) : null;
      if (nextDue) await client.query('UPDATE core.service_event_equipment SET next_due_on = $3 WHERE organization_id = $1 AND id = $2', [tenant.organizationId, row.id, nextDue]);
      results.push({ equipment_id: item.equipment_id, service_type: item.service_type, outcome: item.outcome, next_due_on: nextDue });
      void index;
    }
    await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenant.organizationId, session.userId, 'service.recorded', 'service_event', event.id, requestId]);
    return { service_event_id: event.id as string, job_id: jobId, items: results, server_committed_at: event.created_at };
  }

  /** Only a done result moves the cycle. Later service already recorded for the same unit and
   * type means this is a back-dated entry: history is kept but the cycle is not moved back. */
  private async maintenance(client: PoolClient, tenant: TenantContext, item: Item, itemId: string, occurredAt: Date, serviceDate: Date): Promise<string | null> {
    const later = (await client.query(
      `SELECT 1 FROM core.service_event_equipment i JOIN core.service_events e ON e.organization_id = i.organization_id AND e.id = i.service_event_id
       WHERE i.organization_id = $1 AND i.equipment_id = $2 AND i.service_type = $3 AND i.outcome = 'done' AND e.status = 'committed' AND e.occurred_at > $4 LIMIT 1`,
      [tenant.organizationId, item.equipment_id, item.service_type, occurredAt])).rows[0];
    if (later) return null;
    let schedule = (await client.query('SELECT id, enabled, schedule_mode, interval_months FROM core.maintenance_schedules WHERE organization_id = $1 AND equipment_id = $2 AND service_type = $3',
      [tenant.organizationId, item.equipment_id, item.service_type])).rows[0];
    const next = item.next_maintenance;
    if (next) {
      const values = next.mode === 'months' ? [true, 'months', next.interval_months, null] : next.mode === 'custom_date' ? [true, 'custom_date', null, next.due_on] : [false, 'months', null, null];
      schedule = (await client.query(
        `INSERT INTO core.maintenance_schedules(organization_id, equipment_id, service_type, enabled, schedule_mode, interval_months, custom_due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id, equipment_id, service_type) DO UPDATE SET enabled = EXCLUDED.enabled, schedule_mode = EXCLUDED.schedule_mode,
           interval_months = EXCLUDED.interval_months, custom_due_date = EXCLUDED.custom_due_date
         RETURNING id, enabled, schedule_mode, interval_months`,
        [tenant.organizationId, item.equipment_id, item.service_type, ...values])).rows[0];
    }
    if (!schedule) return null;
    // Close the open cycle: fulfilled by this work, or disabled when reminders were turned off.
    const closed = (await client.query(
      `UPDATE core.maintenance_cycles SET status = $4::text, fulfilled_by_item_id = CASE WHEN $4::text = 'fulfilled' THEN $3::uuid ELSE NULL END, closed_at = now(),
         close_reason = CASE WHEN $4::text = 'disabled' THEN 'no_reminder' END
       WHERE organization_id = $1 AND schedule_id = $2 AND status = 'open' RETURNING id`,
      [tenant.organizationId, schedule.id, itemId, schedule.enabled ? 'fulfilled' : 'disabled'])).rows;
    if (closed.length && schedule.enabled) {
      await client.query("UPDATE core.maintenance_bookings SET status = 'fulfilled' WHERE organization_id = $1 AND cycle_id = ANY($2::uuid[]) AND status = 'active'",
        [tenant.organizationId, closed.map(c => c.id)]);
    }
    await client.query('UPDATE core.maintenance_schedules SET last_done_item_id = $3 WHERE organization_id = $1 AND id = $2', [tenant.organizationId, schedule.id, itemId]);
    if (!schedule.enabled) return null;
    const due = next?.mode === 'custom_date' ? next.due_on : schedule.schedule_mode === 'months' && schedule.interval_months
      ? toDate((await client.query('SELECT ($1::date + make_interval(months => $2))::date AS d', [serviceDate, schedule.interval_months])).rows[0].d) : null;
    if (!due) return null;
    await client.query('INSERT INTO core.maintenance_cycles(organization_id, schedule_id, source_service_event_equipment_id, due_date) VALUES ($1,$2,$3,$4)',
      [tenant.organizationId, schedule.id, itemId, due]);
    return due;
  }

  /** Same client_event_id: return the committed result; a different body is a conflict. */
  private async replay(client: PoolClient, tenant: TenantContext, input: ServiceInput) {
    const event = (await client.query('SELECT id, job_id, request_hash, created_at FROM core.service_events WHERE organization_id = $1 AND client_event_id = $2',
      [tenant.organizationId, input.clientEventId])).rows[0];
    if (!event) return null;
    if (event.request_hash && event.request_hash !== input.hash) throw apiError(409, 'IDEMPOTENCY_MISMATCH');
    const items = (await client.query('SELECT equipment_id, service_type, outcome, next_due_on FROM core.service_event_equipment WHERE organization_id = $1 AND service_event_id = $2 ORDER BY created_at',
      [tenant.organizationId, event.id])).rows.map(i => ({ ...i, next_due_on: i.next_due_on ? toDate(i.next_due_on) : null }));
    const job = event.job_id ? (await client.query('SELECT status FROM core.jobs WHERE organization_id = $1 AND id = $2', [tenant.organizationId, event.job_id])).rows[0] : null;
    return { service_event_id: event.id, job_id: event.job_id, items, server_committed_at: event.created_at, job_status: job?.status ?? null, replayed: true };
  }

  private async checkPhotos(client: PoolClient, session: SessionContext, tenant: TenantContext, items: Item[]) {
    const ids = items.flatMap(i => i.photos.map(p => p.media_asset_id));
    const assets = (await client.query('SELECT id, status, uploaded_by FROM core.media_assets WHERE organization_id = $1 AND id = ANY($2::uuid[])', [tenant.organizationId, ids])).rows;
    const ok = ids.every(id => assets.some(a => a.id === id && a.status === 'ready' && (tenant.role === 'owner' || a.uploaded_by === session.userId)));
    if (!ok || new Set(ids).size !== ids.length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { photos: 'field.image' } });
  }

  private input(check: Validation, body: Record<string, unknown>): ServiceInput {
    const clientEventId = typeof body.client_event_id === 'string' && uuidPattern.test(body.client_event_id) ? body.client_event_id : (check.fail('client_event_id', 'field.required'), randomUUID());
    const occurredAt = typeof body.occurred_at === 'string' && /(Z|[+-]\d{2}:?\d{2})$/.test(body.occurred_at) ? new Date(body.occurred_at) : new Date(NaN);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 10 * 60000) check.fail('occurred_at', 'field.required');
    const note = check.text('note', body.note, { required: false, max: 2000 }) ?? null;
    const raw = Array.isArray(body.items) ? body.items : [];
    if (!raw.length || raw.length > 30) check.fail('items', 'field.required');
    const items: Item[] = raw.map((value, index) => {
      const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      const f = (name: string) => `items.${index}.${name}`;
      const equipmentId = typeof v.equipment_id === 'string' && uuidPattern.test(v.equipment_id) ? v.equipment_id : (check.fail(f('equipment_id'), 'field.required'), '');
      const serviceType = serviceTypes.includes(v.service_type as string) ? v.service_type as string : (check.fail(f('service_type'), 'field.required'), 'other');
      const outcome = outcomes.includes(v.outcome as string) ? v.outcome as string : (check.fail(f('outcome'), 'field.required'), 'done');
      const text = (name: string, max: number) => check.text(f(name), v[name], { required: false, max }) ?? null;
      const reason = text('not_done_reason', 500);
      if (outcome !== 'done' && !reason) check.fail(f('not_done_reason'), 'field.required');
      const photos = Array.isArray(v.photos) ? v.photos.filter((p): p is { media_asset_id: string; photo_type: string } =>
        !!p && typeof p === 'object' && uuidPattern.test(String((p as Record<string, unknown>).media_asset_id)) && photoTypes.includes(String((p as Record<string, unknown>).photo_type))) : [];
      if (Array.isArray(v.photos) && photos.length !== v.photos.length) check.fail(f('photos'), 'field.image');
      return { equipment_id: equipmentId, service_type: serviceType, outcome, work_note: text('work_note', 2000), problem_note: text('problem_note', 2000),
        not_done_reason: outcome === 'done' ? null : reason, photos, next_maintenance: this.nextMaintenance(check, f('next_maintenance'), v.next_maintenance, occurredAt) };
    });
    const keys = items.map(i => `${i.equipment_id}:${i.service_type}`);
    if (new Set(keys).size !== keys.length) check.fail('items', 'field.required');
    if (items.length && !items.some(i => i.outcome === 'done')) check.fail('items', 'field.noneDone');
    const hash = createHash('sha256').update(JSON.stringify({ occurredAt: occurredAt.getTime() || null, note, items })).digest('hex');
    return { clientEventId, occurredAt, note, items, hash };
  }

  private nextMaintenance(check: Validation, field: string, value: unknown, occurredAt: Date): NextMaintenance {
    if (value === undefined || value === null) return null;
    const v = value as Record<string, unknown>;
    if (v.mode === 'none') return { mode: 'none' };
    if (v.mode === 'months' && Number.isInteger(v.interval_months) && (v.interval_months as number) >= 1 && (v.interval_months as number) <= 60) return { mode: 'months', interval_months: v.interval_months as number };
    if (v.mode === 'custom_date' && typeof v.due_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.due_on) && !Number.isNaN(Date.parse(v.due_on))
      && new Date(`${v.due_on}T23:59:59+07:00`) > occurredAt) return { mode: 'custom_date', due_on: v.due_on };
    check.fail(field, 'field.required');
    return null;
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }

  private async requireWritable(session: SessionContext, tenant: TenantContext, jobId: string | null) {
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.require_writable($1,$2)', [session.userId, tenant.organizationId])).rows[0]);
    if (row?.outcome === 'ok') return;
    if (row?.outcome === 'inactive' && jobId) {
      const late = await this.database.identity(async client => (await client.query('SELECT auth.late_submission_allowed($1,$2,$3) AS ok', [session.userId, tenant.organizationId, jobId])).rows[0]);
      if (late?.ok) return;
    }
    throw row?.outcome === 'inactive' ? apiError(403, 'SUBSCRIPTION_EXPIRED') : row?.outcome === 'suspended' ? apiError(403, 'ORGANIZATION_SUSPENDED') : apiError(403, 'TENANT_ACCESS_DENIED');
  }
}

/** Postgres DATE → YYYY-MM-DD without a time-zone shift. */
function toDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
