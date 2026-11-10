import {fail, identityKey, type NativeStore, type EventPayload, type StoredEvent, type QueueState, type Tombstone} from './store.js';
import {uuid, object, instant} from './transport.js';
export type EvidenceTarget = {kind: 'execution_event'; actorUserId: string; requestId: string} | {kind: 'final_report'; reportId: string};
export type EvidenceInput = {projectId: string; employeeId: string; filename: string; contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  blob: Blob; target: EvidenceTarget; dependencyRequestId: string; fileId?: string; reserveRequestId?: string; attachRequestId?: string; onBehalfReason?: string};
type Reservation = {requestId: string; fileId: string; employeeId: string; filename: string; contentType: EvidenceInput['contentType']; sizeBytes: number; sha256: string; onBehalfReason?: string};
type Attachment = {requestId: string; target: EvidenceTarget; onBehalfReason?: string};
export type StoredEvidence = {key: [string, string]; scope: string; id: string; projectId: string; employeeId: string; blob: Blob;
  dependencyRequestId: string; target: EvidenceTarget; reserve: Reservation; attach: Attachment; canonical: string; commandHash: string;
  stage: 'queued' | 'reserved' | 'uploaded' | 'synced'; state: Exclude<QueueState, 'sending'>; attemptCount: number; nextAttemptAt: number | null; lastError: string | null};
export type QueueEvidence = Omit<StoredEvidence, 'key' | 'scope' | 'canonical' | 'commandHash' | 'state'> & {requestId: string; dependency: string; state: QueueState};
export function canonicalJSON(input: unknown): string {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
  if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
  if (Array.isArray(input)) return `[${Array.from(input, canonicalJSON).join(',')}]`;
  const value = object(input);return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}
