import type { Pool } from 'pg';
import { decrypt } from '../shared/crypto.js';

/** Receipts (ใบแจ้งหนี้ IV + ใบเสร็จรับเงิน/ใบกำกับภาษี R) and credit notes (CN) issued in the company database
 * ITISME through its sp_KC_* procedures (infra/itisme/02_koochang_objects.sql). ITISME gives the numbers so they
 * continue the legacy books; the same Ref never issues twice, so a retry after a lost reply is safe. */

export interface ItismeSettings { enabled: boolean; server?: string; port?: number; database?: string; user?: string; passwordSealed?: string }
export interface Buyer { name: string; tax_id?: string; branch_no?: string; address?: string; phone?: string; email?: string }
export interface Seller {
  CompanyName: string; CompanyNameEng?: string | null; TaxID?: string | null; HQ?: string | null; BranchNo?: string | null;
  Address?: string | null; Road?: string | null; District?: string | null; Aumpher?: string | null; Province?: string | null; Zipcode?: string | null;
  Phone?: string | null; Fax?: string | null; AddressEng?: string | null; RoadEng?: string | null; DistrictEng?: string | null; AumpherEng?: string | null; ProvinceEng?: string | null;
}
export interface ReceiptRequest { organizationId: string; ref: string; docDate: string; buyer: Buyer; itemName: string; grossMinor: bigint; remark: string; receiptRemark: string }
export interface ReceiptResult { invoiceNo: string; receiptNo: string; customerId: string; subtotalMinor: bigint; vatMinor: bigint; existing: boolean }
export interface CreditNoteRequest { ref: string; receiptNo: string; docDate: string; reason: string; itemName: string; grossMinor: bigint }
export interface CreditNoteResult { creditNoteNo: string; originalMinor: bigint; correctMinor: bigint; differenceMinor: bigint; vatMinor: bigint; receiptDate: string; existing: boolean }
export interface ItismeClient {
  company(): Promise<Seller>;
  issueReceipt(request: ReceiptRequest): Promise<ReceiptResult>;
  issueCreditNote(request: CreditNoteRequest): Promise<CreditNoteResult>;
  close(): Promise<void>;
}

/** ITISME refused the document itself (51010–51099 are the THROWs in the sp_KC_* procedures): retrying will not help. */
export class PermanentItismeError extends Error {}

