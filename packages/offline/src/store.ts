/** Native storage only. Request handlers schedule requests; only tx.complete resolves. */
export class OfflineQueueError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'OfflineQueueError'; }
}
export function fail(code: string): never { throw new OfflineQueueError(code); }
export type QueueState = 'pending' | 'sending' | 'retry_wait' | 'blocked' | 'auth-required' | 'synced';
type EventCommon = {
  requestId: string; employeeId: string; projectId: string; shiftId: string;
  expectedVersion: number; occurredAt: string; previousEventId?: string; onBehalfReason?: string;
};
type Geo = {latitude: number; longitude: number; accuracyMeters: number; capturedAt: string};
export type EventPayload = EventCommon & (
  {kind: 'shift_start' | 'shift_end'; geo?: Geo} |
  {kind: 'segment_change'; mode: 'idle' | 'break'} |
  {kind: 'segment_change'; mode: 'work'; taskId: string} |
  {kind: 'segment_change'; mode: 'downtime'; taskId?: string;
    reasonCode: 'materials' | 'equipment' | 'front' | 'safety' | 'weather' | 'other'; comment: string} |
  {kind: 'submit_volume'; taskId: string; reportId: string; submittedQuantity: string}
);
export type StoredEvent = {
  key: [string, string]; scope: string; id: string; employeeId: string; projectId: string;
  event: EventPayload; canonical: string; commandHash: string; sequence: number;
  state: Exclude<QueueState, 'sending'>; attemptCount: number; nextAttemptAt: number | null;
  lastError: string | null;
};
type Tail = {version: number; sequence: number; projects: Record<string, string>};
export type Tombstone = {canonical: string; commandHash: string; event: EventPayload; sequence?: number; acknowledged: boolean};
const epochKey = (scope: string) => `epoch:${scope}`;
const tailKey = (scope: string, employee: string) => `tail:${scope}:${employee}`;
export const identityKey = (scope: string, id: string) => `identity:${scope}:${id}`;
export const DATABASE_NAME = 'helios-managed-offline';

