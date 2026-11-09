---
phase: 02a
plan: 01
verified: 2026-11-09T05:50:07Z
status: passed
score: 5/5 must-haves verified
source_head: f1717a46bab4e666a0a8d4c1ca178355d4724dd2
source_base: 22588a9289072eec0b7cd66fe0ba751b6894d503
branch: codex-api
covered_files:
  - .planning/quick/261109-bkb-people-qualifications-admission-checks-c/261109-bkb-CONTEXT.md
  - .planning/quick/261109-bkb-people-qualifications-admission-checks-c/261109-bkb-PLAN.md
  - .planning/quick/261109-bkb-people-qualifications-admission-checks-c/261109-bkb-SUMMARY.md
  - .planning/quick/261109-bkb-people-qualifications-admission-checks-c/PLAN-CHECK.md
  - apps/api/openapi.json
  - apps/api/sql/003_people_admission.sql
  - apps/api/sql/004_admission_crews.sql
  - apps/api/src/app.module.ts
  - apps/api/src/auth.service.ts
  - apps/api/src/db.ts
  - apps/api/src/director-api.service.ts
  - apps/api/src/people-input.ts
  - apps/api/src/people.controller.ts
  - apps/api/src/people.service.ts
  - apps/api/test/director-api.test.ts
  - apps/api/test/foundation.test.ts
  - apps/api/test/people-api.test.ts
  - docs/director-api.md
covered_digest: "v4:sha256:e4d72b8191c263068c659e146501edd4b3b7117e2df3e1a820dd01aa458423fb"
behavior_unverified: 0
overrides_applied: 0
human_verification: []
decision_coverage:
  honored: 0
  total: 0
  not_honored: []
deferred:
  - truth: Daily task creation/readiness with universal admission enforcement
    addressed_in: Phase 02b
    evidence: .planning/ROADMAP.md phase 02b; docs/director-api.md:69-71
---

# Backend 02a — independent verification

**Goal:** people → qualifications → immutable yes/no admission → safe project assignment → crew, preserving the earlier read contract. Initial verification of source HEAD above, against the five PLAN truths and the ROADMAP 02a result. SUMMARY claims were checked against implementation and independently executed tests.

**Verdict: passed within the stated 02a boundary.** No BLOCKER or WARNING found in the five must-have truths. This does not certify task readiness, legacy mutations, UI integration or full pilot acceptance.

## Goal achievement

Paths and line numbers below are repository-relative at the verified source HEAD.

| # | Observable truth | Status | Evidence |
|---|---|---|---|
| 1 | An active tenant director can create/edit/archive a person, manage qualifications, record a versioned yes/no admission and safely assign the person to a project and crew through authenticated HTTP. | VERIFIED | `people.controller.ts:14-58` exposes 20 added guarded operations; `app.module.ts:112-119` registers controller/service. `people.service.ts:22-46` enforces current director authority. Actual create/edit/Q/T/check/assignment/worker-read/crew flow in `people-api.test.ts:51-114`; archive cascades and terminal state at `162-174,280-299`. |
| 2 | Workers see their own personnel records; master/PTO see explicitly assigned projects and their personnel; foreign and unassigned personnel remain inaccessible. | VERIFIED | Shared `director-api.service.ts:9-23,73-100` predicates retain project membership plus worker assignment/ownership. New histories require employee and project visibility (`people.service.ts:191-201`); assignments/crew members filter employee visibility (`248-258,291-303`). HTTP scope assertions at `people-api.test.ts:69-84,90-107,261-266`, plus unchanged earlier ACL cases. All eleven write routes reject worker/master/PTO at `239-252`; memberships GET is director-only at service `224-229`. |
| 3 | A recorded pass alone never establishes current eligibility; latest project template, latest check, current required qualification versions, civil-date expiry and employee status are rechecked. | VERIFIED | One evaluator at `people.service.ts:203-222`, called by reads and both activation paths (`257,269,284,294,322-325`). Sequence allocated under employee lock at `174-187`, not by time. Evidence exact id/version at `215-219`; tenant civil date uses wall clock after lock waits (`160`). Failed-latest, immutable old pass, equal-time ordering, inclusive expiry, unrelated Q, replacement/revoke and template changes are exercised at test `115-160`; stale activation races at `217-233`. |
| 4 | Durable commands are atomic with audit and receipts; concurrent duplicate requestIds cannot duplicate business effects, and stale versions cannot overwrite changes. | VERIFIED | Transaction wrapper commits/rolls back all effects (`db.ts:10-34`); local command reservation before entity locks, operation+canonical payload hash, conflict wait/replay and completion at service `26-47`, audit at `50-51`. Version checks inside locked writes (`53-59,83,123-125,150-156,237-241,264-273,317-330`). Eight simultaneous identical creates return identical 201/body with exactly one employee/audit/receipt (`test:51-64`). Changed payload/operation and revoked-actor replay denied (`62,268-278`). Queued link/archive/membership/evidence/template races exercise actual PG locks and rollback row counts (`175-233`). |
| 5 | Existing read fields and historical assignments/checks survive without fabricated admission backfill; backend 02a does not claim task readiness or full pilot completion. | VERIFIED | Employee reads preserve prior fields and add status/version (`director-api.service.ts:27`); 003 leaves assignment lineage nullable. Actual legacy row remains null/no_check (`test:280-283`), old snapshots/history remain readable (`121,154,173,298`), archive bumps versions/audits without deletion (`service:91-104`, test `290-298`). Existing ten operations and 20 additions are checked method/path by the live OpenAPI test (`director-api.test.ts:260-303`); docs `65-73,112-122` state exclusions. |

