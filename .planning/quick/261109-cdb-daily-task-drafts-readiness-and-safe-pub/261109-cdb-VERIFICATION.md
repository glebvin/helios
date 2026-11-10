---
phase: 02b-task-preparation-publication
plan: 261109-cdb
verified: 2026-11-09T10:31:36Z
status: passed
score: 6/6 must-haves verified
source_base: e34ce8e
source_head: f2d63e22d79e18eb9741fd44b36476143b6d80e7
source_branch: codex-api
covered_files: [".planning/quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub/261109-cdb-PLAN.md", ".planning/quick/261109-cdb-daily-task-drafts-readiness-and-safe-pub/261109-cdb-SUMMARY.md", "apps/api/openapi.json", "apps/api/sql/005_task_preparation.sql", "apps/api/sql/006_task_publication.sql", "apps/api/src/app.module.ts", "apps/api/src/director-api.controller.ts", "apps/api/src/director-api.service.ts", "apps/api/src/durable-command.ts", "apps/api/src/people.service.ts", "apps/api/src/task-input.ts", "apps/api/src/tasks.controller.ts", "apps/api/src/tasks.service.ts", "apps/api/src/workforce.service.ts", "apps/api/test/director-api.test.ts", "apps/api/test/foundation.test.ts", "apps/api/test/people-api.test.ts", "apps/api/test/tasks-api.test.ts", "docs/director-api.md"]
covered_digest: "v4:sha256:714232d6d4ee13d86c5e2b17b6841a276b031f4d114ca3000a38c5b93fa1c758"
behavior_unverified: 0
overrides_applied: 0
human_verification: []
decision_coverage:
  honored: 0
  total: 0
  not_honored: []
warnings:
  - "Plain domain tsc fails TS2688 in the existing install layout; the explicit existing-typeRoots fallback passes. These are different results."
  - "Fresh application of 005/006 was not independently reproduced. This verification observed their installed schema and ledger and exercised repeat migration with unchanged ledger/data."
  - "Generic verify.key-links reports 0/5 because it does not resolve the declared semantic links/TypeScript .js imports. All five links were independently traced in code and runtime below."
deferred:
  - truth: "Validated managed-task shifts, reports, files and physical-phone offline execution"
    addressed_in: "Phase 03"
    evidence: "ROADMAP phase03: Shifts/downtime/result, offline concurrency and files; physical-phone verification remains an early pilot prerequisite."
  - truth: "Full quality, authority matrix, real material/ID/AOSR/hold-point readiness"
    addressed_in: "Phase 04"
    evidence: "ROADMAP phase04: Quality, routes/authority, materials/ID/AOSR; CONTEXT D-07 requires missing dependencies to block in02b."
  - truth: "Full reporting, operations/security/load and complete pilot acceptance"
    addressed_in: "Phase 05"
    evidence: "ROADMAP phase05: Full reporting/security/operations and acceptance."
---

# Backend02b verification

**Goal:** Task creation/readiness with admission enforcement: real daily-task preparation, versioned front readiness and safe director publication, preserving personnel02a behavior.

**Result:** Passed, 6/6 truths behaviorally verified for the scoped backend slice. Initial independent verification; no previous cdb VERIFICATION existed. SUMMARY was read as a claim inventory, then checked against actual implementation, SQL, prior-test diffs and fresh test processes. This does not certify complete pilot readiness.

