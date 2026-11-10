---
phase: 03c1-headless-durable-queue
verified: 2026-11-10T07:55:18Z
source_head: 4d5f5dcea9fe2e75ffc3d334b28b091978d6f821
source_base: a70b36c193f779a29fe41acc96ed3439c67f9d87
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
covered_files: [".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/261110-01w-CONTEXT.md", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/261110-01w-PLAN.md", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/261110-01w-SUMMARY.md", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/executor-g1-full.tap", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/executor-g1-tests-red-gate.json", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-full.tap", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-g1-evidence-green.tap", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-g1-probe-green.log", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-mutable-evidence.log", ".planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-mutable-evidence.mjs", "apps/api/openapi.json", "apps/api/src/evidence.controller.ts", "apps/api/src/execution.controller.ts", "docs/offline-queue.md", "packages/offline/package.json", "packages/offline/src/evidence.ts", "packages/offline/src/index.ts", "packages/offline/src/store.ts", "packages/offline/src/transport.ts", "packages/offline/test/browser.test.mjs", "packages/offline/test/real-api.ts", "packages/offline/tsconfig.json"]
covered_digest: "v4:sha256:a060f5695fdf9d2b2d2a58098d9306b65cd97938d3592513a065011b2af4f0a5"
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "G1: synchronously capture requested evidence arrays and validated metadata/targets/IDs before any authoring await."
  gaps_remaining: []
  regressions: []
gaps: []
deferred:
  - truth: "Application UI, shell/cache/PWA integration and physical Android/iPhone offline acceptance."
    addressed_in: "03c2"
    evidence: "Locked CONTEXT and PLAN objective explicitly separate 03c1 headless module from 03c2; ROADMAP Phase03 and physical-phone prerequisite remain pending."
---

# 03c1 headless durable queue — independent verification

**Status: passed; 6/6 truths verified.** G1 is closed at source4d5f5dc. Independent re-verification ran the unchanged original public probe successfully in both engines and all24 active evidence cases (12 per engine), including six new authoring-mutation regressions. Initial independent full194/194 remains attributable to source126451d; the executor's inspected final full200/200 is separately attributed below. No implementation changes, probe edits or commits were made by this verifier.

**Bounded goal:** retain exact managed execution commands and real evidence Blobs, replay safely through existing Nest/PostgreSQL endpoints, fence current scope/session and expose truthful queue states. This report does not certify all Phase03, UI, installed PWA, physical phones or the complete pilot. Re-verification after one gap closure; no accepted override was used.

## G1 closure and independently repeated checks

Read actual diff126451d..4d5f5dc: only `index.ts`, `evidence.ts`, browser tests and the handoff document changed. `captureEvidence` synchronously validates and copies scalar metadata, project/employee/dependency/file/reserve/attach IDs, normalized reason and an owned nested target; immutable Blob is retained by reference. Bundled authoring uses `Array.from(..., captureEvidence)` before the first event-digest await, including every later photo. Standalone authoring captures before Blob reads. Async preparation reads only this owned snapshot. The existing event snapshot, native transaction boundary, store/transport/session/ordering/retry/cleanup and fresh-Blob stage handoff are unchanged.

Three added active tests per engine cover standalone MIME/filename/reason edits; cleared/replaced arrays plus event time control; and a two-photo event/final-report bundle with all target/ID/metadata/Blob-reference edits. They close/reopen actual persistent profiles and assert original values/bytes, including independently computed PNG SHA-256. Diff adds58 test lines and removes no old assertions; tests are identical between RED93e8a6b and GREEN4d5f5dc. Preserved accepted RED receipt reports24 tests,18 pass/6 intended failures and `RED_EVIDENCE_OK`, without parser/load errors.

All commands below use the existing runtime, no install, and the exact locked environment prefix:

```sh
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 HELIOS_PLAYWRIGHT_MODULE=/Users/Gleb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/Users/Gleb/Library/Caches/ms-playwright
```

