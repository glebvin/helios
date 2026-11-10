---
phase: 02b-task-preparation-publication
plan: 261109-cdb
status: complete
verification: pending-independent-verifier
completed_tasks: [1, 2, 3]
pending_tasks: []
source_base: e34ce8e
implementation_head: f2d63e2
---

# Backend02b — implementation complete, independent verification pending

All three planned implementation checkpoints are complete. Independent verification and the parent-controlled API4327 restart/smoke remain pending. This is not full pilot readiness. Task1 evidence below is preserved as historical checkpoint evidence; Task2/3 results follow.

## Commits

- `7d361f0` — `test(02b-261109-cdb): add failing catalog and draft preparation contract`.
- `c7b119d` — `feat(02b-261109-cdb): add project catalogs and durable scoped task drafts`.

Both commits contain implementation/tests only. Planning artifacts, this SUMMARY and STATE are left for parent. Worktree `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, branch `codex-api`, original expected base `e34ce8e`.

## Delivered checkpoint1

- Ledgered005 adds project-scoped zones/work types, composite references, managed plan/revision/lineage, row constraints, RLS, restricted catalog grants, immutable workflow marker and removal of app daily-task DELETE. Existing rows remain legacy with null managed fields; no invented intervals/admission.
- Strict inputs reject forged properties, numeric/exponent/overflow/excess-scale/zero quantities, malformed civil dates and RFC3339 instants, millisecond excess and invalid tenant timezone. Quantity normalization uses string manipulation. Server derives unit and verifies catalog, employee, responsible member and required RD metadata.
- Director catalog writes; assigned master/director draft creation/replacement; readonly PTO. Version and planRevision increment on plan edits. Ordered project→employee→membership→project-membership→task/assignment locks and separate fresh statements after waits; replay branch only project→actor memberships, never employee afterward.
- Shared small receipt reservation/hash/replay/completion helpers preserve PeopleService operation/hash/authorization behavior and global requestId namespace. Catalog concurrency/replay, people/task mismatch, failed-command rollback and post-insert audit-failure rollback proven.
- Extended v1 task reads/detail and managed response properties. Worker preparation rows/counts/shift/report identifiers are hidden in v1 list/detail/overview and legacy desk/summary; current-day test makes count assertions meaningful.
- Existing Task OpenAPI response schema gained additive nullable managed properties now so unchanged strict response-contract tests remain green. New routes/forms/full docs remain Task3.

## TDD evidence

Initial target `catalog receipt: director creates project catalogs with durable single effect` failed on HTTP404 versus planned201, with successful fixture/auth/cleanup. Complete actual TAP, real exit1, command and semantic assessment are in `task1-red.json`; original first run report is `task1-red.tap`. Installed GSD `check tdd-red-evidence` returned `RED_EVIDENCE_OK`, `passed:true`, target_test_failed. RED commit precedes GREEN.

A first GREEN run exposed missing status query wiring: actual old filter is `day`, although PLAN calls it workDate. Corrected by preserving `day` and adding workDate/status; using both date aliases is400. A later added fixture test had SQL `day` alias without AS; corrected fixture alias. No assertion was removed/weakened and no test disabled.

## Measured verification

Every migrate/test command explicitly exported:

```sh
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327
```

- Started `corepack pnpm db:up`; verified actual port54339 and data_directory exactly `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339` before mutation. PostgreSQL remains running in exec session34885.
- `corepack pnpm db:migrate` applied005; immediate repeat reported schema ready. Final task suite repeats migration and compares exact ledger plus fixture tasks/catalogs/receipts before/after, with no changes.
- Final `corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts`: **9/9 passed**, no skips.
- Unchanged `corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts`: **14/14 passed**, including existing races and30-operation contract.
- Broadened `corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/tasks-api.test.ts test/director-api.test.ts test/foundation.test.ts`: prior director **9/9**, foundation **3/3** passed; newly added task current-day fixture initially failed on the SQL alias. After that test-only correction, task suite **9/9 passed**. Prior suites were not repeated without relevant source change.
- `corepack pnpm --filter @helios/api exec tsc --noEmit`: exit0 after final changes.
- `git diff --check e34ce8e --`: exit0 after final changes.

Actual deterministic PG gate holds employee row NO KEY UPDATE, waits for the HTTP transaction using pg_blocking_pids, commits an actor tenant-membership revocation after Guard, releases employee and asserts403 plus zero receipt/audit. Polling has bounded timeout; gate releases in finally. Test also injects an audit trigger failure after task insert, asserts500 and zero task/receipt/audit effect, drops trigger/function in finally, then retries same requestId successfully. SQL probes assert foreign-project catalog FK23503, missing managed plan revision23514, immutable lineage23514, app DELETE42501, FORCE RLS and catalog DELETE denial.

Expected injected P0001 stack appears in successful task test output; it is the deliberate rollback probe, not an unresolved failure.

## Historical handoff before Task2 (now implemented below)

Read full PLAN publication_protocol and Task2 before changes. TasksService currently owns reusable private `command`, `projectLock`, `memberLocks`, `authorize`, `planLocks`, `validatePlan`, `audit`; extend these without reversing lock order. It currently injects only Pool/DirectorApiService; add PeopleService for same-client eligibility and expose only that documented internal evaluator/evidence operation. PeopleService eligibility remains private at this checkpoint.

No006/front tables, lifecycle routes, readiness evaluator or publication snapshot exist yet. Need all specified gates including current+future-workDate qualifications, fresh current linked member/responsible authority, latest failed front/template/catalog/revision, unsupported dependencies and cross-project interval serialization. Keep every specified deterministic race and rollback/immutability/replay assertion. Task test setup already creates employee/admission/template/assignment through02a. `waitBlocked` and admin restricted pools are available; test cleanup lists future tables but will need FK-aware snapshot cleanup when006 arrives.

Legacy create/sync/report mutation bypasses remain until Task3. Managed rows must not be presented as execution-ready now. Legacy fixture behavior is retained for foundation tests; these tests have not yet been changed to retired-create410. Full route/form OpenAPI, docs, domain/API full pnpm test, domain tsc, independent verifier and API4327 restart remain pending. API4327 was not restarted. No UI/main/dependencies/merge/deploy were touched; no PG54329/API4317 commands were run. No canonical Brain project update was made by executor.

## Task2 — front/readiness/lifecycle/publication

Commits: RED `127d300`, GREEN `b1b2c68`.

The target RED command, with the explicit isolated environment above, was `corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern='front lifecycle' test/tasks-api.test.ts`. Actual exit1: target `front lifecycle: immutable complete attempts and director-only atomic publication`, HTTP404 `Cannot POST .../front-template` versus201. Fixture/auth/cleanup succeeded. RED commit precedes implementation.

006 was applied only after actual PG port54339 and data_directory exactly `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339` were read and asserted. Immediate migration repeat returned schema ready. Front family/version/check/publication tables have composite scoped FKs, immutable history app grants and FORCE RLS. Deferred task→publication reference permits atomic insertion while history→task/front bindings remain scoped. Published plan/revision/lineage/reference are protected; cancellation retains snapshot.

TasksService adds director-controlled immutable front versions, complete server-evaluated immutable attempts, submit/reject/reopen/cancel/publish, current readiness diagnostics, ordered locks and atomic snapshot+task+audit+receipt. Exposed only the existing PeopleService same-client eligibility method with an explicit internal-call contract; old callers/evaluator behavior unchanged. Publication adds inclusive future workDate qualification validity to existing current-date/exact evidence checks. Snapshot includes full plan, exact quantity/revision, timezone, linked user/current memberships, assignment, current admission/check/evidence, front/catalog versions, responsible/current actor/time. Unsupported material/predecessor/ID flags block rather than certify missing modules. Overlap uses employee-serialized cross-project `[start,end)` predicates without second-project/task locks; adjacency succeeds.

Measured final Task2 gate: **tasks22/22 twice**, unchanged **people14/14**, API tsc and diff-check exit0. No skips/disabled assertions. The in-suite repeat compares exact ledger and persisted snapshot rows. Existing Task1 assertions remain. Task schema gained only additive nullable publicationSnapshotId at this checkpoint; full forms/routes are Task3.

Actual deterministic PG gates prove qualification revoke/version change, employee archive/link replacement, current assignment/admission template, actor role/status, linked membership/project membership and responsible role/project link changes after Guard cannot publish stale prerequisites. A two-tier employee-then-member wait proves post-member-wait fresh reads. Project-gated front/template/reopen and plan edit/submit queues assert valid version/state outcomes. A publisher already holding employee forces later qualification edit to wait and commits its original exact evidence first. Queue observations use bounded `pg_blocking_pids` checks, including transitive blockers; timers are only polling intervals, not ordering evidence. Cross-project overlapping publish returns exactly one200/one409 assignment_overlap; adjacent intervals return two200. Every publication failure helper asserts unchanged task/version/state/snapshot/shift/report and no command receipt/audit; Task3 extends state evidence with tenant jobs.

Post-write rollback injects an audit trigger failure after tentative publication snapshot/task writes: HTTP500 with unchanged task/snapshot count and zero receipt/audit; removing the fixture trigger then retrying the same requestId succeeds once. Concurrent exact publication replay returns identical body/status and one receipt/audit; later business invalidation/cancellation does not replace the original result, while current actor/scope revocation denies replay. Failed front attempts remain latest; plan/catalog/template changes invalidate readiness; malformed/duplicate/incomplete answers fail without effects. Inclusive expiry equal to workDate succeeds, later workDate fails although current admission is eligible. Immutable SQL UPDATE/DELETE permissions, plan trigger, RLS and snapshot stability after qualification/catalog edits are asserted.

The first GREEN006 run passed all10 business subtests but teardown failed because the new task↔snapshot FK cycle required a deferred cleanup transaction. Cleanup was corrected on one dedicated admin client with SET CONSTRAINTS ALL DEFERRED; all later repeats self-clean. The two exact residual tenant IDs from that initial run (`64528ce8-f539-4184-a6eb-8629f0f10118`, `20ca349c-9b8c-4b7e-a1c4-28c9b83a6194`) were identified by fixture-only `@tasks.test` members and removed with tenant-scoped deferred cleanup, preserving seeds/project data. First concurrent queue tests counted only direct blockers; the observed second waiter was blocked transitively by the first, so the bounded assertion was corrected to traverse the actual blocking graph. No business assertion was relaxed.

## Task3 — legacy fences, complete contract and regression

Commits: RED `24dfb31`, GREEN `f2d63e2`.

RED target command: `corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 --test-name-pattern='legacy create is retired' test/tasks-api.test.ts`, explicit same env. Actual exit1: HTTP422 reference_denied versus required410. The still-active legacy creator attempted its fixed-project insert and failed scoped reference validation; the retirement contract was absent. RED commit precedes GREEN.

Authenticated legacy create and direct service create now throw410 task_creation_retired. Managed lineage is checked before client-event replay/hash lookup and in every dispatch task mutation, report acceptance via report.task_id, and recordAndMaybeRollback. Missing/foreign task refs hide as404. All managed states, including published/cancelled and forged employee IDs, reject shift_start/shift_end/submit_volume/accept with409 workflow_not_supported before any effects. A fixture matching an already-stored event receipt proves it cannot replay around the fence. Tests assert no task/shift/report/event/pg-boss job/audit change; worker acceptance remains403 under existing role denial.

Foundation creates one explicit scoped legacy task and passes that exact ID to the rollback helper, removing nondeterministic LIMIT1. Its existing zero-job rollback, exactly-one report/job/effect on duplicate replay and foreign event403 assertions are retained. The old foreign-create probe now asserts410 as required; new v1 tests include a real foreign-tenant employee reference404 and zero durable effects. Cleanup is restricted to fixture tenant/task/report IDs.

OpenAPI **53 operations = 52 v1 (30 old +22 additive) + retired legacy POST /api/tasks**. All old operation/schema inventories and actual response assertions remain. Strict reusable catalog/task/lifecycle/front inputs, managed/legacy task shape, readiness/paged histories, publication result and persisted immutable snapshot schema are present; all references and unique operationIds are checked. New HTTP contract test matches exact forms, current task/front/catalog pages and a real persisted snapshot. Docs cover roles, complete forms/example, RD metadata-only meaning, current/future qualification gates, millisecond/offset/tenant-civil interval semantics, locks/replay/ordinary-GET consistency, worker preparation isolation, retired creation and managed legacy fences, and pending later modules.

## Final measured gate and deviation

All migration/test/typecheck commands used the explicit env recorded above. Actual PG54339/data_directory were asserted again before the final chain. Commands and outcomes:

- `corepack pnpm test`: **domain10/10 + API51/51** (director9 + foundation3 + people14 + tasks25), no skipped/disabled tests. Expected injected P0001 audit-failure stacks are deliberate rollback probes inside successful tests.
- `corepack pnpm --filter @helios/api exec tsc --noEmit`: exit0.
- Original planned `corepack pnpm --filter @helios/domain exec tsc --noEmit`: **exit1 TS2688**, cannot resolve types/node in packages/domain's install layout. This is an existing tooling-resolution issue, not a successful original command.
- Without dependency/config/source churn, `corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types`: **exit0**, using the already-installed @types/node symlink from API. This explicit command adjustment is the only final verification deviation.
- After that stop, resumed remaining chain: exact fallback above → repeated task suite **25/25** → `corepack pnpm db:migrate` **schema ready** → `git diff --check e34ce8e --` **exit0**. No source changes followed the full/repeat gates, only documentation of the tooling deviation and this planning evidence.

No new dependency, agent, branch or worktree was created. No apps/web/packages/ui/main/merge/deploy/PG54329/API4317 work occurred. Existing API4327 was not restarted. Parent retains canonical Brain project-state ownership and independent-verifier dispatch; planning artifacts/STATE are intentionally uncommitted by executor. Follow-up: independent source/PG/HTTP verification including the documented domain typeRoots adjustment, then parent-only API4327 restart/smoke. Execution/offline/files/quality/authority/material/ID/AOSR/hold points/multiple executors/norms/production acceptance remain pending, not certified by these slices.
