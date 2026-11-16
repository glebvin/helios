import {canonicalJSON, digest} from './evidence.js';
import {OfflineQueueError, fail, type NativeStore, type QueueState} from './store.js';
import {httpOutcome, retryDelay, uuid, type ChecklistRoute, type DeliveryOutcome} from './transport.js';

export const CHECKLIST_FILE_LIMIT = 8 * 1024 * 1024;
const fileTypes = ['image/jpeg', 'image/png', 'application/pdf'];
export type ChecklistAnswer = {itemId: string; value: string};
export type ChecklistFileInput = {itemId: string; filename: string; contentType: string; bytes: Uint8Array};
export type ChecklistDraftInput = {
  projectId: string; taskId: string; title: string; projectName: string; day: string;
  templateId: string; edition: number; templateVersion: number; expectedVersion: number;
  items: unknown[]; answers: ChecklistAnswer[]; files: ChecklistFileInput[];
};
type StoredFile = {itemId: string; filename: string; contentType: string; bytes: ArrayBuffer; sha256: string; requestId: string | null; serverFileId: string | null};
export type StoredChecklist = {
  key: [string, string, string]; scope: string; projectId: string; taskId: string; title: string; projectName: string; day: string;
  templateId: string; edition: number; templateVersion: number; expectedVersion: number; items: unknown[];
  answers: ChecklistAnswer[]; files: StoredFile[]; requestId: string | null; phase: 'device' | 'queued';
  canonical: string; commandHash: string | null; state: Exclude<QueueState, 'sending'>;
  attemptCount: number; nextAttemptAt: number | null; lastError: string | null;
};
export type ChecklistCard = {projectId: string; taskId: string; title: string; projectName: string; day: string};
export type ChecklistDetail = ChecklistCard & {
  templateId: string; edition: number; templateVersion: number; expectedVersion: number; items: unknown[];
  answers: ChecklistAnswer[]; files: {itemId: string; filename: string; contentType: string; bytes: Uint8Array; requestId: string | null}[];
  phase: 'device' | 'queued'; requestId: string | null; state: QueueState; lastError: string | null;
};
export type ChecklistQueueRow = {
  id: string; requestId: string; projectId: string; taskId: string; stage: 'checklist'; phase: 'queued';
  state: QueueState; attemptCount: number; nextAttemptAt: number | null; lastError: string | null;
};
type Prepared = {canonical: string; commandHash: string; files: StoredFile[]};
type Request = (route: ChecklistRoute, check: () => void, body?: string | Blob) => Promise<{status: number; body: unknown; retryAfterMs: number | null}>;

