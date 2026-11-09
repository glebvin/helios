---
phase: 03a-managed-execution
plan: 261109-nqz
status: complete
independent_verification: pending
subsystem: api
tags: [postgresql, execution, receipts, shifts, provisional-volume]
plan_head_before: 37eea55b4c5ac86efc7bae98ef6ab9b0d4011599
plan_head_after: cfcfcf258b6332046d7e448f7c7119f21a01a745
commits: 3
actuals:
  tokens: 81806
  tasks: 3
  commits: 3
requires:
  - phase: 02b
    provides: Managed published plans, current people eligibility and shared durable commands
provides:
  - Task1 managed event ingestion, stream/shift/segment/event/report persistence and tracer verification
  - Task2 fresh authority, role compatibility, real PostgreSQL lock races, shared replay and cleanup verification
  - Task3 scoped paged reads, exact civil-day/DST provisional totals, additive overview and58-operation contract
affects: [03b-client-queue, 04-acceptance]
tech-stack:
  added: []
  patterns: [sequential-item-transactions, shared-receipt-namespace, ordered-no-key-update-locks]
key-files:
  created: [apps/api/sql/007_managed_execution.sql, apps/api/src/execution-input.ts, apps/api/src/execution.service.ts, apps/api/src/execution.controller.ts, apps/api/src/execution-read.ts, apps/api/test/execution-api.test.ts]
  modified: [apps/api/src/app.module.ts, apps/api/src/task-input.ts, apps/api/src/people.service.ts]
requirements-completed: []
updated: 2026-11-09
---

# Phase 03a Plan 261109-nqz: implementation complete; independent verification pending

All three implementation tasks are committed and executable at cfcfcf2. Parent independent verification and canonical memory closure remain pending. This is not complete phase03/pilot delivery. Earlier checkpoint evidence and pending lists below are historical; the final Task3 section supersedes them.

## Task commit and evidence

1. **Tracer: managed shift/event ledger through HTTP and PostgreSQL** — `81d27f0` (`feat`). Eight code/test/schema files, 421 insertions and3 deletions; no file deletions. Task2/3 were pending at the original Task1 checkpoint; the later Task2 commit is documented below.

The persisted GSD base ledger is `/Users/Gleb/Helios/.git/worktrees/codex-api/gsd-plan-head-before-03a-managed-execution-261109-nqz`. Its base is37eea55; measured `git rev-list --count 37eea55..HEAD` is1. Actual token-scale cost is ceil(51,419 realized diff characters/4)=12,855; this is not harness token usage. Planning files remain uncommitted for the parent, and STATE/ROADMAP/REQUIREMENTS remain unchanged.

## Delivered and tested

- Strict POST `/api/v1/execution/events` returns200 with ordered individual201 success/duplicate or error outcomes. It validates the whole1–50 batch before transactions, rejects duplicate UUIDs/unknown fields/invalid calendar/offset/precision/quantity/geo, and reuses the existing instant and exact quantity parsers.
- Each accepted event uses the unchanged shared `POST /execution/events` durable helper namespace, employee-wide stream version, immutable event payload/hash/client timestamp/server timestamp/review flags, atomic audit/receipt and separate project presence/segments. Equal-time transitions have zero duration. Reports do not move interval chronology.
- Shift start opens idle; changes and end atomically close contiguous intervals. One open tenant/employee shift and one open segment per shift are database constrained. A final report needs a closed shift and positive closed work on its task, permits over-plan provisional quantities with a review flag, and cannot append another final total for that task/shift. Accepted quantity remains null.
- Current project/employee and sorted membership/project-membership prerequisites use NO KEY UPDATE. A current link is reread only after the employee wait. Current role/project scope is checked before receipt replay; business admission is checked for start/work/report, while switching out/end does not require retained admission. `PeopleService.eligibility` adds an optional task workDate check in the same PoolClient without project reacquisition/private publication-readiness evaluation.
-007 uses FORCE RLS, tenant/project/employee/shift/task-assignee composite references, scoped report UUID/final-total uniqueness, no app DELETE, SELECT/INSERT-only event/report grants and narrow ending/stream-update grants. Legacy tables, managed legacy fences and published plans stay unchanged.
- Tests cover HTTP tracer+exact retries, all four event kinds and interval modes/zero edges, original payload/offset persistence, exact review thresholds, immutable final volume, whole-body prevalidation/partial outcomes, missing predecessor then retry, stale version/nonchronological interval/report timing, invalid task/downtime/work/report prerequisites, cleanup after assignment revoke, injected audit failure after domain+event writes with zero domain/version/event/audit/receipt effects, RLS/grants/composite references/open uniqueness and exact migration ledger/data repeat.

