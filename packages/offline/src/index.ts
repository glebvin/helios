import {NativeStore, OfflineQueueError, fail, type EventPayload, type StoredEvent, type QueueState} from './store.js';
export {OfflineQueueError} from './store.js';
export type {EventPayload, QueueState} from './store.js';
export type Session = {token: string; tenantId: string; actorUserId: string; generation: number};
export type QueueOptions = {audience: string; tenantId: string; actorUserId: string; getSession: () => Session | null};
export type QueueEvent = {id: string; requestId: string; employeeId: string; projectId: string; dependency: string | null;
  stage: 'event'; event: EventPayload; state: QueueState; attemptCount: number; nextAttemptAt: number | null; lastError: string | null};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(input: unknown): string {if (typeof input !== 'string' || !uuidPattern.test(input)) fail('invalid_uuid'); return input.toLowerCase();}
function object(input: unknown, allowed?: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail('invalid_object');
  const value = input as Record<string, unknown>;
  if (Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => descriptor.get || descriptor.set)) fail('invalid_json');
  if (allowed && Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_field');
  return value;
}
function stable(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
  if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
  if (Array.isArray(input)) return `[${Array.from(input, value => stable(value)).join(',')}]`;
  const value = object(input);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function instant(value: unknown): number {
  if (typeof value !== 'string') fail('invalid_instant');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59 || (match[7] !== 'Z' && (+match[8] > 23 || +match[9] > 59))) fail('invalid_instant');
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) fail('invalid_instant');
  return Date.parse(value);
}
function text(value: unknown): void {if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('invalid_text');}
function quantity(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,11}(?:\.\d{1,3})?$/.test(value) || !/[1-9]/.test(value)) fail('invalid_quantity');
  const [whole, fraction = ''] = value.split('.'); return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
}
function validateEvent(input: unknown): {event: EventPayload; canonical: string} {
  // Stable JSON validation runs before cloning, so undefined/non-JSON cannot disappear silently.
  const canonical = stable(input); const value = object(input);
  const common = ['kind', 'requestId', 'employeeId', 'projectId', 'shiftId', 'expectedVersion', 'occurredAt', 'previousEventId', 'onBehalfReason'];
  for (const key of ['requestId', 'employeeId', 'projectId', 'shiftId']) uuid(value[key]);
  if (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) fail('invalid_version');
  instant(value.occurredAt);
  if (value.previousEventId !== undefined) uuid(value.previousEventId);
  if (value.onBehalfReason !== undefined) text(value.onBehalfReason);
  if (value.kind === 'shift_start' || value.kind === 'shift_end') {
    object(value, [...common, 'geo']);
    if (value.geo !== undefined) {
      const geo = object(value.geo, ['latitude', 'longitude', 'accuracyMeters', 'capturedAt']);
      for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['accuracyMeters', 0, Number.MAX_VALUE]] as const) {
        if (typeof geo[key] !== 'number' || !Number.isFinite(geo[key]) || (geo[key] as number) < min || (geo[key] as number) > max) fail('invalid_geo');
      }
      instant(geo.capturedAt);
    }
  } else if (value.kind === 'segment_change') {
    if (!['idle', 'work', 'break', 'downtime'].includes(value.mode as string)) fail('invalid_mode');
    object(value, [...common, 'mode', ...(['work', 'downtime'].includes(value.mode as string) ? ['taskId'] : []), ...(value.mode === 'downtime' ? ['reasonCode', 'comment'] : [])]);
    if (value.mode === 'work') uuid(value.taskId);
    if (value.mode === 'downtime') {
      if (value.taskId !== undefined) uuid(value.taskId);
      if (!['materials', 'equipment', 'front', 'safety', 'weather', 'other'].includes(value.reasonCode as string)) fail('invalid_reason_code');
      text(value.comment);
    }
  } else if (value.kind === 'submit_volume') {
    object(value, [...common, 'taskId', 'reportId', 'submittedQuantity']);uuid(value.taskId);uuid(value.reportId);quantity(value.submittedQuantity);
  } else fail('invalid_kind');
  return {event: JSON.parse(JSON.stringify(input)) as EventPayload, canonical};
}
function audience(value: string): string {
  let url: URL;try {url = new URL(value);} catch {return fail('invalid_audience');}
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) fail('invalid_audience');
  const path = url.pathname.replace(/\/$/, '');if (!path.endsWith('/api/v1')) fail('invalid_audience');
  return `${url.origin}${path}`;
}
const reviewKeys = ['delayed', 'future', 'suspicious', 'geoTimeMismatch', 'abovePlannedQuantity'];
function validateReply(body: unknown, event: EventPayload): {state: 'synced' | 'blocked' | 'retry_wait' | 'auth-required'; code: string | null} {
  const batch = object(body, ['results']);if (!Array.isArray(batch.results) || batch.results.length !== 1) fail('ambiguous_response');
  const item = object(batch.results[0]);if (item.requestId !== uuid(event.requestId)) fail('ambiguous_response');
  if (item.outcome === 'error') {
    object(item, ['requestId', 'outcome', 'status', 'code', 'retryable']);
    if (!Number.isInteger(item.status) || (item.status as number) < 400 || (item.status as number) > 599 || typeof item.retryable !== 'boolean' || typeof item.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(item.code)) fail('ambiguous_response');
    return {state: item.status === 401 ? 'auth-required' : item.code === 'missing_dependency' ? 'blocked' : item.retryable ? 'retry_wait' : 'blocked', code: item.code};
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

/** Task1 event facade. Evidence authoring/delivery is added by the separate Task3. */
export async function openOfflineQueue(options: QueueOptions) {
  const base = audience(options.audience), tenantId = uuid(options.tenantId), actorUserId = uuid(options.actorUserId);
  const scope = JSON.stringify([base, tenantId, actorUserId]);
  let closed = false;const aborters = new Set<AbortController>();const sending = new Set<string>();
  function session(): Session {
    if (closed) fail('session_closed');
    const value = options.getSession();
    if (!value || typeof value.token !== 'string' || !value.token || uuid(value.tenantId) !== tenantId || uuid(value.actorUserId) !== actorUserId || !Number.isSafeInteger(value.generation) || value.generation < 0) fail('auth_required');
    return {...value, tenantId, actorUserId};
  }
  function capture(): () => void {
    const initial = session();
    return () => {const current = session();if (current.token !== initial.token || current.generation !== initial.generation) fail('session_changed');};
  }
  const opening = capture(), store = await NativeStore.open();
  let epoch: number;
  try {epoch = await store.epoch(scope);opening();} catch (error) {store.close();throw error;}
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('helios-managed-offline-auth');
  function invalidate(): void {closed = true;for (const aborter of aborters) aborter.abort();store.abortActive();}
  channel?.addEventListener('message', event => {if (event.data?.scope === scope && event.data?.epoch !== epoch) {invalidate();store.close();channel.close();}});
  const view = (row: StoredEvent): QueueEvent => ({id: row.id, requestId: row.event.requestId, employeeId: row.employeeId, projectId: row.projectId,
    dependency: row.event.previousEventId ?? null, stage: 'event', event: structuredClone(row.event), state: sending.has(row.id) ? 'sending' : row.state,
    attemptCount: row.attemptCount, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError});
  async function list(): Promise<QueueEvent[]> {return (await store.list(scope, epoch, capture())).map(view);}
  async function get(id: string): Promise<QueueEvent | null> {const row = await store.get(scope, epoch, uuid(id), capture());return row ? view(row) : null;}
  async function request(path: '/me' | '/execution/events', check: () => void, body?: string): Promise<{status: number; body: unknown}> {
    check();await store.list(scope, epoch, check);check();const current = session();
    const controller = new AbortController();aborters.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${base}${path}`, {method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: `Bearer ${current.token}`, 'x-tenant-id': tenantId, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        body, signal: controller.signal, credentials: 'omit', redirect: 'error'});
      check();const payload: unknown = await response.json();check();return {status: response.status, body: payload};
    } finally {clearTimeout(timeout);aborters.delete(controller);}
  }
  async function flush() {
    const check = capture();
    if (!navigator.locks) return {state: 'unsupported_lock' as const};
    return navigator.locks.request(`helios-offline:${scope}`, {mode: 'exclusive', ifAvailable: true}, async lock => {
      if (!lock) return {state: 'busy' as const};
      check();const rows = await store.list(scope, epoch, check);
      if (!rows.some(row => row.state === 'pending' || row.state === 'retry_wait')) return {state: 'idle' as const};
      const identity = await request('/me', check);
      if (identity.status !== 200) fail(identity.status === 401 ? 'auth_required' : 'identity_unavailable');
      const me = object(identity.body);
      if (me.userId !== actorUserId || me.tenantId !== tenantId) fail('identity_mismatch');
      const heldEmployees = new Set<string>();let attempted = 0;
      for (const row of rows) {
        check();
        if (row.state === 'synced') continue;
        if (heldEmployees.has(row.employeeId)) continue;
        if (!['pending', 'retry_wait'].includes(row.state) || (row.nextAttemptAt !== null && row.nextAttemptAt > Date.now())) {heldEmployees.add(row.employeeId);continue;}
        sending.add(row.id);attempted++;
        let outcome: ReturnType<typeof validateReply>;
        try {
          const response = await request('/execution/events', check, JSON.stringify({events: [row.event]}));
          if (response.status === 200) outcome = validateReply(response.body, row.event);
          else outcome = {state: response.status === 401 ? 'auth-required' : [408, 429].includes(response.status) || response.status >= 500 ? 'retry_wait' : 'blocked', code: `http_${response.status}`};
        } catch (error) {
          check();outcome = {state: 'retry_wait', code: error instanceof OfflineQueueError ? 'ambiguous_response' : 'network_error'};
        } finally {sending.delete(row.id);}
        check();
        const attempts = outcome.state === 'synced' ? 0 : row.attemptCount + 1;
        if (outcome.state === 'retry_wait' && attempts >= 5) outcome = {state: 'blocked', code: 'blocked_retry_exhausted'};
        await store.update(scope, epoch, row.id, row.commandHash, {state: outcome.state, attemptCount: attempts,
          nextAttemptAt: outcome.state === 'retry_wait' ? Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6)) : null, lastError: outcome.code}, check);
        if (outcome.state !== 'synced') heldEmployees.add(row.employeeId);
        if (outcome.state === 'auth-required') break;
      }
      return {state: 'finished' as const, attempted};
    });
  }
  return {
    async enqueueEvent(input: EventPayload): Promise<QueueEvent> {
      const check = capture();const {event, canonical} = validateEvent(input);
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));check();
      const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      return view(await store.enqueue(scope, epoch, event, canonical, hash, check));
    },
    list, get, status: list, flush,
    async retry(id: string): Promise<void> {
      const check = capture(), row = await store.get(scope, epoch, uuid(id), check);
      if (!row) fail('not_found');if (row.state === 'synced') fail('already_synced');
      await store.update(scope, epoch, row.id, row.commandHash, {state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null}, check);
    },
    async cleanupAcknowledged(ids: string[]): Promise<void> {return store.cleanup(scope, epoch, ids.map(uuid), capture());},
    async storageInfo({requestPersistence = false} = {}) {
      const check = capture();await store.list(scope, epoch, check);
      const manager = navigator.storage;
      let persisted: boolean | null = null, persistenceGranted: boolean | null = null, estimate: StorageEstimate | null = null, error: string | null = null;
      try {
        if (manager?.persisted) persisted = await manager.persisted();check();
        if (manager?.estimate) estimate = await manager.estimate();check();
        if (requestPersistence && manager?.persist) persistenceGranted = await manager.persist();check();
      } catch {check();error = 'storage_info_failed';}
      return {indexedDB: true, webLocks: !!navigator.locks, durability: store.durability, persisted, estimate, persistenceGranted,
        persistenceSupported: !!manager?.persist, error};
    },
    async closeSession(): Promise<void> {
      if (closed) return;invalidate();
      try {const nextEpoch = await store.bumpEpoch(scope);channel?.postMessage({scope, epoch: nextEpoch});}
      finally {store.close();channel?.close();}
    },
    close(): void {invalidate();store.close();channel?.close();},
  };
}
export type OfflineQueue = Awaited<ReturnType<typeof openOfflineQueue>>;
