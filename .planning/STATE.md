---
gsd_state_version: "1.0"
current_phase: 03b-server — private evidence files, revisioned hour approval and coherent XLSX exports.
status: "backend03b-server independently verified (6/6 must-haves) at source 7b3610a. Next: 03c durable browser queue, UI integration and physical-phone verification; Phase03 is not complete."
last_updated: "2026-11-10T07:59:57.040Z"
state_head: 4d5f5dcea9fe2e75ffc3d334b28b091978d6f821
---

# Backend state

Date: 2026-11-10
Branch: codex-api
Base: b2ddc9f
Current phase: 03c1 — headless durable browser event and evidence queue.
Status:03c1 independently verified (6/6 must-haves) at source4d5f5dc, after G1 snapshot correction. Next:03c2 Cursor UI wiring, shell/cache/PWA and physical-phone validation; Phase03 and the pilot remain incomplete.
UI worktree is independent. Avoid edits there and main.

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|---|---|---|---|
| 261109-azt | Versioned read API, explicit tenant/project ACL, real overview, OpenAPI and UI handoff; domain10 + API12 and repeat new9 passed | 2026-11-09 | 45a9b51 | quick/261109-azt-versioned-director-api-tenant-project-ac |
| 261109-bkb | People/qualifications, immutable admission/current evidence, assignment/crews; OpenAPI30; independently verified 5/5, domain10/API26 + people14 repeat + tsc passed | 2026-11-09 | f1717a4 | quick/261109-bkb-people-qualifications-admission-checks-c |
| 261109-cdb | Real catalogs/drafts, versioned front checks, atomic admission-gated publication, interval conflict checks and legacy fences; independently verified 6/6, domain10/API51 + tasks25 repeat + API tsc | 2026-11-09 | f2d63e2 | quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub |
| 261109-nqz | Managed execution events/shifts/segments/final provisional volumes, current authority and real races, exact day/DST reads and OpenAPI58; independently verified 6/6, domain10/API74 + execution23 repeat + API tsc | 2026-11-09 | cfcfcf2 | quick/261109-nqz-managed-task-execution-shifts-downtime-v |
| 261109-qu2 | Private evidence, revisioned exact hours and coherent XLSX; OpenAPI69; independently verified6/6, full130 plus time28 and isolated race1 after fixture fix | 2026-11-09 | 7b3610a | [261109-qu2-private-evidence-files-revisioned-time-a](./quick/261109-qu2-private-evidence-files-revisioned-time-a/) |
| 261110-01w | Headless native IndexedDB event/Blob queue, session and cross-tab fences, exact replay; final200 tests, independent6/6 after G1 correction; UI/devices03c2 pending | 2026-11-10 | 4d5f5dc | [261110-01w-03c-headless-durable-browser-event-and-e](./quick/261110-01w-03c-headless-durable-browser-event-and-e/) |

## Confirmed decisions

- Backend uses isolated PostgreSQL54339, `.data/pg-54339`, API4327. Original UI defaults retained.
- Workers require active project membership plus actual employee assignment for project/task reads; own employee profile stays available without assignment.
- Missing quality/downtime/ID metrics are explicit unavailable/null. Legacy write limitations remain documented.
- No UI edits, main merge, deployment or complete-pilot readiness claim. Server evidence/hour approval/XLSX03b and headless durable queue03c1 are independently verified. Next:03c2 UI integration, shell/cache/PWA and physical-phone testing.
- Backend02a uses durable atomic receipt/audit commands and ordered NO KEY UPDATE locks; current eligibility requires latest attempt/template and exact active qualification id/version on tenant civil date. Backend02b adds current+workDate evidence checks at publication. Legacy creation is retired (410), and legacy execution rejects all managed tasks before replay/effects; legacy fixture execution remains uncertified.
- API4327 started from cfcfcf2; live health/OpenAPI58, seeded director login/projects/execution shifts/reports, additive provisional exact-string overview, malformed empty batch400 and logout smoke passed after independent verification. Isolated PG54339 retained.
- 03a execution uses separate presence/work/break/downtime intervals, shared durable receipts, provisional final task/shift volume and immutable event ledger. All reported time/volume stays unapproved; no complete client offline/files/quality acceptance claim. Plain domain tsc retains baselineTS2688; explicit existing-typeRoots fallback passes.