## Executed commands

All migration/test/typecheck commands used this fresh-shell wrapper, including explicit54339/4327 values (no default54329/4317):

```sh
h03() { env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 "$@"; }
```

- RED: `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts` failed on absent route404 after correcting the test fixture's existing submit/publish200 expectation. No RED commit; the implementation commit contains green tests.
- `h03 corepack pnpm db:migrate && h03 corepack pnpm db:migrate`: applied007 once, then `schema ready` with no application. The SQL test subsequently snapshots every schema_migrations row and all five execution tables, runs the existing migration runner and proves exact equality. No resets/ORM/migration rewrites.
- Expanded execution target passed7/7 before exact-threshold additions.
- Final affected regression: `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts test/people-api.test.ts test/tasks-api.test.ts` passed **47/47 = execution8 + unchanged people14 + unchanged tasks25**, zero skips/todos. Expected injected audit/publication errors were logged and asserted as successful rollback tests.
- `h03 corepack pnpm --filter @helios/api exec tsc --noEmit`: exit0. Initial union-narrowing compilation errors were fixed before commit; no dependencies/config changes.
- `git diff --check` and staged diff-check: exit0. Protected-branch assertion returnedfalse, branch assertion codex-api and expected source37eea55 passed immediately before commit. No tracked deletion or generated output remained.

## Runtime restoration / deviation

Initial host-escalated connection to54339 returned ECONNREFUSED; ports54339/4327 had no listener, while the existing postmaster file recorded89308. Parent explicitly authorized restoring the existing isolated DB via `h03 corepack pnpm db:up`. The standard script recovered the existing persistent directory itself (no manual pid removal/reset), started PostgreSQL18.6 as PID43410 in session33695, and reported ready. Read-only pg query then confirmed database/user helios/helios, port54339 and `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339` before fixture/migration writes. Leave this PG runtime running; API4327 was not started or restarted. Parent owns API action after independent verification.

This is a Rule3 runtime restoration within the authorized environment, not a feature/scope change. No new external tool/library APIs required research. No project-specific rules/skills were present; configured gsd-executor agent-skills query emitted no entries. Parent owns canonical Brain/session closure.

## Original Task1 handoff (historical; superseded by Task2 checkpoint below)

1. **Task2:** add actual HTTP/PG role/tenant/own/foreign-project negatives, current authority/cleanup/replay invalidation matrix and real observed row-gate races (`pg_blocking_pids`, no sleep as correctness evidence). Include queued simultaneous same receipt/version/cross-project starts; link/archive/assignment/qualification version+status+expiry/new admission/template/cancel races; publication/archive compatibility; all shared people/task request operation families including actual admission-check path; unrelated execution dependency rejection. Existing locks/authority/admission implementation is a starting point, not race certification. Extend fixture child cleanup if adding execution rows to older fixture tenants. Verify planned three-file suite and API tsc, then commit Task2 separately.
2. **Task3:** implement the four fresh scoped paged read routes, own worker assignment scope, real exact civil-day/DST/open-asOf integer-ms strings and per-task totals, submitted report day semantics and unit groups, additive managed overview without legacy duplication,58-operation OpenAPI and full protocol docs. Current OpenAPI remains53 and has not yet documented the new POST. No task executionStatus field was added. Preserve old assertions and run full domain/API regression, API tsc, existing-typeRoots domain fallback, execution repeat and diff-check before commit.
3. Parent independent verifier must trace all truths to implementation/SQL/test evidence before live API restart or certification. Later03b remains browser queue/files/photos/device/hour approval;04 remains quality/acceptance/material/ID. Do not mark API-01/ACL-01/DATA-01/TEST-01/DEV-01 complete based solely on this tracer checkpoint.

