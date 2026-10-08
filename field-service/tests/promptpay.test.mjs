import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, promptPayPayload } from '../apps/api/dist/billing/promptpay.js';

test('CRC-16/CCITT-FALSE matches the standard check value', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('PromptPay payload: mobile, tax ID and e-wallet targets with the invoice amount', () => {
  const mobile = promptPayPayload('081-234-5678', 59000);
  assert.equal(mobile.slice(0, -4),
    '000201010212' + '29370016A000000677010111' + '01130066812345678' + '5303764' + '5406590.00' + '5802TH' + '6304');
  assert.equal(mobile.slice(-4), crc16(mobile.slice(0, -4)));
  assert.match(promptPayPayload('0105561234567', 29000), /0016A000000677010111021301055612345675303764540629\d\.00/);
  assert.match(promptPayPayload('123456789012345', 100), /0016A0000006770101110315123456789012345/);
  assert.match(promptPayPayload('0812345678', 129000), /54071290\.00/);
});

test('PromptPay payload refuses unusable IDs and amounts', () => {
  assert.equal(promptPayPayload('12345', 1000), null);
  assert.equal(promptPayPayload('0812345678', 0), null);
  assert.equal(promptPayPayload('0812345678', 1.5), null);
});