export const toMinor = (value: number | string): bigint => BigInt(Math.round(Number(value) * 100));
export const fromMinor = (minor: bigint | number | string): string => {
  const v = BigInt(minor), sign = v < 0n ? '-' : '', a = v < 0n ? -v : v;
  return `${sign}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};

const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** 9 ต.ค. 2569 — the Bangkok calendar date of an instant. */
export function thaiShortDate(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + 7 * 3_600_000);
  return `${d.getUTCDate()} ${thaiMonths[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

export interface TaxJob {
  id: string; organization_id: string; kind: 'receipt' | 'credit_note'; ref: string; doc_date: string; gross_minor: string | number;
  buyer: Buyer; reason: string | null; attempts: number; invoice_number: string; plan_name_th: string | null; interval_unit: string | null;
  period_start: Date | string | null; period_end: Date | string | null; receipt_no: string | null; receipt_item: string | null;
}

/** "ค่าบริการแพ็กเกจคู่ช่าง Small รายเดือน 9 ต.ค. 2569 – 8 พ.ย. 2569". The period end is shown inclusive. */
export function receiptItem(job: Pick<TaxJob, 'plan_name_th' | 'interval_unit' | 'period_start' | 'period_end'>): string {
  const plan = job.plan_name_th?.trim() || 'คู่ช่าง';
  const unit = job.interval_unit === 'year' ? ' รายปี' : job.interval_unit === 'month' ? ' รายเดือน' : '';
  const period = job.period_start && job.period_end
    ? ` ${thaiShortDate(job.period_start)} – ${thaiShortDate(new Date(new Date(job.period_end).getTime() - 1))}` : '';
  return `ค่าบริการแพ็กเกจคู่ช่าง ${plan}${unit}${period}`.slice(0, 1000);
}

/** Dates come as text from PostgreSQL and as UTC-midnight Date objects from mssql (useUTC). */
const isoDate = (value: Date | string) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/** Legacy ITISME keeps HQ '1' with BranchNo '0000', a branch as HQ '0' with its number; no tax id → both empty. */
export function legacyBranch(buyer: Buyer): { hq: string | null; branchNo: string | null } {
  if (!buyer.tax_id || !buyer.branch_no) return { hq: null, branchNo: null };
  return buyer.branch_no === '00000' ? { hq: '1', branchNo: '0000' } : { hq: '0', branchNo: buyer.branch_no };
}

function retrySeconds(attempts: number) { return Math.min(60 * 2 ** Math.max(attempts - 1, 0), 3600); }

export interface TaxDeps {
  pool: Pool; secretKey?: Buffer;
  connect?: (settings: Required<Omit<ItismeSettings, 'enabled' | 'passwordSealed'>> & { password: string }) => Promise<ItismeClient>;
  log?: (message: string) => void;
}

/** One pass of the queue. Does nothing (and claims nothing) while ITISME is off or not configured. */
export async function runTaxDocuments(deps: TaxDeps, limit = 5): Promise<number> {
  const settings = (await deps.pool.query('SELECT worker.itisme_settings() AS value')).rows[0]?.value as ItismeSettings | null;
  if (!settings?.enabled || !settings.passwordSealed || !settings.server || !settings.database || !settings.user || !deps.secretKey) return 0;
  const jobs = (await deps.pool.query('SELECT * FROM worker.claim_tax_documents($1)', [limit])).rows as TaxJob[];
  if (!jobs.length) return 0;
  let client: ItismeClient | null = null, seller: Seller | null = null, connectError: unknown = null;
  try {
    client = await (deps.connect ?? connectItisme)({ server: settings.server, port: settings.port ?? 1433, database: settings.database,
      user: settings.user, password: decrypt(deps.secretKey, settings.passwordSealed) });
    seller = await client.company();
  } catch (error) { connectError = error; }
  try {
    for (const job of jobs) {
      let outcome: 'issued' | 'retry' | 'failed' = 'retry', result: Record<string, unknown> | null = null, error: string | null = null;
      try {
        if (connectError || !client || !seller) throw connectError ?? new Error('ITISME_UNAVAILABLE');
        result = await issue(client, seller, job);
        outcome = 'issued';
      } catch (e) {
        outcome = e instanceof PermanentItismeError ? 'failed' : 'retry';
        error = (e instanceof Error ? e.message : 'ITISME_ERROR').slice(0, 200);
        deps.log?.(`TAX_DOCUMENT_${outcome.toUpperCase()} ${job.kind} ${job.ref}: ${error}`);
      }
      await deps.pool.query('SELECT worker.finish_tax_document($1,$2,$3,$4,$5)', [job.id, outcome, result, error, retrySeconds(job.attempts)]);
    }
  } finally { await client?.close().catch(() => {}); }
  return jobs.length;
}

async function issue(client: ItismeClient, seller: Seller, job: TaxJob): Promise<Record<string, unknown>> {
  const docDate = isoDate(job.doc_date), gross = BigInt(job.gross_minor);
  if (job.kind === 'receipt') {
    const itemName = receiptItem(job);
    const r = await client.issueReceipt({ organizationId: job.organization_id, ref: job.ref, docDate, buyer: job.buyer, itemName, grossMinor: gross,
      remark: `KooChang ${job.invoice_number}`.slice(0, 150), receiptRemark: `KooChang ${job.invoice_number}`.slice(0, 50) });
    return { item_name: itemName, customer_id: r.customerId, invoice_no: r.invoiceNo, receipt_no: r.receiptNo, receipt_date: docDate,
      subtotal_minor: String(r.subtotalMinor), vat_minor: String(r.vatMinor), seller };
  }
  if (!job.receipt_no) throw new Error('RECEIPT_NOT_ISSUED');
  const itemName = `ลดหนี้ ${job.receipt_item ?? receiptItem(job)}`.slice(0, 1000);
  const r = await client.issueCreditNote({ ref: job.ref, receiptNo: job.receipt_no, docDate, reason: job.reason?.trim() || 'คืนเงินค่าบริการ',
    itemName, grossMinor: gross });
  return { item_name: itemName, customer_id: '-', credit_note_no: r.creditNoteNo, receipt_date: r.receiptDate,
    subtotal_minor: String(r.differenceMinor), vat_minor: String(r.vatMinor), original_minor: String(r.originalMinor), correct_minor: String(r.correctMinor), seller };
}

/** SQL Server through the mssql driver (tedious). Only sp_KC_* procedures are called; the login has EXECUTE on them alone. */
export async function connectItisme(c: { server: string; port: number; database: string; user: string; password: string }): Promise<ItismeClient> {
  const sql = (await import('mssql')).default;
  const pool = new sql.ConnectionPool({ server: c.server, port: c.port, database: c.database, user: c.user, password: c.password,
    // server2 runs SQL Server next to the worker with its own certificate; traffic stays on the machine.
    options: { encrypt: true, trustServerCertificate: true }, pool: { max: 2, min: 0 }, connectionTimeout: 10_000, requestTimeout: 30_000 });
  await pool.connect();
  const permanent = (e: unknown) => {
    const n = (e as { number?: number })?.number;
    return n && n >= 51000 && n < 51100 ? new PermanentItismeError(`ITISME_${n}: ${(e as Error).message}`) : e;
  };
  const money = (minor: bigint) => Number(fromMinor(minor));
  return {
    async company() {
      const r = await pool.request().execute('dbo.sp_KC_Company');
      const row = r.recordset?.[0] as Seller | undefined;
      if (!row?.CompanyName) throw new Error('ITISME_COMPANY_MISSING');
      return row;
    },
    async issueReceipt(q) {
      const { hq, branchNo } = legacyBranch(q.buyer);
      try {
        const r = await pool.request()
          .input('OrganizationID', sql.UniqueIdentifier, q.organizationId).input('Ref', sql.VarChar(20), q.ref).input('DocDate', sql.Date, q.docDate)
          .input('BuyerName', sql.NVarChar(1000), q.buyer.name).input('TaxID', sql.NVarChar(13), q.buyer.tax_id ?? null)
          .input('HQ', sql.Char(1), hq).input('BranchNo', sql.NVarChar(5), branchNo)
          .input('Address', sql.NVarChar(1000), q.buyer.address ?? null).input('Phone', sql.NVarChar(100), q.buyer.phone ?? null)
          .input('Email', sql.NVarChar(100), q.buyer.email ?? null).input('ItemName', sql.NVarChar(1000), q.itemName)
          .input('Gross', sql.Decimal(18, 2), money(q.grossMinor)).input('Remark', sql.NVarChar(150), q.remark).input('ReceiptRemark', sql.NVarChar(50), q.receiptRemark)
          .output('InvoiceNo', sql.VarChar(20)).output('ReceiptNo', sql.VarChar(20)).output('CustomerID', sql.VarChar(10))
          .output('Subtotal', sql.Decimal(18, 2)).output('Vat', sql.Decimal(18, 2)).output('Existing', sql.Bit)
          .execute('dbo.sp_KC_IssueReceipt');
        const o = r.output;
        return { invoiceNo: o.InvoiceNo, receiptNo: o.ReceiptNo, customerId: o.CustomerID, subtotalMinor: toMinor(o.Subtotal), vatMinor: toMinor(o.Vat), existing: Boolean(o.Existing) };
      } catch (e) { throw permanent(e); }
    },
    async issueCreditNote(q) {
      try {
        const r = await pool.request()
          .input('Ref', sql.VarChar(20), q.ref).input('ReceiptNo', sql.VarChar(20), q.receiptNo).input('DocDate', sql.Date, q.docDate)
          .input('Reason', sql.NVarChar(250), q.reason).input('ItemName', sql.NVarChar(1000), q.itemName).input('Gross', sql.Decimal(18, 2), money(q.grossMinor))
          .output('CreditNoteNo', sql.VarChar(20)).output('OriginalAmount', sql.Decimal(18, 2)).output('CorrectAmount', sql.Decimal(18, 2))
          .output('Difference', sql.Decimal(18, 2)).output('Vat', sql.Decimal(18, 2)).output('ReceiptDate', sql.DateTime).output('Existing', sql.Bit)
          .execute('dbo.sp_KC_IssueCreditNote');
        const o = r.output;
        return { creditNoteNo: o.CreditNoteNo, originalMinor: toMinor(o.OriginalAmount), correctMinor: toMinor(o.CorrectAmount),
          differenceMinor: toMinor(o.Difference), vatMinor: toMinor(o.Vat), receiptDate: isoDate(o.ReceiptDate), existing: Boolean(o.Existing) };
      } catch (e) { throw permanent(e); }
    },
    close: () => pool.close(),
  };
}