## Known limitations

No new stub/TODO/placeholder was found in the Task1 files. Unimplemented planned Task2 verification and Task3 routes/contracts are explicit pending scope, not claimed as shipped. Full `pnpm test` and domain typechecks have not run in this checkpoint; planned full regression belongs to Task3. The prior plain-domain TS2688 issue remains unchanged; use the exact existing typeRoots fallback in PLAN without dependency repair. No user approval/auth gate arose; host escalation was used for local PG/HTTP/git administration.

## Self-Check: PASSED (Task1 checkpoint only)

All five created source/schema/test files and the three modified source files exist. Commit81d27f0 is HEAD and an ancestor of HEAD, implementation working tree is clean, no tracked deletion occurred, and only the task's local planning directory is untracked. Base/head/count are measured from git and the persisted ledger. This SUMMARY remains status incomplete until Tasks2/3 and final verification are complete.


## Task2 checkpoint — 2026-11-09

2. **Prove fresh authority, shared replay and lock safety under real races** — `5615f1fd27e08317bea75f73436db7d0ff7b5980` (`fix(03a-261109-nqz): prove current execution authority and lock safety`). Two files: execution service and execution test;273 insertions and8 line replacements, no deleted files or removed assertions. Current base37eea55→HEAD count2. Total realized diff82,488 characters, ceil(/4)=20,622 token-scale cost; not harness token usage.

### Correctness fixes and evidence

- Removed target-role overrestriction: an employee linked to any active tenant member is admissible, consistent with existing people assignment/publication. A linked worker additionally requires active project membership. Actual linked master and director start/end succeed under authorized director recording; a linked master without project grant still cannot act. Actor permissions were not widened.
- An archived employee cannot continue as worker actor even if its link survives archive. Director/granted master cleanup remains independent of target assignment/admission/link/tenant membership; actual manager end and exact replay succeed while target is archived, assignment revoked, template outdated and target tenant membership revoked, with actor/reason retained in audit. Worker switch-out/end after revoked qualification and cancelled task succeeds while current worker authority remains active.
- Nine new execution tests extend8→17. Actual HTTP/PG negative scope includes real second-tenant project/employee rows, outsider/PTO, non-own employee, manager reason, foreign/absent references, ungranted projects, legacy/draft/pending/cancelled/other-assignee task work.
- Race gates explicitly query recursive `pg_blocking_pids` before mutation/release. Tests assert unchanged execution rows plus exact prior receipt/audit/event effects on denial. Fresh worker role/status, project grant, employee link/archive and master project grant are rechecked after real membership/project/employee waits. Business gates cover start assignment, work assignment/template/newer failed real admission command/qualification version/revoke/expiry/workDate/task cancellation/linked tenant status, plus final report qualification version/cancellation.
- Same receipt, separate same-version devices and cross-project starts queue behind an observed employee gate; exactly one stream increment/open shift results, with exact duplicate original result or stale-version loser. Actual publication and start share project/employee locks in both orderings; actual people archive and start share employee locks in both orderings, with successful manager cleanup when archive follows start. No deadlock occurred.
-25 real HTTP mutation operation-family probes cover both people and tasks, including actual `POST /employees/{id}/admission-checks` with project in payload, every task lifecycle action and create/update families. Reusing an execution receipt conflicts and preserves original row. Every existing fixture people/task receipt rejects reverse reuse by execution and cannot satisfy execution dependency; execution predecessors belonging to another actor/project also fail. No alternate command alias or copied authority evaluator was added.
- Task1 strict syntax/quantity/ordering/dependency/partial-batch/post-ledger rollback/RLS/FK/immutable ledger/grants/migration-repeat assertions remain; base task full response and complete publication snapshot rows remain exactly unchanged after execution/races. Existing people/task tests are unchanged, including legacy managed fences, and foundation assertions passed.

