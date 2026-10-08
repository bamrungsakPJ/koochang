import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RequestId, Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { MEDIA_SETTINGS, type MediaSettings } from '../config.js';
import { DatabaseService } from '../database/database.service.js';
import { signedFileUrl, type UrlRequest } from '../media/urls.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';

const photoTypes = ['nameplate', 'equipment', 'other'];
interface PhotoInput { media_asset_id: string; photo_type: string }

/** Serial for matching only: upper case, letters and digits. Ambiguous characters (O/0, I/1)
 * are kept as typed; the person confirms, the system never guesses. */
export function normalizeSerial(serial: string | null | undefined): string | null {
  const value = (serial ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return value.length ? value : null;
}

/** Equipment at a customer location. Visibility follows locations (RLS). Creating needs a
 * writable plan; OCR suggestions are never applied here unless the person sends them. */
@Controller('organizations/:organizationId')
@UseGuards(TenantGuard)
export class EquipmentController {
  constructor(private readonly database: DatabaseService, @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings) {}

  @Get('locations/:locationId/equipment')
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('locationId') locationId: string, @Req() request: UrlRequest) {
    this.id(locationId);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      await this.requireLocation(client, tenant, locationId);
      const rows = (await client.query(
        `SELECT e.id, e.name, e.equipment_type AS category, e.brand, e.model, e.serial_number, e.status, e.version,
           (SELECT m.thumbnail_key FROM core.equipment_photos p JOIN core.media_assets m ON m.organization_id = p.organization_id AND m.id = p.media_asset_id
             WHERE p.organization_id = e.organization_id AND p.equipment_id = e.id AND m.status = 'ready'
             ORDER BY (p.photo_type = 'equipment') DESC, p.sort_order, p.created_at LIMIT 1) AS thumbnail_key,
           (SELECT to_char(min(cy.due_date), 'YYYY-MM-DD') FROM core.maintenance_cycles cy
             JOIN core.maintenance_schedules s ON s.organization_id = cy.organization_id AND s.id = cy.schedule_id AND s.enabled
             WHERE s.organization_id = e.organization_id AND s.equipment_id = e.id AND cy.status = 'open') AS next_due_on,
           (SELECT max(se.occurred_at) FROM core.service_event_equipment i JOIN core.service_events se ON se.organization_id = i.organization_id AND se.id = i.service_event_id
             WHERE i.organization_id = e.organization_id AND i.equipment_id = e.id AND se.status = 'committed') AS last_serviced_at
         FROM core.equipment e WHERE e.organization_id = $1 AND e.location_id = $2 AND e.status = 'active' ORDER BY e.created_at`,
        [tenant.organizationId, locationId])).rows;
      return { items: rows.map(({ thumbnail_key, ...e }) => ({ ...e, thumbnail_url: signedFileUrl(this.settings, request, thumbnail_key) })) };
    });
  }

  /** Create equipment with its photos in one transaction. The same request_key returns the same
   * equipment. A serial already at this location, or the same category + brand + model + name,
   * returns DUPLICATE_WARNING with candidates unless confirm_duplicate is set. */
  @Post('locations/:locationId/equipment')
  async create(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('locationId') locationId: string, @Body() body: Record<string, unknown> = {}, @Req() request: UrlRequest) {
    this.id(locationId);
    const check = new Validation();
    const requestKey = typeof body.request_key === 'string' && uuidPattern.test(body.request_key) ? body.request_key : '';
    if (!requestKey) check.fail('request_key', 'field.required');
    const fields = this.fields(check, body, true);
    const photos = this.photos(check, body.photos);
    const ocrRequestId = typeof body.ocr_request_id === 'string' && uuidPattern.test(body.ocr_request_id) ? body.ocr_request_id : null;
    check.done();
    await this.requireWritable(session, tenant);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      await this.requireLocation(client, tenant, locationId);
      const existing = (await client.query('SELECT id FROM core.equipment WHERE organization_id = $1 AND create_request_key = $2', [tenant.organizationId, requestKey])).rows[0];
      if (existing) return this.detail(client, tenant, existing.id, request);
      if (body.confirm_duplicate !== true) {
        const candidates = (await client.query(
          `SELECT id, name, equipment_type AS category, brand, model, serial_number FROM core.equipment
           WHERE organization_id = $1 AND location_id = $2 AND status = 'active'
             AND (($3::text IS NOT NULL AND serial_normalized = $3)
               OR ($3::text IS NULL AND equipment_type = $4 AND coalesce(lower(brand), '') = coalesce(lower($5), '')
                   AND coalesce(lower(model), '') = coalesce(lower($6), '') AND coalesce(lower(name), '') = coalesce(lower($7), '')))
           LIMIT 5`,
          [tenant.organizationId, locationId, normalizeSerial(fields.serial_number), fields.category, fields.brand, fields.model, fields.name])).rows;
        if (candidates.length) throw apiError(409, 'DUPLICATE_WARNING', { candidates });
      }
      const equipment = (await client.query(
        `INSERT INTO core.equipment(organization_id, location_id, name, equipment_type, brand, model, serial_number, serial_normalized, installed_on, note, created_by_member_id, create_request_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tenant.organizationId, locationId, fields.name, fields.category, fields.brand, fields.model, fields.serial_number, normalizeSerial(fields.serial_number),
          fields.installed_on, fields.note, tenant.memberId, requestKey])).rows[0];
      await this.attachPhotos(client, session, tenant, equipment.id, photos);
      if (ocrRequestId) {
        // Record what the person confirmed next to the suggestion; never the other way round.
        await client.query(
          `UPDATE core.ocr_requests SET equipment_id = $3, accepted_fields = $4 WHERE organization_id = $1 AND id = $2 AND equipment_id IS NULL`,
          [tenant.organizationId, ocrRequestId, equipment.id, { brand: fields.brand, model: fields.model, serial_number: fields.serial_number }]);
      }
      await this.audit(client, session, tenant, requestId, 'equipment.created', equipment.id);
      return this.detail(client, tenant, equipment.id, request);
    });
  }

  @Get('equipment/:equipmentId')
  get(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('equipmentId') equipmentId: string, @Req() request: UrlRequest) {
    this.id(equipmentId);
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, equipmentId, request));
  }

  @Patch('equipment/:equipmentId')
  async update(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('equipmentId') equipmentId: string, @Body() body: Record<string, unknown> = {}, @Req() request: UrlRequest) {
    this.id(equipmentId);
    const check = new Validation();
    const expected = Number(body.expected_version);
    if (!Number.isInteger(expected) || expected < 1) check.fail('expected_version', 'field.required');
    const fields = this.fields(check, body, false);
    check.done();
    await this.requireWritable(session, tenant);
    // Only the fields present in the body change; the column list is fixed, values are parameters.
    const columns: [string, keyof typeof fields][] = [['name', 'name'], ['equipment_type', 'category'], ['brand', 'brand'], ['model', 'model'],
      ['serial_number', 'serial_number'], ['installed_on', 'installed_on'], ['note', 'note']];
    const params: unknown[] = [tenant.organizationId, equipmentId, expected];
    const assignments = columns.filter(([, key]) => body[key] !== undefined).map(([column, key]) => `${column} = $${params.push(fields[key])}`);
    if (body.serial_number !== undefined) assignments.push(`serial_normalized = $${params.push(normalizeSerial(fields.serial_number))}`);
    if (!assignments.length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { name: 'field.required' } });
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const row = (await client.query(`UPDATE core.equipment SET ${assignments.join(', ')} WHERE organization_id = $1 AND id = $2 AND version = $3 RETURNING id`, params)).rows[0];
      if (!row) {
        const current = (await client.query('SELECT version FROM core.equipment WHERE organization_id = $1 AND id = $2', [tenant.organizationId, equipmentId])).rows[0];
        if (!current) throw apiError(404, 'RESOURCE_NOT_FOUND');
        throw apiError(409, 'VERSION_CONFLICT', { latest_version: current.version });
      }
      await this.audit(client, session, tenant, requestId, 'equipment.updated', equipmentId);
      return this.detail(client, tenant, equipmentId, request);
    });
  }

  @Post('equipment/:equipmentId/photos')
  async addPhotos(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('equipmentId') equipmentId: string, @Body() body: Record<string, unknown> = {}, @Req() request: UrlRequest) {
    this.id(equipmentId);
    const check = new Validation();
    const photos = this.photos(check, body.photos);
    if (!photos.length) check.fail('photos', 'field.required');
    check.done();
    await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const equipment = (await client.query('SELECT id FROM core.equipment WHERE organization_id = $1 AND id = $2', [tenant.organizationId, equipmentId])).rows[0];
      if (!equipment) throw apiError(404, 'RESOURCE_NOT_FOUND');
      await this.attachPhotos(client, session, tenant, equipmentId, photos);
      await this.audit(client, session, tenant, requestId, 'equipment.photos_added', equipmentId);
      return this.detail(client, tenant, equipmentId, request);
    });
  }

  // helpers ---------------------------------------------------------------------------------
  private async detail(client: PoolClient, tenant: TenantContext, equipmentId: string, request: UrlRequest) {
    const equipment = (await client.query(
      `SELECT e.id, e.location_id, l.customer_id, e.name, e.equipment_type AS category, e.brand, e.model, e.serial_number, e.installed_on, e.note, e.status, e.version, e.created_at
       FROM core.equipment e JOIN core.customer_locations l ON l.organization_id = e.organization_id AND l.id = e.location_id
       WHERE e.organization_id = $1 AND e.id = $2`, [tenant.organizationId, equipmentId])).rows[0];
    if (!equipment) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const photos = (await client.query(
      `SELECT p.id, p.photo_type, m.id AS media_asset_id, m.object_key, m.thumbnail_key, m.status FROM core.equipment_photos p
       JOIN core.media_assets m ON m.organization_id = p.organization_id AND m.id = p.media_asset_id
       WHERE p.organization_id = $1 AND p.equipment_id = $2 ORDER BY p.sort_order, p.created_at`, [tenant.organizationId, equipmentId])).rows;
    return {
      ...equipment,
      photos: photos.map(p => ({ id: p.id, photo_type: p.photo_type, media_asset_id: p.media_asset_id, status: p.status,
        url: p.status === 'ready' ? signedFileUrl(this.settings, request, p.object_key) : null,
        thumbnail_url: p.status === 'ready' ? signedFileUrl(this.settings, request, p.thumbnail_key) : null })),
    };
  }

  /** Photos must be ready files of this shop; technicians may attach only their own uploads. */
  private async attachPhotos(client: PoolClient, session: SessionContext, tenant: TenantContext, equipmentId: string, photos: PhotoInput[]) {
    for (const [index, photo] of photos.entries()) {
      const asset = (await client.query('SELECT id, status, uploaded_by FROM core.media_assets WHERE organization_id = $1 AND id = $2', [tenant.organizationId, photo.media_asset_id])).rows[0];
      if (!asset || asset.status !== 'ready' || (tenant.role !== 'owner' && asset.uploaded_by !== session.userId)) {
        throw apiError(400, 'VALIDATION_ERROR', { field_errors: { photos: 'field.image' } });
      }
      await client.query(
        `INSERT INTO core.equipment_photos(organization_id, equipment_id, media_asset_id, photo_type, sort_order) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id, equipment_id, media_asset_id) DO NOTHING`,
        [tenant.organizationId, equipmentId, photo.media_asset_id, photo.photo_type, index]);
    }
  }

  private fields(check: Validation, body: Record<string, unknown>, creating: boolean) {
    const text = (key: string, max: number) => check.text(key, body[key], { required: false, max }) ?? null;
    const category = creating || body.category !== undefined ? check.text('category', body.category, { max: 40 }) ?? 'other' : 'other';
    let installed: string | null = null;
    if (body.installed_on !== undefined && body.installed_on !== null && body.installed_on !== '') {
      installed = typeof body.installed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.installed_on) && !Number.isNaN(Date.parse(body.installed_on)) ? body.installed_on : null;
      if (!installed) check.fail('installed_on', 'field.required');
    }
    return { name: text('name', 80), category, brand: text('brand', 80), model: text('model', 80), serial_number: text('serial_number', 80), installed_on: installed, note: text('note', 1000) };
  }

  private photos(check: Validation, value: unknown): PhotoInput[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 10) { check.fail('photos', 'field.required'); return []; }
    const photos = value.filter((p): p is PhotoInput => !!p && typeof p === 'object' && uuidPattern.test(String((p as PhotoInput).media_asset_id)) && photoTypes.includes((p as PhotoInput).photo_type));
    if (photos.length !== value.length) check.fail('photos', 'field.image');
    return photos;
  }

  private async requireLocation(client: PoolClient, tenant: TenantContext, locationId: string) {
    const row = (await client.query('SELECT id FROM core.customer_locations WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL', [tenant.organizationId, locationId])).rows[0];
    if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }

  private async requireWritable(session: SessionContext, tenant: TenantContext) {
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.require_writable($1,$2)', [session.userId, tenant.organizationId])).rows[0]);
    if (row?.outcome === 'ok') return;
    throw row?.outcome === 'inactive' ? apiError(403, 'SUBSCRIPTION_EXPIRED') : row?.outcome === 'suspended' ? apiError(403, 'ORGANIZATION_SUSPENDED') : apiError(403, 'TENANT_ACCESS_DENIED');
  }

  private async audit(client: PoolClient, session: SessionContext, tenant: TenantContext, requestId: string, action: string, id: string) {
    await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [tenant.organizationId, session.userId, action, 'equipment', id, requestId]);
  }
}
