import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { fromMinor, type Buyer, type Seller } from './tax-documents.js';

/** PDF of an issued document, drawn after the legacy ITIS ME form (สแกน CCF27052568): company header, buyer box,
 * number/date box, item table, amount in Thai words, totals and signature boxes. Everything comes from the
 * tax_documents row (numbers and amounts from ITISME, seller and buyer snapshots), so the PDF is the same
 * every time it is opened and needs no connection to ITISME. */

export interface TaxDocumentRow {
  kind: 'receipt' | 'credit_note'; status: string; ref: string; doc_date: string | Date; gross_minor: string | number; buyer: Buyer; reason?: string | null;
  item_name: string | null; customer_id: string | null; invoice_no: string | null; receipt_no: string | null; credit_note_no: string | null;
  receipt_date: string | Date | null; subtotal_minor: string | number | null; vat_minor: string | number | null;
  original_minor: string | number | null; correct_minor: string | number | null; seller: Seller | null;
}

const require = createRequire(import.meta.url);
const fontDir = require.resolve('@expo-google-fonts/sarabun/package.json').replace(/package\.json$/, '');
let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts() {
  fonts ??= { regular: readFileSync(`${fontDir}400Regular/Sarabun_400Regular.ttf`), bold: readFileSync(`${fontDir}700Bold/Sarabun_700Bold.ttf`) };
  return fonts;
}

const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
function thaiNumber(n: bigint): string {
  if (n === 0n) return '';
  if (n >= 1_000_000n) return `${thaiNumber(n / 1_000_000n)}ล้าน${thaiNumber(n % 1_000_000n)}`;
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]), place = s.length - 1 - i;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += `${digits[d]}${places[place]}`;
  }
  return out;
}
/** 14316.60 → "หนึ่งหมื่นสี่พันสามร้อยสิบหกบาทหกสิบสตางค์", 16980 → "หนึ่งหมื่นหกพันเก้าร้อยแปดสิบบาทถ้วน". */
export function bahtText(minor: bigint | number | string): string {
  const v = BigInt(minor), baht = v / 100n, satang = v % 100n;
  if (v === 0n) return 'ศูนย์บาทถ้วน';
  return `${baht ? `${thaiNumber(baht)}บาท` : ''}${satang ? `${thaiNumber(satang)}สตางค์` : 'ถ้วน'}`;
}