### Commands and results

Every migrate/test/typecheck invocation used the fresh-shell h03 wrapper above, explicit54339/4327. Read-only host PG identity was helios/helios, inet port54339, exact `.data/pg-54339`; PostgreSQL43410 retained, API4327 not started.

- Expanded execution target14/14 passed, then16/16 passed while adding final coverage.
- Planned three-file regression: `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts test/people-api.test.ts test/tasks-api.test.ts` — **56/56 = execution17 + people14 + tasks25**, no skips/todos. Expected injected audit errors are asserted rollback outcomes.
- Final focused verification after adding revoked-target manager cleanup: `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts test/foundation.test.ts` — **20/20 = execution17 + unchanged foundation3**, no skips/todos.
- `h03 corepack pnpm --filter @helios/api exec tsc --noEmit` — exit0. It initially found only test helper UUID-default inference; explicit string parameter annotations corrected this without changing runtime behavior/config/dependencies.
- Two new-test harness issues were corrected before commit: denied replay must preserve existing1/1/1 effects, and reopen follows pending state (the test now resubmits between reject/reopen). Neither required production changes. Full planned56 passed after these corrections.
- `git diff --check`, staged diff-check, branch codex-api, protected=false, expected81d27f0/source37eea55/toplevel assertions passed. Missing GSD spawn sentinel was created at this existing linked worktree's git admin directory before commit; no stage/commit occurred before that identity guard passed. Explicit owner/orchestrator codex-api branch instruction takes precedence over generic agent-branch naming.

### Current resume point: Task3 only

Implement the four scoped paged GET routes, real tenant-civil/DST/day/open-asOf exact time totals and report submission-day/unit-group semantics, additive overview without legacy duplication,58-operation OpenAPI, protocol docs and full domain/API regression exactly as PLAN Task3. No Task3 code or contract was started; OpenAPI remains53 and currently omits even the Task1 POST. Preserve all existing assertions and update operation-count assertions additively. No fixture cleanup changes outside execution were necessary because only execution fixtures create managed rows.

Planning/SUMMARY/STATE intentionally remain uncommitted for parent continuation. Requirements have not been marked complete. Final full suite/domain checks belong to Task3; independent verification and API restart remain parent-owned. This remains incomplete03a, not complete03/pilot certification.

### Self-check: PASSED (Tasks1–2 checkpoint only)

Both implementation commits exist, HEAD5615f1f descends from81d27f0 and original37eea55, implementation tree is clean, no file deletions occurred. Only local planning files remain uncommitted. Task3 remains outstanding.


## Task3 checkpoint — scoped reads, exact totals, contract and full regression

**Commit:** `cfcfcf258b6332046d7e448f7c7119f21a01a745` — `feat(03a-261109-nqz): expose scoped execution totals and contract`. All3 implementation tasks complete; independent verification pending,03b/04 unfinished. No optional task executionStatus was added and published/cancelled plan/snapshots remain unchanged.

### Delivered