## Backend03b-server independent verification and runtime closure — 2026-11-09

The earlier03a and implementation checkpoint notes below are historical. Quick261109-qu2 completed all three sequential implementation tasks: private evidence6routes, immutable hour approval/history/revoke4routes and real XLSX1route, strict OpenAPI69 preserving the old58 operations/schemas. Source7b3610a (production21626a0 plus isolated test fixture fix). Independent verifier passed6/6 with actual SQL/source/runtime evidence. Full regression130=domain10/API120 independently repeated, affected69 passed before the test-only fix; final time28 and independently filtered XLSX race1 passed afterward. APItsc and explicit-typeRoots domain fallback pass; plain domainTS2688 remains. Initial fresh008/009 application was not independently repeated; retained migrations/data/grants/FKs and repeat idempotency were exercised.

Files are private JPEG/PNG/PDF up to8MiB, immutable verified local FS bytes with fresh post-I/O authority and safe retry across separate FS/PG commit boundaries; private orphans may remain. Production S3/AV/backups/orphan operations are deferred. Source/confirmed exact-ms values and revision history are separate; relevant late events stale approvals. XLSX requires every recorded row in a <=31day/10000row snapshot to be current approved; one missing/stale/revoked day blocks export. Locks release before rendering, current authority is checked afterward, captured hash/revision/time remain attributable. Current approval commands are director-only; full matrix is04.

Parent started API4327 from7b3610a (Node49890/session83065), retained PG54339. Live health/spec69, login/me, evidence list, empty-day/history, actual empty XLSX, strict-query400, unauthenticated401 and logout smoke passed; downloaded OOXML independently parsed. No UI/main/merge/deploy or full-pilot claim. Remaining03c client queue/phones,04 quality/materials/routes/ID/AOSR and05 operational acceptance stay pending.

##03c1 independent verification and closure — 2026-11-10

The03b runtime note above is historical: this slice did not restart parent API4327. Quick261110-01w completed all three sequential tasks at source4d5f5dc. Added only dependency-free `packages/offline` and `docs/offline-queue.md`; no API/SQL/OpenAPI/UI/root dependency or lockfile changes. Native IndexedDB commits events plus actual Blobs atomically, binds audience/tenant/actor/session generations and authEpoch, coordinates tabs via Web Locks and preserves immutable employee stream versions/IDs/payloads across retries. Private evidence stages reserve→raw upload→attachment resume with exact identities. Explicit states and bounded retries/capacity/acknowledged cleanup; no pending-delete or automatic stale-version rebase.

Final full sequential gate200/200 = retained domain10/API120 + browser70 (Chromium35/WebKit35), no skips. Independently initial full194/194, then unchanged public G1 probe and active evidence24/24 after correction; verifier passed6/6. G1 found mutable caller evidence metadata/array crossing async authoring; synchronous owned snapshots now precede every await, with six active native reopen regressions. Two WebKit findings are separately documented: fresh byte-identical Blob copies and carrying the current Blob after IDB state writes fix actual stage failures; global Playwright offline emulation breaks native Blob/FileReader without the module, so real tests abort actual API network requests and explicitly do not claim physical airplane-mode testing. Real Nest/PG tests inspect original payloads/versions/segments/receipts/audits/exact bindings and download SHA after committed-response loss, stale and revoked/expired authority. Test fixtures and owned processes are cleaned; retained PG54339 last observed PID65500.

API/offline/fixture/typed-adapter compilers pass. Plain domainTS2688 remains, explicit existing typeRoots fallback passes. Use `--config.verifyDepsBeforeRun=false` to avoid the installed pnpm store-verification attempt and `-r --workspace-concurrency=1 --if-present test` to serialize old full-table migration snapshots against new fixture writes. No install/config workaround was applied. Storage clearing/eviction/device loss is not guaranteed against; no same-origin encryption or background delivery claim. The module is not yet consumed by Cursor UI; legacy localStorage/SW remain unchanged/unsupported for managed events. Next03c2 integrates application UI/cache and validates physical Android/iPhone;04 and05 remain pending.

## Backend02b implementation checkpoint — 2026-11-09

