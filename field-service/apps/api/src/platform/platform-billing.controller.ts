import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '../media/object-storage.js';
import { RequestId } from '../auth/session.guard.js';
import { apiError, uuidPattern, Validation } from '../shared/api-error.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, StepUp, type PlatformAccount } from './platform.guard.js';

const confirmErrors: Record<string, [number, Parameters<typeof apiError>[1]]> = {
  not_found: [404, 'RESOURCE_NOT_FOUND'], voided: [422, 'INVOICE_CLOSED'], already_paid: [422, 'INVOICE_CLOSED'],
  amount_mismatch: [422, 'PAYMENT_AMOUNT_MISMATCH'], reference_used: [409, 'BANK_REFERENCE_USED'],
};

/** Billing operations of the platform team: payment queue, proof review, confirming money
 * received, refunds with a second approver, and the daily reconciliation export. */
@Controller('platform/billing')
@UseGuards(PlatformGuard)
export class PlatformBillingController {
  constructor(private readonly database: PlatformDatabaseService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null) {}

  @Get('invoices') @Permission('billing.read')
  invoices(@Account() account: PlatformAccount, @Query('status') status?: string) {
    const filter = ['pending', 'open', 'paid', 'all'].includes(status ?? '') ? status : 'pending';
    return this.database.run(async c => ({ items: (await c.query('SELECT * FROM padmin.payment_queue($1,$2)', [account.accountId, filter])).rows }));
  }

  @Get('invoices/:id') @Permission('billing.read')
  async invoice(@Account() account: PlatformAccount, @Param('id') id: string) {
    this.id(id);
    const detail = await this.database.run(async c => (await c.query('SELECT padmin.invoice_detail($1,$2) AS d', [account.accountId, id])).rows[0].d);
    if (!detail) throw apiError(404, 'RESOURCE_NOT_FOUND');
    return detail;
  }

  /** The proof image itself, streamed with no-store; every view is audited. */
  @Get('proofs/:id/file') @Permission('billing.read')
  async proof(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string,
    @Res() response: { setHeader: (n: string, v: string) => void; end: (b: Buffer) => void }) {
    this.id(id);
    if (!this.storage) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    const key = await this.database.run(async c => (await c.query('SELECT padmin.proof_object($1,$2,$3) AS k', [account.accountId, id, requestId])).rows[0].k);
    if (!key) throw apiError(404, 'RESOURCE_NOT_FOUND');
    let data: Buffer;
    try { data = await this.storage.get(key); } catch { throw apiError(404, 'RESOURCE_NOT_FOUND'); }
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(data);
  }

  /** Money actually received on the bank statement. Retrying with the same bank reference
   * returns the same payment and period; nothing is extended twice. */
  @Post('invoices/:id/confirm') @HttpCode(200) @Permission('billing.verify') @StepUp()
  async confirm(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const amount = Number(body.amount_minor);
    if (!Number.isSafeInteger(amount) || amount <= 0) check.fail('amount_minor', 'field.required');
    const reference = check.text('bank_reference', body.bank_reference, { max: 80 });
    const received = typeof body.received_at === 'string' && !Number.isNaN(Date.parse(body.received_at)) && Date.parse(body.received_at) <= Date.now() + 60_000
      ? new Date(body.received_at) : (check.fail('received_at', 'field.required'), null);
    const proofId = body.proof_id === undefined || body.proof_id === null ? null
      : typeof body.proof_id === 'string' && uuidPattern.test(body.proof_id) ? body.proof_id : (check.fail('proof_id', 'field.required'), null);
    const note = check.text('note', body.note, { required: false, max: 500 }) ?? null;
    check.done();
    const row = await this.database.run(async c => (await c.query('SELECT * FROM padmin.confirm_payment($1,$2,$3,$4,$5,$6,$7,$8)',
      [account.accountId, id, amount, reference, received, proofId, note, requestId])).rows[0]);
    const error = confirmErrors[row.outcome];
    if (error) throw apiError(error[0], error[1]);
    return { outcome: row.outcome, payment_id: row.payment_id, period_start: row.period_start, period_end: row.period_end };
  }

