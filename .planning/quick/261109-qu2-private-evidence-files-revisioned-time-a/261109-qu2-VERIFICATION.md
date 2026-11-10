---
phase: 03b-server-evidence-time
plan: 261109-qu2
verified: 2026-11-09T20:53:31Z
status: passed
score: 6/6 must-haves verified
source_head: 7b3610a92c4fd6664349aab402d825ac71641f9a
source_base: 8294b79fffe5567b26362a675c6cf72200ee8193
behavior_unverified: 0
overrides_applied: 0
covered_files: [".planning/quick/261109-qu2-private-evidence-files-revisioned-time-a/261109-qu2-CONTEXT.md", ".planning/quick/261109-qu2-private-evidence-files-revisioned-time-a/261109-qu2-PLAN.md", ".planning/quick/261109-qu2-private-evidence-files-revisioned-time-a/261109-qu2-SUMMARY.md", "apps/api/openapi.json", "apps/api/package.json", "apps/api/sql/008_private_evidence.sql", "apps/api/sql/009_time_approvals.sql", "apps/api/src/app.module.ts", "apps/api/src/evidence-input.ts", "apps/api/src/evidence-storage.ts", "apps/api/src/evidence-time-scope.ts", "apps/api/src/evidence.controller.ts", "apps/api/src/evidence.service.ts", "apps/api/src/execution-read.ts", "apps/api/src/time-input.ts", "apps/api/src/time-source.ts", "apps/api/src/time-xlsx.ts", "apps/api/src/time.controller.ts", "apps/api/src/time.service.ts", "apps/api/test/contract-check.ts", "apps/api/test/director-api.test.ts", "apps/api/test/evidence-api.test.ts", "apps/api/test/execution-api.test.ts", "apps/api/test/inspect-time-xlsx.py", "apps/api/test/people-api.test.ts", "apps/api/test/tasks-api.test.ts", "apps/api/test/time-api.test.ts", "docs/director-api.md", "pnpm-lock.yaml"]
covered_digest: "v4:sha256:d44b1819c60138d9b948346ea5733885422348585a1e20e8a5e23093ec9113bf"
re_verification:
  previous_status: passed
  previous_score: 6/6
  gaps_closed: []
  gaps_remaining: []
  regressions: []
decision_coverage: {honored: 0, total: 0, not_honored: []}
deferred:
  - truth: "Durable browser queue, UI integration and physical Android/iPhone offline validation"
    addressed_in: "03c"
    evidence: "Locked CONTEXT and docs/director-api.md explicitly retain this work after03b-server."
  - truth: "Full authority matrix, quality inspections, materials and executive documents"
    addressed_in: "04"
    evidence: "ROADMAP04 and locked CONTEXT; initial director-only hour approval is explicit."
  - truth: "Production S3, AV, orphan operations, backups/restore, load and complete pilot acceptance"
    addressed_in: "05 / deployment"
    evidence: "ROADMAP05 and docs storage/acceptance boundaries."
---
# 03b-server — independent verification

**Result: passed, 6/6 locked truths.** Initially verified actual source and real HTTP/PostgreSQL/files/XLSX behavior at21626a0; narrowly re-verified the test-only isolation fix at7b3610a. This certifies the bounded server slice, not full Phase03 or the complete customer pilot. No overrides. Production source, SQL, contract and dependency files are unchanged by7b3610a.

The table-form ROADMAP states Phase03 as shifts/downtime/result/offline/files. It remains partial because03c is explicitly deferred. The generic `roadmap.get-phase 03` query returns `found:false` for this table format; the actual ROADMAP, REQUIREMENTS, CONTEXT and six PLAN truths were read directly. No whole-phase completion inferred.

## Observable truths