| Independent current command, following that environment prefix | Result |
|---|---|
| `node .planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-mutable-evidence.mjs` | Exit0. Unchanged original probe; `verifier-g1-probe-green.log` records both engines reopening image/png declaration matching actual Blob, original bytes, no invalid MIME in canonical, matching canonical hash, one retained requested photo, original09:00 event and successful original target capture. The probe asserts matching MIME; its additional observations are explicitly asserted by the active tests below. Historical failing log is preserved. |
| `node packages/offline/test/browser.test.mjs evidence` | Exit0, **24/24** = Chromium12/WebKit12, fail0/skipped0/cancelled0; `verifier-g1-evidence-green.tap`. Includes all18 prior evidence cases plus6 new G1 cases: native abort/atomic bundle, persistence/reopen, stage-loss/local-commit replay, response/scope/session guards and bounds are exercised again. |
| `node apps/api/node_modules/typescript/bin/tsc --project packages/offline/tsconfig.json --noEmit` | Exit0. |
| `git diff --quiet 126451d..4d5f5dc -- apps/api packages/domain packages/offline/src/store.ts packages/offline/src/transport.ts packages/offline/test/real-api.ts packages/offline/package.json packages/offline/tsconfig.json` | Exit0, unchanged prior guarantee paths/configs. |
| `git diff --check` | Exit0. |

Truths1/5 were fully rechecked against actual corrected source and runtime; truths2/3/4/6 received source-diff regression review and retain prior independent behavioral evidence. No new full194/200 or oldAPI130 run was needed or claimed by the verifier after this narrow authoring-only fix. Inspected executor `executor-g1-full.tap` records final **200/200** = domain10/API120/browser70, Chromium35/WebKit35; its real fixtures report locked PG identity and cleanup. This is executor evidence, not an independently repeated200 result. Domain plainTS2688, explicit-typeRoots fallback and API compiler observations remain as separately attributed baseline/current executor evidence. No new PG/socket/API4327 lifecycle work occurred during this recheck beyond owned browser mechanics listeners/profiles, all closed in finally.

## Observable truths

| # | Locked truth | Status | Source and behavioral evidence |
|---|---|---|---|
| 1 | Completed local save retains exact execution command and requested actual Blob across reload/reopen; abort/quota/unsupported never returns saved. | **VERIFIED** | `store.ts:70-101` resolves only on native `tx.oncomplete`, rejects abort, scopes transactions, requests strict durability and has native-only fallback. Prior persistence/quota/unsupported evidence retained; current24/24 repeats actual evidence abort, bounds and persistent bundle saves. G1 fixed: every requested photo is synchronously captured before hashing, and cleared/replaced-array tests preserve the original event+Blob after reopen. |
| 2 | Fixed audience/tenant/actor, generation/authEpoch and memory-only tokens fence public operations and stages. | **VERIFIED** | `index.ts:44-93`, `transport.ts:65-91`, `NativeStore.scoped`; actual delayed `/me`/event barriers exercise token/generation/actor/tenant/null/close changes. Two-page authEpoch tests disable BroadcastChannel and reject both later access and stale in-flight commit. Persisted stores are inspected for the bearer; real revoked/expired authority prevents commands. |
| 3 | Employee ordering across projects, frozen event payload, dependency/cleanup/tombstones and cross-tab exclusion. | **VERIFIED** | Atomic `enqueueInTransaction` updates event/identity/tail; ordering excludes project from employee key and checks same-project predecessor. Two pages race the same tail: exactly one succeeds; blocked head fences successors while another employee progresses. Native Web Lock contention plus page close/replay and tombstoned cleanup/re-enqueue pass. Independent mutable-input control also proves the event's original occurredAt survives a caller mutation after invocation. |
| 4 | Strict status/per-item identities, bounded exact replay and stale/auth failures cannot manufacture acknowledgement. | **VERIFIED** | `validateReply`, `httpOutcome`, `retryDelay`, facade `record/flush`; wrong/extra/contradictory/malformed replies, item201 rules, decimal/instant identities, non-JSON401/403, item500, Retry-After, five-failure exhaustion and explicit unchanged retry are actively exercised in both engines. Actual Nest committed event response loss produces success/duplicate with identical payload and one scoped receipt/audit. |
| 5 | Actual Blob has frozen three-stage identities/scope/hash/target, guarded state transitions and fresh-byte handoff across overwrites. | **VERIFIED** | Current24/24 repeats stage replay/abort/identity/target/session/size/count/aggregate-byte cases and all6 new snapshot regressions. The unchanged independent probe now reopens correct original MIME/Blob/canonical/hash. Multi-photo regression preserves original targets, stage IDs and immutable Blob references despite immediate caller mutation. `updateEvidence`/`recordFile` fresh-byte handoff remains unchanged, with prior independent real event/report chain evidence retained. |
| 6 | Actual Chromium/WebKit plus real Nest/PG, retained domain10/API120 and unchanged69-operation contract. | **VERIFIED** | Independent full sequential run exit0: domain10, Chromium32, WebKit32, API120; no skipped/cancelled tests. Real fixture exact role/database/port/data_directory checks execute before owned writes; actual scoped ledger payloads/versions, segments, report quantity, receipts/audits, attachment binding and downloaded bytes/SHA are asserted. API/OpenAPI/SQL/dependencies/UI are unchanged versus a70b36c. |