Quick261109-cdb Task1 completed at c7b119d (RED7d361f0): project catalogs, strict durable managed drafts, worker preparation isolation, additive Task response schema. Actual tasks9/9, unchanged people14/14, prior director9/9 and foundation3/3 passed; API tsc/diff-check exit0;005 migration and exact ledger/data repeat verified on PG54339 `.data/pg-54339`. PG process retained; API4327 was not restarted. SUMMARY status incomplete: Task2 front/readiness/lifecycle/publication/snapshots/races and Task3 legacy write fences/full contract/docs/regression still pending. No complete02b/pilot or independent-verifier claim.

## Backend02b implementation checkpoints2/3 — 2026-11-09

All three quick261109-cdb implementation tasks are complete. Task2 RED127d300/GREENb1b2c68 adds006 immutable front versions/attempts/publication, approval lifecycle, same-client personnel eligibility plus future workDate gate, ordered fresh ACL locks and serialized cross-project overlap. Tasks22/22 twice + unchanged people14/14 and API tsc passed. Task3 RED24dfb31/GREENf2d63e2 retires legacy create410, fences all managed execution before receipt replay/effects, preserves explicit legacy foundation rollback/job/replay assertions, and delivers53-operation OpenAPI (52v1 +1 deprecated create) and current docs. Final full pnpm test domain10/API51 and repeated tasks25 pass; API tsc/migration repeat/diff-check exit0. Planned plain domain tsc fails TS2688 due existing missing local types/node resolution; explicit existing-typeRoots fallback `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` passes without dependency/config changes. SUMMARY records exact deviation/races/rollback/grants/evidence.

Independent verification subsequently passed6/6; GSD verification.status=passed. Verifier independently repeated full domain10/API51, tasks25, API tsc and domain explicit-typeRoots fallback. Plain-domain failure and lack of independent fresh005/006 application are explicit limits. Parent started API4327 from verified source and live-smoked the new contract/read routes and retired create. Single-employee plans, yes/no front checks and RD metadata only; required material/ID/predecessor dependencies block until phase04. No complete-pilot claim.


## Backend03a implementation checkpoints1–2 — 2026-11-09

Quick261109-nqz remains incomplete2/3. Task1 committed81d27f0 (managed execution atomic event tracer/schema/strict batch); Task2 committed5615f1f (fresh target role compatibility and archived-worker authority fixes, real PG-gated race/ACL/replay coverage). Planned affected regression56/56=execution17+people14+tasks25; final execution17+foundation3=20/20 and API tsc passed. Migration007 apply/repeat plus exact row/data repeat remain verified through retained tests. PG54339 PID43410 retained; API4327 not restarted. Parent owns independent certification/canonical Brain. Task3 scoped reads/exact civil day+DST totals/overview/OpenAPI58/docs/full regression remains pending; requirements not marked complete. SUMMARY status incomplete and planning/state uncommitted for continuation.


## Backend03a implementation checkpoint3 — 2026-11-09

All three quick261109-nqz implementation tasks are committed:81d27f0,5615f1f,cfcfcf2. Task3 adds four current-scoped paged reads, exact decimal-string civil-day/DST/asOf time and per-task totals, report occurred-day/unit grouping, separate managedExecution overview and strict58-operation contract/docs. Final full h03 regression domain10/API74, execution23 repeat, API tsc and domain explicit-typeRoots fallback passed; plain domain tsc retains existing TS2688. Old53 path inventory/assertions, foundation jobs/rollback/replay, people/task assertions and managed legacy fences retained. PG54339 PID43410 retained; API4327 not started. Independent verification, requirements certification, parent planning/Brain closure and any subsequent API restart are pending.03b queue/files/hours and04 acceptance remain unfinished; no complete03/pilot claim.

## Backend03a independent verification and runtime closure — 2026-11-09

The preceding dated checkpoint descriptions are historical. Independent verifier passed6/6 at source cfcfcf2: full domain10/API74, execution23 repeat, API tsc, explicit-typeRoots domain fallback and base diff-check. Plain domainTS2688 and lack of independent initial007 application remain explicit limits. The generic link detector misses semantic/.js imports; all four links were manually/runtime traced in VERIFICATION. PG restored through standard db:up only, with exact54339/data_directory checked before writes. Parent started API4327 and live-smoked health/OpenAPI58, execution reads/provisional overview and invalid-batch rejection. Source/worktree remains isolated; managed task plan/snapshots unchanged and legacy execution fences retained. Remaining03b/04/05 work is not certified by03a.
