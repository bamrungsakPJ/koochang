import { describe, expect, it } from 'vitest';
import { formatThaiPhone, isThaiMobile, normalizeThaiPhone } from './phone';

describe('normalizeThaiPhone', () => {
  it.each([
    ['0812345678', '+66812345678'],
    ['081-234-5678', '+66812345678'],
    ['+66 81 234 5678', '+66812345678'],
    ['66812345678', '+66812345678'],
    ['02-123-4567', '+6621234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeThaiPhone(input)).toBe(expected);
  });

  it.each(['', '12345', '081234567890', 'abc', '+1 415 555 0100'])('rejects %s', (input) => {
    expect(normalizeThaiPhone(input)).toBeNull();
  });
});

describe('isThaiMobile', () => {
  it('accepts 06/08/09 mobiles and rejects landlines', () => {
    expect(isThaiMobile('+66812345678')).toBe(true);
    expect(isThaiMobile('+66612345678')).toBe(true);
    expect(isThaiMobile('+6621234567')).toBe(false);
  });
});

describe('formatThaiPhone', () => {
  it('formats mobile and Bangkok landline', () => {
    expect(formatThaiPhone('+66812345678')).toBe('081-234-5678');
    expect(formatThaiPhone('+6621234567')).toBe('02-123-4567');
  });
});