- Four project-scoped GETs: shifts (employee filter), shift segments, reports (employee/task/submission day filters), and employee/day (required day, optional strict asOf). First three have deterministic ascending time+UUID pages, default25/max100 and strict query keys. Current SQL membership/link/grant/worker assignment checks apply to every data query; cached Guard role is not new-read authority. Worker own only, director tenant-wide, master/PTO granted projects. Shift/day versions reflect the employee-wide stream without exposing other-project records. Shift startEvent/endEvent and reports retain visible occurredAt/receivedAt/reviewFlags; timestamps are client assertions.
- Small shared execution-read.ts contains the scoped SQL, clock and exact aggregates reused by reads/overview. Time stays integer PostgreSQL epoch milliseconds and decimal strings; no float duration/quantity arithmetic, per-task work/downtime, presence=sum all four modes. Each civil boundary is computed independently AT TIME ZONE validated pg_timezone_names. Open/closed intervals clip by asOf and day, with explicit source/provisional/asOf/hasOpenIntervals. Default clock is truncated to milliseconds, future asOf400, invalid timezone422; empty/pre-interval/zero edges return0.
- Report day/source is managed_execution_events.occurred_at in tenant timezone, independently of shift day/receipt date. Additive overview.managedExecution has current open/start/report counts, exact time/per-task totals and quantities grouped only by unit. Legacy top-level shift/report queries explicitly exclude managed tasks; tasksForDay retains prior all-plan meaning. No managed rows are copied into legacy tables. Quality/ID/legacy downtime capability remains unavailable.
- Strict OpenAPI58 = exact original53 method/path pairs + POST + four GETs. All old paths remain byte-equivalent JSON data; only old Overview schema changes additively. Seven exact strict input forms, bounded batch/nested geo, per-item success/duplicate/error, result/read/page/time schemas and protocol descriptions cover current authority, replay/dependency/version/cleanup, timing/flags, terminal report and provisional limits. Sum output allows grouped decimals above individual numeric(14,3) capacity. Docs include copyable UUID/version chain, failed predecessor retry, retaining failed/pending items and visible conflict resolution;03b client queue/files and04 acceptance remain explicit.
- Six new HTTP/PG tests retain17 existing execution tests: scoped reads/pages/current link+assignment+grants, exact Kathmandu civil-midnight1ms work/downtime/break/zero edges, NewYork23h/25h DST/open/default/fixed/preinterval/future asOf/invalid timezone, report submission day and mixed legacy+managed source counting, strict58 inventory/actual response schemas/all refs/unique operationIds, and real two-task final reports with separate m2/m3 totals including99999999999.999. Existing people/task/director tests only update contract counts53→58; no assertion/inventory or legacy fence was removed.

### Verification on final implementation source

Every migrate/test/typecheck used the fresh-shell h03 wrapper above with54339/4327. Host read-only identity confirmed helios/helios/54339 and exact worktree .data/pg-54339. PostgreSQL43410 retained; API4327 was absent and was never started. Existing execution migration-repeat test preserves exact schema ledger and all managed data on every run; no new migration/reset was introduced in Task3.

- `h03 corepack pnpm test`: **domain10/10 + API74/74** (execution23 + director9 + foundation3 + people14 + tasks25), no skips/todos. Expected injected failure logs are assertions of rollback. Earlier full regression at execution22 also passed domain10/API73 before final added unit/mark coverage.
- `h03 corepack pnpm --filter @helios/api exec tsc --noEmit`: exit0.
- `h03 corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types`: exit0, without dependency/config changes.
- Final repeated `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts`: **23/23**, no skips/todos.
- Plain `h03 corepack pnpm --filter @helios/domain exec tsc --noEmit`: reproduced existing TS2688 (missing local types/node resolution); remains a known tooling limitation, not silently repaired or represented as passing.
- `git diff --check 37eea55`, staged diff-check, protected=false/current codex-api/toplevel/sentinel/exact5615f1f-before-commit/base-ledger assertions passed. No tracked deletions. Parent's explicit existing codex-api branch authorization governs this sequential executor.

### Corrections and remaining scope

Two new-read SQL harness/implementation mistakes were caught and corrected before final green: an extra parenthesis in project scope (scope now reused rather than duplicated), and reserved bare day aliases (explicit AS day). A mixed fixture initially tried nonexistent legacy report employee_id; the fixture was corrected to the existing schema. There were no changes to earlier mutation logic/locks, no extra API/dependency/UI/job, no scope waiver or dropped assertion. Shared helper is a local reuse implementation detail, not a new service/infrastructure.

All three implementation checkpoints are committed. Parent owns independent truth/lock/grant/receipt/source verification, planning docs commit, requirements/status certification and canonical Brain update before any API restart. Browser durable queue/device/files/hour approval03b and quality acceptance/material/ID04 remain pending; no full phase03/pilot claim.

### Final implementation self-check: PASSED

HEAD `cfcfcf258b6332046d7e448f7c7119f21a01a745`, original base37eea55, measured `git rev-list --count 37eea55..HEAD`=3. Token-scale metric ceil(realized diff characters/4)=81806; this is not harness token usage. Only parent-owned local planning files remain uncommitted.