function text(value: unknown, max: number, code = 'invalid_text'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(code);
  return value.trim();
}
function copyBytes(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
function ownedBytes(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value.slice(0));
}
function contentCanonical(input: {templateId: string; edition: number; expectedVersion: number; answers: ChecklistAnswer[]; files: {itemId: string; filename: string; contentType: string; sha256: string}[]}): string {
  return canonicalJSON({
    templateId: input.templateId, edition: input.edition, expectedVersion: input.expectedVersion,
    answers: [...input.answers].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    files: [...input.files].map(file => ({itemId: file.itemId, filename: file.filename, contentType: file.contentType, sha256: file.sha256})).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  });
}
export async function prepareChecklist(input: ChecklistDraftInput): Promise<Prepared & {draft: ChecklistDraftInput}> {
  const projectId = uuid(input.projectId), taskId = uuid(input.taskId), templateId = uuid(input.templateId);
  const title = text(input.title, 200), projectName = text(input.projectName, 200), day = text(input.day, 10, 'invalid_day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('invalid_day');
  if (!Number.isSafeInteger(input.edition) || input.edition < 1 || !Number.isSafeInteger(input.templateVersion) || input.templateVersion < 1) fail('invalid_version');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('invalid_version');
  if (!Array.isArray(input.items) || input.items.length > 40 || !Array.isArray(input.answers) || input.answers.length > 40) fail('invalid_checklist');
  if (!Array.isArray(input.files) || input.files.length > 20) fail('invalid_file');
  const answers = input.answers.map(answer => ({itemId: text(answer.itemId, 64, 'invalid_checklist'), value: text(answer.value, 80, 'invalid_checklist')}));
  const files: StoredFile[] = [];
  for (const file of input.files) {
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength < 1 || file.bytes.byteLength > CHECKLIST_FILE_LIMIT) fail('invalid_size');
    const contentType = text(file.contentType, 40, 'invalid_content_type');
    if (!fileTypes.includes(contentType)) fail('invalid_content_type');
    const itemId = text(file.itemId, 64, 'invalid_file'), filename = text(file.filename, 120, 'invalid_filename');
    const bytes = copyBytes(file.bytes);
    files.push({itemId, filename, contentType, bytes, sha256: await digest(bytes), requestId: null, serverFileId: null});
  }
  const draft = {...input, projectId, taskId, templateId, title, projectName, day, answers, items: JSON.parse(JSON.stringify(input.items)) as unknown[]};
  const canonical = contentCanonical({templateId, edition: input.edition, expectedVersion: input.expectedVersion, answers, files});
  return {draft, canonical, commandHash: await digest(new TextEncoder().encode(canonical)), files};
}
function listed(store: NativeStore, scope: string, epoch: number, check: () => void): Promise<StoredChecklist[]> {
  return store.scoped(scope, epoch, 'readonly', check, (tx, result) => {
    const request = tx.objectStore('checklist').index('scope').getAll(scope);
    request.onsuccess = () => result((request.result as StoredChecklist[]).sort((a, b) => a.taskId.localeCompare(b.taskId)));
  });
}
export function checklistCards(rows: StoredChecklist[]): ChecklistCard[] {
  return rows.filter(row => row.items.length > 0).map(row => ({projectId: row.projectId, taskId: row.taskId, title: row.title, projectName: row.projectName, day: row.day}));
}
export function checklistDetail(row: StoredChecklist, sending: Set<string>): ChecklistDetail {
  return {
    projectId: row.projectId, taskId: row.taskId, title: row.title, projectName: row.projectName, day: row.day,
    templateId: row.templateId, edition: row.edition, templateVersion: row.templateVersion, expectedVersion: row.expectedVersion,
    items: row.items, answers: row.answers, phase: row.phase, requestId: row.requestId,
    state: row.requestId && sending.has(row.requestId) ? 'sending' : row.state, lastError: row.lastError,
    files: row.files.map(file => ({itemId: file.itemId, filename: file.filename, contentType: file.contentType, requestId: file.requestId, bytes: ownedBytes(file.bytes)})),
  };
}
export function checklistQueueRow(row: StoredChecklist, sending: Set<string>): ChecklistQueueRow | null {
  if (row.phase !== 'queued' || !row.requestId) return null;
  return {id: row.requestId, requestId: row.requestId, projectId: row.projectId, taskId: row.taskId, stage: 'checklist', phase: 'queued',
    state: sending.has(row.requestId) ? 'sending' : row.state, attemptCount: row.attemptCount, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError};
}
export async function listChecklists(store: NativeStore, scope: string, epoch: number, check: () => void): Promise<StoredChecklist[]> {
  return listed(store, scope, epoch, check);
}
function put(store: NativeStore, scope: string, epoch: number, check: () => void, row: StoredChecklist): Promise<StoredChecklist> {
  return store.scoped(scope, epoch, 'readwrite', check, (tx, result) => {
    tx.objectStore('checklist').put(row);
    result(row);
  });
}
export async function saveChecklist(store: NativeStore, scope: string, epoch: number, check: () => void, prepared: Awaited<ReturnType<typeof prepareChecklist>>): Promise<StoredChecklist> {
  const {draft, canonical, commandHash, files} = prepared;
  const existing = (await listed(store, scope, epoch, check)).find(row => row.projectId === draft.projectId && row.taskId === draft.taskId);
  if (existing?.phase === 'queued' && existing.state === 'synced' && existing.canonical === canonical) return existing;
  if (existing?.phase === 'queued' && existing.state !== 'synced' && existing.state !== 'blocked') {
    if (existing.canonical !== canonical) fail('local_identity_conflict');
    return existing;
  }
  const row: StoredChecklist = {
    key: [scope, draft.projectId, draft.taskId], scope, projectId: draft.projectId, taskId: draft.taskId,
    title: draft.title, projectName: draft.projectName || existing?.projectName || 'Объект', day: draft.day || existing?.day || '',
    templateId: draft.templateId, edition: draft.edition, templateVersion: draft.templateVersion, expectedVersion: draft.expectedVersion,
    items: draft.items, answers: draft.answers, files, requestId: null, phase: 'device', canonical, commandHash, state: 'pending',
    attemptCount: 0, nextAttemptAt: null, lastError: null,
  };
  return put(store, scope, epoch, check, row);
}
export async function queueChecklist(store: NativeStore, scope: string, epoch: number, check: () => void, projectId: string, taskId: string): Promise<StoredChecklist> {
  const wantedProject = uuid(projectId), wantedTask = uuid(taskId);
  const existing = (await listed(store, scope, epoch, check)).find(row => row.projectId === wantedProject && row.taskId === wantedTask);
  if (!existing) fail('not_found');
  if (existing.phase === 'queued' && existing.state !== 'synced') {
    if (existing.state === 'blocked') return existing;
    if (existing.state === 'pending' && existing.nextAttemptAt === null) return existing;
    return put(store, scope, epoch, check, {...existing, state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null});
  }
  if (existing.phase === 'queued' && existing.state === 'synced' && existing.answers.length + existing.files.length > 0 && existing.canonical === contentCanonical(existing)) return existing;
  const files = existing.files.map(file => ({...file, requestId: file.requestId ?? crypto.randomUUID(), serverFileId: null}));
  const requestId = crypto.randomUUID();
  return put(store, scope, epoch, check, {...existing, files, requestId, phase: 'queued', state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null, commandHash: existing.commandHash});
}
async function patch(store: NativeStore, scope: string, epoch: number, check: () => void, row: StoredChecklist, next: Pick<StoredChecklist, 'files' | 'state' | 'attemptCount' | 'nextAttemptAt' | 'lastError'>): Promise<StoredChecklist> {
  const saved = {...row, ...next};
  if (row.commandHash && saved.commandHash !== row.commandHash) fail('local_identity_conflict');
  return put(store, scope, epoch, check, saved);
}
function settle(row: StoredChecklist, outcome: DeliveryOutcome, retryAfter: number | null): Pick<StoredChecklist, 'files' | 'state' | 'attemptCount' | 'nextAttemptAt' | 'lastError'> {
  const attempts = outcome.state === 'synced' ? 0 : row.attemptCount + 1;
  const limited = outcome.state === 'retry_wait' && attempts >= 5 ? {state: 'blocked' as const, code: 'blocked_retry_exhausted'} : outcome;
  return {files: row.files, state: limited.state, attemptCount: attempts, nextAttemptAt: limited.state === 'retry_wait' ? Date.now() + retryDelay(attempts, retryAfter) : null, lastError: limited.code};
}
export async function holdChecklists(store: NativeStore, scope: string, epoch: number, check: () => void, outcome: DeliveryOutcome, retryAfter: number | null): Promise<void> {
  for (const row of await listed(store, scope, epoch, check)) {
    if (row.phase !== 'queued' || !['pending', 'retry_wait'].includes(row.state) || (row.nextAttemptAt !== null && row.nextAttemptAt > Date.now())) continue;
    await patch(store, scope, epoch, check, row, settle(row, outcome, retryAfter));
  }
}
function fileId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as {fileId?: unknown}).fileId;
  return typeof value === 'string' ? value : null;
}
function runAccepted(body: unknown, requestId: string): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return (body as {id?: unknown; requestId?: unknown}).id !== undefined && (body as {requestId?: unknown}).requestId === requestId;
}
export async function deliverChecklist(store: NativeStore, scope: string, epoch: number, row: StoredChecklist, check: () => void, request: Request, sending: Set<string>): Promise<StoredChecklist> {
  let current = row;
  for (const itemId of current.files.map(file => file.itemId)) {
    const file = current.files.find(item => item.itemId === itemId);
    if (!file || file.serverFileId || !file.requestId) continue;
    sending.add(file.requestId);
    let outcome: DeliveryOutcome, retryAfter: number | null = null, uploaded: string | null = null;
    try {
      const response = await request({kind: 'checklist-file', projectId: current.projectId, taskId: current.taskId, itemId: file.itemId, requestId: file.requestId, filename: file.filename, contentType: file.contentType}, check, new Blob([file.bytes]));
      retryAfter = response.retryAfterMs;
      uploaded = response.status === 201 ? fileId(response.body) : null;
      outcome = uploaded ? {state: 'synced', code: null} : response.status === 201 ? {state: 'retry_wait', code: 'ambiguous_response'} : httpOutcome(response.status);
    } catch (error) {
      check();
      outcome = {state: 'retry_wait', code: error instanceof OfflineQueueError ? 'ambiguous_response' : 'network_error'};
    } finally {sending.delete(file.requestId!);}
    check();
    if (!uploaded) return patch(store, scope, epoch, check, current, settle(current, outcome, retryAfter));
    current = await patch(store, scope, epoch, check, current, {files: current.files.map(item => item.itemId === file.itemId ? {...item, serverFileId: uploaded} : item), state: 'pending', attemptCount: current.attemptCount, nextAttemptAt: null, lastError: null});
  }
  if (!current.requestId || current.files.some(file => !file.serverFileId)) return current;
  sending.add(current.requestId);
  let outcome: DeliveryOutcome, retryAfter: number | null = null;
  try {
    const answers = [...current.answers.filter(answer => !current.files.some(file => file.itemId === answer.itemId)), ...current.files.map(file => ({itemId: file.itemId, value: file.serverFileId!}))];
    const response = await request({kind: 'checklist-run', projectId: current.projectId, taskId: current.taskId}, check, JSON.stringify({requestId: current.requestId, templateId: current.templateId, edition: current.edition, expectedVersion: current.expectedVersion, answers}));
    retryAfter = response.retryAfterMs;
    outcome = response.status === 201 && runAccepted(response.body, current.requestId) ? {state: 'synced', code: null} : response.status === 201 ? {state: 'retry_wait', code: 'ambiguous_response'} : httpOutcome(response.status);
  } catch (error) {
    check();
    outcome = {state: 'retry_wait', code: error instanceof OfflineQueueError ? 'ambiguous_response' : 'network_error'};
  } finally {sending.delete(current.requestId);}
  check();
  return patch(store, scope, epoch, check, current, settle(current, outcome, retryAfter));
}
export async function retryChecklist(store: NativeStore, scope: string, epoch: number, check: () => void, id: string): Promise<boolean> {
  const key = uuid(id);
  const row = (await listed(store, scope, epoch, check)).find(item => item.requestId === key || item.files.some(file => file.requestId === key));
  if (!row) return false;
  if (row.state === 'synced') fail('already_synced');
  await patch(store, scope, epoch, check, row, {files: row.files, state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null});
  return true;
}
