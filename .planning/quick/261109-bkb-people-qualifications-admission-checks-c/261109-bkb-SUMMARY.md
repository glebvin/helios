---
phase: 02a
plan: 01
status: complete
subsystem: api
tags: [people, qualifications, admission, postgres, concurrency, openapi]
requires: [phase01-read-api]
provides: [versioned-personnel-commands, immutable-admission-evidence, admission-gated-assignment-and-crews]
affects: [02b-task-readiness, ui-handoff]
tech-stack:
  added: []
  patterns: [tenant-transactions, atomic-command-receipts, optimistic-versions, immutable-snapshots]
key-files:
  created: [apps/api/sql/003_people_admission.sql, apps/api/sql/004_admission_crews.sql, apps/api/src/people.service.ts, apps/api/src/people.controller.ts, apps/api/src/people-input.ts, apps/api/test/people-api.test.ts]
  modified: [apps/api/src/app.module.ts, apps/api/src/director-api.service.ts, apps/api/test/director-api.test.ts, apps/api/openapi.json, docs/director-api.md]
decisions:
  - A project has one immutable-code template family; latest failed attempt defeats earlier passed IDs.
  - Current evidence requires exact active qualification id/version and inclusive tenant civil date.
  - Use ordered NO KEY UPDATE locks to preserve serialization without FK KEY SHARE upgrade deadlocks.
  - Evaluate civil date with clock_timestamp after lock waits rather than transaction-start time.
metrics:
  duration: approximately 18 minutes including context and three checkpoints
  completed: 2026-11-09
actuals:
  tokens: 54351
  tasks: 3
  commits: 3
plan_head_before: 22588a9289072eec0b7cd66fe0ba751b6894d503
plan_head_after: f1717a46bab4e666a0a8d4c1ca178355d4724dd2
---

# Backend02a Plan01: people, admission and crews

Director-only employee/qualification commands now feed immutable yes/no admission evidence, transactionally gated project assignments, worker project access and crews. Existing ten operations remain; twenty additional operations and E/Q/T/C/A/M schemas are published in OpenAPI.

## Three sequential checkpoints

1. **adb69ad** — employee/qualification vertical tracer, shared scoped ACL, status/version, command hash/receipt/audit. Applied `003_people_admission.sql`; real HTTP/PG2/2 and API tsc passed. Eight parallel same-key creates produced identical201/body and exactly one employee, audit and receipt; stale edit409 and rejected reference rollback verified.
2. **c2dee58** — immutable templates/checks, current eligibility, explicit/implicit project membership, assignments and crews. Applied `004_admission_crews.sql`; real HTTP/PG9/9 and tsc passed. Both immutable tables have only SELECT/INSERT for application role. Composite lineage FKs preserve same tenant/project/employee; partial SQL unique index prevents two active crews.
3. **f1717a4** — complete30-operation contract, examples/limits, expanded negative/schema/security/concurrency regressions, strict command query validation and wall-clock civil date. Final people14/14 repeatedly passed, full domain10/API26 passed, tsc and diff check exit0.

Implementation/source/docs/test changes are committed. Parent owns the planning/verification completion commit and independent verification. SUMMARY/STATE are saved locally for that handoff.

## Exact verification

Every PG-dependent invocation used:

```sh
HELIOS_DB_PORT=54339 \
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios \
ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios
```

- `corepack pnpm db:migrate`:003 applied at checkpoint1,004 at checkpoint2. Repeated migrations within both HTTP suites preserved exact filename/applied_at ledger and fixture data.
- `corepack pnpm --filter @helios/api exec tsx --test test/people-api.test.ts`: final14/14,0 skipped/todo; two standalone final-contract runs passed (2058.934ms and1618.079ms). After the final clock_timestamp adjustment, standalone14/14 (1808.867ms) and the same14/14 inside the full suite passed again.
- `corepack pnpm test`: final domain10/10; API26/26 = prior director9 + foundation3 + people14.0 failures/skipped/todo; final API run3121.027ms. It also passed before the final clock adjustment.
- `corepack pnpm --filter @helios/api exec tsc --noEmit`: exit0 after each checkpoint and final full suite.
- `git diff --check`: exit0.
- Public HTTP OpenAPI equals checked-in artifact; method/path inventory preserves old10 and adds20; E/Q/T/C/A/M, CreatedCrew and paged HTTP response schemas validate against actual responses.
- Application role has FORCE RLS on every new table, no DELETE on new tables, no UPDATE on immutable check/version rows, and cannot update receipt identity/hash. API completes reserved receipts using column-scoped UPDATE(status,result).