const thaiMonthsLong = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** 2026-10-09 → "9 ตุลาคม 2569". */
export function thaiLongDate(value: string | Date): string {
  const iso = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${thaiMonthsLong[m - 1]} ${y + 543}`;
}
const money = (minor: bigint | number | string | null) => {
  const [whole, frac] = fromMinor(BigInt(minor ?? 0)).split('.');
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
};
const join = (...parts: (string | null | undefined)[]) => parts.map(p => p?.trim()).filter(Boolean).join(' ');

export function sellerLines(s: Seller) {
  return {
    th: join(s.Address, s.Road, s.District, s.Aumpher, s.Province, s.Zipcode),
    en: s.AddressEng && !s.RoadEng && !s.DistrictEng && !s.ProvinceEng ? s.AddressEng.trim() : join(s.AddressEng, s.RoadEng, s.DistrictEng, s.AumpherEng, s.ProvinceEng, s.Zipcode),
    branch: s.HQ === '1' || !s.BranchNo || /^0+$/.test(s.BranchNo) ? 'สำนักงานใหญ่' : `สาขาที่ ${s.BranchNo}`,
  };
}
export function buyerBranch(b: Buyer) {
  if (!b.tax_id) return '';
  return `เลขประจำตัวผู้เสียภาษี ${b.tax_id}  ${!b.branch_no || b.branch_no === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${b.branch_no}`}`;
}

/** copy: 'original' → ต้นฉบับ (for the shop), 'copy' → สำเนา. */
export function renderTaxPdf(row: TaxDocumentRow, copy: 'original' | 'copy' = 'original'): Promise<Buffer> {
  if (row.status !== 'issued' || !row.seller) return Promise.reject(new Error('TAX_DOCUMENT_NOT_ISSUED'));
  const { regular, bold } = loadFonts();
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, left: 36, right: 36, bottom: 0 }, info: { Title: row.kind === 'receipt' ? `${row.receipt_no}` : `${row.credit_note_no}`, Author: row.seller.CompanyName } });
  doc.registerFont('r', regular); doc.registerFont('b', bold);
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const L = 36, R = 559, W = R - L, seller = row.seller, lines = sellerLines(seller), receipt = row.kind === 'receipt';
  const text = (font: 'r' | 'b', size: number, value: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}) =>
    doc.font(font).fontSize(size).text(value, x, y, { lineBreak: false, ...options });

  // Header: logo + seller names (left, as on the legacy form), copy mark + branch + tax id (right).
  let nameX = L;
  if (seller.Logo) {
    try { doc.image(Buffer.from(seller.Logo, 'base64'), L, 30, { fit: [130, 57] }); nameX = L + 142; } catch { /* unreadable logo: names only */ }
  }
  text('b', 17, seller.CompanyName, nameX, 36);
  if (seller.CompanyNameEng) text('b', 12, seller.CompanyNameEng, nameX, 60);
  text('b', 13, copy === 'original' ? 'ต้นฉบับ' : 'สำเนา', R - 160, 36, { width: 160, align: 'right' });
  text('r', 9.5, copy === 'original' ? 'สำหรับลูกค้า' : 'สำหรับบริษัท', R - 160, 54, { width: 160, align: 'right' });
  text('r', 9.5, `สาขาที่ออกใบกำกับภาษี : ${lines.branch}`, R - 260, 70, { width: 260, align: 'right' });
  if (seller.TaxID) text('r', 9.5, `เลขประจำตัวผู้เสียภาษี ${seller.TaxID}`, R - 260, 84, { width: 260, align: 'right' });
  text('r', 9.5, lines.th, L, 100, { width: W });
  if (lines.en) text('r', 9, lines.en, L, 114, { width: W });
  const contact = join(seller.Phone ? `โทร. ${seller.Phone}` : '', seller.Fax ? `แฟกซ์ ${seller.Fax}` : '');
  if (contact) text('r', 9, contact, L, 127, { width: W });

  // Title bar.
  doc.lineWidth(1).rect(L, 144, W, 26).stroke();
  text('b', 14, receipt ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี  ( Receipt / Tax Invoice )' : 'ใบลดหนี้ / ใบกำกับภาษี  ( Credit Note )', L, 148, { width: W, align: 'center' });

  // Buyer box (left) and number box (right).
  const top = 178, boxH = 104, split = L + W * 0.62, b = row.buyer;
  doc.roundedRect(L, top, split - L - 6, boxH, 6).stroke();
  text('r', 10, 'ชื่อลูกค้า', L + 6, top + 6); text('r', 8, 'Name', L + 6, top + 19);
  text('b', 10.5, b.name, L + 62, top + 6, { width: split - L - 76, lineBreak: true, height: 28, ellipsis: true });
  text('r', 9.5, buyerBranch(b), L + 62, top + 34, { width: split - L - 76 });
  text('r', 10, 'ที่อยู่', L + 6, top + 50); text('r', 8, 'Address', L + 6, top + 63);
  text('r', 9.5, join(b.address, b.phone ? `โทร. ${b.phone}` : ''), L + 62, top + 50, { width: split - L - 76, lineBreak: true, height: 50, ellipsis: true });
  const info: [string, string][] = receipt
    ? [['เลขที่ No.', row.receipt_no ?? ''], ['วันที่ Date', thaiLongDate(row.doc_date)], ['เงื่อนไขการชำระ Term of Payment', '0 วัน'],
       ['ครบกำหนดชำระ Due Date', thaiLongDate(row.doc_date)], ['ใบแจ้งหนี้ Invoice No.', row.invoice_no ?? '']]
    : [['เลขที่ No.', row.credit_note_no ?? ''], ['วันที่ Date', thaiLongDate(row.doc_date)], ['อ้างถึงใบกำกับภาษี Ref. Tax Invoice', row.receipt_no ?? ''],
       ['ลงวันที่ Dated', row.receipt_date ? thaiLongDate(row.receipt_date) : ''], ['รหัสลูกค้า Customer', row.customer_id ?? '']];
  info.forEach(([label, value], i) => {
    text('r', 9, label, split + 2, top + 6 + i * 20, { width: R - split - 4 });
    text('b', 9.5, value, split + 2, top + 6 + i * 20, { width: R - split - 2, align: 'right' });
  });

  // Item table.
  const tTop = top + boxH + 10, cols = [L, L + 40, L + 300, L + 370, L + 450, R], rowH = 30;
  doc.rect(L, tTop, W, rowH).stroke();
  for (const x of cols.slice(1, -1)) doc.moveTo(x, tTop).lineTo(x, tTop + rowH).stroke();
  const head: [string, string][] = [['ลำดับ', 'No.'], ['รายการ', 'Items'], ['จำนวน/หน่วย', 'Quantity'], ['ราคาต่อหน่วย (บาท)', 'Unit Price (Baht)'], ['จำนวนเงิน (บาท)', 'Amount (Baht)']];
  head.forEach(([th, en], i) => { const x = cols[i]!, w = cols[i + 1]! - x;
    text('r', 9, th, x, tTop + 3, { width: w, align: 'center' }); text('r', 8, en, x, tTop + 16, { width: w, align: 'center' }); });
  const gross = BigInt(row.gross_minor), y0 = tTop + rowH + 8;
  text('r', 10, '1', cols[0]!, y0, { width: 40, align: 'center' });
  doc.font('r').fontSize(10).text(row.item_name ?? '', cols[1]! + 4, y0, { width: cols[2]! - cols[1]! - 8 });
  text('r', 10, '1', cols[2]!, y0, { width: 70, align: 'center' });
  text('r', 10, money(gross), cols[3]!, y0, { width: cols[4]! - cols[3]! - 6, align: 'right' });
  text('r', 10, money(gross), cols[4]!, y0, { width: R - cols[4]! - 6, align: 'right' });
  if (!receipt) {
    const y = y0 + 44;
    text('r', 9.5, `เหตุที่ลดหนี้ : ${row.reason ?? ''}`, cols[1]! + 4, y, { width: W - 50, lineBreak: true, height: 40 });
  }

  // Totals.
  const sTop = 560;
  doc.moveTo(L, sTop).lineTo(R, sTop).dash(2, { space: 2 }).stroke().undash();
  text('b', 10.5, `( ${bahtText(gross)} )`, L, sTop + 12, { width: W * 0.58, align: 'center' });
  const totals: [string, string, string][] = receipt
    ? [['รวมเงิน (บาท)', 'Total (Baht)', money(row.subtotal_minor)], ['ส่วนลด (บาท)', 'Discount (Baht)', '-'],
       ['ภาษีมูลค่าเพิ่ม (บาท)', 'Vat 7%', money(row.vat_minor)], ['ยอดเงินสุทธิ (บาท)', 'Grand Total (Baht)', money(gross)]]
    : [['มูลค่าตามใบกำกับเดิม', 'Original Amount', money(row.original_minor)], ['มูลค่าที่ถูกต้อง', 'Correct Amount', money(row.correct_minor)],
       ['ผลต่าง', 'Difference', money(row.subtotal_minor)], ['ภาษีมูลค่าเพิ่ม 7%', 'Vat 7%', money(row.vat_minor)], ['รวมเงินที่ลดหนี้', 'Total Credit (Baht)', money(gross)]];
  const tx = L + W * 0.6;
  totals.forEach(([th, en, value], i) => {
    const y = sTop + 6 + i * 29;
    text('r', 9.5, th, tx, y); text('r', 8.5, en, tx, y + 12);
    text('b', 10, value, tx, y + 5, { width: R - tx, align: 'right' });
    doc.moveTo(tx, y + 27).lineTo(R, y + 27).dash(1, { space: 2 }).stroke().undash();
  });
  if (receipt) {
    text('r', 9.5, 'ชำระเงินผ่านระบบคู่ช่าง (KooChang) เรียบร้อยแล้ว', L, sTop + 48, { width: W * 0.58 });
    text('r', 9, `อ้างอิง ${row.ref}`, L, sTop + 64, { width: W * 0.58 });
  }

  // Signature boxes.
  const gTop = 740, gw = W / 3;
  doc.rect(L, gTop, W, 62).stroke();
  for (let i = 1; i < 3; i++) doc.moveTo(L + gw * i, gTop).lineTo(L + gw * i, gTop + 62).stroke();
  const signs = receipt ? ['ผู้มีอำนาจลงนาม / Authorized Signature', 'ผู้รับบริการ / Received By', 'ผู้รับเงิน / Collector By']
    : ['ผู้มีอำนาจลงนาม / Authorized Signature', 'ผู้รับใบลดหนี้ / Received By', 'ผู้จัดทำ / Prepared By'];
  signs.forEach((label, i) => {
    const x = L + gw * i;
    doc.moveTo(x + 14, gTop + 28).lineTo(x + gw - 14, gTop + 28).dash(1, { space: 2 }).stroke().undash();
    text('r', 8.5, label, x, gTop + 32, { width: gw, align: 'center' });
    text('r', 8.5, 'วันที่ / Date ....................................', x, gTop + 46, { width: gw, align: 'center' });
  });
  text('r', 7.5, 'เอกสารออกโดยระบบคอมพิวเตอร์', L, 808, { width: W, align: 'center' });
  doc.end();
  return done;
}
