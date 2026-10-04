import { Body, Controller, Get, Inject, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { RuntimeSettingsService } from '../platform/runtime-settings.service.js';
import { PLATFORM_SETTINGS, MEDIA_SETTINGS, type MediaSettings, type PlatformSettings } from '../config.js';
import { Session, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { InvalidImageError, processImage } from '../media/image.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../media/object-storage.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { SlipVerificationService } from './slip-verification.service.js';
import { StripeService } from './stripe.service.js';

/** Owner bank transfers. EasySlip-confirmed payments activate immediately; exceptional proofs
 * stay in the platform review queue. Technicians never reach the billing routes. */
@Controller('organizations/:organizationId/billing')
@UseGuards(TenantGuard)
export class BillingController {
  constructor(private readonly database: DatabaseService, @Inject(PLATFORM_SETTINGS) private readonly settings: PlatformSettings,
    @Inject(MEDIA_SETTINGS) private readonly media: MediaSettings, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    private readonly slips: SlipVerificationService, private readonly stripe: StripeService,
    @Optional() private readonly runtime?: RuntimeSettingsService) {}
  private bank() { return this.runtime ? this.runtime.bank() : Promise.resolve(this.settings.payment); }

  /** Paid plans at their current published price (proposal prices until launch). */
  @Get('plans')
  async plans(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    const stripe = await this.stripe.methods();
    const bank = await this.bank();
    const allowed=(await this.runtime?.read())?.policy?.new_payments_enabled!==false;
    return this.database.withTenant(session.userId, tenant.organizationId, async client => ({
      payment_available: allowed&&(Boolean(bank) || stripe.stripe_card || stripe.stripe_qr),
      methods: { transfer: Boolean(bank), ...stripe },
      items: (await client.query(
        `SELECT DISTINCT ON (p.id,pr.interval_unit) p.code, p.name_th, p.name_en, pv.technician_seats, pv.storage_bytes, pv.ocr_per_period, pv.grace_days,
           pr.id AS price_version_id, pr.amount_minor, pr.currency, pr.interval_unit
         FROM billing.plans p JOIN billing.plan_versions pv ON pv.plan_id = p.id AND pv.published_at <= now()
         JOIN billing.price_versions pr ON pr.plan_version_id = pv.id AND pr.effective_from <= now()
         WHERE p.kind = 'paid' AND p.status = 'active'
         AND pv.version_no=(SELECT max(latest.version_no) FROM billing.plan_versions latest WHERE latest.plan_id=p.id AND latest.published_at<=now())
         ORDER BY p.id, pr.interval_unit, pr.effective_from DESC`)).rows.sort((a, b) => Number(a.amount_minor) - Number(b.amount_minor)),
    }));
  }

  @Get('invoices')
  invoices(@Session() session: SessionContext, @Tenant() tenant: TenantContext) {
    this.ownerOnly(tenant);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => ({
      items: (await client.query(
        `SELECT i.id, i.number, i.amount_minor, i.currency, i.status, i.created_at, i.due_at, i.paid_at, i.voided_at,
           i.plan_snapshot->>'name_th' AS plan_name_th, i.plan_snapshot->>'name_en' AS plan_name_en,
           (SELECT pp.status FROM billing.payment_proofs pp WHERE pp.organization_id = i.organization_id AND pp.invoice_id = i.id ORDER BY pp.created_at DESC LIMIT 1) AS proof_status
         FROM billing.invoices i WHERE i.organization_id = $1 AND i.status <> 'voided' ORDER BY i.created_at DESC LIMIT 50`, [tenant.organizationId])).rows,
    }));
  }

  @Post('invoices')
  async create(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant);
    const check = new Validation();
    const price = typeof body.price_version_id === 'string' && uuidPattern.test(body.price_version_id) ? body.price_version_id : (check.fail('price_version_id', 'field.required'), '');
    const key = typeof body.request_key === 'string' && uuidPattern.test(body.request_key) ? body.request_key : (check.fail('request_key', 'field.required'), '');
    check.done();
    if((await this.runtime?.read())?.policy?.new_payments_enabled===false)throw apiError(503,'TEMPORARILY_UNAVAILABLE');
    const methods = await this.stripe.methods();
    const bank = await this.bank();
    if (!bank && !methods.stripe_card && !methods.stripe_qr) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const row = await this.database.identity(async c => (await c.query('SELECT * FROM auth.create_invoice($1,$2,$3,$4)', [session.userId, tenant.organizationId, price, key])).rows[0]);
    if (row.outcome === 'forbidden') throw apiError(403, 'TENANT_ACCESS_DENIED');
    if (row.outcome === 'suspended') throw apiError(403, 'ORGANIZATION_SUSPENDED');
    if (row.outcome === 'not_found') throw apiError(400, 'VALIDATION_ERROR', { field_errors: { price_version_id: 'field.required' } });
    if (row.outcome === 'seats') throw apiError(422, 'SEAT_LIMIT_REACHED');
    if (bank) await this.database.identity(c => c.query('SELECT auth.freeze_invoice_receiver($1,$2,$3,$4::jsonb)',
      [session.userId, tenant.organizationId, row.invoice_id, JSON.stringify(bank)]));
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, row.invoice_id));
  }

  @Get('invoices/:invoiceId')
  get(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('invoiceId') invoiceId: string) {
    this.ownerOnly(tenant); this.id(invoiceId);
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, invoiceId));
  }

  @Post('invoices/:invoiceId/checkout')
  checkout(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('invoiceId') invoiceId: string, @Body() body: Record<string, unknown> = {}) {
    this.ownerOnly(tenant); this.id(invoiceId);
    if (!['card','promptpay'].includes(body.method as string) || typeof body.request_key !== 'string' || !uuidPattern.test(body.request_key)) throw apiError(400,'VALIDATION_ERROR');
    return this.stripe.checkout(session.userId,tenant.organizationId,invoiceId,body.method as 'card'|'promptpay',body.request_key);
  }
  @Post('invoices/:invoiceId/checkouts/:checkoutId/refresh')
  async refreshCheckout(@Session() session: SessionContext,@Tenant() tenant: TenantContext,@Param('invoiceId') invoiceId:string,@Param('checkoutId') checkoutId:string) {
    await this.checkoutOwner(session,tenant,invoiceId,checkoutId);
    await this.stripe.refresh(checkoutId);
    return this.database.withTenant(session.userId,tenant.organizationId,c=>this.detail(c,tenant,invoiceId));
  }
  @Post('invoices/:invoiceId/checkouts/:checkoutId/cancel')
  async cancelCheckout(@Session() session: SessionContext,@Tenant() tenant: TenantContext,@Param('invoiceId') invoiceId:string,@Param('checkoutId') checkoutId:string) {
    await this.checkoutOwner(session,tenant,invoiceId,checkoutId);
    await this.stripe.cancel(checkoutId);
    return this.database.withTenant(session.userId,tenant.organizationId,c=>this.detail(c,tenant,invoiceId));
  }
  private async checkoutOwner(session:SessionContext,tenant:TenantContext,invoiceId:string,id:string) {
    this.ownerOnly(tenant);this.id(invoiceId);this.id(id);
    const row=await this.database.withTenant(session.userId,tenant.organizationId,async c=>(await c.query('SELECT id FROM billing.stripe_checkouts WHERE organization_id=$1 AND invoice_id=$2 AND id=$3',[tenant.organizationId,invoiceId,id])).rows[0]);
    if(!row)throw apiError(404,'RESOURCE_NOT_FOUND');
  }

  /** Proof of transfer as image bytes (screenshot or photo of the slip). Stored privately with
   * metadata removed; not counted in the shop's photo storage. `proof_id` makes retries safe. */
  @Put('invoices/:invoiceId/proof')
  async proof(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Param('invoiceId') invoiceId: string,
    @Query('proof_id') proofId: string, @Req() request: { body: unknown }) {
    this.ownerOnly(tenant); this.id(invoiceId);
    if (!uuidPattern.test(proofId ?? '')) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { proof_id: 'field.required' } });
    if (!this.storage) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const bytes = Buffer.isBuffer(request.body) ? request.body : null;
    if (!bytes?.length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { content: 'field.required' } });
    const open = await this.database.withTenant(session.userId, tenant.organizationId, async c =>
      (await c.query('SELECT status FROM billing.invoices WHERE organization_id = $1 AND id = $2', [tenant.organizationId, invoiceId])).rows[0]);
    if (!open) throw apiError(404, 'RESOURCE_NOT_FOUND');
    let processed;
    try { processed = await processImage(bytes, this.media.maxStoredBytes); }
    catch (error) {
      if (error instanceof InvalidImageError) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { content: 'field.image' } });
      throw error;
    }
    const key = `billing/${tenant.organizationId}/${invoiceId}/${proofId.toLowerCase()}.jpg`;
    const row = await this.database.identity(async c => (await c.query('SELECT * FROM auth.submit_payment_proof($1,$2,$3,$4,$5,$6,$7)',
      [session.userId, tenant.organizationId, invoiceId, proofId, key, processed.checksum, processed.image.length])).rows[0]);
    if (row.outcome === 'closed') throw apiError(422, 'INVOICE_CLOSED');
    if (row.outcome === 'mismatch') throw apiError(409, 'VERSION_CONFLICT');
    if (row.outcome === 'checkout_active') throw apiError(422, 'PAYMENT_IN_PROGRESS');
    if (!['ok', 'existing'].includes(row.outcome)) throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (open.status === 'open') {
      await this.storage.put(key, processed.image);
      await this.slips.verify(proofId, processed.image);
    }
    return this.database.withTenant(session.userId, tenant.organizationId, client => this.detail(client, tenant, invoiceId));
  }

  private async detail(client: PoolClient, tenant: TenantContext, invoiceId: string) {
    const invoice = (await client.query(
      `SELECT i.id, i.number, i.amount_minor, i.currency, i.status, i.created_at, i.due_at, i.paid_at, i.voided_at, i.void_reason,
         i.receiver_snapshot, i.plan_snapshot->>'name_th' AS plan_name_th, i.plan_snapshot->>'name_en' AS plan_name_en, (i.plan_snapshot->>'technician_seats')::int AS technician_seats
       FROM billing.invoices i WHERE i.organization_id = $1 AND i.id = $2`, [tenant.organizationId, invoiceId])).rows[0];
    if (!invoice) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const proofs = (await client.query(`SELECT id, status, reason, created_at, reviewed_at, verification_code, verification_at FROM billing.payment_proofs
      WHERE organization_id = $1 AND invoice_id = $2 ORDER BY created_at DESC`, [tenant.organizationId, invoiceId])).rows;
    const payment = (await client.query(`SELECT p.amount_minor, p.verified_at,
        coalesce((SELECT sum(r.amount_minor) FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id AND r.status = 'succeeded'), 0) AS refunded_minor
      FROM billing.payments p WHERE p.organization_id = $1 AND p.invoice_id = $2`, [tenant.organizationId, invoiceId])).rows[0] ?? null;
    const period = (await client.query('SELECT start_at, end_at FROM billing.subscription_periods WHERE organization_id = $1 AND invoice_id = $2',
      [tenant.organizationId, invoiceId])).rows[0] ?? null;
    const channel = invoice.receiver_snapshot ?? await this.bank();
    const { receiver_snapshot: _receiver, ...publicInvoice } = invoice;
    const checkouts = (await client.query('SELECT id,method,status,reason,created_at,expires_at,checkout_url FROM billing.stripe_checkouts WHERE organization_id=$1 AND invoice_id=$2 ORDER BY created_at DESC',[tenant.organizationId,invoiceId])).rows;
    const methods = {transfer:Boolean(channel),...await this.stripe.methods()};
    return { ...publicInvoice, proofs, payment, period, checkouts, methods,
      pay_to: invoice.status === 'open' && channel ? { bank_name: channel.bankName, account_name: channel.accountName, account_number: channel.accountNumber,
        promptpay_id: channel.promptPayId ?? null, reference: invoice.number } : null };
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
  private ownerOnly(tenant: TenantContext) { if (tenant.role !== 'owner') throw apiError(403, 'TENANT_ACCESS_DENIED'); }
}