export async function digest(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Own all caller-controlled values synchronously; Blob bytes are immutable. */
export function captureEvidence(input: EvidenceInput, actor: string) {
  const value = object(input, ['projectId','employeeId','filename','contentType','blob','target','dependencyRequestId','fileId','reserveRequestId','attachRequestId','onBehalfReason']);
  const projectId = uuid(value.projectId), employeeId = uuid(value.employeeId), dependencyRequestId = uuid(value.dependencyRequestId);
  const blob = value.blob;
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > 8 * 1024 * 1024) fail('invalid_size');
  if (!['image/jpeg','image/png','application/pdf'].includes(value.contentType as string) || blob.type !== value.contentType) fail('invalid_content_type');
  if (typeof value.filename !== 'string' || !value.filename.trim() || value.filename.trim().length > 255 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value.filename)) fail('invalid_filename');
  if (value.onBehalfReason !== undefined && (typeof value.onBehalfReason !== 'string' || !value.onBehalfReason.trim() || value.onBehalfReason.length > 500)) fail('invalid_text');
  const t = object(value.target);let target: EvidenceTarget;
  if (t.kind === 'execution_event') {
    object(t, ['kind','actorUserId','requestId']);target = {kind: t.kind, actorUserId: uuid(t.actorUserId), requestId: uuid(t.requestId)};
    if (target.actorUserId !== actor || target.requestId !== dependencyRequestId) fail('local_dependency_conflict');
  } else if (t.kind === 'final_report') {object(t, ['kind','reportId']);target = {kind: t.kind, reportId: uuid(t.reportId)};}
  else return fail('invalid_target');
  const id = value.fileId === undefined ? crypto.randomUUID() : uuid(value.fileId);
  const reserveId = value.reserveRequestId === undefined ? crypto.randomUUID() : uuid(value.reserveRequestId);
  const attachId = value.attachRequestId === undefined ? crypto.randomUUID() : uuid(value.attachRequestId);
  if (new Set([id,reserveId,attachId,dependencyRequestId]).size !== 4) fail('local_identity_conflict');
  const reason = value.onBehalfReason === undefined ? {} : {onBehalfReason: (value.onBehalfReason as string).trim()};
  return {projectId, employeeId, dependencyRequestId, blob, target, id, reserveId, attachId, reason,
    filename: value.filename.trim(), contentType: value.contentType as EvidenceInput['contentType']};
}
export async function prepareEvidence(input: ReturnType<typeof captureEvidence>, scope: string, check: () => void): Promise<StoredEvidence> {
  const {projectId, employeeId, dependencyRequestId, blob, target, id, reserveId, attachId, reason, filename, contentType} = input;
  const bytes = await blob.arrayBuffer();check();const sha256 = await digest(bytes);check();
  const reserve: Reservation = {requestId: reserveId, fileId: id, employeeId, filename, contentType, sizeBytes: blob.size, sha256, ...reason};
  const attach: Attachment = {requestId: attachId, target, ...reason};
  const canonical = canonicalJSON({projectId, dependencyRequestId, reserve, attach});const commandHash = await digest(new TextEncoder().encode(canonical));check();
  return {key: [scope,id], scope, id, employeeId, projectId, blob, dependencyRequestId, target, reserve, attach, canonical, commandHash,
    stage: 'queued', state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null};
}
function compatible(row: StoredEvidence, dependency: EventPayload): void {
  if (uuid(dependency.employeeId) !== row.employeeId || uuid(dependency.projectId) !== row.projectId || uuid(dependency.requestId) !== row.dependencyRequestId) fail('local_dependency_conflict');
  if (row.target.kind === 'final_report' && (dependency.kind !== 'submit_volume' || uuid(dependency.reportId) !== row.target.reportId)) fail('local_dependency_conflict');
}
/** All request scheduling stays in this single native transaction; hashing precedes it. */
export function saveEvidence(store: NativeStore, scope: string, epoch: number, rows: StoredEvidence[], check: () => void,
  event?: {event: EventPayload; canonical: string; commandHash: string}): Promise<{event?: StoredEvent; evidence: StoredEvidence[]}> {
  return store.scoped(scope, epoch, 'readwrite', check, (tx, result, guard) => {
    const files = tx.objectStore('evidence'), meta = tx.objectStore('meta');let savedEvent: StoredEvent | undefined;const saved: StoredEvidence[] = [];
    const next = (position: number) => {
      if (position === rows.length) {result({...(savedEvent ? {event: savedEvent} : {}), evidence: saved});return;}
      const row = rows[position];const existing = meta.get(identityKey(scope,row.id));
      existing.onsuccess = () => guard(() => {
        if (existing.result) {
          const retained = existing.result.value;
          if (retained.role !== 'file' || retained.canonical !== row.canonical) fail('local_identity_conflict');
          const present = files.get(row.key);present.onsuccess = () => guard(() => {
            if (present.result) saved.push(present.result);
            else if (retained.acknowledged) saved.push({...row, stage: 'synced', state: 'synced'});
            else fail('local_identity_conflict');
            next(position+1);
          });return;
        }
        const reserveIdentity = meta.get(identityKey(scope,row.reserve.requestId)), attachIdentity = meta.get(identityKey(scope,row.attach.requestId));
        attachIdentity.onsuccess = () => guard(() => {
          if (reserveIdentity.result || attachIdentity.result) fail('local_identity_conflict');
          const dependency = meta.get(identityKey(scope,row.dependencyRequestId));
          dependency.onsuccess = () => guard(() => {
            if (!dependency.result?.value?.event) fail('local_dependency_conflict');compatible(row,dependency.result.value.event);
            const count = files.count();const cursor = files.openCursor();let bytes = 0;
            cursor.onsuccess = () => guard(() => {
              const item = cursor.result;if (item) {bytes += (item.value as StoredEvidence).blob.size;item.continue();return;}
              if (count.result >= 32 || bytes + row.blob.size > 64 * 1024 * 1024) fail('capacity_exceeded');
              files.add(row);
              for (const [id,role] of [[row.id,'file'],[row.reserve.requestId,'reserve'],[row.attach.requestId,'attach']]) meta.put({key:identityKey(scope,id),value:{canonical:row.canonical,commandHash:row.commandHash,role,acknowledged:false}});
              saved.push(row);next(position+1);
            });
          });
        });
      });
    };
    if (event) store.enqueueInTransaction(tx,scope,event.event,event.canonical,event.commandHash,row => {savedEvent = row;next(0);},guard);
    else next(0);
  });
}
export function listEvidence(store: NativeStore, scope: string, epoch: number, check: () => void): Promise<StoredEvidence[]> {
  return store.scoped(scope,epoch,'readonly',check,(tx,result) => {const r=tx.objectStore('evidence').index('scope').getAll(scope);r.onsuccess=()=>result(r.result);});
}
export function evidenceDependency(store: NativeStore, scope: string, epoch: number, row: StoredEvidence, check: () => void): Promise<boolean> {
  return store.scoped(scope,epoch,'readonly',check,(tx,result,guard) => {const r=tx.objectStore('meta').get(identityKey(scope,row.dependencyRequestId));r.onsuccess=()=>guard(()=>{
    const dependency=r.result?.value as Tombstone | undefined;if(!dependency?.event)fail('local_dependency_conflict');compatible(row,dependency.event);result(dependency.acknowledged);
  });});
}
export async function updateEvidence(store: NativeStore, scope: string, epoch: number, row: StoredEvidence,
  patch: Pick<StoredEvidence,'state'|'attemptCount'|'nextAttemptAt'|'lastError'|'stage'>, check: () => void): Promise<Blob> {
  // Re-putting an IDB-backed Blob reference can lose its backing bytes in WebKit on reopen.
  // Materialize the bounded bytes before the transaction; never replace them with metadata alone.
  check();const bytes=await row.blob.arrayBuffer();check();const blob=new Blob([bytes],{type:row.blob.type});
  return store.scoped(scope,epoch,'readwrite',check,(tx,result,guard)=>{
    const files=tx.objectStore('evidence'),meta=tx.objectStore('meta'),r=files.get(row.key);
    r.onsuccess=()=>guard(()=>{
      if(!r.result || r.result.commandHash!==row.commandHash || r.result.stage!==row.stage)fail('local_identity_conflict');
      files.put({...r.result,...patch,blob});
      if(patch.state==='synced')for(const [id,role] of [[row.id,'file'],[row.reserve.requestId,'reserve'],[row.attach.requestId,'attach']])meta.put({key:identityKey(scope,id),value:{canonical:row.canonical,commandHash:row.commandHash,role,acknowledged:true}});
      // Carry the same fresh bytes into the next stage; the overwritten IDB reference
      // may no longer be readable in WebKit even within this still-running flush.
      result(blob);
    });
  });
}
export function cleanup(store: NativeStore, scope: string, epoch: number, ids: string[], check: () => void): Promise<void> {
  return store.scoped(scope,epoch,'readwrite',check,(tx,result,guard)=>{
    const events=tx.objectStore('events'),files=tx.objectStore('evidence'),er=events.index('scope').getAll(scope),fr=files.index('scope').getAll(scope);
    fr.onsuccess=()=>guard(()=>{
      const eventRows=er.result as StoredEvent[],fileRows=fr.result as StoredEvidence[];
      for(const id of ids){
        const row=eventRows.find(row=>row.id===id)??fileRows.find(row=>row.id===id);
        if(!row || row.state!=='synced')fail('cleanup_requires_acknowledgement');
        if(eventRows.some(other=>other.state!=='synced'&&other.event.previousEventId?.toLowerCase()===id)||fileRows.some(other=>other.state!=='synced'&&other.dependencyRequestId===id))fail('pending_dependency');
      }
      for(const id of ids){events.delete([scope,id]);files.delete([scope,id]);}result(undefined);
    });
  });
}
/** A reservation is an original receipt snapshot; never infer uploaded/attached from it. */
export function validateEvidenceReply(body: unknown, row: StoredEvidence, actor: string): void {
  const b=object(body),r=row.reserve;
  for(const [key,value] of Object.entries({id:row.id,projectId:row.projectId,employeeId:row.employeeId,filename:r.filename,contentType:r.contentType,sizeBytes:r.sizeBytes,sha256:r.sha256,reservedBy:actor,onBehalfReason:r.onBehalfReason??null}))if(b[key]!==value)fail('ambiguous_response');
  instant(b.reservedAt);
  if(!['pending','ready'].includes(b.state as string))fail('ambiguous_response');
  if(b.state==='ready'){uuid(b.readyBy);instant(b.readyAt);}else if(b.readyBy!==null||b.readyAt!==null)fail('ambiguous_response');
  if(row.stage!=='queued'&&b.state!=='ready')fail('ambiguous_response');
  if(row.stage==='uploaded'){
    const a=object(b.attachment);if(a.attachedBy!==actor||a.onBehalfReason!==(row.attach.onBehalfReason??null)||canonicalJSON(a.target)!==canonicalJSON(row.target))fail('ambiguous_response');instant(a.attachedAt);
  }else if(b.attachment!==null){
    const a=object(b.attachment);if(a.attachedBy!==actor||canonicalJSON(a.target)!==canonicalJSON(row.target))fail('ambiguous_response');instant(a.attachedAt);
  }
}
