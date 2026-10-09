import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openTestDatabase } from './support/database.mjs';
import { actors } from './support/actors.mjs';
import { runTaxDocuments, receiptItem, legacyBranch, applySeller, PermanentItismeError, toMinor, fromMinor } from '../apps/api/dist/billing/tax-documents.js';
import { renderTaxPdf, bahtText, thaiLongDate } from '../apps/api/dist/billing/tax-pdf.js';
import { encrypt } from '../apps/api/dist/shared/crypto.js';

let db, a, operator, approver, verifier;
const key = randomBytes(32);
async function role(name, fn) { await db.exec(`BEGIN; SET LOCAL ROLE ${name};`); try { const r = await fn(db); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } }
const workerPool = { query: (q, p) => role('fs_worker', c => c.query(q, p)) };
async function account(code) {
  const id = (await db.query("INSERT INTO platform.accounts(display_name,email,mfa_enrolled,password_hash,totp_secret_sealed) VALUES('Tax tester',$1,true,'synthetic-hash','synthetic-sealed') RETURNING id", [`${randomUUID()}@test.invalid`])).rows[0].id;
  await db.query('INSERT INTO platform.account_roles(account_id,role_id) SELECT $1,id FROM platform.roles WHERE code=$2', [id, code]);
  return id;
}
const platform = (sql, params) => role('fs_platform', c => c.query(sql, params));
async function setItisme(value) {
  await db.query('INSERT INTO platform.runtime_settings(id,version) VALUES(true,1) ON CONFLICT (id) DO NOTHING');
  await db.query('UPDATE platform.runtime_settings SET itisme=$1 WHERE id', [value]);
}
const enabled = () => setItisme({ enabled: true, server: 'localhost', port: 1433, database: 'ITISME_TEST', user: 'koochang_billing', passwordSealed: encrypt(key, 'synthetic-password') });
async function paidShop(name) {
  const shop = await a.createShop(name);
  const price = (await db.query("SELECT id FROM billing.price_versions WHERE id='72000000-0000-0000-0000-000000000001'")).rows[0].id;
  const inv = await a.one('SELECT * FROM auth.create_invoice($1,$2,$3,$4)', [shop.owner.userId, shop.organizationId, price, randomUUID()]);
  const pay = (await db.query('SELECT * FROM padmin.confirm_payment($1,$2,59000,$3,now(),NULL,NULL,$4)', [verifier, inv.invoice_id, `REF-${randomUUID()}`, randomUUID()])).rows[0];
  assert.equal(pay.outcome, 'ok');
  const number = (await db.query('SELECT number FROM billing.invoices WHERE id=$1', [inv.invoice_id])).rows[0].number;
  return { ...shop, invoiceId: inv.invoice_id, paymentId: pay.payment_id, number };
}
const doc = async (paymentId, kind = 'receipt') => (await db.query('SELECT * FROM billing.tax_documents WHERE payment_id=$1 AND kind=$2', [paymentId, kind])).rows[0];
const seller = { CompanyName: 'บริษัท ไอ ที อีส มี จำกัด', CompanyNameEng: 'IT IS ME Company Limited', TaxID: '0105554156362', HQ: '1', Address: '99/111', Province: 'นนทบุรี', Zipcode: '11110' };

/** Stands in for SQL Server: numbers continue per month, the same Ref returns the same document. */
function fakeItisme({ fail } = {}) {
  const calls = [], byRef = new Map();
  let iv = 1, r = 1, cn = 0;
  const client = {
    company: async () => seller,
    issueReceipt: async q => {
      calls.push(['receipt', q]);
      if (fail) throw fail();
      if (byRef.has(q.ref)) return { ...byRef.get(q.ref), existing: true };
      const gross = q.grossMinor, subtotal = (gross * 100n + 53n) / 107n;
      const out = { invoiceNo: `IV6910${String(++iv).padStart(4, '0')}`, receiptNo: `R6910${String(++r).padStart(4, '0')}`, customerId: 'C0000166', subtotalMinor: subtotal, vatMinor: gross - subtotal, existing: false };
      byRef.set(q.ref, out); return out;
    },
    issueCreditNote: async q => {
      calls.push(['credit', q]);
      if (fail) throw fail();
      const subtotal = (q.grossMinor * 100n + 53n) / 107n;
      return { creditNoteNo: `CN6910${String(++cn).padStart(4, '0')}`, originalMinor: 55140n, correctMinor: 55140n - subtotal, differenceMinor: subtotal, vatMinor: q.grossMinor - subtotal, receiptDate: q.docDate, existing: false };
    },
    close: async () => {},
  };
  return { calls, connect: async settings => { calls.push(['connect', settings]); return client; } };
}
const run = (fake, extra = {}) => runTaxDocuments({ pool: workerPool, secretKey: key, connect: fake.connect, ...extra });

