# Managed offline queue — 03c1 adapter contract

`packages/offline` is a headless browser module for the existing versioned execution/evidence API. It has no React, Node runtime or new dependency. Cursor still needs to connect it to the application in03c2. The existing localStorage outbox and service worker are untouched and **unsupported for managed events**; do not send the same managed command through both queues, silently migrate old entries or delete them.

## Exported API

Import `openOfflineQueue`, `OfflineQueueError` and the types `OfflineQueue`, `QueueOptions`, `Session`, `EventPayload`, `QueueEvent`, `QueueEvidence`, `EvidenceInput`, `EvidenceTarget`, `QueueState` from `packages/offline/src/index.ts` (package name `@helios/offline` when the consumer's workspace/bundler is wired). The package exports TypeScript source; the browser consumer must compile it. This change does not add a frontend dependency or change its lockfile.

```ts
type Session = {
  token: string; tenantId: string; actorUserId: string; generation: number;
};
// openOfflineQueue({audience, tenantId, actorUserId, getSession}): Promise<OfflineQueue>
// enqueueEvent(event: EventPayload, options?: {evidence?: EvidenceInput[]}): Promise<QueueEvent>
// enqueueEvidence(input: EvidenceInput): Promise<QueueEvidence>
// list()/status(): Promise<(QueueEvent | QueueEvidence)[]>
// get(id: string): Promise<QueueEvent | QueueEvidence | null>
// flush(): Promise<{state: 'idle' | 'busy' | 'unsupported_lock'} |
//                  {state: 'finished'; attempted: number}>
// retry(id: string): Promise<void>
// cleanupAcknowledged(ids: string[]): Promise<void>
// storageInfo({requestPersistence?: boolean}?): Promise<storage capability result>
// closeSession(): Promise<void>
// close(): void
```

`audience` is the fixed absolute HTTPS API base ending in `/api/v1`; HTTP is allowed only on loopback for development. The queue partition is normalized audience + tenant + actor. Employee ordering is shared across that actor's projects within the partition. Events, files and metadata use native IndexedDB `helios-managed-offline`, schema version1; tokens remain in memory. Changing the actor, tenant or API base opens a separate partition and never exposes another partition's records. All public data operations require a matching current session.

`QueueEvent.stage === 'event'` discriminates the event/evidence union. An event retains `event`, `id`/`requestId`, project/employee, dependency, state, attemptCount, nextAttemptAt and lastError. Evidence uses the file ID as `id`, the reservation request ID as `requestId`, and retains its actual `blob`, frozen `reserve`/`attach` bodies, target, dependencyRequestId and durable `stage` (`queued`, `reserved`, `uploaded`, `synced`). Event acknowledgement and its photos' acknowledgement are separate: a synced event can still have a pending photo. `status()` returns rows, not aggregate counters; derive displayed counts from their states/stages.

## Typed adapter example

Run this in the application browser bundle. Supply a real API login's identity/token, an employee/project the user can act on, the current employee stream version and predecessor from application reconciliation, and a selected PNG/JPEG/PDF `File` or `Blob`. Keep the same generated command object/IDs if the UI retries a local save; creating a different ID represents a different command.

```ts
import {
  openOfflineQueue, type OfflineQueue, type Session, type EventPayload,
  type EvidenceInput,
} from '../packages/offline/src/index.js'; // Adjust relative import in the consumer.

let session: Session | null = null;
let queue: OfflineQueue | null = null;
let generation = 0;

// Serialize UI login/logout/token/tenant/actor transitions through this function.
export async function replaceSession(next: Omit<Session, 'generation'> | null) {
  const previous = queue;
  queue = null;
  session = null;
  generation += 1; // Increment even when the new token/user looks identical.
  await previous?.closeSession(); // Persist authEpoch and fence other tabs/in-flight work.
  if (!next) return;
  session = {...next, generation};
  queue = await openOfflineQueue({
    audience: `${location.origin}/api/v1`,
    tenantId: next.tenantId,
    actorUserId: next.actorUserId,
    getSession: () => session,
  });
}

export function makeStart(input: {
  employeeId: string; projectId: string; expectedVersion: number;
  previousEventId?: string;
}): EventPayload {
  return {
    kind: 'shift_start', requestId: crypto.randomUUID(), shiftId: crypto.randomUUID(),
    employeeId: input.employeeId, projectId: input.projectId,
    expectedVersion: input.expectedVersion, occurredAt: new Date().toISOString(),
    ...(input.previousEventId ? {previousEventId: input.previousEventId} : {}),
  };
}

export function makePhoto(event: EventPayload, blob: Blob): EvidenceInput {
  if (!session) throw new Error('Login required');
  const contentType = blob.type;
  if (contentType !== 'image/png' && contentType !== 'image/jpeg' &&
      contentType !== 'application/pdf') throw new Error('Unsupported file type');
  return {
    projectId: event.projectId, employeeId: event.employeeId,
    filename: 'shift-photo.png', contentType, blob,
    dependencyRequestId: event.requestId,
    target: {kind: 'execution_event', actorUserId: session.actorUserId,
      requestId: event.requestId},
    fileId: crypto.randomUUID(), reserveRequestId: crypto.randomUUID(),
    attachRequestId: crypto.randomUUID(),
  };
}

export async function saveStart(event: EventPayload, photo: EvidenceInput) {
  if (!queue) throw new Error('Login required');
  const saved = await queue.enqueueEvent(event, {evidence: [photo]});
  // Show “saved on this device” only after this resolves: event+Blob committed atomically.
  return saved;
}

export async function flushNow() {
  const active = queue;
  if (!active) return;
  const delivery = await active.flush();
  const rows = await active.status();
  return {delivery, rows}; // UI distinguishes event/file states and explains errors.
}

// UI event handlers must catch rejected promises and render the actionable error.
// A manual sync button calls flushNow(); online is only another opportunity to try.
export function connectOnline(onError: (error: unknown) => void) {
  const handler = () => {void flushNow().catch(onError);};
  addEventListener('online', handler);
  return () => removeEventListener('online', handler);
}
```

The caller serializes auth transitions and increments generation for token refresh/logout/login/actor/tenant changes; `getSession` must return current state synchronously. Invoke `closeSession()` while the old queue is still available, even when the UI has cleared its token. This bumps a durable authEpoch, broadcasts invalidation and aborts local work. Other tabs must update their own session provider and reopen their queue after their auth UI reconciles. Epoch checks protect even without BroadcastChannel. `close()` only disposes this handle (navigation/unmount); it does not log the scope out across tabs. Neither operation deletes pending records or can reverse a command already committed by the server.

For a final report photo use `target: {kind: 'final_report', reportId}` and `dependencyRequestId` equal to that local `submit_volume.requestId`. `enqueueEvidence()` can add a photo later to an existing local/acknowledged tombstoned dependency with matching project/employee. Arbitrary unverified remote event/report targets are not supported. Optional `onBehalfReason` must be supplied where current server authority requires it. Example filename is illustrative; use the actual selected filename with the correct MIME type in the UI.

## Delivery, conflicts and recovery

Every flush requires native Web Locks; it returns `unsupported_lock` without sending when unavailable, or `busy` if another tab holds the scope's lock. Do not show either as synced. A closed/crashed tab releases its lock. Call `flush` explicitly on save/manual sync/online if desired; there is no internal timer, automatic background sync or service-worker delivery. `navigator.onLine` is not delivery proof. `finished` means the pass completed; `attempted` counts attempted event/stage requests, not successes. Always inspect rows.

Before any send, current `/me` must match the bound actor/tenant. The transport uses only fixed routes with in-memory bearer and tenant header, `credentials: omit`, redirect rejection and a30second abort timeout. It sends one frozen event per execution batch, in employee order across projects; one failed head prevents that employee's successors. IDs, expectedVersion, timestamps, predecessor and JSON never change on delivery/retry. The server remains authoritative for current assignment, admission, lifecycle and versions.

States are `pending`, transient `sending`, `retry_wait`, `blocked`, `auth-required`, `synced`. HTTP200 alone cannot acknowledge an event: exactly one validated matching per-item201 `success`/`duplicate` is required. Invalid/mismatched/partial replies stay unacknowledged. HTTP401 needs authentication;403/other permanent failures block. Retryable failures (network/ambiguous replies,408,429,5xx or validated retryable server errors) wait with bounded exponential delay (1,2,4,8seconds before the fifth failed attempt blocks), or valid `Retry-After` clamped to1–60seconds. No automatic resend before `nextAttemptAt`. `retry(id)` explicitly resets attempts/delay while preserving command/Blob/stage; it does not itself send. IDs are event request IDs or evidence file IDs. A synced row rejects retry with `already_synced`.

For `stale_version`, `missing_dependency`, assignment/admission/lifecycle errors, inspect current server history and the frozen local chain. Show the conflict to the user; do not renumber/rebase/replace the original payload or bypass its successor fence. Reauthentication must restore the same current identity for this partition; switching account must not send the previous account's queue. There is no pending-delete/force-send/rebase API in this slice. If a changed business action is needed, reconcile it explicitly with server state; do not fabricate acknowledgement or enqueue a replacement that silently duplicates an already committed effect.

Evidence waits for dependency acknowledgement before all stages in this implementation. It then reserves frozen metadata (201), uploads original bytes as `application/octet-stream` (200), and attaches the exact event/report target (201). Matching declaration, actor, timestamps, state and target are validated at every stage; a reservation replay may validly remain the original pending snapshot after a later upload. Each lost reply/failed local commit repeats that stage with the original IDs/hash/bytes, producing one server receipt/binding. Keep Blobs until validated attachment **and explicit cleanup**. WebKit requires the implementation's bounded fresh native Blob copy before status/retry re-put and before fetch; do not replace that copy with an IDB-backed Blob reference, metadata-only save or base64 fallback.

## Storage and device limits

The whole database permits1000 retained events,32 retained evidence files and64MiB of evidence, across partitions; each supported JPEG/PNG/PDF must contain1byte–8MiB and have matching Blob MIME/declaration. Caps include synced rows until cleanup. Both authoring entrypoints synchronously validate and capture their own event, evidence array, metadata, targets and IDs before any hashing or Blob read; later edits to caller-owned objects or arrays cannot change the requested save. Immutable Blob bytes are retained by reference. Hashing reads actual bounded bytes before the native transaction; the server additionally validates magic/content. A save resolves only on IndexedDB transaction completion. Rejected hashing/validation/quota/abort/versionchange/capacity means the UI cannot claim saved. Keep the input in the UI and expose `OfflineQueueError.code` or the sanitized native failure; there is no volatile success fallback.

`cleanupAcknowledged(ids)` is explicit and atomic, refuses unsynced rows and acknowledged dependencies that still have pending event/evidence dependents. Clean up completed evidence/dependents before their event (or include the complete acknowledged set). Compact identity/tail tombstones remain so exact authoring replay cannot resend and changed payload reuse cannot overwrite history. This is not an unlimited history retention system; there is no automatic orphan-file deletion, migration or global account purge.

`storageInfo({requestPersistence: true})` exposes actual `indexedDB`, `webLocks`, `durability`, `persisted`, `persistenceSupported`, `persistenceGranted`, `estimate` and sanitized `error`. Call persistence request from a suitable user interaction and display the returned boolean/null honestly. Strict transaction durability is requested when supported and falls back only if the browser rejects the option. Versionchange closes the stale connection; reopen after the upgrade/auth lifecycle settles. An upgrade blocked by another native connection rejects opening rather than reporting ready.

Origin storage may be cleared, evicted, exhausted, lost with a profile/device or affected by power loss. Transaction completion and `persist()` are browser boundaries, not guaranteed backups. There is no encryption from same-origin scripts/XSS or an OS user; isolate trusted application origins. Session fences stop further local sends/acknowledgements but cannot undo an in-flight server commit. Persisted records contain no bearer token; that does not make their business data public or encrypted.

## Verification and handoff

The test runner requires the explicitly supplied installed Playwright1.62.1 runtime and both engines; unavailable engines or unimplemented/unknown suites fail. `tracer` is the retained event tracer, `mechanics` includes all62 native browser scenarios, `evidence` focuses on24 of them, `real` adds8 browser→actual Nest/PostgreSQL scenarios and `all` includes70 total (35 per engine). The six authoring-mutation regressions reopen persistent profiles and retain original metadata, photo arrays, targets, IDs and event timestamps. No required case is skipped. The separate real fixture validates both database role identities and exact retained54339 data_directory before writing, owns random Nest/proxy ports and unique fixture IDs, controls setup/inspection through private IPC and cleans its rows/pools/listeners/profiles/private storage. Parent API4327 is untouched.

Real offline integration aborts actual browser `/api/v1/**` network requests while authoring native Blob/IndexedDB data, proves fetch unavailable, then closes/reopens the persistent profile before real online delivery. It does not replace fetch or IndexedDB. Playwright WebKit `context.setOffline(true)` independently makes a newly constructed Blob's `arrayBuffer()` fail even without the module; network-only interruption avoids that emulator artifact. No OS airplane-mode or physical-device result is claimed. Lost responses are dropped only after the same-origin proxy has fully received Nest's committed success.

Run old server tests and real fixtures sequentially: retained migration tests snapshot shared tables, so default workspace parallelism can create an unrelated fixture race. Use the locked54339 environment plus the two browser runtime variables, then `corepack pnpm --config.verifyDepsBeforeRun=false -r --workspace-concurrency=1 --if-present test`. The flag prevents installed pnpm's automatic dependency verification from attempting a store-changing install. Do not reinstall or change dependency/store configuration to run these gates. Offline/API typechecks and domain checks are separate; plain domain tsc retains baselineTS2688, with the existing API typeRoots fallback recorded separately.

03c2 remains: Cursor application wiring, user-facing conflict/retry/status controls, application shell/cache/PWA behavior and physical Android/iPhone installed-PWA tests (offline capture, process termination, OS storage pressure/clearing, upgrades and recovery). Desktop WebKit is not iPhone certification. This module and automated evidence do not complete Phase03, acceptance or the pilot.