| # | Locked truth | Verdict | Concrete evidence |
|---|---|---|---|
| 1 | Authorized private reserve/upload/read/bind; cross-scope denial | VERIFIED | Six guarded routes are registered in AppModule; EvidenceService scope→receipt/metadata→raw storage→binding. Full run executes18 evidence tests, including actual JPEG/PNG/PDF bytes, tenant/project/own/master/PTO/archive/link/assignment denials, current ACL after PG waits and paused disk I/O. |
| 2 | Immutable verified bytes before ready; safe FS/PG crash retry | VERIFIED | evidence-storage.ts18–60 bounds stream and exact size/hash/magic; exclusive0600 temp, fsync, no-clobber hard-link, verification and directory sync; finally cleanup. evidence.service.ts53–65 releases initial transaction before I/O, then freshly scopes and commits ready/audit. Real failure injection covers write/file+directory sync/promotion, post-storage DB rollback, inode reuse and one ready audit; concurrent PUTs and missing/corrupt bytes fail closed. |
| 3 | Immutable exact source/confirmed approval/revoke;03a reported values preserved | VERIFIED | SQL009 immutable app grants and revision/head chain; time.service.ts55–89 serializes shared receipt→fresh scope→head, compares source/version, uses BigInt five-category totals, appends revision and audit. Default/correction/revoke/reapprove/history/replay/rollback and SQL-denial tests pass; overridden confirmedTaskAllocation is null. |
| 4 | Relevant-only stale hashes, civil DST and fresh authority | VERIFIED | time-source.ts18–52 uses shared SQL civil clipping, recorded zero markers, lifecycle replay ordered by numeric employee version, composite actor/request identity, relevant flags and clipped endpoints. No global stream version/capture clock in hash. Tests cover equal timestamps, actor collisions, carry-in flags, closed zero/open/future,23/25h and1ms-over, valid late events vs unrelated day/project/report, both arrival orders and real PG role/admin waits. |
| 5 | Coherent complete approved real XLSX, bounded rows, raw ms, safe typed text | VERIFIED | time.service.ts27–53 freezes project source, enumerates same recorded predicate, bounds10001, locks sorted employees/current memberships/heads, checks every row or fails409, releases before render and freshly authorizes afterward. time-xlsx.ts7–18 emits actual OOXML via pinned writer, String labels/raw ms, half-up6-decimal hours. Python zipfile/XML independently parses actual HTTP bytes, CRC/relationships/cell types/no formula nodes.28 time tests include10000-row download,10001-zero-row rejection, all missing/stale/revoked rows, malicious=,+,-,@ labels, paused-render ACL changes and source-after-capture attribution. |
| 6 | Additive contract/retained behavior and honest remaining scope | VERIFIED | Independent full130=domain10/API120,0fail/skip; all old58 operations and every old schema structurally identical to8294b79. Exact69 inventory/IDs/local refs, live new response/schema/MIME/header tests pass. Docs explicitly defer03c/04/production operational acceptance. No apps/web/packages/ui/main/runtime changes by verifier. |

## Required artifacts and wiring

All six declared artifacts exist, are substantive and are wired into runtime:

- SQL008 creates file/binding tables, FORCE RLS, narrow grants, immutable ready transition and exact scoped composite FKs. Event FK includes tenant/project/employee/shift/actor/request; repeated event requestId across actors cannot alias. SQL009 creates immutable revision chain/current pointer, scoped deferred FK and FORCE RLS. Both migrations are present in the real retained migration ledger; repeat tests preserve exact ledger and data.
- EvidenceStorage is injected via AppModule; EvidenceController delegates every route to EvidenceService. EvidenceService calls storage outside locked transactions and re-enters fresh scope before ready/binding/byte release.
- TimeSource is called by reads, approval and export; shared civilClipStart/End/Ms are also used by03a executionTotals. PostgreSQL results feed canonical attributed source and raw totals, not demo constants.
- TimeXlsx receives only the captured approved rows; HTTP controller returns its actual buffer and safe XLSX headers. Independent parser reads downloaded bytes, not writer inputs.
- time-api.test.ts is included by API `test/*.test.ts`, runs actual Nest on random ports against54339 and cleans its own fixtures.

Generic `verify.key-links` returned0/4 with “Target not referenced in source”. This is a scanner limitation with TypeScript source importing emitted `.js` names and semantic via descriptions; it is **not** counted as an automated pass. All four links were manually traced and behaviorally exercised:

| From → to | Runtime trace | Verdict |
|---|---|---|
| evidence.controller.ts → evidence.service.ts | Import line5, injected constructor11, actual reserve/PUT/download/attach calls12–17; real binary tracer | WIRED |
| evidence.service.ts → durable-command.ts | Import7, reserve/replay29–31 and84–86, complete/audit transactional effects; retry/collision/rollback tests | WIRED |
| time-source.ts → execution-read.ts | Import4, shared expressions15/23, exact03a-vs-approval DST comparison | WIRED |
| time.service.ts → time-xlsx.ts | Import10, instance15, awaited capture transaction27–49 then render50 and fresh scope51; paused-render tests prove lock release | WIRED |

Requirements API-01/ACL-01/DATA-01/TEST-01/DEV-01 are covered for this slice by actual routes, current scope, SQL-derived data, HTTP/PG tests and isolated runtime. Other pilot requirements remain open; no percentage of full product claimed.

## Independent commands and results

All test/typecheck commands used backend workdir and explicit environment:

```sh
h03b() {
  env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios \
    ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios \
    HELIOS_DB_PORT=54339 API_PORT=4327 "$@"
}
```

Before writes an independent admin query confirmed database=helios, user=helios, SQL port54339, data_directory=/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339. No DB reset, manual PID deletion, API4327 restart, UI process operation, merge or deploy.

| Command | Observed |
|---|---|
| `h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern='approval tracer: exact recorded source' test/time-api.test.ts` |1/1, exit0 |
| `h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern='XLSX captured snapshot remains attributable' test/time-api.test.ts` at7b3610a |1/1, exit0; independently rechecks the previously failing isolated scenario |
| `h03b corepack pnpm test` |130/130=domain10+API120;0fail/skip; API42.769s; exit0. Saved output /private/tmp/helios03b-independent-full.log |
| `h03b corepack pnpm --filter @helios/api exec tsc --noEmit` |exit0 |
| `h03b corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` |exit0 |
| `h03b corepack pnpm --filter @helios/domain exec tsc --noEmit` |exit1, pre-existing TS2688 missing local node types, separately reproduced; not reported green |
| Python parsed git-show old spec vs current spec | Every old path operation object and old schema structurally identical;69 current operations |
| `git diff --check 8294b79` |exit0 |