**Score: 6/6.** There are no behavior-present-but-unexercised truths, outstanding gaps or in-scope human verification items. Current G1 behavior is proven by actual passing assertions rather than source presence alone.

## Historical G1 RED at126451d — now closed

The same issue has two public reproductions. Run from this worktree root:

```sh
HELIOS_PLAYWRIGHT_MODULE=/Users/Gleb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/Users/Gleb/Library/Caches/ms-playwright node .planning/quick/261110-01w-03c-headless-durable-browser-event-and-e/verifier-mutable-evidence.mjs
```

Initial source126451d produced exit **1**; exact historical output is `verifier-mutable-evidence.log`. Current source4d5f5dc produces exit0 in the unchanged probe, separately preserved as `verifier-g1-probe-green.log`. The probe compiles actual production source, serves only its native modules on a random loopback origin, uses real persistent Chromium/WebKit profiles and native IDB, closes/reopens, then removes owned temporary files/listener/profiles. No fetch/IDB/Blob method monkeypatch, mock storage or server effect is involved. The following describes the old defect, not current behavior.

1. Start valid PNG `enqueueEvidence(input)`, then synchronously set `input.contentType = 'text/plain'` before awaiting the save. Both engines resolve the save. After persistent profile reopen the row is pending/queued, `reserve.contentType` is text/plain, `blob.type` is image/png, and bytes remain `[137,80,78,71]`. The native stored `canonical` contains text/plain and `commandHash` equals SHA-256 of that invalid canonical. The defect is not only a helper return or a cosmetic public view: it freezes the invalid declaration that later delivery would send.
2. Start `enqueueEvent(event, {evidence: photos})` with one valid photo, then synchronously clear `photos.length` before awaiting. Both engines resolve the event save and have **zero** evidence rows for that event. `index.ts` first awaits event hashing and only then reads/iterates the original caller-owned array. A similar mutation of its nested target to a wrong actor makes authoring reject `local_dependency_conflict`, confirming late consumption rather than an entry snapshot.

Control: mutate the event's `occurredAt` after invocation. The stored event retains the original09:00 instant, because `validateEvent` already clones before the event digest await. The narrow correction is the equivalent snapshot boundary for the array and all evidence metadata/targets/IDs before any authoring await. A Blob is immutable and need not become base64. No payload editing, auto-rebase, API/schema change or new dependency is needed.

## Required artifacts

`verify.artifacts` returns all7 passed (initial existence/pattern checks); all still exist. Independent inspection establishes substance and real consumers; G1 is cleared by the current behavioral evidence above.

| Artifact | Substance and wiring | Result |
|---|---|---|
| `src/index.ts` | Public headless lifecycle/session facade calls native store, transport and evidence pipeline; synchronous input capture precedes hashing. Used by real browser module import. | Verified; G1 closed |
| `src/store.ts` | Real IDB schema/indexes, transaction settlement/abort, scoped epoch, atomic tail/identity, bounds and cleanup support. | Verified |
| `src/transport.ts` | Fixed allowed paths/methods, memory bearer, pre-send current authority, timeout and strict response validation. | Verified |
| `src/evidence.ts` | Synchronous owned declaration/target snapshot, native Blob hash/reserve/attach identities, IDB persistence, stage guard/copy and exact receipt validation. | Verified; G1 closed |
| `test/browser.test.mjs` | Real native browser matrix, deterministic HTTP mechanics fixture, actual browser proxy to real Nest/PG, six added authoring-mutation cases. | Verified as exercised; old assertions retained |
| `test/real-api.ts` | Existing AppModule on random listener, locked DB preflight, private IPC ownership, scoped snapshots and cleanup. | Verified |
| `docs/offline-queue.md` | Real exported signatures, compiled typed adapter, current synchronous snapshot contract, actionable conflict/session/cleanup instructions, honest platform limits. | Verified handoff |