before(async () => {
  db = await openTestDatabase('tax_documents'); a = actors(db);
  operator = await account('billing_operator'); approver = await account('billing_approver'); verifier = await account('super_admin');
});
after(async () => { await db?.close(); });

test('a payment queues one receipt made out to the shop; the owner profile updates documents still waiting', async () => {
  await setItisme({ enabled: false });
  const shop = await paidShop('ร้านทดสอบใบเสร็จ');
  const d = await doc(shop.paymentId);
  assert.equal(d.status, 'queued'); assert.equal(d.ref, shop.number); assert.equal(Number(d.gross_minor), 59000);
  assert.deepEqual(d.buyer, { name: 'ร้านทดสอบใบเสร็จ' });
  const saved = await a.one('SELECT * FROM auth.save_buyer_profile($1,$2,0,$3,$4,$5,$6,$7,$8)', [shop.owner.userId, shop.organizationId, 'บริษัท ช่างแอร์ จำกัด', '0105500000001', '00000', '1 ถนนสุขุมวิท กรุงเทพฯ', '0812345678', null]);
  assert.deepEqual([saved.outcome, saved.version], ['ok', 1]);
  assert.equal((await doc(shop.paymentId)).buyer.tax_id, '0105500000001');
  assert.equal((await a.one('SELECT * FROM auth.save_buyer_profile($1,$2,0,$3,NULL,NULL,$4,NULL,NULL)', [shop.owner.userId, shop.organizationId, 'x', 'y'])).outcome, 'conflict');
  assert.equal((await a.one('SELECT * FROM auth.save_buyer_profile($1,$2,1,$3,$4,NULL,$5,NULL,NULL)', [shop.owner.userId, shop.organizationId, 'x', '0105500000001', 'y'])).outcome, 'invalid', 'tax id needs a branch');
  const tech = await a.addTechnician(shop);
  assert.equal((await a.one('SELECT * FROM auth.save_buyer_profile($1,$2,1,$3,NULL,NULL,$4,NULL,NULL)', [tech.userId, shop.organizationId, 'x', 'y'])).outcome, 'forbidden');
});

test('nothing is claimed while ITISME is off; once on, the receipt is issued once with the ITISME numbers', async () => {
  await setItisme({ enabled: false });
  const shop = await paidShop('Issue once');
  const fake = fakeItisme();
  assert.equal(await run(fake), 0);
  assert.equal((await doc(shop.paymentId)).status, 'queued');
  await enabled();
  assert.ok(await run(fake) >= 1);
  const d = await doc(shop.paymentId);
  assert.equal(d.status, 'issued');
  assert.match(d.invoice_no, /^IV6910\d{4}$/); assert.match(d.receipt_no, /^R6910\d{4}$/);
  assert.equal(Number(d.subtotal_minor) + Number(d.vat_minor), 59000);
  assert.equal(d.seller.TaxID, '0105554156362');
  assert.match(d.item_name, /^ค่าบริการแพ็กเกจคู่ช่าง /);
  const connect = fake.calls.find(c => c[0] === 'connect')[1];
  assert.equal(connect.password, 'synthetic-password'); assert.equal(connect.database, 'ITISME_TEST');
  const sent = fake.calls.find(c => c[0] === 'receipt' && c[1].ref === shop.number)[1];
  assert.equal(sent.grossMinor, 59000n); assert.equal(sent.organizationId, shop.organizationId);
  const before = fake.calls.length;
  await run(fake);
  assert.equal(fake.calls.filter(c => c[0] === 'receipt' && c[1].ref === shop.number).length, 1, 'issued documents are not sent again');
  assert.ok(fake.calls.length >= before);
});

