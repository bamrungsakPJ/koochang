import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { normalizePhone } from '@field-service/core';
import { RequestId, Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { pagination, pageRows } from '../shared/pagination.js';

interface LocationInput { label?: string; address?: string | null; travel_note?: string | null; coordinates?: unknown }
interface LocationCoordinates { latitude: number; longitude: number; accuracy_m: number | null; method: 'current_location' | 'manual_pin' }
interface ParsedLocation { label: string; address: string | null; travel_note: string | null; coordinates: LocationCoordinates | null }
const customerTypes = ['individual', 'business'];

/** Customers and their service locations. Visibility is enforced by RLS: owners see the whole
 * shop, technicians only what they created until jobs exist. Writes need a writable plan. */
@Controller('organizations/:organizationId')
@UseGuards(TenantGuard)
export class CustomersController {
  constructor(private readonly database: DatabaseService) {}

  /** Search by phone (any format) or name. Phone digits match anywhere, name is case-insensitive. */
  @Get('customers')
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const page = pagination(limit, offset, 30, 100);
    const text = (q ?? '').trim().slice(0, 80);
    const digits = text.replace(/\D/g, '');
    const phone = digits.length >= 3 ? (digits.startsWith('0') ? digits.slice(1) : digits.replace(/^66/, '')) : null;
    return this.database.withTenant(session.userId, tenant.organizationId, async client => pageRows((await client.query(
        `SELECT c.id, c.name, c.phone_normalized, c.customer_type, c.version, c.updated_at,
           count(l.id)::int AS location_count, count(l.latitude)::int AS located_count
         FROM core.customers c LEFT JOIN core.customer_locations l ON l.organization_id = c.organization_id AND l.customer_id = c.id AND l.archived_at IS NULL
         WHERE c.organization_id = $1 AND c.archived_at IS NULL
           AND ($2 = '' OR lower(coalesce(c.name, '')) LIKE '%' || lower($2) || '%' OR ($3::text IS NOT NULL AND c.phone_normalized LIKE '%' || $3 || '%'))
         GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC LIMIT $4 OFFSET $5`, [tenant.organizationId, text, phone, page.limit + 1, page.offset])).rows, page));
  }

  /** Create a customer, optionally with the first location, in one transaction. The same
   * request_key returns the same customer. A known phone needs confirm_duplicate, and the app
   * shows the existing customers instead of merging them. */
  @Post('customers')
  async create(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const requestKey = this.requestKey(check, body.request_key);
    const name = check.text('name', body.name, { required: false, max: 120 });
    const phone = this.phone(check, body.phone);
    if (!phone) check.fail('phone', 'field.required');
    const note = check.text('note', body.note, { required: false, max: 1000 });
    const type = customerTypes.includes(body.customer_type as string) ? body.customer_type as string : 'individual';
    const location = body.location && typeof body.location === 'object' ? this.location(check, body.location as LocationInput, 'location.') : null;
    check.done();
    await this.requireWritable(session, tenant);

    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const existing = (await client.query('SELECT id FROM core.customers WHERE organization_id = $1 AND create_request_key = $2', [tenant.organizationId, requestKey])).rows[0];
      if (existing) return this.detail(client, tenant, existing.id);
      if (phone && body.confirm_duplicate !== true) {
        const same = (await client.query(
          'SELECT id, name, phone_normalized FROM core.customers WHERE organization_id = $1 AND phone_normalized = $2 AND archived_at IS NULL LIMIT 5', [tenant.organizationId, phone])).rows;
        if (same.length) throw apiError(409, 'DUPLICATE_WARNING', { candidates: same });
      }
      const customer = (await client.query(
        `INSERT INTO core.customers(organization_id, name, phone, phone_normalized, customer_type, note, created_by_member_id, create_request_key)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7) RETURNING id`,
        [tenant.organizationId, name ?? null, phone, type, note ?? null, tenant.memberId, requestKey])).rows[0];
      if (location) {
        const locationId = await this.insertLocation(client, tenant, session.userId, customer.id, location, null);
        if (location.coordinates) await this.audit(client, session, tenant, requestId, 'location.coordinates_saved', 'customer_location', locationId, { method: location.coordinates.method });
      }
      await this.audit(client, session, tenant, requestId, 'customer.created', 'customer', customer.id);
      return this.detail(client, tenant, customer.id);
    });
  }

  @Get('customers/:customerId')
  get(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('customerId') customerId: string) {
    this.id(customerId);
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, customerId));
  }

  @Patch('customers/:customerId')
  async update(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('customerId') customerId: string, @Body() body: Record<string, unknown> = {}) {
    this.id(customerId);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const name = check.text('name', body.name, { required: false, max: 120 });
    const phone = body.phone === undefined ? undefined : this.phone(check, body.phone);
    const note = body.note === undefined ? undefined : check.text('note', body.note, { required: false, max: 1000 }) ?? null;
    check.done();
    await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const row = (await client.query(
        `UPDATE core.customers SET name = CASE WHEN $4::boolean THEN $5 ELSE name END,
           phone = CASE WHEN $6::boolean THEN $7 ELSE phone END, phone_normalized = CASE WHEN $6::boolean THEN $7 ELSE phone_normalized END,
           note = CASE WHEN $8::boolean THEN $9 ELSE note END
         WHERE organization_id = $1 AND id = $2 AND version = $3 RETURNING id`,
        [tenant.organizationId, customerId, expected, body.name !== undefined, name ?? null, phone !== undefined, phone ?? null, note !== undefined, note ?? null])).rows[0];
      if (!row) await this.conflictOrMissing(client, 'core.customers', tenant, customerId);
      await this.audit(client, session, tenant, requestId, 'customer.updated', 'customer', customerId);
      return this.detail(client, tenant, customerId);
    }).catch(error => { throw this.mapCheck(error); });
  }

  /** Hide from new work. History stays; nothing is deleted. Owner only. */
  @Post('customers/:customerId/archive') @HttpCode(200)
  async archive(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param('customerId') customerId: string) {
    this.id(customerId);
    if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED');
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const row = (await client.query('UPDATE core.customers SET archived_at = coalesce(archived_at, now()) WHERE organization_id = $1 AND id = $2 RETURNING id', [tenant.organizationId, customerId])).rows[0];
      if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
      await this.audit(client, session, tenant, requestId, 'customer.archived', 'customer', customerId);
      return { id: customerId, archived: true };
    });
  }

  // locations -------------------------------------------------------------------------------
  @Post('customers/:customerId/locations')
  async addLocation(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('customerId') customerId: string, @Body() body: Record<string, unknown> = {}) {
    this.id(customerId);
    const check = new Validation();
    const requestKey = this.requestKey(check, body.request_key);
    const location = this.location(check, body as LocationInput, '');
    check.done();
    await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const customer = (await client.query('SELECT id FROM core.customers WHERE organization_id = $1 AND id = $2', [tenant.organizationId, customerId])).rows[0];
      if (!customer) throw apiError(404, 'RESOURCE_NOT_FOUND');
      const existing = (await client.query('SELECT id FROM core.customer_locations WHERE organization_id = $1 AND create_request_key = $2', [tenant.organizationId, requestKey])).rows[0];
      if (!existing) {
        const id = await this.insertLocation(client, tenant, session.userId, customerId, location, requestKey);
        await this.audit(client, session, tenant, requestId, 'location.created', 'customer_location', id);
        if (location.coordinates) await this.audit(client, session, tenant, requestId, 'location.coordinates_saved', 'customer_location', id, { method: location.coordinates.method });
      }
      return this.detail(client, tenant, customerId);
    });
  }

  @Patch('locations/:locationId')
  async updateLocation(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('locationId') locationId: string, @Body() body: Record<string, unknown> = {}) {
    this.id(locationId);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const label = body.label === undefined ? undefined : check.text('label', body.label, { max: 80 });
    const address = body.address === undefined ? undefined : check.text('address', body.address, { required: false, max: 500 }) ?? null;
    const travel = body.travel_note === undefined ? undefined : check.text('travel_note', body.travel_note, { required: false, max: 500 }) ?? null;
    check.done();
    await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const row = (await client.query(
        `UPDATE core.customer_locations SET name = coalesce($4, name), address = CASE WHEN $5::boolean THEN $6 ELSE address END,
           travel_note = CASE WHEN $7::boolean THEN $8 ELSE travel_note END
         WHERE organization_id = $1 AND id = $2 AND version = $3 RETURNING customer_id`,
        [tenant.organizationId, locationId, expected, label ?? null, address !== undefined, address ?? null, travel !== undefined, travel ?? null])).rows[0];
      if (!row) await this.conflictOrMissing(client, 'core.customer_locations', tenant, locationId);
      await this.audit(client, session, tenant, requestId, 'location.updated', 'customer_location', locationId);
      return this.detail(client, tenant, row.customer_id);
    });
  }

  /** Coordinates are saved only by an explicit action: the device reads its position once
   * (current_location) or the user drops a pin (manual_pin). Replacing saved coordinates needs
   * replace_existing and the current version, and is audited with the previous value. There is
   * no endpoint that accepts a technician's position over time. */
  @Put('locations/:locationId/coordinates')
  async saveCoordinates(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @RequestId() requestId: string,
    @Param('locationId') locationId: string, @Body() body: Record<string, unknown> = {}) {
    this.id(locationId);
    const check = new Validation();
    const expected = this.version(check, body.expected_version);
    const lat = Number(body.latitude), lng = Number(body.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) check.fail('latitude', 'field.required');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) check.fail('longitude', 'field.required');
    const method = body.method === 'manual_pin' ? 'manual_pin' : body.method === 'current_location' ? 'current_location' : null;
    if (!method) check.fail('method', 'field.required');
    const accuracy = body.accuracy_m === undefined || body.accuracy_m === null ? null : Number(body.accuracy_m);
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)) check.fail('accuracy_m', 'field.required');
    check.done();
    await this.requireWritable(session, tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const current = (await client.query('SELECT customer_id, latitude, longitude, version FROM core.customer_locations WHERE organization_id = $1 AND id = $2 FOR UPDATE',
        [tenant.organizationId, locationId])).rows[0];
      if (!current) throw apiError(404, 'RESOURCE_NOT_FOUND');
      if (current.version !== expected) throw apiError(409, 'VERSION_CONFLICT', { latest_version: current.version });
      if (current.latitude !== null && body.replace_existing !== true) throw apiError(409, 'COORDINATES_EXIST');
      await client.query(
        `UPDATE core.customer_locations SET latitude = round($3::numeric, 6), longitude = round($4::numeric, 6), accuracy_meters = $5,
           capture_method = $6, location_captured_at = now(), location_captured_by = $7 WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, locationId, lat, lng, accuracy, method, session.userId]);
      await this.audit(client, session, tenant, requestId, current.latitude === null ? 'location.coordinates_saved' : 'location.coordinates_replaced',
        'customer_location', locationId, { previous: current.latitude === null ? null : { latitude: current.latitude, longitude: current.longitude }, method });
      return this.detail(client, tenant, current.customer_id);
    });
  }

  // helpers ---------------------------------------------------------------------------------
  private async detail(client: PoolClient, tenant: TenantContext, customerId: string) {
    const customer = (await client.query(
      'SELECT id, name, phone_normalized, customer_type, note, archived_at, version, created_at FROM core.customers WHERE organization_id = $1 AND id = $2',
      [tenant.organizationId, customerId])).rows[0];
    if (!customer) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const locations = (await client.query(
      `SELECT id, name AS label, address, travel_note, latitude::float8 AS latitude, longitude::float8 AS longitude, accuracy_meters::float8 AS accuracy_m,
         capture_method, location_captured_at, version FROM core.customer_locations
       WHERE organization_id = $1 AND customer_id = $2 AND archived_at IS NULL ORDER BY created_at`, [tenant.organizationId, customerId])).rows;
    return { ...customer, locations };
  }

  private async insertLocation(client: PoolClient, tenant: TenantContext, userId: string, customerId: string, location: ParsedLocation, requestKey: string | null) {
    const coords = location.coordinates;
    return (await client.query(
      `INSERT INTO core.customer_locations(organization_id, customer_id, name, address, travel_note, created_by_member_id, create_request_key,
         latitude, longitude, accuracy_meters, capture_method, location_captured_at, location_captured_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,round($8::numeric,6),round($9::numeric,6),$10,$11,CASE WHEN $11::text IS NULL THEN NULL ELSE now() END,$12) RETURNING id`,
      [tenant.organizationId, customerId, location.label, location.address, location.travel_note, tenant.memberId, requestKey,
        coords?.latitude ?? null, coords?.longitude ?? null, coords?.accuracy_m ?? null, coords?.method ?? null, coords ? userId : null])).rows[0].id as string;
  }

  private location(check: Validation, input: LocationInput, prefix: string): ParsedLocation {
    let coordinates: LocationCoordinates | null = null;
    if (input.coordinates !== undefined) {
      if (!input.coordinates || typeof input.coordinates !== 'object' || Array.isArray(input.coordinates)) check.fail(`${prefix}coordinates`, 'field.required');
      else {
        const c = input.coordinates as Record<string, unknown>;
        if (typeof c.latitude !== 'number' || !Number.isFinite(c.latitude) || c.latitude < -90 || c.latitude > 90) check.fail(`${prefix}coordinates.latitude`, 'field.required');
        if (typeof c.longitude !== 'number' || !Number.isFinite(c.longitude) || c.longitude < -180 || c.longitude > 180) check.fail(`${prefix}coordinates.longitude`, 'field.required');
        if (c.accuracy_m !== undefined && c.accuracy_m !== null && (typeof c.accuracy_m !== 'number' || !Number.isFinite(c.accuracy_m) || c.accuracy_m < 0 || c.accuracy_m > 100000)) check.fail(`${prefix}coordinates.accuracy_m`, 'field.required');
        if (c.method !== 'current_location' && c.method !== 'manual_pin') check.fail(`${prefix}coordinates.method`, 'field.required');
        coordinates = { latitude: c.latitude as number, longitude: c.longitude as number, accuracy_m: c.accuracy_m as number | null ?? null, method: c.method as LocationCoordinates['method'] };
      }
    }
    return {
      label: check.text(`${prefix}label`, input.label, { max: 80 }) ?? '',
      address: check.text(`${prefix}address`, input.address, { required: false, max: 500 }) ?? null,
      travel_note: check.text(`${prefix}travel_note`, input.travel_note, { required: false, max: 500 }) ?? null,
      coordinates,
    };
  }

  private phone(check: Validation, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    const phone = normalizePhone(value);
    if (!phone) check.fail('phone', 'field.phone');
    return phone;
  }

  private requestKey(check: Validation, value: unknown): string {
    if (typeof value === 'string' && uuidPattern.test(value)) return value;
    check.fail('request_key', 'field.required');
    return '';
  }

  private version(check: Validation, value: unknown): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) check.fail('expected_version', 'field.required');
    return n;
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }

  private async conflictOrMissing(client: PoolClient, table: string, tenant: TenantContext, id: string): Promise<never> {
    const row = (await client.query(`SELECT version FROM ${table} WHERE organization_id = $1 AND id = $2`, [tenant.organizationId, id])).rows[0];
    if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
    throw apiError(409, 'VERSION_CONFLICT', { latest_version: row.version });
  }

  /** Removing both name and phone would leave a customer nobody can find. */
  private mapCheck(error: unknown) {
    return (error as { code?: string }).code === '23514' ? apiError(400, 'VALIDATION_ERROR', { field_errors: { phone: 'field.required' } }) : error;
  }

  private async requireWritable(session: SessionContext, tenant: TenantContext) {
    const row = await this.database.identity(async client => (await client.query('SELECT outcome FROM auth.require_writable($1,$2)', [session.userId, tenant.organizationId])).rows[0]);
    if (row?.outcome === 'ok') return;
    throw row?.outcome === 'inactive' ? apiError(403, 'SUBSCRIPTION_EXPIRED') : row?.outcome === 'suspended' ? apiError(403, 'ORGANIZATION_SUSPENDED') : apiError(403, 'TENANT_ACCESS_DENIED');
  }

  private async audit(client: PoolClient, session: SessionContext, tenant: TenantContext, requestId: string, action: string, type: string, id: string, details: object = {}) {
    await client.query('INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tenant.organizationId, session.userId, action, type, id, requestId, details]);
  }
}
