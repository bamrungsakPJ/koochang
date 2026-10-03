import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { MEDIA_SETTINGS, type MediaSettings } from '../config.js';
import { DatabaseService } from '../database/database.service.js';
import { OCR_PROVIDER, type OcrProvider } from '../ocr/ocr.provider.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { InvalidImageError, processImage } from './image.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { signKey, verifyToken } from './signed-url.js';

const mimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const purposes = ['equipment', 'nameplate', 'service', 'other'];
interface MediaRow {
  id: string; status: string; purpose: string; mime_type: string; size_bytes: string; declared_bytes: string | null; request_key: string;
  object_key: string; thumbnail_key: string | null; uploaded_by: string; width: number | null; height: number | null; failure_code: string | null; created_at: string;
}
interface HttpRequest { protocol: string; headers: Record<string, string | undefined>; body: unknown; }

/** Maps a quota reservation outcome to the API error the app shows. */
function quotaError(outcome: string | undefined) {
  if (outcome === 'limit_reached') return apiError(409, 'PLAN_LIMIT_REACHED');
  if (outcome === 'inactive') return apiError(403, 'SUBSCRIPTION_EXPIRED');
  return apiError(403, 'TENANT_ACCESS_DENIED');
}

@Controller('organizations/:organizationId')
@UseGuards(TenantGuard)
export class MediaController {
  constructor(
    private readonly database: DatabaseService,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    @Inject(OCR_PROVIDER) private readonly ocr: OcrProvider | null,
  ) {}