## Four key links and real data flow

The generic `verify.key-links` scanner reports1/4: it misses three semantic links (`Target not referenced in source`). That is its literal-path/.js-import limitation, not evidence of three disconnected routes. All four actual paths were traced:

| From → To | Trace | Status |
|---|---|---|
| facade → native store | `index.ts` imports `./store.js`; synchronous captured inputs → `store.enqueue` or `saveEvidence` → `store.scoped`/`enqueueInTransaction` → native transaction completion. Real reopen/abort assertions exercise the path. | Wired and flowing; G1 closed |
| transport → execution controller | facade `/me` then one-event `/execution/events`; transport fixed base/headers; real same-origin proxy forwards to `ExecutionController @Post('execution/events')` and real execution service/PG. | Wired and flowing |
| evidence → evidence controller | valid owned declaration/body/Blob → facade stage selection → fixed reserve POST/content PUT/attachment POST → `EvidenceController` → private file bytes/PG binding. Byte downloads/SHA and target columns are asserted. | Wired and flowing; G1 closed |
| browser harness → real fixture | `startRealFixture` spawns `test/real-api.ts` with private IPC; proxy forwards actual browser requests to its random Nest listener; owned `snapshot` SQL reads exact tenant data. | Wired and flowing |

No UI rendering or mocked dynamic UI value is claimed in a headless slice. Real snapshots filter every SQL collection by owned tenant, then assert exact request IDs/payloads/versions, expected55minute work interval and1.250 report, actor/project/employee/event/report bindings, one receipt/audit per command and exact downloaded PNG-signature bytes/hash. These are stronger than unscoped total counts. Negative real stale/revoked/expired scenarios assert original local rows remain and no denied request gets its own receipt/audit/evidence/report effect.

## Initial independent execution and test-quality audit

Full command (one independent run only):

```sh
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 HELIOS_PLAYWRIGHT_MODULE=/Users/Gleb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/Users/Gleb/Library/Caches/ms-playwright corepack pnpm --config.verifyDepsBeforeRun=false -r --workspace-concurrency=1 --if-present test
```

| Check | Observed result |
|---|---|
| `verifier-full.tap` | Exit0,194/194 = domain10 + browser64 + API120; Chromium32/WebKit32; fail0/skipped0/cancelled0. Existing56 mechanics and8 real scenarios all ran. |
| Initial authoring mutation probe | Historical exit1 on126451d; same invalid persisted MIME and lost optional bundle in both engines. Current unchanged probe exit0 and24/24 evidence recheck are recorded above. |
| Offline/API production tsc | Both exit0 with locked DB env. Offline DOM-only `types:[]` isolates inherited Node types. |
| Real fixture tsc | Exit0 using installed API compiler, NodeNext/ES2022, decorators/metadata, strict, API typeRoots. |
| Actual typed adapter in docs | Extracted the actual import/example code into an owned temporary compiler project extending offline tsconfig, adjusted its relative import to the same real module, set rootDir `/`, noEmit; exit0 and temporary project removed. |
| Domain plain tsc | Exit2, TS2688 missing Node type definition. This is the acknowledged baseline, not a pass. |
| Existing domain fallback | Explicit `--typeRoots apps/api/node_modules/@types`, exit0; no config/dependency fix. |
| Contract/scope | `apps/api/openapi.json` byte-equal to a70b36c, parsed69 operations. Git diff contains exactly9 added offline/docs files; API/SQL/scripts/root manifest/lockfile/apps/web/packages/ui unchanged. `git diff --check a70b36c HEAD` exit0. |
| Owned cleanup | Runtime logs confirm preflight identity and cleanup; owned real Nest PIDs73192/73927 exit successfully and host process lookup finds neither afterward. Browser contexts, server connections, IPC/pools, fixture tenants/users and temporary private storage are closed/removed. PG retained; no DB restore/reset or API4327 restart was required. |