The complete suite was run once independently; its actual races/binaries/Excel scenarios supplied behavioral evidence, rather than repeatedly rerunning the workspace per truth. No source/test edits or commits made.

## Test quality and limitations

**Test isolation warning resolved at7b3610a.** At the original21626a0 checkpoint, the single filtered command below failed before exercising the intended race:

```sh
h03b corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 \
  --test-name-pattern='XLSX captured snapshot remains attributable' test/time-api.test.ts
```

Historical observation: TypeError `Cannot read properties of undefined (reading 'version')`, streamVersion at time-api.test.ts181, called from interval182 and target test313. The suite before-hook creates the primary employee stream; the otherEmployee stream/admission fixture used by this late-event scenario was established by earlier sequential tests. The original supported full run passed the race and asserted downloaded sourceHash/revision/raw ms/capturedAt plus subsequent409; the filtered failure was a test-maintenance issue, not a runtime XLSX defect.

Independent recheck of21626a0..7b3610a confirms exactly11 added lines in this test only. They create the stream if absent, assert the active employee/link, and obtain current assignment/admission through the actual API, creating the missing fixture only when necessary. Existing race/download assertions are unchanged. The exact filtered command now passes1/1,0fail/skip, exit0 in1.128s, including the actual event-after-capture and downloaded workbook assertions. SQL identity54339/data_directory was independently rechecked before fixture writes. No production edits or additional runtime behavior are introduced. Full130 was not repeated after this test-only change because production/SQL/contract/dependencies are identical and the specific failure is resolved directly; prior full130 evidence remains attributable to21626a0.

No disabled/skipped/todo tests or unresolved TODO/FIXME/XXX/TBD blockers were found in changed production SQL/source and new requirement-linked tests. Filesystem seam injection still executes the real adapter after restoration; PG races inspect actual blocking PIDs, not arbitrary sleeps. Expected DST/zero/category totals are explicit arithmetic; OOXML is parsed by independent Python stdlib. The10000-row fixture manually builds attributed source records and uses the production canonical serializer only to hash them; it spot-checks actual sources before bulk approvals, then compares all10000 independently parsed records. This validates boundary/export completeness; smaller tests separately exercise real approval commands.

Disconfirmation checks:
- Partial broader requirement: durable browser/physical-phone offline remains absent by locked03c boundary, not claimed here.
- Potentially misleading test found on first pass: individual filtered XLSX race depended on preceding fixture; exact historical failure is retained above and the independent isolated GREEN at7b3610a resolves it.
- Uncovered operational error class: actual OS crash/power-loss and physical device/browser lifecycle are not simulated by real storage-stage exceptions. These remain deployment/device acceptance, not certified by passing server tests.

Initial fresh application of008/009 was **not independently repeated on a new empty DB**. The retained DB already had both; independent full run exercised repeat migrations twice with exact ledger/data checks, app grants/RLS/FKs and runtime behavior. Executor initial-application evidence is historical evidence only.

No human-verification item remains inside the six locked03b-server truths. Physical Android/iPhone, client queue, S3/AV/orphan cleanup, backup/restore, production load/UX and complete customer acceptance are explicitly deferred; this report does not certify them. Pinned writer4.1.1/API-only lock change was inspected locally; no fresh registry/security audit performed by verifier.

### Decision Coverage

No trackable decisions in CONTEXT.md. Canonical gate returned skipped=true, total0, honored0, not_honored[]. Locked numbered boundaries were manually checked against shipped code/docs; no fuzzy gate count is substituted for that review.

## Closure

### Advisory (New Scope, Unevidenced)

None. This narrow re-verification found no new-scope concerns; no additional implementation requirement was introduced.

No blocking implementation gap observed. Status **passed** for03b-server at the fingerprint above. The baseline domain type-resolution limitation remains; the isolated-test warning is resolved. Parent owns STATE/ROADMAP, SUMMARY closure, canonical Brain, planning commit and any final API4327 smoke. Because SUMMARY is automatically fingerprint-covered, regenerate the canonical fingerprint after changing its completion status.


## Parent closure

After the independent source check and test-only recheck, parent updated SUMMARY and STATE to03b-server complete, retaining Phase03/03c/04/05 boundaries. Only the stale Phase03 roadmap status was corrected; it remains partial. Covered input fingerprint was refreshed for these summary metadata changes; no verified source was changed. API4327 was started from7b3610a, with live health/spec69/auth/evidence/day/history/header-only XLSX/strict-query/unauthenticated/logout smoke and independent downloaded OOXML parsing all passing. This smoke adds runtime evidence, not physical-phone or production acceptance.
