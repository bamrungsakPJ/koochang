import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { MEDIA_SETTINGS, type MediaSettings } from '../config.js';
import { Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { signKey, verifyToken } from '../media/signed-url.js';
import type { UrlRequest } from '../media/urls.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { renderTaxPdf, type TaxDocumentRow } from './tax-pdf.js';

type PdfResponse = { setHeader: (n: string, v: string) => void; end: (b: Buffer) => void };
const linkKey = (organizationId: string, id: string) => `tax-document:${organizationId}:${id}`;
const linkTtlSeconds = 300;

export async function sendTaxPdf(response: PdfResponse, row: TaxDocumentRow | null, copy: 'original' | 'copy' = 'original') {
  if (!row || row.status !== 'issued') throw apiError(404, 'RESOURCE_NOT_FOUND');
  const pdf = await renderTaxPdf(row, copy);
  const name = row.kind === 'receipt' ? row.receipt_no : row.credit_note_no;
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `inline; filename="${String(name).replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(pdf);
}

/** Owner side of receipts and credit notes: who they are made out to, the list, and the PDF (through a
 * short-lived signed link so the app can open it in the browser). Technicians never reach these routes. */
@Controller('organizations/:organizationId/billing')
@UseGuards(TenantGuard)
export class TaxDocumentsController {
  constructor(private readonly database: DatabaseService, @Inject(MEDIA_SETTINGS) private readonly media: MediaSettings) {}

  @Get('buyer-profile')
  profile(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async c => ({
      profile: (await c.query(`SELECT version, buyer_name, tax_id, branch_no, address, phone, email, updated_at
        FROM billing.buyer_profiles WHERE organization_id = $1`, [tenant.organizationId])).rows[0] ?? null,
      organization_name: (await c.query('SELECT name FROM core.organizations WHERE id = $1', [tenant.organizationId])).rows[0]?.name ?? '',
    }));
  }

  @Put('buyer-profile')
  async saveProfile(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const version = typeof body.version === 'number' && Number.isSafeInteger(body.version) && body.version >= 0 ? body.version : (check.fail('version', 'field.required'), 0);
    const name = check.text('buyer_name', body.buyer_name, { max: 200 });
    const address = check.text('address', body.address, { max: 500 });
    const taxId = check.text('tax_id', typeof body.tax_id === 'string' ? body.tax_id.replace(/[\s-]/g, '') : body.tax_id, { required: false, max: 13 }) ?? null;
    if (taxId && !/^\d{13}$/.test(taxId)) check.fail('tax_id', 'field.taxId');
    let branch = check.text('branch_no', body.branch_no, { required: false, max: 5 }) ?? null;
    if (taxId && !branch) branch = '00000';
    if (branch && (!taxId || !/^\d{5}$/.test(branch))) check.fail('branch_no', 'field.branchNo');
    const phone = check.text('phone', body.phone, { required: false, max: 30 }) ?? null;
    const email = check.text('email', body.email, { required: false, max: 100 }) ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) check.fail('email', 'field.email');
    check.done();
    const row = await this.database.identity(async c => (await c.query('SELECT * FROM auth.save_buyer_profile($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [session.userId, tenant.organizationId, version, name, taxId, branch, address, phone, email])).rows[0]);
    if (row.outcome === 'forbidden') throw apiError(403, 'TENANT_ACCESS_DENIED');
    if (row.outcome === 'conflict') throw apiError(409, 'VERSION_CONFLICT');
    if (row.outcome !== 'ok') throw apiError(400, 'VALIDATION_ERROR');
    return this.profile(session, tenant);
  }

  @Get('tax-documents')
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async c => ({
      items: (await c.query(`SELECT id, kind, status, doc_date::text AS doc_date, gross_minor, invoice_no, receipt_no, credit_note_no, issued_at, created_at
        FROM billing.tax_documents WHERE organization_id = $1 AND status <> 'skipped' ORDER BY created_at DESC LIMIT 50`, [tenant.organizationId])).rows,
    }));
  }

  /** A link valid for five minutes; opening it needs no session (the app hands it to the browser). */
  @Post('tax-documents/:id/link') @HttpCode(200)
  async link(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('id') id: string, @Req() request: UrlRequest) {
    this.ownerOnly(tenant);
    if (!uuidPattern.test(id)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (!this.media.urlSecret) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const issued = await this.database.withTenant(session.userId, tenant.organizationId, async c =>
      (await c.query("SELECT 1 FROM billing.tax_documents WHERE organization_id = $1 AND id = $2 AND status = 'issued'", [tenant.organizationId, id])).rowCount);
    if (!issued) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const { token, expiresAt } = signKey(this.media.urlSecret, linkKey(tenant.organizationId, id), linkTtlSeconds);
    const base = `${request.headers['x-forwarded-proto'] ?? request.protocol}://${request.headers['x-forwarded-host'] ?? request.headers.host}/v1/documents`;
    return { url: `${base}/${token}`, expires_at: expiresAt };
  }

  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }
}

/** Signed PDF links. No session: the short-lived signature is the permission. */
@Controller('documents')
export class TaxDocumentFileController {
  constructor(private readonly database: DatabaseService, @Inject(MEDIA_SETTINGS) private readonly media: MediaSettings) {}

  @Get(':token') @HttpCode(200)
  async download(@Param('token') token: string, @Res() response: PdfResponse) {
    const key = this.media.urlSecret ? verifyToken(this.media.urlSecret, token) : null;
    const [, organizationId, id] = /^tax-document:([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(key ?? '') ?? [];
    if (!organizationId || !id) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const row = await this.database.identity(async c => (await c.query('SELECT auth.tax_document_file($1,$2) AS v', [organizationId, id])).rows[0]?.v ?? null);
    await sendTaxPdf(response, row);
  }
}