  @Post('proofs/:id/reject') @HttpCode(200) @Permission('billing.verify')
  async reject(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    const outcome = await this.database.run(async c => (await c.query('SELECT padmin.reject_proof($1,$2,$3,$4) AS o', [account.accountId, id, reason, requestId])).rows[0].o);
    if (outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (outcome !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  @Get('refunds') @Permission('billing.read')
  refunds(@Account() account: PlatformAccount) {
    return this.database.run(async c => ({ items: (await c.query('SELECT * FROM padmin.refund_queue($1)', [account.accountId])).rows }));
  }

  @Post('payments/:id/refunds') @Permission('refund.request') @StepUp()
  async requestRefund(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const amount = Number(body.amount_minor);
    if (!Number.isSafeInteger(amount) || amount <= 0) check.fail('amount_minor', 'field.required');
    const reason = check.text('reason', body.reason, { max: 500 });
    check.done();
    const row = await this.database.run(async c => (await c.query('SELECT * FROM padmin.request_refund($1,$2,$3,$4,$5)', [account.accountId, id, amount, reason, requestId])).rows[0]);
    if (row.outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (row.outcome === 'exceeds') throw apiError(422, 'REFUND_EXCEEDS_PAYMENT');
    return { refund_id: row.refund_id };
  }

  @Post('refunds/:id/approve') @HttpCode(200) @Permission('refund.approve') @StepUp()
  approve(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.decide(account, requestId, id, true, body);
  }

  @Post('refunds/:id/reject') @HttpCode(200) @Permission('refund.approve') @StepUp()
  rejectRefund(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.decide(account, requestId, id, false, body);
  }

  /** After transferring the money back: succeeded with the bank reference, or failed. */
  @Post('refunds/:id/complete') @HttpCode(200) @Permission('refund.request') @StepUp()
  async complete(@Account() account: PlatformAccount, @RequestId() requestId: string, @Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    this.id(id);
    const check = new Validation();
    const succeeded = body.succeeded !== false;
    const reference = succeeded ? check.text('bank_reference', body.bank_reference, { max: 80 }) : null;
    check.done();
    const outcome = await this.database.run(async c => (await c.query('SELECT padmin.complete_refund($1,$2,$3,$4,$5) AS o', [account.accountId, id, succeeded, reference, requestId])).rows[0].o);
    if (outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (outcome === 'reference_used') throw apiError(409, 'BANK_REFERENCE_USED');
    if (outcome !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  /** CSV of payments and refunds by Bangkok day (amounts in satang, refunds negative). */
  @Get('reconciliation.csv') @Permission('billing.read')
  async reconciliation(@Account() account: PlatformAccount, @Query('from') from: string, @Query('to') to: string,
    @Res() response: { setHeader: (n: string, v: string) => void; end: (b: string) => void }) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(from ?? '') || !day.test(to ?? '')) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { from: 'field.required' } });
    const rows = await this.database.run(async c => (await c.query('SELECT * FROM padmin.reconciliation($1,$2,$3)', [account.accountId, from, to])).rows);
    const cell = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ''); return /[",\n\r]|^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
    const lines = ['day,kind,invoice,shop,amount_minor,bank_reference,at,actor',
      ...rows.map(r => [r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day, r.kind, r.number, r.organization_name, r.amount_minor, r.bank_reference, r.at, r.actor].map(cell).join(','))];
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="reconciliation-${from}-${to}.csv"`);
    response.setHeader('Cache-Control', 'no-store');
    response.end('﻿' + lines.join('\r\n') + '\r\n');
  }

  private async decide(account: PlatformAccount, requestId: string, id: string, approve: boolean, body: Record<string, unknown>) {
    this.id(id);
    const check = new Validation();
    const reason = check.text('reason', body.reason, { required: !approve, max: 500 }) ?? null;
    check.done();
    const outcome = await this.database.run(async c => (await c.query('SELECT padmin.decide_refund($1,$2,$3,$4,$5) AS o', [account.accountId, id, approve, reason, requestId])).rows[0].o);
    if (outcome === 'not_found') throw apiError(404, 'RESOURCE_NOT_FOUND');
    if (outcome === 'self_approval') throw apiError(403, 'SELF_APPROVAL_FORBIDDEN');
    if (outcome !== 'ok') throw apiError(422, 'INVALID_STATE_TRANSITION');
    return { ok: true };
  }

  private id(value: string) { if (!uuidPattern.test(value)) throw apiError(404, 'RESOURCE_NOT_FOUND'); }
}