  /** Step 1: reserve storage for the declared size and register a pending file. Retrying with
   * the same request_key returns the same file. */
  @Post('media')
  async create(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}, @Req() request: HttpRequest) {
    if (!this.storage || !this.settings.urlSecret) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const check = new Validation();
    const requestKey = typeof body.request_key === 'string' && uuidPattern.test(body.request_key) ? body.request_key : undefined;
    if (!requestKey) check.fail('request_key', 'field.required');
    if (typeof body.mime_type !== 'string' || !mimeTypes.includes(body.mime_type)) check.fail('mime_type', 'field.required');
    const declared = Number(body.byte_size);
    if (!Number.isInteger(declared) || declared < 1 || declared > this.settings.maxUploadBytes) check.fail('byte_size', 'field.tooLong');
    const purpose = typeof body.purpose === 'string' && purposes.includes(body.purpose) ? body.purpose : 'other';
    check.done();

    const reservation = await this.database.identity(async client => (await client.query(
      'SELECT outcome FROM auth.reserve_usage($1,$2,$3,$4,$5,$6)', [session.userId, tenant.organizationId, 'storage_bytes', requestKey, declared, 3600])).rows[0]);
    if (reservation?.outcome !== 'reserved' && reservation?.outcome !== 'existing') throw quotaError(reservation?.outcome);

    const row = await this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const existing = await this.find(client, tenant.organizationId, { requestKey });
      if (existing) return existing;
      const id = randomUUID();
      const month = new Date().toISOString().slice(0, 7).replace('-', '/');
      return (await client.query(
        `INSERT INTO core.media_assets(id, organization_id, object_key, mime_type, size_bytes, status, uploaded_by, request_key, purpose, declared_bytes)
         VALUES ($1,$2,$3,$4,0,'pending_upload',$5,$6,$7,$8) RETURNING *`,
        [id, tenant.organizationId, `${tenant.organizationId}/${month}/${id}.jpg`, body.mime_type, session.userId, requestKey, purpose, declared])).rows[0] as MediaRow;
    }).catch(async error => {
      if ((error as { code?: string }).code !== '23505') throw error;
      return this.database.withTenant(session.userId, tenant.organizationId, client => this.find(client, tenant.organizationId, { requestKey }));
    });
    return this.present(row!, request);
  }

  /** Step 2: the image bytes. Processed (verified, rotated, metadata and GPS removed, resized,
   * thumbnail) before it is stored; storage is then counted at the stored size. */
  @Put('media/:assetId/content')
  async upload(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('assetId') assetId: string, @Req() request: HttpRequest) {
    if (!this.storage) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    if (!uuidPattern.test(assetId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const asset = await this.database.withTenant(session.userId, tenant.organizationId, client => this.find(client, tenant.organizationId, { id: assetId }));
    if (!asset || asset.uploaded_by !== session.userId) throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (asset.status === 'ready') return this.present(asset, request);
    if (asset.status !== 'pending_upload') throw apiError(422, 'INVALID_STATE_TRANSITION');
    const bytes = Buffer.isBuffer(request.body) ? request.body : null;
    if (!bytes?.length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { content: 'field.required' } });

    let processed;
    try { processed = await processImage(bytes, this.settings.maxStoredBytes); }
    catch (error) {
      const code = error instanceof InvalidImageError ? error.message : 'PROCESSING_FAILED';
      await this.fail(session, tenant, asset, code);
      throw apiError(400, 'VALIDATION_ERROR', { field_errors: { content: 'field.image' } });
    }
    const thumbnailKey = asset.object_key.replace(/\.jpg$/, '_thumb.jpg');
    await this.storage.put(asset.object_key, processed.image);
    await this.storage.put(thumbnailKey, processed.thumbnail);
    const stored = processed.image.length + processed.thumbnail.length;
    const ready = await this.database.withTenant(session.userId, tenant.organizationId, async client => (await client.query(
      `UPDATE core.media_assets SET status = 'ready', size_bytes = $3, thumbnail_key = $4, checksum = $5, width = $6, height = $7,
         gps_metadata_stripped_at = now(), mime_type = 'image/jpeg', failure_code = NULL
       WHERE organization_id = $1 AND id = $2 AND status = 'pending_upload' RETURNING *`,
      [tenant.organizationId, asset.id, stored, thumbnailKey, processed.checksum, processed.width, processed.height])).rows[0] as MediaRow | undefined);
    if (!ready) return this.present((await this.database.withTenant(session.userId, tenant.organizationId, c => this.find(c, tenant.organizationId, { id: assetId })))!, request);
    await this.database.identity(client => client.query('SELECT auth.consume_usage($1,$2,$3,$4)', [tenant.organizationId, 'storage_bytes', asset.request_key, stored]));
    return this.present(ready, request);
  }

  @Get('media/:assetId')
  async get(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('assetId') assetId: string, @Req() request: HttpRequest) {
    if (!uuidPattern.test(assetId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const asset = await this.database.withTenant(session.userId, tenant.organizationId, client => this.find(client, tenant.organizationId, { id: assetId }));
    // Until jobs exist (B modules) a technician may open only the files they uploaded.
    if (!asset || (tenant.role !== 'owner' && asset.uploaded_by !== session.userId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return this.present(asset, request);
  }

  // OCR -------------------------------------------------------------------------------------
  /** Queue a nameplate reading. Costs one OCR only when the provider succeeds; failures and
   * retries are not counted. Without a provider the app goes straight to manual entry. */
  @Post('ocr-requests')
  async requestOcr(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    if (!this.ocr) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const check = new Validation();
    const requestKey = typeof body.request_key === 'string' && uuidPattern.test(body.request_key) ? body.request_key : undefined;
    const assetId = typeof body.media_asset_id === 'string' && uuidPattern.test(body.media_asset_id) ? body.media_asset_id : undefined;
    if (!requestKey) check.fail('request_key', 'field.required');
    if (!assetId) check.fail('media_asset_id', 'field.required');
    check.done();
    const asset = await this.database.withTenant(session.userId, tenant.organizationId, client => this.find(client, tenant.organizationId, { id: assetId! }));
    if (!asset || asset.status !== 'ready' || (tenant.role !== 'owner' && asset.uploaded_by !== session.userId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const reservation = await this.database.identity(async client => (await client.query(
      'SELECT outcome FROM auth.reserve_usage($1,$2,$3,$4,1,$5)', [session.userId, tenant.organizationId, 'ocr', requestKey, 3600])).rows[0]);
    if (reservation?.outcome !== 'reserved' && reservation?.outcome !== 'existing') throw quotaError(reservation?.outcome);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      await client.query(`INSERT INTO core.ocr_requests(organization_id, request_key, media_asset_id, requested_by)
        VALUES ($1,$2,$3,$4) ON CONFLICT ON CONSTRAINT ocr_requests_organization_id_request_key_key DO NOTHING`, [tenant.organizationId, requestKey, assetId, session.userId]);
      return this.presentOcr((await client.query('SELECT * FROM core.ocr_requests WHERE organization_id = $1 AND request_key = $2', [tenant.organizationId, requestKey])).rows[0]);
    });
  }

  @Get('ocr-requests/:requestId')
  async getOcr(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('requestId') requestId: string) {
    if (!uuidPattern.test(requestId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const row = await this.database.withTenant(session.userId, tenant.organizationId, async client =>
      (await client.query('SELECT * FROM core.ocr_requests WHERE organization_id = $1 AND id = $2', [tenant.organizationId, requestId])).rows[0]);
    if (!row || (tenant.role !== 'owner' && row.requested_by !== session.userId)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return this.presentOcr(row);
  }

  // helpers ---------------------------------------------------------------------------------
  private async find(client: PoolClient, organizationId: string, by: { id?: string; requestKey?: string }): Promise<MediaRow | undefined> {
    const column = by.id ? 'id' : 'request_key';
    return (await client.query(`SELECT * FROM core.media_assets WHERE organization_id = $1 AND ${column} = $2`, [organizationId, by.id ?? by.requestKey])).rows[0];
  }

  private async fail(session: SessionContext, tenant: TenantContext, asset: MediaRow, code: string) {
    await this.database.withTenant(session.userId, tenant.organizationId, client => client.query(
      "UPDATE core.media_assets SET status = 'failed', failure_code = $3 WHERE organization_id = $1 AND id = $2 AND status = 'pending_upload'",
      [tenant.organizationId, asset.id, code]));
    await this.database.identity(client => client.query('SELECT auth.settle_usage($1,$2,$3,false)', [tenant.organizationId, 'storage_bytes', asset.request_key]));
  }

  private present(asset: MediaRow, request: HttpRequest) {
    const base = `${request.headers['x-forwarded-proto'] ?? request.protocol}://${request.headers['x-forwarded-host'] ?? request.headers.host}/v1/files`;
    const url = (key: string | null) => {
      if (!key || asset.status !== 'ready' || !this.settings.urlSecret) return null;
      return `${base}/${signKey(this.settings.urlSecret, key, this.settings.urlTtlSeconds).token}`;
    };
    return {
      id: asset.id, status: asset.status, purpose: asset.purpose, request_key: asset.request_key,
      size_bytes: Number(asset.size_bytes), width: asset.width, height: asset.height, failure_code: asset.failure_code,
      upload_url: asset.status === 'pending_upload' ? `${base.replace(/\/files$/, '')}/organizations/${asset.object_key.split('/')[0]}/media/${asset.id}/content` : null,
      url: url(asset.object_key), thumbnail_url: url(asset.thumbnail_key),
      url_expires_in: asset.status === 'ready' ? this.settings.urlTtlSeconds : null,
    };
  }

  private presentOcr(row: Record<string, unknown>) {
    return { id: row.id, status: row.status, media_asset_id: row.media_asset_id, suggestions: row.status === 'succeeded' ? row.result : null,
      error_code: row.status === 'failed' ? row.error_code : null, provider: row.provider ?? null };
  }
}

/** Signed downloads. No session: the short-lived signature is the permission. */
@Controller('files')
export class FilesController {
  constructor(@Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null) {}

  @Get(':token') @HttpCode(200)
  async download(@Param('token') token: string, @Res() response: { setHeader: (n: string, v: string) => void; end: (b: Buffer) => void }) {
    const key = this.storage && this.settings.urlSecret ? verifyToken(this.settings.urlSecret, token) : null;
    if (!key) throw apiError(404, 'RESOURCE_NOT_FOUND');
    let data: Buffer;
    try { data = await this.storage!.get(key); } catch { throw apiError(404, 'RESOURCE_NOT_FOUND'); }
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(data);
  }
}

