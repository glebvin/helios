import {OfflineQueueError, fail, type EventPayload} from './store.js';
export type Session = {token: string; tenantId: string; actorUserId: string; generation: number};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(input: unknown): string {if (typeof input !== 'string' || !uuidPattern.test(input)) fail('invalid_uuid'); return input.toLowerCase();}
export function object(input: unknown, allowed?: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail('invalid_object');
  const value = input as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => descriptor.get || descriptor.set)) fail('invalid_json');
  if (allowed && Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_field');
  return value;
}
export function instant(value: unknown): number {
  if (typeof value !== 'string') fail('invalid_instant');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59 || (match[7] !== 'Z' && (+match[8] > 23 || +match[9] > 59))) fail('invalid_instant');
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) fail('invalid_instant');
  return Date.parse(value);
}
export function quantity(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,11}(?:\.\d{1,3})?$/.test(value) || !/[1-9]/.test(value)) fail('invalid_quantity');
  const [whole, fraction = ''] = value.split('.'); return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
}
const reviewKeys = ['delayed', 'future', 'suspicious', 'geoTimeMismatch', 'abovePlannedQuantity'];
export function validateReply(body: unknown, event: EventPayload): {state: 'synced' | 'blocked' | 'retry_wait' | 'auth-required'; code: string | null} {
  const batch = object(body, ['results']);if (!Array.isArray(batch.results) || batch.results.length !== 1) fail('ambiguous_response');
  const item = object(batch.results[0]);if (item.requestId !== uuid(event.requestId)) fail('ambiguous_response');
  if (item.outcome === 'error') {
    object(item, ['requestId', 'outcome', 'status', 'code', 'retryable']);
    if (!Number.isInteger(item.status) || (item.status as number) < 400 || (item.status as number) > 599 || typeof item.retryable !== 'boolean' || typeof item.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(item.code)) fail('ambiguous_response');
    const transient = [408, 429].includes(item.status as number) || (item.status as number) >= 500;
    return {state: item.status === 401 ? 'auth-required' : item.code === 'missing_dependency' ? 'blocked' : transient && item.retryable ? 'retry_wait' : 'blocked', code: item.code};
  }
  object(item, ['requestId', 'outcome', 'status', 'result']);
  if (!['success', 'duplicate'].includes(item.outcome as string) || item.status !== 201) fail('ambiguous_response');
  const result = object(item.result);
  for (const key of ['requestId', 'employeeId', 'projectId', 'shiftId'] as const) if (result[key] !== uuid(event[key])) fail('ambiguous_response');
  if (result.kind !== event.kind || result.version !== event.expectedVersion + 1 || instant(result.occurredAt) !== instant(event.occurredAt)) fail('ambiguous_response');
  instant(result.receivedAt);
  const flags = object(result.reviewFlags, reviewKeys);
  if (reviewKeys.some(key => typeof flags[key] !== 'boolean')) fail('ambiguous_response');
  if (event.kind === 'submit_volume' && (result.taskId !== uuid(event.taskId) || result.reportId !== uuid(event.reportId) || result.submittedQuantity !== quantity(event.submittedQuantity) || result.provisional !== true || result.acceptedQuantity !== null)) fail('ambiguous_response');
  return {state: 'synced', code: null};
}


export type DeliveryOutcome = {state: 'synced' | 'blocked' | 'retry_wait' | 'auth-required'; code: string | null};
export function httpOutcome(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return {state: 'retry_wait', code: 'ambiguous_response'};
  return {state: status === 401 ? 'auth-required' : [408, 429].includes(status) || status >= 500 ? 'retry_wait' : 'blocked', code: `http_${status}`};
}
export function retryDelay(attempt: number, retryAfter: number | null): number {
  return retryAfter ?? Math.min(60_000, 1000 * 2 ** Math.min(attempt - 1, 6));
}
function retryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : null;
  const date = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) : NaN;
  const delay = seconds === null ? date - Date.now() : seconds * 1000;
  return Number.isFinite(delay) ? Math.max(1000, Math.min(60_000, delay)) : null;
}

/** Fixed execution routes only. Credentials are captured in memory immediately before each send. */
export function createTransport(base: string, tenantId: string, session: () => Session,
  beforeSend: (check: () => void) => Promise<unknown>, aborters: Set<AbortController>) {
  return async function request(path: '/me' | '/execution/events', check: () => void, body?: string) {
    check();await beforeSend(check);check();const current = session();
    const controller = new AbortController();aborters.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${base}${path}`, {method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: `Bearer ${current.token}`, 'x-tenant-id': tenantId, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body, signal: controller.signal, credentials: 'omit', redirect: 'error'});
      check();
      // An auth/permanent HTTP failure is authoritative even when its body is empty or not JSON.
      let payload: unknown;
      if (response.status === 200) {
        try {payload = await response.json();}
        catch {check();throw new OfflineQueueError('ambiguous_response');}
      } else void response.body?.cancel().catch(() => {});
      check();return {status: response.status, body: payload, retryAfterMs: retryAfter(response.headers.get('Retry-After'))};
    } finally {clearTimeout(timeout);aborters.delete(controller);}
  };
}
