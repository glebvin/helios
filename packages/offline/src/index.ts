import {canonicalJSON, digest, prepareEvidence, saveEvidence, listEvidence, evidenceDependency, updateEvidence, validateEvidenceReply, cleanup, type EvidenceInput, type QueueEvidence, type StoredEvidence} from './evidence.js';
import {uuid, object, instant, quantity, validateReply, createTransport, httpOutcome, retryDelay, type DeliveryOutcome, type Session} from './transport.js';
import {NativeStore, OfflineQueueError, fail, type EventPayload, type StoredEvent, type QueueState} from './store.js';
export {OfflineQueueError} from './store.js';
export type {EventPayload, QueueState} from './store.js';
export type {EvidenceInput, EvidenceTarget, QueueEvidence} from './evidence.js';
export type {Session} from './transport.js';
export type QueueOptions = {audience: string; tenantId: string; actorUserId: string; getSession: () => Session | null};
export type QueueEvent = {id: string; requestId: string; employeeId: string; projectId: string; dependency: string | null;
  stage: 'event'; event: EventPayload; state: QueueState; attemptCount: number; nextAttemptAt: number | null; lastError: string | null};
function text(value: unknown): void {if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('invalid_text');}
function validateEvent(input: unknown): {event: EventPayload; canonical: string} {
  // Stable JSON validation runs before cloning, so undefined/non-JSON cannot disappear silently.
  const canonical = canonicalJSON(input); const value = object(input);
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
/** Scope-bound immutable execution and evidence facade. */
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
  const fileView = (row: StoredEvidence): QueueEvidence => {
    const {key,scope: storedScope,canonical,commandHash,...publicRow} = structuredClone(row);
    return {...publicRow,requestId:row.reserve.requestId,dependency:row.dependencyRequestId,state:sending.has(row.id)?'sending':row.state};
  };
  async function list(): Promise<(QueueEvent | QueueEvidence)[]> {
    const check=capture();const events=await store.list(scope,epoch,check),files=await listEvidence(store,scope,epoch,check);check();
    return [...events.map(view),...files.map(fileView)];
  }
  async function get(id: string): Promise<QueueEvent | QueueEvidence | null> {
    const check=capture(),key=uuid(id),row=await store.get(scope,epoch,key,check);if(row)return view(row);
    const files=await listEvidence(store,scope,epoch,check);const file=files.find(row=>row.id===key);return file?fileView(file):null;
  }
  const request = createTransport(base, tenantId, session, check => store.list(scope, epoch, check), aborters);
  async function record(row: StoredEvent, outcome: DeliveryOutcome, check: () => void, retryAfter: number | null = null) {
    const attempts = outcome.state === 'synced' ? 0 : row.attemptCount + 1;
    if (outcome.state === 'retry_wait' && attempts >= 5) outcome = {state: 'blocked', code: 'blocked_retry_exhausted'};
    await store.update(scope, epoch, row.id, row.commandHash, {state: outcome.state, attemptCount: attempts,
      nextAttemptAt: outcome.state === 'retry_wait' ? Date.now() + retryDelay(attempts, retryAfter) : null, lastError: outcome.code}, check);
    return outcome;
  }
  async function recordFile(row:StoredEvidence,outcome:DeliveryOutcome,check:()=>void,retryAfter:number|null=null):Promise<StoredEvidence>{
    const attempts=outcome.state==='synced'?0:row.attemptCount+1;
    if(outcome.state==='retry_wait'&&attempts>=5)outcome={state:'blocked',code:'blocked_retry_exhausted'};
    const stage=outcome.state==='synced'?(row.stage==='queued'?'reserved':row.stage==='reserved'?'uploaded':'synced'):row.stage;
    const patch={stage,state:outcome.state==='synced'&&stage!=='synced'?'pending' as const:outcome.state,attemptCount:attempts,
      nextAttemptAt:outcome.state==='retry_wait'?Date.now()+retryDelay(attempts,retryAfter):null,lastError:outcome.code};
    await updateEvidence(store,scope,epoch,row,patch,check);return {...row,...patch};
  }
  async function flush() {
    const check = capture();
    if (!navigator.locks) return {state: 'unsupported_lock' as const};
    return navigator.locks.request(`helios-offline:${scope}`, {mode: 'exclusive', ifAvailable: true}, async lock => {
      if (!lock) return {state: 'busy' as const};
      check();const rows = await store.list(scope, epoch, check), files = await listEvidence(store, scope, epoch, check);
      if (![...rows,...files].some(row => row.state === 'pending' || row.state === 'retry_wait')) return {state: 'idle' as const};
      let identityFailure: DeliveryOutcome | null = null, identityDelay: number | null = null;
      try {
        const identity = await request('/me', check);identityDelay = identity.retryAfterMs;
        if (identity.status !== 200) identityFailure = httpOutcome(identity.status);
        else {
          const me = object(identity.body);
          if (me.userId !== actorUserId || me.tenantId !== tenantId) identityFailure = {state: 'blocked', code: 'identity_mismatch'};
        }
      } catch (error) {
        check();identityFailure = {state: 'retry_wait', code: error instanceof OfflineQueueError ? 'ambiguous_response' : 'network_error'};
      }
      if (identityFailure) {
        // Only current employee heads are eligible; an identity failure never sends a command.
        const seen = new Set<string>();
        for (const row of rows) {
          if (row.state === 'synced' || seen.has(row.employeeId)) continue;
          seen.add(row.employeeId);
          if (['pending', 'retry_wait'].includes(row.state) && (row.nextAttemptAt === null || row.nextAttemptAt <= Date.now())) await record(row, identityFailure, check, identityDelay);
        }
        for(const row of files)if(['pending','retry_wait'].includes(row.state)&&(row.nextAttemptAt===null||row.nextAttemptAt<=Date.now()))await recordFile(row,identityFailure,check,identityDelay);
        return {state: 'finished' as const, attempted: 0};
      }
      const heldEmployees = new Set<string>();let attempted = 0;
      for (const row of rows) {
        check();
        if (row.state === 'synced') continue;
        if (heldEmployees.has(row.employeeId)) continue;
        if (!['pending', 'retry_wait'].includes(row.state) || (row.nextAttemptAt !== null && row.nextAttemptAt > Date.now())) {heldEmployees.add(row.employeeId);continue;}
        sending.add(row.id);attempted++;
        let outcome: DeliveryOutcome, retryAfter: number | null = null;
        try {
          const response = await request('/execution/events', check, JSON.stringify({events: [row.event]}));
          retryAfter = response.retryAfterMs;
          if (response.status === 200) outcome = validateReply(response.body, row.event);
          else outcome = httpOutcome(response.status);
        } catch (error) {
          check();outcome = {state: 'retry_wait', code: error instanceof OfflineQueueError ? 'ambiguous_response' : 'network_error'};
        } finally {sending.delete(row.id);}
        check();
        outcome = await record(row, outcome, check, retryAfter);
        if (outcome.state !== 'synced') heldEmployees.add(row.employeeId);
        if (outcome.state === 'auth-required') return {state:'finished' as const,attempted};
      }
      for (let row of files) {
        check();if(!['pending','retry_wait'].includes(row.state)||(row.nextAttemptAt!==null&&row.nextAttemptAt>Date.now()))continue;
        if(!await evidenceDependency(store,scope,epoch,row,check))continue;
        // Each durable stage is attempted at most once in this flush. A completed stage resets its retry counter.
        while(row.stage!=='synced'){
          sending.add(row.id);attempted++;let outcome:DeliveryOutcome,retryAfter:number|null=null;
          try{
            const kind=row.stage==='queued'?'reserve':row.stage==='reserved'?'upload':'attach';
            const response=await request({kind,projectId:row.projectId,fileId:row.id},check,kind==='upload'?row.blob:JSON.stringify(kind==='reserve'?row.reserve:row.attach));
            retryAfter=response.retryAfterMs;
            if(response.status===(kind==='upload'?200:201)){validateEvidenceReply(response.body,row,actorUserId);outcome={state:'synced',code:null};}
            else outcome=httpOutcome(response.status);
          }catch(error){check();outcome={state:'retry_wait',code:error instanceof OfflineQueueError?'ambiguous_response':'network_error'};}
          finally{sending.delete(row.id);}
          check();row=await recordFile(row,outcome,check,retryAfter);
          if(row.state==='auth-required')return {state:'finished' as const,attempted};
          if(row.state!=='pending')break;
        }
      }
      return {state: 'finished' as const, attempted};
    });
  }
  return {
    async enqueueEvent(input: EventPayload, options: {evidence?: EvidenceInput[]} = {}): Promise<QueueEvent> {
      const check = capture();const {event, canonical} = validateEvent(input);object(options,['evidence']);
      if(options.evidence!==undefined&&(!Array.isArray(options.evidence)||options.evidence.length>32))fail('invalid_evidence');
      const hash=await digest(new TextEncoder().encode(canonical));check();
      const evidence:StoredEvidence[]=[];for(const input of options.evidence??[])evidence.push(await prepareEvidence(input,scope,actorUserId,check));
      if(!evidence.length)return view(await store.enqueue(scope,epoch,event,canonical,hash,check));
      const saved=await saveEvidence(store,scope,epoch,evidence,check,{event,canonical,commandHash:hash});return view(saved.event!);
    },
    async enqueueEvidence(input: EvidenceInput): Promise<QueueEvidence>{
      const check=capture(),row=await prepareEvidence(input,scope,actorUserId,check);
      return fileView((await saveEvidence(store,scope,epoch,[row],check)).evidence[0]);
    },
    list, get, status: list, flush,
    async retry(id: string): Promise<void> {
      const check = capture(),key=uuid(id),row = await store.get(scope, epoch, key, check);
      if(row){if(row.state==='synced')fail('already_synced');await store.update(scope,epoch,row.id,row.commandHash,{state:'pending',attemptCount:0,nextAttemptAt:null,lastError:null},check);return;}
      const files=await listEvidence(store,scope,epoch,check),file=files.find(row=>row.id===key);if(!file)fail('not_found');if(file.state==='synced')fail('already_synced');
      await updateEvidence(store,scope,epoch,file,{stage:file.stage,state:'pending',attemptCount:0,nextAttemptAt:null,lastError:null},check);
    },
    async cleanupAcknowledged(ids: string[]): Promise<void> {return cleanup(store,scope,epoch,ids.map(uuid),capture());},
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
