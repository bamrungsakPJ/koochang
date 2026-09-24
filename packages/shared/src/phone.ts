/**
 * Thai phone numbers are stored as E.164 (+66XXXXXXXXX) and shown as 0XX-XXX-XXXX.
 * Accepts the forms people actually type: 0812345678, 081-234-5678, +66 81 234 5678, 66812345678.
 */

const THAI_MOBILE = /^\+66[689]\d{8}$/;
const THAI_ANY = /^\+66\d{8,9}$/;

export function normalizeThaiPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  let national: string;
  if (/^\+66\d+$/.test(digits)) national = digits.slice(3);
  else if (/^66\d+$/.test(digits)) national = digits.slice(2);
  else if (/^0\d+$/.test(digits)) national = digits.slice(1);
  else return null;

  const e164 = `+66${national}`;
  return THAI_ANY.test(e164) ? e164 : null;
}

export function isThaiMobile(e164: string): boolean {
  return THAI_MOBILE.test(e164);
}

export function formatThaiPhone(e164: string): string {
  const national = `0${e164.slice(3)}`;
  if (national.length === 10) return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  if (national.length === 9) return `${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
  return national;
}