test('ITISME down: the document waits and is retried; a refusal by ITISME fails it for the console', async () => {
  await enabled();
  const down = await paidShop('Down');
  const offline = fakeItisme({ fail: () => Object.assign(new Error('Failed to connect'), { code: 'ESOCKET' }) });
  await run(offline);
  let d = await doc(down.paymentId);
  assert.deepEqual([d.status, d.attempts], ['queued', 1]);
  assert.ok(new Date(d.next_attempt_at) > new Date(), 'backs off');
  assert.match(d.last_error, /Failed to connect/);
  const refused = await paidShop('Refused');
  await db.query("UPDATE billing.tax_documents SET status='skipped' WHERE payment_id=$1", [down.paymentId]);
  await run(fakeItisme({ fail: () => new PermanentItismeError('ITISME_51012: Buyer name is required') }));
  d = await doc(refused.paymentId);
  assert.equal(d.status, 'failed');
  assert.equal((await platform('SELECT padmin.act_tax_document($1,$2,$3,$4,$5) AS o', [operator, d.id, 'retry', 'Fixed buyer name', randomUUID()])).rows[0].o, 'ok', 'billing.verify may retry');
  assert.equal((await doc(refused.paymentId)).status, 'queued');
  await assert.rejects(() => platform('SELECT padmin.act_tax_document($1,$2,$3,$4,$5) AS o', [approver, d.id, 'skip', 'No permission', randomUUID()]), e => e.code === '42501');
  assert.equal((await platform('SELECT padmin.act_tax_document($1,$2,$3,$4,$5) AS o', [operator, d.id, 'skip', 'Issued by hand', randomUUID()])).rows[0].o, 'ok');
  assert.equal((await doc(refused.paymentId)).status, 'skipped');
  const list = (await platform('SELECT * FROM padmin.tax_documents($1,$2,$3,51,0)', [approver, 'skipped', refused.organizationId])).rows;
  assert.deepEqual(list.map(r => r.status), ['skipped']);
});

test('a refund that succeeds queues a credit note, issued after its receipt against the receipt number', async () => {
  await enabled();
  const shop = await paidShop('Refund CN');
  const refundId = (await db.query('SELECT * FROM padmin.request_refund($1,$2,59000,$3,$4)', [operator, shop.paymentId, 'ลูกค้ายกเลิกภายใน 7 วัน', randomUUID()])).rows[0].refund_id
    ?? (await db.query('SELECT id FROM billing.refunds WHERE payment_id=$1', [shop.paymentId])).rows[0].id;
  await db.query('SELECT padmin.decide_refund($1,$2,true,$3,$4)', [approver, refundId, 'Approved', randomUUID()]);
  assert.equal(await doc(shop.paymentId, 'credit_note'), undefined, 'approval alone is not a refund');
  await db.query('SELECT padmin.complete_refund($1,$2,true,$3,$4)', [operator, refundId, `RF-${randomUUID()}`, randomUUID()]);
  const queued = await doc(shop.paymentId, 'credit_note');
  assert.equal(queued.status, 'queued'); assert.match(queued.ref, /^RF[0-9a-f]{18}$/); assert.equal(queued.reason, 'ลูกค้ายกเลิกภายใน 7 วัน');
  // The receipt is still queued: the credit note must wait for it.
  const claimed = await role('fs_worker', c => c.query('SELECT id FROM worker.claim_tax_documents(100)'));
  assert.ok(!claimed.rows.some(r => r.id === queued.id));
  await db.query("UPDATE billing.tax_documents SET status='queued', next_attempt_at=now() WHERE status='running'");
  const fake = fakeItisme();
  await run(fake, {}); await run(fake, {});
  const cn = await doc(shop.paymentId, 'credit_note');
  assert.equal(cn.status, 'issued'); assert.match(cn.credit_note_no, /^CN6910\d{4}$/);
  const sent = fake.calls.find(c => c[0] === 'credit')[1];
  assert.equal(sent.receiptNo, (await doc(shop.paymentId)).receipt_no);
  assert.equal(sent.grossMinor, 59000n);
  assert.match(sent.itemName, /^ลดหนี้ ค่าบริการแพ็กเกจคู่ช่าง/);
  assert.equal(Number(cn.subtotal_minor) + Number(cn.vat_minor), 59000);
  assert.equal(await platform('SELECT padmin.act_tax_document($1,$2,$3,$4,$5) AS o', [operator, (await doc(shop.paymentId)).id, 'skip', 'Too late', randomUUID()]).then(r => r.rows[0].o), 'not_allowed');
});

