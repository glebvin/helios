import { day, uuid } from './api-input.js';
import { httpError } from './errors.js';
import { integer, object } from './people-input.js';

const money = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

/** Новая редакция. Единицу берёт сервер из вида работ, клиент её не подменяет. */
export function contractPriceCommand(input: unknown) {
  const body = object(input, ['requestId', 'workTypeId', 'price', 'start', 'end', 'expectedVersion']);
  if (typeof body.price !== 'string') throw httpError(400, 'invalid_price');
  const start = day(body.start);
  const end = day(body.end);
  if (!start || !end) throw httpError(400, 'invalid_period');
  return {
    requestId: uuid(body.requestId).toLowerCase(),
    workTypeId: uuid(body.workTypeId).toLowerCase(),
    price: body.price.trim(),
    start,
    end,
    expectedVersion: integer(body.expectedVersion, 0),
  };
}

export type PriceImportRow = { line: number; workTypeName: string; price: string; start: string; end: string; error: string | null };

/** Проверочный формат строк, не файл заказчика. Пустая цена не становится нулём. */
export function priceImportRows(input: unknown): PriceImportRow[] {
  const body = object(input, ['rows']);
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 50) throw httpError(400, 'invalid_body');
  return body.rows.map((value, index) => {
    const item = object(value, ['workTypeName', 'price', 'start', 'end']);
    const workTypeName = typeof item.workTypeName === 'string' ? item.workTypeName.trim() : '';
    const price = typeof item.price === 'string' ? item.price.trim() : '';
    let start = '';
    let end = '';
    let error: string | null = null;
    if (!workTypeName || workTypeName.length > 200) error = 'invalid_text';
    else if (!money.test(price)) error = 'invalid_price';
    else {
      try {
        start = day(item.start) ?? '';
        end = day(item.end) ?? '';
        if (!start || !end || start > end) error = 'invalid_period';
      } catch { error = 'invalid_period'; }
    }
    return { line: index + 1, workTypeName, price, start, end, error };
  });
}