## Business and concurrency evidence

- Full employee→qualification→template→check→assignment→worker project read→crew flow; all eleven write routes reject worker/master/PTO. Foreign organization/user/project and check-owner mismatch denied. Strict fields/query/JSON/date/boolean/version, duplicate/missing/unknown item answers and immutable code edits denied.
- Required evidence exact version invalidation; unrelated Q edit leaves eligibility unchanged. Inclusive expiry uses Pacific/Kiritimati tenant date; expired active code remains occupied until revoke. Renewal new ID requires fresh check. Noncritical false produces warning; critical false persists failed. Eight attempts in primary flow retain history, and latest failed attempt defeats old pass. Equal timestamps do not alter sequence ordering.
- Concurrent same-key POST replay has one business/audit/receipt effect; changed payload/operation409. Cached old body/status survives later archive while current authorization is required. Role downgrade and tenant membership revocation deny replay.
- Genuine PostgreSQL lock queues are observed using recursive pg_blocking_pids. Link edit queued before activation commits first: no stale-linked worker grant. Explicit membership revoke then implicit activation produces active version2. Archive then queued activation returns409 after cascade; no receipt for failed command. Qualification revoke and template publication queued before activation return422; exactly zero assignment/audit/receipt for rejected activation. Two crew inclusions produce one200 and one409 crew_conflict with one active SQL row.
- Assignment revoke cascades crew version. Archive with active assignment/crew yields exactly three audit records, one completed receipt and version bumps on all three entities. Terminal unarchive/check/activation/inclusion rejected; history remains readable to director.
- Legacy assignment retains null lineage and false/no_check. Linked master assignment does not auto-grant project membership. Existing scope assertions and foundation assertions remain intact; only director fixture cleanup gains new FK children.

## Runtime and deviations

- Initial54339 connection was refused: the earlier PG process was absent. Restarted existing isolated database with `HELIOS_DB_PORT=54339 corepack pnpm db:up`; active tool session47987, PG PID15827 at startup. Tests assert actual port54339 and data_directory ending `codex-api/.data/pg-54339`. Leave it running for parent verification.
- Never used UI54329/4317, restarted API4327, edited frontend/UI/main, merged/deployed or installed dependencies.
- The first gated-race harness counted only direct gate blockers. PostgreSQL queues the second waiter behind the first tuple waiter; fixed the test to count the recursive blocking chain and release gates in teardown. Interrupted only its own hung test processes and removed only its own @people.test fixture tenants/users before rerun. No application deadlock was observed. A later cross-project FK probe accidentally reused a crew-member PK; changed probe to a fresh empty crew so it verifies the intended23503 rather than23505.
- Task3 added a controller-local query guard because the contract requires rejecting unknown write query fields. This closes validation omitted in the initial tracer. No global command framework was introduced.
- The final actuals.tokens value is ceil(217403 Unicode diff characters/4); no estimate was supplied. Three commits measured via git rev-list22588a9..HEAD.

## Remaining boundaries

Only active director writes; no account creation/invitation/tenant-role grant. documentReference is metadata only. Admission checklist supports yes/no only. No upload/S3/photo/typed measurement engine, phone offline/load/production acceptance claim.

Daily task creation/readiness and universal admission enforcement are **02b pending**. Legacy `/api/tasks`, `/api/sync/events`, `/api/reports/:id/accept` still retain documented authorization/validation/concurrency limitations and can bypass this new people/admission workflow. New assignment/crew operations do not certify those legacy mutations. UI integration, independent verification and parent-owned API4327 restart follow separately.

## Self-Check: PASSED

All six created implementation artifacts exist; all three recorded commits are ancestors of HEAD. Current source tests, migration repeat, OpenAPI response validation and typecheck passed with no skip/TODO/FIXME placeholders. Implementation commits contain11 files and no frontend changes. Planning artifacts intentionally await the parent completion commit.
