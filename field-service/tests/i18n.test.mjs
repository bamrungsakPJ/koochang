import test from 'node:test'; import assert from 'node:assert/strict';
import core from '../packages/core/dist/index.js'; import i18n from '../packages/i18n/dist/index.js';
test('every translation key exists in both catalogs',()=>assert.deepEqual(Object.keys(i18n.catalogs.th).sort(),Object.keys(i18n.catalogs.en).sort()));
test('language preferences accept th/en and safely fall back',()=>{ assert.equal(core.normalizeLanguage('en-US,en;q=0.9'),'en'); assert.equal(core.normalizeLanguage('th-TH'),'th'); assert.equal(core.normalizeLanguage('eg'),'th'); });
test('Thai Buddhist and English Gregorian calendars share the same date',()=>{ const d=new Date('2026-11-10T03:00:00Z'); assert.match(i18n.formatDate(d,'th'),/2569/); assert.match(i18n.formatDate(d,'en'),/2026/); assert.match(i18n.formatMoney(59000,'en'),/590\.00/); assert.throws(()=>i18n.formatMoney(0.5,'th')); });
test('unknown error code never leaks a raw translation key',()=>assert.equal(i18n.errorMessage('en','SECRET_DB_ERROR'),i18n.translate('en','INTERNAL_ERROR')));
