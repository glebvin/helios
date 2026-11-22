import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readPriceImport, keepPriceImport, clearPriceImport } from './price-import-command.ts';

test('потерянный ответ сохраняет исходные строки и requestId даже при недоступном хранилище', () => {
  const key = randomUUID(), requestId = randomUUID();
  const rows = [{ workTypeName: 'Кладка', price: '12', start: '2026-01-01', end: '2026-01-31' }];
  const blocked = () => { throw new Error('Storage blocked'); };
  keepPriceImport(key, { requestId, text: 'исходная таблица', rows }, blocked);
  rows[0].price = '999';
  assert.equal(readPriceImport(key, blocked)?.rows[0].price, '12');
  assert.equal(readPriceImport(key, blocked)?.requestId, requestId);
  clearPriceImport(key, randomUUID(), blocked);
  assert.equal(readPriceImport(key, blocked)?.requestId, requestId);
  clearPriceImport(key, requestId, blocked);
  assert.equal(readPriceImport(key, blocked), null);
});

test('запрос другой учётки или объекта не используется; повреждённое хранилище не ломает форму', () => {
  const a = randomUUID(), b = randomUUID();
  const store = { getItem: () => '{broken', setItem: () => {}, removeItem: () => {} };
  assert.equal(readPriceImport(a, () => store), null);
  keepPriceImport(a, { requestId: randomUUID(), text: 'таблица A', rows: [{ workTypeName: 'Кладка', price: '1', start: '2026-01-01', end: '2026-01-31' }] }, () => store);
  assert.equal(readPriceImport(b, () => store), null);
  assert.equal(readPriceImport(a, () => store)?.text, 'таблица A');
});