test('roles: the worker reaches documents only through worker functions; owners read only their own', async () => {
  await assert.rejects(() => role('fs_worker', c => c.query('SELECT * FROM billing.tax_documents')), e => e.code === '42501');
  await assert.rejects(() => a.api('SELECT * FROM worker.claim_tax_documents(1)'), e => e.code === '42501');
  await assert.rejects(() => a.api('SELECT worker.itisme_settings()'), e => e.code === '42501');
  const mine = await paidShop('Mine'), other = await paidShop('Other');
  const rows = await (async () => {
    await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
    try {
      await db.query("SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)", [mine.owner.userId, mine.organizationId]);
      return (await db.query('SELECT organization_id FROM billing.tax_documents')).rows;
    } finally { await db.exec('ROLLBACK'); }
  })();
  assert.ok(rows.every(r => r.organization_id === mine.organizationId));
  assert.ok(other.organizationId !== mine.organizationId);
});

test('item text, VAT split, branch codes and the PDF', async () => {
  assert.equal(receiptItem({ plan_name_th: 'Small', interval_unit: 'month', period_start: '2026-10-09T03:00:00Z', period_end: '2026-11-09T03:00:00Z' }),
    'ค่าบริการแพ็กเกจคู่ช่าง Small รายเดือน 9 ต.ค. 2569 – 9 พ.ย. 2569');
  assert.deepEqual(legacyBranch({ name: 'x', tax_id: '0105500000001', branch_no: '00000' }), { hq: '1', branchNo: '0000' });
  assert.deepEqual(legacyBranch({ name: 'x', tax_id: '0105500000001', branch_no: '00012' }), { hq: '0', branchNo: '00012' });
  assert.deepEqual(legacyBranch({ name: 'x' }), { hq: null, branchNo: null });
  assert.equal(toMinor('271.03'), 27103n); assert.equal(fromMinor(1897n), '18.97');
  assert.equal(bahtText(1698000), 'หนึ่งหมื่นหกพันเก้าร้อยแปดสิบบาทถ้วน');
  assert.equal(bahtText(1431660), 'หนึ่งหมื่นสี่พันสามร้อยสิบหกบาทหกสิบสตางค์');
  assert.equal(bahtText(2101), 'ยี่สิบเอ็ดบาทหนึ่งสตางค์');
  assert.equal(thaiLongDate('2026-10-09'), '9 ตุลาคม 2569');
  const pdf = await renderTaxPdf({ kind: 'receipt', status: 'issued', ref: 'INV-2610-000001', doc_date: '2026-10-09', gross_minor: 29000, buyer: { name: 'ร้านทดสอบ' },
    item_name: 'ค่าบริการ', customer_id: 'C0000166', invoice_no: 'IV69100002', receipt_no: 'R69100002', credit_note_no: null, receipt_date: '2026-10-09',
    subtotal_minor: 27103, vat_minor: 1897, original_minor: null, correct_minor: null, seller });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(() => renderTaxPdf({ kind: 'receipt', status: 'queued', seller: null }), /NOT_ISSUED/);
  // Console seller details replace the ITISME Company row; blanks keep it.
  const fixed = applySeller({ ...seller, CompanyNameEng: 'P.WATTANA KARNCHANG', TaxID: '0105551456362', Road: 'x' },
    { name_en: 'IT IS ME Company Limited', tax_id: '0105554156362', name_th: ' ', address_th: '99/111 หมู่ 11 นนทบุรี 11110' }, 'iVBORw0KGgo=');
  assert.deepEqual([fixed.CompanyName, fixed.CompanyNameEng, fixed.TaxID, fixed.Address, fixed.Road, fixed.Logo],
    [seller.CompanyName, 'IT IS ME Company Limited', '0105554156362', '99/111 หมู่ 11 นนทบุรี 11110', null, 'iVBORw0KGgo=']);
  const withBadLogo = await renderTaxPdf({ kind: 'receipt', status: 'issued', ref: 'INV-2610-000001', doc_date: '2026-10-09', gross_minor: 29000, buyer: { name: 'ร้านทดสอบ' },
    item_name: 'ค่าบริการ', customer_id: 'C0000166', invoice_no: 'IV69100002', receipt_no: 'R69100002', credit_note_no: null, receipt_date: '2026-10-09',
    subtotal_minor: 27103, vat_minor: 1897, original_minor: null, correct_minor: null, seller: { ...seller, Logo: 'bm90IGFuIGltYWdl' } });
  assert.equal(withBadLogo.subarray(0, 5).toString(), '%PDF-', 'an unreadable logo leaves the names only');
});