**Score:** 5/5 truths verified; zero present-but-behavior-unverified truths.

## Required artifacts and wiring

| Artifact | Result | Substantive implementation / wiring |
|---|---|---|
| `apps/api/sql/003_people_admission.sql` | VERIFIED | Employee/membership/assignment versions; checked linked-member FK; qualification composite FK and active-code uniqueness; atomic receipt PK and column-scoped completion grant; audit details. All 51 lines reviewed. |
| `apps/api/sql/004_admission_crews.sql` | VERIFIED | One project template family; immutable versions/checks; employee sequence; same tenant/project/employee check-lineage FK (`34-35`); composite crew/assignment FKs (`54-55`); one active crew partial unique index (`57`); FORCE RLS and restricted grants (`58-66`). |
| `apps/api/src/people.service.ts` | VERIFIED | Real SQL reads/writes through withTenant, shared scoped visibility, command receipts/audits, locks, eligibility and archive/revoke cascades. Entire 334-line file reviewed. |
| `apps/api/src/people.controller.ts` | VERIFIED | Actual Nest decorators, UUID/query validation, TenantGuard, service calls and original HTTP status replay. Entire 58-line file reviewed. |
| `apps/api/test/people-api.test.ts` | VERIFIED | Real Nest HTTP listener on an ephemeral loopback port and PostgreSQL application/admin pools; fixtures scoped to unique tenant/user IDs; observed lock queues; content/state/count assertions, not mocked success. Entire 344-line file reviewed. |
| `apps/api/openapi.json` | VERIFIED | 30 method/path operations; E/Q/T/C/A/M, nullable lineage/currentAdmission, strict command input schemas, version-zero PUTs, statuses and paging. Live spec equals checked-in JSON. |

All four PLAN key links are WIRED: AppModule → controller/provider (`app.module.ts:112-119`); PeopleService → shared DirectorApiService (`people.service.ts:7,20,54,131,194,251,292`); service → tenant transaction/schema/receipts (`21,26-51` and SQL writes); actual HTTP tests → guarded controller (`people-api.test.ts:19-38`).

Data-flow trace: authenticated session/tenant membership → trusted Actor → shared SQL visibility → tenant-scoped DB rows → server-generated immutable snapshots/evidence → single eligibility evaluator → assignment/crew writes and currentAdmission reads. No fixture constants feed production responses. Client-supplied passed/time/evidence and mutable template code are rejected by `people-input.ts:42-60` and exercised at test `253-257`.

## Database/security and concurrency evidence

- RLS is enabled and forced on all seven new tables. Tests read no rows without tenant context or from the foreign tenant (`test:83-84,108-110,300-304`). No DELETE privileges on new tables. App-role UPDATE of checks/template versions and receipt hash is actually denied (`112-113,305`); SQL grants only receipt status/result update (`003:49-51`) and immutable SELECT/INSERT (`004:66`).
- Composite FKs constrain qualification owner, template/project, check/employee/project and crew/assignment. Foreign qualification and cross-project crew inserts fail with actual PostgreSQL 23503 (`test:306-308`), rather than relying solely on controller checks.
- Required Q edits, failed later check and template publication invalidate current eligibility while retaining immutable earlier pass. Activation takes project then employee/membership locks; archive skips project locks and takes dependent rows in ordered groups. Actual recursive `pg_blocking_pids` queues establish the concurrent ordering in `test:175-233`. Tested races finish without deadlock or stale grant.
- Active crew uniqueness is both SQL-enforced and exercised: competing inclusions yield one 200 and one 409 crew_conflict, with exactly one active row (`158-160`). Archive/revoke preserve membership/check/history and version/audit effects (`162-174,290-298`).

## Independently executed verification

Working directory: `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`. Branch `codex-api`, exact source HEAD verified; base ancestry verified with git exit 0. Every DB-dependent invocation explicitly set:

```sh
HELIOS_DB_PORT=54339 API_PORT=4327 \
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios \
ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios
```

| Command / probe | Actual independent result |
|---|---|
| `corepack pnpm test` | Exit 0. Domain 10/10 (63.083292 ms), API 26/26 = director 9 + foundation 3 + people 14 (3303.66 ms). No failures/cancellations/skips/todos. |
| `corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts` | Exit 0. Separate repeat 14/14 (1746.218834 ms), no failures/cancellations/skips/todos. Thus people14 independently passed once inside full test and once standalone. |
| `corepack pnpm --filter @helios/api exec tsc --noEmit` | Exit 0, no diagnostics. |
| `git diff --check` | Exit 0. |
| DB port/data_directory | Passing real SQL assertion at `people-api.test.ts:301`: port54339, directory ending `codex-api/.data/pg-54339`. |
| Migration repeat | Each independent people run executes migrator twice and compares exact schema_migrations rows; 003/004 ledger entries preserved (`309-312`). |
| OpenAPI/HTTP schemas | Live checked-in equality and complete 30-operation inventory pass; actual E/Q/T/C/crew and paged response data satisfy schema assertions (`director-api.test.ts:260-303`, people `314-344`). Manual schema review also covered strict command inputs and AssignmentInput active/revoked oneOf. |

First sandboxed full-test attempt stopped before tests with tsx IPC `listen EPERM`; the same command was rerun with approved host execution for local IPC/HTTP/PostgreSQL and passed. No assertion was bypassed and no DB target changed.

### Test quality audit

| Test file | Linked requirement | Active | Skipped | Circular | Assertion level | Verdict |
|---|---|---:|---:|---:|---|---|
| `people-api.test.ts` | PEOPLE-02A, ACL-01, TEST-01, DEV-01 | 14 | 0 | 0 | HTTP response values + independent SQL state/count/grant/FK/lock assertions | SUFFICIENT |
| `director-api.test.ts` | ACL-01, TEST-01; existing read compatibility | 9 | 0 | 0 | Scope/login/aggregate/read content and public schema assertions | SUFFICIENT |
| `foundation.test.ts` | Existing tenant/transaction compatibility | 3 | 0 | 0 | Real tenant isolation, context reset and rollback effects | SUFFICIENT |

No disabled-only coverage, expected-output generation through production evaluators, mock-only behavior or TODO/FIXME/XXX/TBD markers found in the new implementation/migrations/people tests. Live schema equality alone is not business evidence; the separate semantic and SQL assertions above provide that evidence.

## Requirements and decisions

ACL-01: satisfied for the 02a routes and retained read scope. TEST-01: satisfied by actual two-tenant/multiple-project HTTP/PG tests, denied roles and malformed inputs. DEV-01: satisfied by isolated worktree, explicit DB target and real directory assertion. PEOPLE-02A: satisfied as this plan's local trace label for the subsequent people requirement; it is not presented as an older formal ID.

### Decision Coverage

`check.decision-coverage-verify` returned exit0, skipped=true, total=0, honored=0, message: “No trackable decisions in CONTEXT.md.” The context has no structured `<decisions>` entries. Manual contract comparison covered its authority/visibility, director-only writes, yes/no template, documentReference metadata, receipts/version/atomicity, current admission/evidence, membership, crews, archive/history and isolated-runtime decisions; all are represented in implementation/docs/tests above.

## Limits and deferred work

- 02b task creation/readiness and universal admission enforcement remain pending. The existing `/api/tasks`, `/api/sync/events`, `/api/reports/:id/accept` retain documented authorization/validation/concurrency limits and can bypass the new people workflow (`docs/director-api.md:69-71`). This is an explicit scope boundary, not evidence of safe legacy mutations.
- Directors alone write; no invitation/account creation/tenant-role administration. The checklist supports yes/no, and documentReference is text metadata only. No upload/photo/typed measurements, physical-phone offline, load, production security/operations or complete pilot claim is verified.
- This independent run verifies 003/004 on the already-migrated isolated DB and exact repeat safety. It does not independently replay first application on a fresh empty database. There is no remaining 02a must-have relying on a manual UI check.
- Tests instantiate their own ephemeral HTTP app. The persistent API4327 process was not restarted or certified against this source HEAD. No use of54329/4317, UI/main source edits, source/test edits, commits, merges or deployments were performed by this verifier. Preexisting parent-owned planning changes were left in place.

## Human verification and gaps

N/A — backend infrastructure slice; the acceptance behaviors above were checked programmatically. No blocking gaps or unresolved human-verification items found for the scoped 02a goal. UI integration and later roadmap acceptance remain separate work.

Verifier: Codex, independent gsd-verifier role.