Requirement-linked tests are active: no actual skip/todo/pending patterns found. Boundary injections (quota, unsupported strict option, absent locks/storage, controlled timer, real request-success→abort) are identified as such, not claimed as physical disk pressure/power loss. Actual transaction/lock/order/session transitions have runtime assertions. Fixture journals/receipts are used to prove exact replay, not to generate expected values for the production implementation. Real SQL snapshot and independently computed SHA-256/download bytes provide separate oracles. G1 exposed a genuine old omission; new cases now actively assert the missing snapshot property and independently pass.

### WebKit adaptation and retained production regression

Read preserved `task3-webkit-offline-baseline.log`: without queue code, Playwright WebKit global `setOffline(true)` makes both new native Blob.arrayBuffer and FileReader fail; both work before/after that flag. The real integration instead aborts actual `/api/v1/**` network requests, asserts real fetch rejection, authoring still uses native Blob/IDB, and reopened profiles deliver to actual Nest/PG. This is a justified network-interruption harness adaptation. It is not OS airplane-mode, browser process-kill, physical iPhone, or installed-PWA evidence.

The previously found production WebKit overwrite defect is meaningfully exercised: actual real test queues both event and report Blobs, reopens between each committed lost-reply boundary, and eventually continues multiple evidence stages in the same flush. `updateEvidence` materializes bytes outside IDB, puts a fresh Blob, returns that Blob through `store.scoped` only after complete; `recordFile` carries it into the next stage. Initial full independent Chromium/WebKit real scenarios passed without the removed Blob-prototype diagnostics. That path is unchanged by G1; current evidence recheck repeats native stage replay, while executor final full200 also retains all8 real scenarios.

## Requirements and decision coverage

| Requirement | In-scope evidence | Disposition |
|---|---|---|
| AUTH-01 | Current session/generation/authEpoch, real `/me`, logout/stale completion/expired session tests. | Verified within03c1; no new whole-pilot completion mark |
| ACL-01 | Fixed audience/tenant/actor, fixed paths, real current authority, revoked membership and cross-scope native reads. | Verified within03c1; server remains authority |
| TEST-01 / DEV-01 | Real native engines and actual isolated Nest/PG, explicit role/port/path preflight, owned random ports/fixture cleanup, preserved130/69; current G1 cases24/24. | Verified within03c1; no new whole-pilot completion mark |
| Robust offline sync/files (subsequent pilot) | Durable exact execution/evidence mechanism, captured authoring snapshot and interrupted replay. | Verified within03c1; UI/device/full-pilot work remains separate |

### Decision Coverage

`check.decision-coverage-verify` returned `skipped:true`, reason `no trackable decisions`, total0/honored0; message: **No trackable decisions in CONTEXT.md.** It has numbered locked requirements rather than a `<decisions>` block. Manual mapping above and bounded-scope review cover them; no fuzzy-decision count is presented as implementation proof.

## Anti-patterns, human scope and conclusion

No debt-marker blocker, stub production return, secret logging, fake IndexedDB, arbitrary queued URL, new dependency, API/SQL/UI edit or install is present. G1's exact historical failing output remains preserved and the same public probe plus active stronger cases pass after the narrow correction. No new-scope unevidenced advisory or outstanding blocker was found in re-verification.

### Advisory (New Scope, Unevidenced)

None.

No in-scope human-only item remains. Physical phones, OS storage pressure/clearing, installed PWA/shell/cache and UI error/retry flows are explicitly deferred03c2 work, not silently converted into passed checks. Origin eviction/clearing/power-loss survival is not guaranteed by transaction completion or persist(), and docs accurately disclose it.

**Next step:** parent canonical STATE/Brain/planning closure and later03c2 integration/device acceptance. Parent must refresh the canonical fingerprint if it edits included SUMMARY/planning evidence. Source4d5f5dc is verified within this bounded03c1 goal; no verifier commit, merge, deployment, PG reset or API4327 restart occurred.

_Verifier: Codex independent gsd-verifier; re-verified2026-11-10T07:55:18Z._

## Parent archival closure

Parent closed SUMMARY/STATE for this bounded03c1 and left03c2/UI/PWA/physical devices pending. Planning/console artifacts received whitespace-only archival normalization with token equivalence checked; no tested implementation, owned probe, assertion or result changed. The canonical covered fingerprint was recomputed for SUMMARY and those artifact bytes. API4327 was not restarted; no merge/deploy/UI edits.
