---
phase: 03a-managed-execution
plan: 261109-nqz
verified: 2026-11-09T15:37:12Z
status: passed
score: 6/6 must-haves verified
source_base: 37eea55
source_head: cfcfcf258b6332046d7e448f7c7119f21a01a745
source_branch: codex-api
covered_files: [".planning/PROJECT.md", ".planning/REQUIREMENTS.md", ".planning/ROADMAP.md", ".planning/STATE.md", ".planning/quick/261109-nqz-managed-task-execution-shifts-downtime-v/261109-nqz-CONTEXT.md", ".planning/quick/261109-nqz-managed-task-execution-shifts-downtime-v/261109-nqz-PLAN-CHECK.md", ".planning/quick/261109-nqz-managed-task-execution-shifts-downtime-v/261109-nqz-PLAN.md", ".planning/quick/261109-nqz-managed-task-execution-shifts-downtime-v/261109-nqz-SUMMARY.md", "apps/api/openapi.json", "apps/api/sql/007_managed_execution.sql", "apps/api/src/api-input.ts", "apps/api/src/app.module.ts", "apps/api/src/auth.service.ts", "apps/api/src/db.ts", "apps/api/src/director-api.service.ts", "apps/api/src/durable-command.ts", "apps/api/src/execution-input.ts", "apps/api/src/execution-read.ts", "apps/api/src/execution.controller.ts", "apps/api/src/execution.service.ts", "apps/api/src/people.service.ts", "apps/api/src/task-input.ts", "apps/api/src/tasks.service.ts", "apps/api/src/workforce.service.ts", "apps/api/test/director-api.test.ts", "apps/api/test/execution-api.test.ts", "apps/api/test/foundation.test.ts", "apps/api/test/people-api.test.ts", "apps/api/test/tasks-api.test.ts", "docs/director-api.md"]
covered_digest: "v4:sha256:7dfd364b1390e2719733c054bb0df234ade5eade9fa0d70e3012c379dac42487"
behavior_unverified: 0
overrides_applied: 0
human_verification: []
decision_coverage:
  honored: 0
  total: 0
  not_honored: []
warnings:
  - "Plain domain tsc independently reproduces existing TS2688; the explicit existing-typeRoots fallback passes. Plain tsc is not passing."
  - "Independent verification observed installed007 and exact migration ledger/data repeat, not fresh initial007 application. Executor fresh-apply evidence is recorded separately in SUMMARY."
  - "Generic semantic verify.key-links reports0/4; manual import/call/SQL plus passing runtime tests establish4/4 links below."
deferred:
  - truth: "Browser durable offline queue, files/photos, devices, hour approval/Excel and physical-phone verification"
    addressed_in: "03b / remaining Phase03"
    evidence: "Locked CONTEXT outcome/boundaries and docs/director-api.md distinguish03a server protocol from03b."
  - truth: "Quality acceptance, routes/authority, materials/ID/AOSR and full pilot operations/security/acceptance"
    addressed_in: "Phases04/05"
    evidence: "ROADMAP04/05 and locked CONTEXT; managed submitted quantities remain provisional with acceptedQuantity null."
---

# Backend03a independent verification

**Result: passed, 6/6 behaviorally verified truths, no blocking implementation gaps.** This certifies the locked server execution slice only. It does not certify all Phase03, the phone/offline product, files, approved hours, quality acceptance or complete pilot readiness.

Verified in `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`, branch `codex-api`, HEAD `cfcfcf258b6332046d7e448f7c7119f21a01a745`, implementation comparison `37eea55..HEAD`. Initial verification; no previous nqz VERIFICATION existed. STATE/PROJECT/REQUIREMENTS/ROADMAP, CONTEXT, PLAN, PLAN-CHECK and SUMMARY were read. SUMMARY was treated as claims, independently traced to source/SQL/tests and executed behavior. No source/test edits, commits, agents, UI/main work, API restart or operations on54329/4317.

## Observable truths