export class NativeStore {
  private closed = false;
  private active = new Set<IDBTransaction>();
  durability: IDBTransactionDurability | 'unsupported' = 'unsupported';
  private constructor(private db: IDBDatabase) {
    db.onversionchange = () => this.close();
  }
  static open(): Promise<NativeStore> {
    if (!globalThis.indexedDB) return Promise.reject(new OfflineQueueError('unsupported_storage'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const events = db.createObjectStore('events', {keyPath: 'key'});
        events.createIndex('scope', 'scope');
        events.createIndex('employee', ['scope', 'employeeId', 'sequence']);
        const evidence = db.createObjectStore('evidence', {keyPath: 'key'});
        evidence.createIndex('scope', 'scope');
        db.createObjectStore('meta', {keyPath: 'key'});
      };
      request.onblocked = () => { settled = true; reject(new OfflineQueueError('storage_upgrade_blocked')); };
      request.onerror = () => { settled = true; reject(request.error ?? new OfflineQueueError('storage_open_failed')); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; resolve(new NativeStore(request.result));
      };
    });
  }
  private transaction<T>(mode: IDBTransactionMode, check: () => void,
    work: (tx: IDBTransaction, result: (value: T) => void, guard: (fn: () => void) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new OfflineQueueError('storage_closed')); return; }
      let tx: IDBTransaction;
      try {
        check();
        if (mode === 'readwrite') {
          try { tx = this.db.transaction(['meta', 'events', 'evidence'], mode, {durability: 'strict'}); }
          catch (error) {
            if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'NotSupportedError')) throw error;
            tx = this.db.transaction(['meta', 'events', 'evidence'], mode);
          }
          this.durability = tx.durability ?? 'unsupported';
        } else tx = this.db.transaction(['meta', 'events', 'evidence'], mode);
      } catch (error) { reject(error); return; }
      this.active.add(tx);
      let value: T; let failure: unknown;
      const guard = (fn: () => void) => {
        try { check(); fn(); }
        catch (error) { failure = error; try { tx.abort(); } catch { /* Already aborted. */ } }
      };
      tx.oncomplete = () => {
        this.active.delete(tx);
        try { check(); resolve(value); } catch (error) { reject(error); }
      };
      tx.onerror = () => { failure ??= tx.error; };
      tx.onabort = () => {
        this.active.delete(tx);
        reject(failure ?? tx.error ?? new OfflineQueueError('storage_aborted'));
      };
      guard(() => work(tx, result => {value = result;}, guard));
    });
  }
  epoch(scope: string): Promise<number> {
    return this.transaction('readonly', () => {}, (tx, result) => {
      const request = tx.objectStore('meta').get(epochKey(scope));
      request.onsuccess = () => result(request.result?.value ?? 0);
    });
  }
  /** Shared native transaction boundary for atomic event/evidence/meta operations; never await inside work. */
  scoped<T>(scope: string, epoch: number, mode: IDBTransactionMode, check: () => void,
    work: (tx: IDBTransaction, result: (value: T) => void, guard: (fn: () => void) => void) => void): Promise<T> {
    return this.transaction(mode, check, (tx, result, guard) => {
      const request = tx.objectStore('meta').get(epochKey(scope));
      request.onsuccess = () => guard(() => {
        if ((request.result?.value ?? 0) !== epoch) fail('session_invalidated');
        work(tx, result, guard);
      });
    });
  }
  bumpEpoch(scope: string): Promise<number> {
    return this.transaction('readwrite', () => {}, (tx, result) => {
      const meta = tx.objectStore('meta'); const request = meta.get(epochKey(scope));
      request.onsuccess = () => {const value = (request.result?.value ?? 0) + 1; meta.put({key: epochKey(scope), value}); result(value);};
    });
  }
  list(scope: string, epoch: number, check: () => void): Promise<StoredEvent[]> {
    return this.scoped(scope, epoch, 'readonly', check, (tx, result) => {
      const request = tx.objectStore('events').index('scope').getAll(scope);
      request.onsuccess = () => result((request.result as StoredEvent[]).sort((a, b) => a.sequence - b.sequence));
    });
  }
  get(scope: string, epoch: number, id: string, check: () => void): Promise<StoredEvent | null> {
    return this.scoped(scope, epoch, 'readonly', check, (tx, result) => {
      const request = tx.objectStore('events').get([scope, id]);
      request.onsuccess = () => result(request.result ?? null);
    });
  }
  enqueue(scope: string, epoch: number, event: EventPayload, canonical: string, commandHash: string, check: () => void): Promise<StoredEvent> {
    return this.scoped(scope, epoch, 'readwrite', check, (tx, result, guard) => this.enqueueInTransaction(tx, scope, event, canonical, commandHash, result, guard));
  }
  enqueueInTransaction(tx: IDBTransaction, scope: string, event: EventPayload, canonical: string, commandHash: string, result: (row: StoredEvent) => void, guard: (fn: () => void) => void): void {
    const events = tx.objectStore('events'), meta = tx.objectStore('meta');
    const id = event.requestId.toLowerCase(), employeeId = event.employeeId.toLowerCase(), projectId = event.projectId.toLowerCase();
    const existing = events.get([scope, id]);
    existing.onsuccess = () => guard(() => {
      if (existing.result) {
        if (existing.result.canonical !== canonical) fail('local_identity_conflict');
        result(existing.result); return;
      }
      const identity = meta.get(identityKey(scope, id));
      identity.onsuccess = () => guard(() => {
        if (identity.result) {
          const retained = identity.result.value as Tombstone;
          if (!retained.event || retained.canonical !== canonical || !retained.acknowledged) fail('local_identity_conflict');
          result({key: [scope, id], scope, id, employeeId, projectId, event: retained.event, canonical: retained.canonical,
            commandHash: retained.commandHash, sequence: retained.sequence ?? 0, state: 'synced', attemptCount: 0, nextAttemptAt: null, lastError: null});
          return;
        }
        const tailRequest = meta.get(tailKey(scope, employeeId));
        tailRequest.onsuccess = () => guard(() => {
          const tail = tailRequest.result?.value as Tail | undefined;
          if (tail && event.expectedVersion !== tail.version + 1) fail('local_stream_conflict');
          const predecessor = tail?.projects[projectId];
          if (predecessor && event.previousEventId?.toLowerCase() !== predecessor) fail('local_dependency_conflict');
          // An unknown initial ID is the caller's explicit external acknowledgement, checked by the server on delivery.
          // A known local ID still cannot be borrowed from another employee/project.
          const dependency = event.previousEventId === undefined ? null : meta.get(identityKey(scope, event.previousEventId.toLowerCase()));
          const save = () => guard(() => {
            if (dependency?.result) {
              const known = (dependency.result.value as Tombstone).event;
              if (!known || known.employeeId.toLowerCase() !== employeeId || known.projectId.toLowerCase() !== projectId) fail('local_dependency_conflict');
            }
            const count = events.count();
            count.onsuccess = () => guard(() => {
              if (count.result >= 1000) fail('capacity_exceeded');
              const sequence = (tail?.sequence ?? 0) + 1;
              const row: StoredEvent = {key: [scope, id], scope, id, employeeId, projectId, event, canonical, commandHash,
                sequence, state: 'pending', attemptCount: 0, nextAttemptAt: null, lastError: null};
              events.add(row);
              meta.put({key: tailKey(scope, employeeId), value: {version: event.expectedVersion, sequence, projects: {...tail?.projects, [projectId]: id}}});
              meta.put({key: identityKey(scope, id), value: {canonical, commandHash, event, sequence, acknowledged: false} satisfies Tombstone});
              result(row);
            });
          });
          if (dependency) dependency.onsuccess = save;else save();
        });
      });
    });
  }

  update(scope: string, epoch: number, id: string, commandHash: string,
    patch: Pick<StoredEvent, 'state' | 'attemptCount' | 'nextAttemptAt' | 'lastError'>, check: () => void): Promise<void> {
    return this.scoped(scope, epoch, 'readwrite', check, (tx, result, guard) => {
      const events = tx.objectStore('events'), meta = tx.objectStore('meta');
      const request = events.get([scope, id]);
      request.onsuccess = () => guard(() => {
        const row = request.result as StoredEvent | undefined;
        if (!row || row.commandHash !== commandHash) fail('local_identity_conflict');
        events.put({...row, ...patch});
        if (patch.state === 'synced') meta.put({key: identityKey(scope, id), value: {canonical: row.canonical, commandHash, event: row.event, sequence: row.sequence, acknowledged: true} satisfies Tombstone});
        result(undefined);
      });
    });
  }
  abortActive(): void { for (const tx of this.active) {try {tx.abort();} catch { /* Finished. */ }} }
  close(): void {this.closed = true; this.abortActive(); this.db.close();}
}
