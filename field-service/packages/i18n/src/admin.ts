import type { Language } from './index.js';

/** Platform console texts (th/en). Kept apart from the shop app catalog. */
const th = {
  consoleTitle: 'คอนโซลแพลตฟอร์ม', signIn: 'เข้าสู่ระบบ', email: 'อีเมล', password: 'รหัสผ่าน', next: 'ถัดไป',
  mfaTitle: 'ยืนยันตัวตนอีกขั้น', mfaHint: 'ใส่รหัส 6 หลักจากแอปยืนยันตัวตน', code: 'รหัส 6 หลัก', confirm: 'ยืนยัน', cancel: 'ยกเลิก',
  signOut: 'ออกจากระบบ', stepUpTitle: 'ยืนยันก่อนทำรายการเงิน', stepUpHint: 'รายการนี้ต้องยืนยันรหัสจากแอปยืนยันตัวตนอีกครั้ง',
  navPayments: 'การชำระเงิน', navRefunds: 'คืนเงิน', navShops: 'ร้าน', navSupport: 'ช่วยเหลือ', navAudit: 'ประวัติการจัดการ', navReconcile: 'กระทบยอด',
  filterPending: 'รอตรวจหลักฐาน', filterOpen: 'รอชำระทั้งหมด', filterPaid: 'ชำระแล้ว', filterAll: 'ทั้งหมด',
  invoice: 'ใบแจ้งชำระ', shop: 'ร้าน', amount: 'ยอด', plan: 'แพ็กเกจ', status: 'สถานะ', created: 'สร้างเมื่อ', proof: 'หลักฐาน', empty: 'ไม่มีรายการ',
  'invoice.open': 'รอชำระ', 'invoice.paid': 'ชำระแล้ว', 'invoice.voided': 'ยกเลิก', 'proof.pending': 'รอตรวจ', 'proof.accepted': 'รับแล้ว', 'proof.rejected': 'ไม่ผ่าน',
  'refund.pending': 'รออนุมัติ', 'refund.approved': 'อนุมัติแล้ว รอโอน', 'refund.succeeded': 'คืนสำเร็จ', 'refund.failed': 'โอนไม่สำเร็จ', 'refund.rejected': 'ไม่อนุมัติ',
  back: 'กลับ', proofImage: 'ภาพหลักฐาน (เปิดแล้วบันทึกประวัติ)', showProof: 'เปิดดูภาพ',
  confirmPayment: 'ยืนยันรับเงินจริง', confirmHint: 'ตรวจกับรายการเดินบัญชีธนาคาร: ยอด ผู้รับ และเลขอ้างอิงที่ใช้ได้ครั้งเดียว สลิปไม่ใช่หลักฐานว่าได้รับเงินแล้ว',
  amountReceived: 'ยอดที่ได้รับ (บาท)', bankReference: 'เลขอ้างอิงธนาคาร', receivedAt: 'เวลาที่เงินเข้า', note: 'หมายเหตุ', rejectProof: 'ปฏิเสธหลักฐาน', reason: 'เหตุผล',
  paymentConfirmed: 'ยืนยันรับเงินแล้ว รอบใช้งาน {from} – {to}', paymentExisting: 'รายการนี้ยืนยันไว้แล้ว ไม่เพิ่มรอบซ้ำ',
  payment: 'การรับเงิน', verifiedBy: 'ยืนยันโดย {name}', period: 'รอบใช้งาน', refunds: 'คืนเงิน', requestRefund: 'ขอคืนเงิน', refundAmount: 'ยอดคืน (บาท)',
  approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', complete: 'บันทึกโอนคืนสำเร็จ', failed: 'โอนไม่สำเร็จ', requestedBy: 'ขอโดย {name}',
  refundRule: 'ผู้อนุมัติต้องเป็นคนละคนกับผู้ขอ ยอดคืนรวมไม่เกินยอดรับจริง การคืนเงินไม่หยุดสิทธิ์ร้าน', reconcileHint: 'ไฟล์ CSV รายการรับเงินและคืนเงินตามวันเวลาไทย',
  from: 'ตั้งแต่', to: 'ถึง', download: 'ดาวน์โหลด', saved: 'บันทึกแล้ว', noPermission: 'บัญชีนี้ไม่มีสิทธิ์ดูส่วนนี้', roles: 'บทบาท',
  networkError: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง',
};
type AdminCatalog = { [K in keyof typeof th]: string };
const en: AdminCatalog = {
  consoleTitle: 'Platform console', signIn: 'Sign in', email: 'Email', password: 'Password', next: 'Next',
  mfaTitle: 'Two-step verification', mfaHint: 'Enter the 6-digit code from your authenticator app', code: '6-digit code', confirm: 'Confirm', cancel: 'Cancel',
  signOut: 'Sign out', stepUpTitle: 'Confirm before a money action', stepUpHint: 'This action needs a fresh code from your authenticator app.',
  navPayments: 'Payments', navRefunds: 'Refunds', navShops: 'Shops', navSupport: 'Support', navAudit: 'Audit log', navReconcile: 'Reconciliation',
  filterPending: 'Proofs to check', filterOpen: 'All unpaid', filterPaid: 'Paid', filterAll: 'All',
  invoice: 'Invoice', shop: 'Shop', amount: 'Amount', plan: 'Plan', status: 'Status', created: 'Created', proof: 'Proof', empty: 'Nothing here',
  'invoice.open': 'Unpaid', 'invoice.paid': 'Paid', 'invoice.voided': 'Voided', 'proof.pending': 'To check', 'proof.accepted': 'Accepted', 'proof.rejected': 'Rejected',
  'refund.pending': 'Awaiting approval', 'refund.approved': 'Approved, to transfer', 'refund.succeeded': 'Refunded', 'refund.failed': 'Transfer failed', 'refund.rejected': 'Rejected',
  back: 'Back', proofImage: 'Proof image (viewing is recorded)', showProof: 'Open image',
  confirmPayment: 'Confirm money received', confirmHint: 'Check the bank statement: amount, receiver and a reference that can be used once. A slip is not proof that money arrived.',
  amountReceived: 'Amount received (THB)', bankReference: 'Bank reference', receivedAt: 'Received at', note: 'Note', rejectProof: 'Reject proof', reason: 'Reason',
  paymentConfirmed: 'Payment confirmed. Period {from} – {to}', paymentExisting: 'Already confirmed; no extra period added.',
  payment: 'Payment', verifiedBy: 'Confirmed by {name}', period: 'Period', refunds: 'Refunds', requestRefund: 'Request refund', refundAmount: 'Refund amount (THB)',
  approve: 'Approve', reject: 'Reject', complete: 'Record refund transferred', failed: 'Transfer failed', requestedBy: 'Requested by {name}',
  refundRule: 'The approver must be a different person from the requester. Total refunds never exceed the amount received. Refunds do not suspend the shop.',
  reconcileHint: 'CSV of payments and refunds by Bangkok day.',
  from: 'From', to: 'To', download: 'Download', saved: 'Saved', noPermission: 'This account cannot view this section.', roles: 'Roles',
  networkError: 'Cannot connect. Please try again.',
};
export type AdminKey = keyof AdminCatalog;
const adminCatalogs = { th, en };
export function adminText(language: Language, key: AdminKey, params?: Record<string, string | number>): string {
  const text = adminCatalogs[language][key];
  return params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text;
}
