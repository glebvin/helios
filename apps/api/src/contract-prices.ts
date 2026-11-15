import { day, uuid } from './api-input.js';
import { httpError } from './errors.js';
import { integer, object } from './people-input.js';

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
