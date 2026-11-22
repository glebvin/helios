import { httpError } from './errors.js';
import { uuid } from './api-input.js';
import { object, text } from './people-input.js';

export function idSetInput(input: unknown) {
  const body = object(input, ['requestId', 'expectedVersion', 'titles']);
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw httpError(400, 'invalid_version');
  if (!Array.isArray(body.titles) || body.titles.length > 30) throw httpError(400, 'invalid_titles');
  const titles = body.titles.map((item: unknown) => text(item, 120));
  if (new Set(titles).size !== titles.length) throw httpError(400, 'invalid_titles');
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion, titles };
}