**Scope:** `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, branch `codex-api`, source HEAD `f2d63e22d79e18eb9741fd44b36476143b6d80e7`, implementation comparison `e34ce8e..f2d63e2`. No source/test edits, commits, new agents, API4327 restart, UI/main changes, PG54329 or API4317 operations. Existing STATE and untracked quick-task artifacts were present before verification. Parent owns canonical project state and final runtime restart/smoke.

## Observable truths

| # | Truth from PLAN | Status | Independent evidence |
|---|---|---|---|
| 1 | Director maintains real project zones/work types and front template versions; director/master prepare a single-employee task in visible projects using exact quantities and valid tenant-civil planned intervals. | VERIFIED | `005` catalogs and scoped FKs; `task-input.ts` strict strings/booleans/calendar/instants; `TasksService.writeCatalog/writeTask/validatePlan/writeFrontTemplate`. Actual `catalog receipt`, `catalog scopes`, `draft`, `quantity interval`, `front lifecycle` and contract tests passed in full suite and repeat. Assertions include exact `12.340`, derived unit, version/revision, foreign references, malformed offsets/dates/precision, unsupported fields and invalid saved timezone. |
| 2 | Master submits draft for approval; only a current director publishes a pending task. Worker sees only own published managed tasks, PTO only reads assigned projects, and plan changes invalidate readiness. | VERIFIED | `TasksService.authorize/action`, `taskVisible` and reused legacy filtering. Runtime lifecycle/role tests, stale-plan front test, master-revocation gate, own-published worker response and current-day preparation count/shift/report hiding tests passed. Worker predicate explicitly excludes every managed status except `published`, including pending/cancelled. |
| 3 | Publication atomically rechecks current ACL, linked user, active employee assignment, current exact admission/evidence, qualifications on workDate, latest front attempt/template/plan revision and cross-project interval availability; dependency requirements without real modules block. | VERIFIED | Same-client `people.eligibility` at tasks service line211, existing evaluator lines192–213, additional inclusive workDate evidence check, latest front `ORDER BY sequence DESC` without passed filter, catalog/revision/template binding, explicit dependency reasons. Actual future-workDate test proves Jan17 denied / inclusive Jan16 allowed, exact qualification id/version persisted, renewal invalidates old evidence. Existing people latest-failed test also passed. Unsupported material/predecessor/ID and RD/current-catalog tests passed with zero failed-command effects. |
| 4 | Concurrent personnel/link/role/project membership/template/assignment edits cannot commit a publication based on stale prerequisites; overlapping publication yields at most one success, adjacent intervals both succeed. | VERIFIED | Actual deterministic PG tests `publication races`, `publication two-tier wait`, `front/template and plan lifecycle serialize`, `cross-project employee gate`, `draft plan replacement ... assignment edits wait` passed twice. Gates observe `pg_blocking_pids`, including two-tier waits/transitive queue, before invalidation/release. Employee serializes cross-project overlap; one200/one409 with losing receipt/snapshot absent; adjacent intervals two200. Opposite valid ordering blocks qualification writer until publication commits original evidence. |
| 5 | Published plan/evidence snapshots are immutable, and each durable successful command has one matching receipt/audit effect; exact replay reauthorizes current scope and changed operation/payload conflicts across people/task commands. | VERIFIED | SQL006 trigger, SELECT/INSERT-only history grants and scoped deferred snapshot FK; shared canonical operation+payload hash and existing `(tenant,actor,requestId)` receipt namespace. Runtime concurrent exact catalog/publication replay gives identical responses and one receipt/audit; changed payload and people→task namespace reuse conflict. Draft replay survives later catalog invalidation; revoked master scope denies completed replay, restored scope returns original body. Injected audit failures after task insert and after publication snapshot/task writes rollback all effects; same request retries successfully. Snapshot/grant/RLS/plan mutation probes passed. |
| 6 | Legacy create returns 410; managed tasks cannot start/end shifts, submit/accept reports or leak drafts through legacy reads; previous personnel and controlled legacy fixture tests retain their assertions. | VERIFIED | Service-level `createTask`410; `legacyTask` before event receipt lookup/hash and in dispatch/acceptance/test helper. Actual four-state managed fence test checks draft/pending/published/cancelled, forged employee IDs, preexisting shifts/reports and stored replay. Reports/shifts/events/audit/jobs/task state stay unchanged. Worker v1/legacy hiding tests passed. Prior people14, director9 and foundation3 all passed; their diffs preserve assertions except deliberate create410 and additive operation count53. |

**Score:** 6/6; 0 present-but-behavior-unverified truths, 0 overrides. No failed truth is being deferred to obtain this result.

## Required artifacts

| Artifact | Existence/substance/wiring | Evidence |
|---|---|---|
| `apps/api/sql/005_task_preparation.sql` | VERIFIED | Real catalogs, managed plan/revision/check constraints, tenant/project/responsible composite FKs, immutable workflow marker, overlap index, FORCE RLS and app daily-task DELETE revocation. Migration loader discovers numbered SQL; installed constraints/grants and ledger are exercised by runtime probes. |
| `apps/api/sql/006_task_publication.sql` | VERIFIED | Front family/version/check/publication tables, scoped task/template/front FKs, unique sequence/publication, deferred task→snapshot FK, published plan/reference trigger, immutable history privileges and FORCE RLS. Runtime publication writes and mutation-denial probes use these actual tables. Fresh initial application remains an explicit verification limit. |
| `apps/api/src/tasks.service.ts` | VERIFIED | 272 substantive lines; actual registered Nest provider/controller calls, strict draft/catalog/lifecycle/front/readiness/publication SQL, fresh auth and transactional snapshot/audit/receipt effects. |
| `apps/api/src/durable-command.ts` | VERIFIED | Canonical sorted-key hash, reservation, replay and completion used by both people and task services; unchanged people operation/hash behavior, no new write authority. |
| `apps/api/test/tasks-api.test.ts` | VERIFIED | 25 active actual HTTP/PG tests, real ephemeral listener, fixture-specific tenants, restricted/admin pools, deterministic PG gates and failure injection; all pass twice independently. |
| `apps/api/openapi.json` | VERIFIED | 53 unique operations:52 v1 plus deprecated `/api/tasks` create. Runtime inventories, exact checked-in spec equality, reference resolution, strict inputs, paginated responses, managed/front/publication evidence schemas all pass. |

Mechanical `query verify.artifacts` exit0:6/6. This is supplemental to the behavioral evidence, not the basis for accepting behavior.

## Key links

| From → to | Status | Concrete trace |
|---|---|---|
| TasksController → TasksService | WIRED | `tasks.controller.ts` imports `./tasks.service.js`, injects `TasksService`, applies TenantGuard/query guard and calls service methods; AppModule registers both. HTTP lifecycle tests reach SQL state. |
| TasksService → PeopleService | WIRED | Constructor dependency registered in AppModule; readiness calls `this.people.eligibility(c, employee, p, assignment.admissionCheckId)` using its transaction client. Existing evaluator remains unchanged apart from visibility/comment; workDate gate is additive in tasks service. |
| TasksService → SQL006 | WIRED | Concrete `front_template_versions`, `task_front_checks` and `task_publication_snapshots` queries/inserts plus task publication FK/trigger; successful HTTP publication and rollback/privilege tests exercise actual schema. SQL migration file is loaded by migrate.ts, not imported by service. |
| PeopleService → durable-command | WIRED | Explicit `./durable-command.js` imports and reserve/replay/complete calls replace the equivalent previous code; prior people suite and cross-operation receipt test pass. |
| WorkforceService → managed task model/read policy | WIRED | Uses immutable DB `workflow_kind` to fence before replay/effects and imports `taskVisible/taskJoin` from director-api.service; this semantic link does not require a TasksService import. All four managed-state fence tests and worker hiding tests pass. |

Mechanical `query verify.key-links` returned exit1,0/5, all with `Target not referenced in source`. The generic literal-reference detector does not resolve these semantic links or `.ts`→`.js` module imports. Its negative output is recorded; direct import/call/table traces plus actual HTTP/PG effects establish all five links. No NOT_WIRED implementation was silently accepted.

## Data-flow trace

| Data | Source → validation/evaluation → persistence → read/response | Status |
|---|---|---|
| Daily plan | HTTP strict task input → real tenant/project zone/type/employee/responsible/timezone validation → daily_tasks draft with server unit/revision → v1 detail/list and scoped overview | VERIFIED, exact value assertions |
| Front readiness | Immutable versioned template + complete boolean answers → server critical/warning calculation → immutable sequenced attempt tied to plan/catalog → front history/detail and latest readiness | VERIFIED, newer failed attempt defeats older pass |
| Admission | Current assignment.checkId → same-client exact latest personnel eligibility/current qualification evidence + workDate gate → publication evidence snapshot | VERIFIED, expiry/renewal and concurrent invalidation assertions |
| Publication | Locked current authority/employee/assignment/front/catalog → employee-serialized cross-project overlap → snapshot+published task+audit+receipt in one withTenant transaction → task with snapshotId and readiness | VERIFIED, rollback and concurrent success/failure assertions |
| Worker reads | Guard actor + active project/employee assignment → shared own-published predicate in v1/legacy queries → filtered rows/counts/associated shifts/reports | VERIFIED, hidden current-day preparation and visible own publication assertions |

No dummy constants feed the new task/readiness/publication data. Existing legacy summary sample fields are explicitly labeled as such; unavailable pilot metrics remain outside this scope.

## Lock, replay and SQL inspection

New task mutations reserve the shared receipt, lock only target project by tenant/id, read task hint without a lock, lock sorted old/new employee IDs, reread employee links, lock sorted tenant then project memberships, lock task, reread hint/version, and lock assignments last (`tasks.service.ts:34–46,81–96`). Fresh authorization and readiness queries run after all waits. A changed hint aborts409 rather than acquiring an earlier-tier lock late. No visibility join in the employee lock query supplies stale authority.

People archive/update paths retain employee→membership→assignment/crew order and do not acquire a project afterward. Qualification writes serialize on employee; admission/template/check/assignment and front/catalog commands serialize on project. Project membership changes use project→member. `FOR NO KEY UPDATE` remains compatible with implicit FK KEY SHARE. The overlap query reads other projects without locking their project/task rows, avoiding a cross-project lock cycle.

Replay takes only target project and fresh actor membership/project-membership locks and returns the stored body/status after current scope authorization. It does not proceed to employee locks or re-evaluate stale business prerequisites. Failed new reservations rollback with the command. Existing people authorization semantics were preserved; exposing eligibility does not expose a write endpoint or widen roles.

SQL005/006 retain existing project/assignee tenant constraints; new catalog references include tenant/project and responsible references tenant/user. SQL006 front→template and snapshot→task/front references are scoped composites. All six new tables have ENABLE and FORCE RLS with `app_tenant()` USING/WITH CHECK. Catalog app privileges are SELECT/INSERT/UPDATE; history app privileges SELECT/INSERT; only front family `version` is updatable. App cannot delete daily tasks. Published task trigger allows only status/version changes with published/cancelled status and preserves snapshot reference/plan. App mutation probes actually assert42501/23514/23503, not merely presence of SQL strings.

## Executed verification

All DB/HTTP commands below used exactly:

```sh
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327
```

Preflight directly queried `current_setting('port')` and `current_setting('data_directory')`, asserting54339 and `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339` before tests. Existing PostgreSQL was reused; no API restart. Suites bind ephemeral127.0.0.1 HTTP listeners and close them. Expected P0001 traces come from deliberate audit failure injection and accompany passing rollback assertions.

| Check | Actual command | Result |
|---|---|---|
| Full regression | `corepack pnpm test` | exit0; domain10/10, API51/51, 0 skipped/cancelled/todo |
| Repeated tasks/races | `corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts` | exit0;25/25, 0 skipped/cancelled/todo |
| API typecheck | `corepack pnpm --filter @helios/api exec tsc --noEmit` | exit0 |
| Plain domain typecheck | `corepack pnpm --filter @helios/domain exec tsc --noEmit` | **exit1, TS2688 Cannot find type definition file for node** |
| Existing-types domain fallback | `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` | exit0; uses already-installed API types, no dependency/config edits |
| Diff check | `git diff --check e34ce8e --` | exit0 |
| Migration repeat probes | Full and repeated tasks suite call `corepack pnpm db:migrate` against54339 | Ledger and relevant task/catalog/snapshot data exactly unchanged;005/006 ledger entries present |
| GSD artifacts | `query verify.artifacts .../261109-cdb-PLAN.md` | exit0,6/6 |
| GSD key links | `query verify.key-links .../261109-cdb-PLAN.md` | exit1,0/5 generic literal detection; manual/runtime link verification above |
| Fingerprint | `query verification.fingerprint <taskdir> <17 changed implementation paths>` | exit0; covered_files/digest copied verbatim into frontmatter |

Full output captured in `/private/tmp/helios-cdb-verifier-full.tap`; repeat output in `/private/tmp/helios-cdb-verifier-tasks-repeat.tap`. These temporary transcripts are supplementary; measured results and evidence mapping are preserved here.

### Probe execution

No standalone probe shell file is declared by this plan or present in scripts (only `scripts/db.mjs`). Required SQL, repeat-migration, injected-failure, restricted-role/RLS, stored-event-replay and blocking-race probes were actually executed through the named test suites, not taken from SUMMARY. Fresh migration of an empty pre005 database was not executed independently; no claim of fresh005/006 certification is made.

### Test quality audit

| Test file | Linked requirements | Active | Skipped | Circular expected output | Assertion level | Verdict |
|---|---|---:|---:|---|---|---|
| tasks-api.test.ts | API-01, ACL-01, DATA-01, TEST-01, DEV-01 | 25 | 0 | none | Behavioral, exact values and unchanged DB effects | PASS |
| people-api.test.ts | Preserved02a/ACL/DATA/TEST | 14 | 0 | none | Behavioral, evidence identity/version/rollback/races | PASS |
| director-api.test.ts | API-01, AUTH-01, ACL-01, DATA-01 | 9 | 0 | none | Scoped values, role/session behavior, additive contract | PASS |
| foundation.test.ts | Tenant isolation, transaction/jobs/replay | 3 | 0 | none | Rollback/job/duplicate-effect assertions | PASS |
| domain rules.test.ts | Existing domain rules | 10 | 0 | none | Exact domain values | PASS runtime; plain tsc warning above |

No `.skip`, `.todo`, `.only`, xit/xdescribe/xtest or circular expected-fixture writer was found in the new tests. Compared prior-test diffs against base: director/people operation count30→53 preserves inventories/schema assertions; retired cross-task create422→410 follows the explicit retirement contract. Foundation replaces obsolete create201 with a controlled explicit legacy fixture task ID; transactional rollback, no queued job on rollback, single report effect on repeated worker, and foreign-scope403 assertions remain. No test was weakened to bypass the managed workflow fence.

## Requirements coverage

| Requirement | Coverage and evidence | Status |
|---|---|---|
| API-01 | Versioned project task/detail/catalog/front/lifecycle endpoints, compatibility fields, exact checked-in53-operation contract; actual HTTP response/schema tests | VERIFIED for02b |
| ACL-01 | Tenant RLS/composite refs; role/project/own predicates; fresh mutation and replay authorization after actual waits | VERIFIED |
| DATA-01 | Real catalog/task/admission/front/publication SQL data; missing dependencies explicitly unready; unavailable later metrics remain documented | VERIFIED for02b |
| TEST-01 | Actual two-tenant/multi-project HTTP/PG suites, denied/malformed/foreign refs, deterministic blocking races, rollback/receipt/history assertions | VERIFIED |
| DEV-01 | Actual PG54339 directory/port assertion, explicit env, no forbidden runtime, repeat migration/data stability; API tsc and domain runtime green, plain domain tsc limitation explicit | VERIFIED within scope; tooling warning retained |
| AUTH-01 | Earlier authentication requirement retained by full regression; not a new02b claim | Preserved |

REQUIREMENTS has no additional per02b traceability IDs omitted by this plan. Subsequent-pilot requirements stay pending; no orphaned requirement was silently marked complete.

### Decision coverage

GSD decision-coverage query returned exit0, skipped=true, reason=`no trackable decisions`, total0/honored0: CONTEXT has prose bullets, not the structured decisions block recognized by that parser. This is not a claim that it checked all owner decisions. Manual review of the ten CONTEXT bullets and PLAN D-01…D-10 aliases found coverage in the corresponding catalogs/plan/roles/lifecycle/front/locks/dependency block/receipts/legacy fences/docs. Single employee, no invented norms, no UI changes and no full-pilot claim are preserved.

## Anti-patterns, limitations and deferred work

No task stubs, unresolved TBD/FIXME/XXX debt markers, client-trusted pass/status/evidence inputs, skipped requirement tests, placeholder new data or disconnected implemented endpoint was found. Three attempted disconfirmations were checked explicitly: stale authority after two waits, earlier passed front/admission defeating latest failed/evidence changes, and legacy stored-event replay bypassing managed lineage; code plus passing runtime probes reject them.

The plain domain `tsc --noEmit` failure is a real reproducible tooling warning, not a green check. Base→HEAD changes contain no domain/package/dependency/lockfile edits; the existing install layout lacks local node type resolution. The explicit fallback and domain runtime tests pass. This is recorded in task deferred-items/docs and does not establish a new02b business invariant failure.

Fresh005/006 installation has executor evidence but was not independently reproduced here. This verifier only certifies installed schema behavior and repeat migration. The generic link scanner limitation is separately recorded above; it does not replace code/runtime evidence.

Ordinary multi-statement READ COMMITTED GET totals/items/readiness remain advisory rather than an atomic snapshot. Cross-project overlap covers published managed tasks with real intervals, not legacy rows lacking intervals. The published evidence has a DB snapshot/schema and response snapshotId, without a separate public snapshot export endpoint. These are explicit contract limits.

Materials, predecessor acceptance, ID/AOSR and hold-point modules remain absent and required dependencies block publication. Single-employee tasks remain the supported model; crew/multiple-executor attribution is not implemented. Validated managed execution/offline/files, full authority matrix, complete quality/material process and full pilot/load/security acceptance stay in later roadmap phases. Parent-controlled API4327 restart/live smoke remains outside this source verification. None is being claimed complete.

## Human verification

N/A for the scoped infrastructure/API slice: all six must-haves have actual behavioral evidence. No human-needed item or unverified must-have is hidden by the infrastructure exemption. Physical-phone offline and full pilot acceptance remain later prerequisites, not acceptance of an implemented02b UI.

## Gaps summary

No blocking implementation gap found for the six locked02b truths. Status `passed` applies to source HEAD and fingerprint above, with the explicit plain-domain-typecheck and migration-evidence limits. It does not authorize a pilot completion claim, UI/main merge/deploy or managed legacy execution.

_Verifier: Codex, independent gsd-verifier. No implementation/test changes or commits._