| # | Locked truth | Result | Independent source and behavioral evidence |
|---|---|---|---|
| 1 | One employee has at most one open managed project shift across the tenant; contiguous idle/work/break/downtime segments separate presence from productive task time. | VERIFIED | SQL007 lines2–41: employee stream, global partial open-shift uniqueness, scoped open-segment uniqueness, chronology/mode/task checks. `execution.service.ts:117–148` locks employee stream, rejects prior interval times and any cross-project open shift, opens idle and atomically closes/opens half-open segments. Actual tracer/lifecycle, SQL uniqueness, chronology and queued cross-project-start tests pass twice. Zero-length transitions remain explicit and productive work is never copied from whole shift duration. |
| 2 | Ordered bounded event batches preserve successful independent items; exact retries return original results after current authority checks, and failures consume no version, receipt or domain effects. | VERIFIED | `execution-input.ts:15–35` validates all union shapes, unknown/nested keys,1–50 bound and normalized duplicate IDs before transactions. `execution.service.ts:64–74,111–119,151–159` performs sequential separate `withTenant` transactions, shared receipt reservation, authority-before-replay, same actor/employee/project committed event dependency, exact version and atomic event/domain/audit/receipt writes. Strict malformed-body, partial independent success, missing predecessor→same-payload retry, changed command and real simultaneous receipt/device tests pass. Injected audit failure occurs AFTER domain/stream/event writes and proves exact rows/version/event/audit/receipt rollback followed by one successful exact retry. |
| 3 | Work and final submitted volume require current own published managed task, assignment, exact admission/evidence and workDate qualifications; current authorized managers can close existing time after assignee invalidation. | VERIFIED | `execution.service.ts:87–109,125–148` separates current actor authority from business eligibility; same PoolClient `people.eligibility` at102 includes current tenant-civil evidence and inclusive workDate validity (`people.service.ts:193–214`). Published managed workflow, assignee/project, active assignment and current linked target membership are enforced for work/report. Linked nonworker targets retain existing compatibility. Report requires ended shift, event>=end, positive CLOSED task work and single immutable task/shift final total; SQL numeric(14,3)>0/unique plus null accepted response. Actual authority/foreign/draft/pending/cancelled/legacy/task-assignee, qualification version/revoke/expiry/template/latest failed admission/workDate gates, terminal/report uniqueness, worker switch-out/end and director/granted-master archived+revoked cleanup tests pass twice. Manager reason/actor retained in audit; revoked worker is denied. |
| 4 | Client event time and server receipt time remain distinct; chronology, cross-project exclusion and current authorization survive real PostgreSQL lock waits and concurrent devices. | VERIFIED | `execution.service.ts:13–16,76–94,113–123,152–157` preserves original instant/offset payload, records server clock separately, uses exact >24h/>5min thresholds and project→employee→sorted current memberships→project memberships→stream/shift/task/assignment NO KEY UPDATE locks. Link read occurs AFTER employee wait; fresh role/status/grant read AFTER membership waits. Shared FK KEY SHARE compatibility retained; no second project acquisition or nested eligibility command. Tests219–272/342–402 observe recursive `pg_blocking_pids` before release/mutation;10ms polling only waits for actual lock graph. Current role/grant/link/archive/business invalidations, same receipt/version devices, cross-project starts and real publication/archive in BOTH orderings all pass without deadlocks. Pure threshold-boundary test plus HTTP raw payload/receivedAt assertions pass. |
| 5 | Scoped paged reads and tenant-civil day/DST totals expose exact provisional time and submitted quantities without acceptance, duplicated legacy data or changes to published task plan state. | VERIFIED | Four registered GET handlers (`execution.controller.ts:14–21`), fresh scope on every SQL (`execution-read.ts:6–12`), strict query/page parsing and deterministic timestamp+UUID ordering. Worker current own active link/project grant/assignment; director tenant-wide; master/PTO current project grant. `execution-read.ts:13–37` validates pg_timezone_names, computes each civil boundary independently, clips all modes by min(end,asOf,dayEnd), uses exact PostgreSQL integer epoch-ms and decimal strings, separates task work/downtime and quantity units. Report day is joined event occurred_at. Actual reads/current revocations/pages, Kathmandu midnight1ms/zero/empty/preinterval, NewYork23h/25h and fixed/default/open/future asOf tests pass twice. Historical CLOSED intervals have exact expected totals. Mixed legacy/managed counts and two-unit maximal decimal totals pass; full task response and publication snapshot remain unchanged. |
| 6 | Actual HTTP/PG tests prove atomic ledger/receipt/audit/version behavior, RLS/grants/FKs and old business assertions; OpenAPI documents complete03a protocol while03b/04 remain pending. | VERIFIED | SQL007 lines42–91: immutable ledger/report grants, tenant/scoped composite FKs, stream-version/report uniqueness, FORCE RLS and narrow column ending/version updates, no app DELETE. Actual restricted-role SQL probes pass. Full independent domain10/API74 and execution23 repeat pass (no skipped/todo tests). Old foundation3 assertions/people14/task25/director9 remain; diffs only add contract counts/names in old tests, no removed assertion. Runtime OpenAPI58 checks preserve exact53-operation inventory, strict input union, response shapes, unique IDs and resolvable refs; independent JSON comparison confirms old operations byte-equivalent as JSON and only additive old Overview schema change. Docs232–279 cover copyable UUID/version chain, retry/dependency/conflict retention, authority/cleanup/timing, terminal provisional volume, exact reads and03b/04 limits. |

Score6/6; present-but-behavior-unverified0; overrides0. None of the six truths relies solely on grep or artifact existence.

## Artifacts, wiring and data flow

GSD `verify.artifacts` returns5/5 for SQL007, service, controller, execution tests and OpenAPI. All have substantive production behavior and pass actual wiring through Nest `AppModule` registration/provider injection (`app.module.ts:108–117`). `execution-input.ts` and `execution-read.ts` are also covered, including the helper added beyond the initial artifact list.

GSD generic `verify.key-links` reports0/4 with “Target not referenced in source”. This scanner does not resolve the declared semantic links and TypeScript `.js` imports; it is not reported as passing. All four are independently WIRED:

| Link | Manual and executed evidence |
|---|---|
| Controller→service | Imports/injects ExecutionService; guarded `actorOf(r)` and unknown body→`ingest`, strict syntax validates before transactional per-item accept. Four reads call corresponding service functions. In-process Nest HTTP tests reach real writes/read queries. |
| Service→durable-command | Direct imports at service7, actual `reserveCommand`113/`replayCommand`115/`completeCommand`158; unchanged shared canonical hash and `(tenant,actor,requestId)` table namespace.25 real people/task operation-family probes include actual admission-check path; reverse receipt reuse and nonexecution dependency both reject. |
| Service→people evaluator | Existing injected PeopleService and exact same PoolClient at102→`eligibility`; public evaluator remains read-only, no project reacquisition/private publication readiness. Newer real failed admission command and qualification/task invalidation races prove this path. Existing people/task suites pass. |
| Overview→SQL007 data | DirectorApiService1/154→managedOverview→real scoped managed_shifts/segments/reports/events queries at helper30–37; report date from event occurred_at, numeric sums GROUP BY unit. Actual mixed source/day/two-unit assertions prove flowing values rather than static counters. |

Migration loader discovers007 via existing runner. Managed tables are the real sources throughout controller→service/helper→tenant transaction→SQL, with event/audit/shared receipt persisted atomically. Legacy overview shift/report/quantity sources explicitly exclude managed tasks; tasksForDay retains its preexisting plan meaning. Execution does not update daily_tasks or publication snapshots; unchanged raw snapshot/full response checks pass. Shared command helper, workforce fences and foundation tests are byte-unchanged from base.

## Independent executed evidence

Every migration/test/typecheck used this fresh-shell wrapper and the exact workdir above:

```sh
h03() { env DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios HELIOS_DB_PORT=54339 API_PORT=4327 "$@"; }
```

| Command | Observed result |
|---|---|
| `h03 corepack pnpm test` | Exit0; domain10/10, API74/74 (director9+execution23+foundation3+people14+tasks25); fail/cancelled/skipped/todo0. |
| `h03 corepack pnpm --filter @helios/api exec tsx --test --test-concurrency=1 test/execution-api.test.ts` | Independent repeated process exit0;23/23, fail/cancelled/skipped/todo0.22 exercise real HTTP/PG; one tests exact review thresholds directly. |
| `h03 corepack pnpm --filter @helios/api exec tsc --noEmit` | Passed, no diagnostics. |
| `h03 corepack pnpm --filter @helios/domain exec tsc --noEmit` | Fails existing TS2688: cannot find type definition for node. Explicitly not represented as passing. |
| `h03 corepack pnpm --filter @helios/domain exec tsc --noEmit --typeRoots ../../apps/api/node_modules/@types` | Passed, no diagnostics; no dependency/config change. |
| `git diff --check 37eea55` | Exit0. |
| Existing execution migration-repeat probe in each independent test process | Calls `corepack pnpm db:migrate` with all four explicit env values; schema_migrations contains007 once; exact entire ledger and all five managed table rows unchanged. |

Injected execution audit/task audit/publication errors in full output are expected asserted rollback probes, not failing tests. Tests create ephemeral in-process listeners and fixture-specific tenants; they do not start/restart API4327. Cleanup is scoped to those fixture tenants/users and removes injected trigger/function in finally. Anti-pattern scan found no skipped tests, test TODOs, unwired stubs, untracked debt markers or expected-fixture generation in the new files. Test evidence includes exact values and multi-step state/effect assertions, not status-only existence checks. Admin fixtures for historical DST timestamps exercise read aggregation independently of ingestion chronology; mutation/chronology is covered by separate HTTP lifecycle/race tests.

## Runtime, limits and decision coverage

Initial host-escalated read-only identity check found54339 refused and old PID43410 absent. Parent explicitly authorized restoration using only standard `h03 corepack pnpm db:up`. PostgreSQL18.6 recovered the existing persistent directory with no reset/manual pid deletion; current PID57602, retained tool session63684. Before fixture writes, independent SQL confirmed `current_database=helios`, `current_user=helios`, `inet_server_port=54339`, `data_directory=/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339`; lsof matched PID57602. API4327 had no listener and was never started. Parent owns subsequent runtime lifecycle/smoke and canonical Brain/planning closure.

Fresh initial007 application was not independently replayed into a second schema/database; this verifier observed installed definitions, constrained runtime behavior and exact repeat stability. Executor fresh application is recorded in SUMMARY, not rebranded as independently observed evidence. No destructive fresh/reset migration attempt was needed. The known plain-domain type resolution issue and semantic scanner limitation are tooling warnings, not hidden green checks.

GSD decision-coverage query returned skipped/no trackable decisions,0/0; CONTEXT uses numbered “Core decisions” rather than `<decisions>` syntax. Manual coverage maps decisions1→truth1,2/3→truth2,4/6→truth4,5→truth3,7→truth5,8→truth6. No new local project skills/rules discovered; configured gsd-verifier skills query emitted no entries.

Human verification required for this03a server contract: none. Future phone/browser flow, files/photos, hour approval, quality/authority/material/ID and full acceptance remain intentionally outside this contract. No complete phase03/pilot/quality-readiness claim is made.
