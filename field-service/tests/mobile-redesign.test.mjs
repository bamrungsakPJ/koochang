import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(name) {
  const source = await readFile(new URL(`../apps/mobile/src/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { applyOcrFields } = await load('ocr-fields');
const { customerDestination } = await load('customer-flow');

test('OCR fills readable values immediately and leaves unread values and nickname alone', () => {
  const current = { name: 'ห้องรับแขก', brand: '', model: 'รุ่นเดิม', serial_number: '' };
  assert.deepEqual(applyOcrFields(current, { brand: ' DAIKIN ', model: null, serial_number: '00AB-123', name: 'AI name' }, {}),
    { name: 'ห้องรับแขก', brand: 'DAIKIN', model: 'รุ่นเดิม', serial_number: '00AB-123' });
  assert.equal(current.brand, '');
});

test('manual edits and deliberate clearing survive delayed OCR and later retries', () => {
  const manual = { brand: true, serial_number: true };
  const first = applyOcrFields({ brand: 'ยี่ห้อที่แก้เอง', model: '', serial_number: '' }, { brand: 'AI', model: 'M1', serial_number: 'AI-SN' }, manual);
  const retry = applyOcrFields(first, { brand: 'AI2', model: 'M2', serial_number: 'AI2-SN' }, manual);
  assert.deepEqual(retry, { brand: 'ยี่ห้อที่แก้เอง', model: 'M2', serial_number: '' });
});

test('a newly created customer flows directly into the intended service or appointment with real ids', () => {
  const customer = { id: 'new-customer', locations: [{ id: 'new-location' }] };
  assert.deepEqual(customerDestination('serviceAdhoc', customer), { screen: 'serviceAdhoc', customerId: 'new-customer', locationId: 'new-location' });
  assert.deepEqual(customerDestination('jobNew', customer), { screen: 'jobNew', customerId: 'new-customer', locationId: 'new-location' });
  assert.deepEqual(customerDestination(undefined, customer), { screen: 'customer', id: 'new-customer' });
});

test('a duplicate customer with several locations keeps the original flow until a location is chosen', () => {
  const customer = { id: 'existing-customer', locations: [{ id: 'site-a' }, { id: 'site-b' }] };
  for (const intent of ['serviceAdhoc', 'jobNew']) {
    const target = customerDestination(intent, customer);
    assert.equal(target.screen, 'customerLocationPick');
    assert.equal(target.customer, customer);
    assert.equal(target.then, intent);
  }
  assert.deepEqual(customerDestination('serviceAdhoc', { id: 'empty-customer', locations: [] }), { screen: 'customer', id: 'empty-customer' });
});
