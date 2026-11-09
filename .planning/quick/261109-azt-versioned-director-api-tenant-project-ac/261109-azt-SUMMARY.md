---
phase: 01-versioned-director-read-api
plan: 261109-azt
status: complete
subsystem: backend
tags: [nestjs, postgresql, authorization, openapi, http-tests]
requires: [existing-foundation-b2ddc9f]
provides: [versioned-read-api, tenant-project-visibility, real-daily-overview, ui-handoff]
affects: [director-ui-integration, subsequent-pilot-slices]
tech-stack:
  added: []
  patterns: [tenant-rls, explicit-project-acl, migration-ledger, isolated-http-fixtures]
key-files:
  created: [apps/api/sql/002_project_access.sql, apps/api/src/api-input.ts, apps/api/src/director-api.controller.ts, apps/api/src/director-api.service.ts, apps/api/test/director-api.test.ts, apps/api/openapi.json, docs/director-api.md]
  modified: [scripts/db.mjs, apps/api/src/migrate.ts, apps/api/src/auth.service.ts, apps/api/src/app.module.ts, apps/api/src/workforce.service.ts, apps/api/test/foundation.test.ts, apps/api/package.json, PASSPORT.md]
key-decisions:
  - Active project membership and actual assignee assignment are required for worker task reads.
  - Own employee profile remains readable without project assignment.
  - Reviewed report count includes accepted quantity zero and does not mean task completion.
  - Backend PostgreSQL uses isolated port 54339 and .data/pg-54339; default 54329 is preserved.
  - New overview declares missing quality, downtime and ID capabilities unavailable.
completed: 2026-11-09
duration: not-measured
actuals:
  tokens: 23792
  tasks: 3
  commits: 3
plan_head_before: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
plan_head_after: 45a9b51eaad4cbe1f69323a4137d8dba2e35cf43
---

# Phase 01 Plan 261109-azt: Versioned director read API Summary

Ten documented v1 operations now read real PostgreSQL data through validated sessions, forced tenant RLS, explicit project access and worker ownership checks.

## Completed tasks

1. Isolated PostgreSQL startup and migration ledger: `HELIOS_DB_PORT` is validated, nondefault ports use separate directories, an existing listener must report the expected data_directory. Added tenant-scoped project memberships and employee assignments with composite foreign keys, status constraints, indexes, forced RLS and explicit application grants. Existing tasks justify only assignment backfill. Numbered migrations are serialized with an advisory lock and transactionally recorded; 001 is safely replayed once for older unledgered schemas.
2. Implemented shared authorization and all read/auth operations. Inputs reject malformed bodies, UUIDs, impossible dates, duplicate/array/unknown queries, invalid pagination and duplicate raw authorization/tenant headers. Invalid/expired/deleted sessions return 401; valid sessions without active tenant membership return 403. Resource details hide denied scope with 404. Worker reads require ownership and actual assignee assignment. Legacy worker desk employee lists/detail now hide other employees. Overview uses independent counts and timezone-aware half-open boundaries, including a tested 25-hour DST day; decimals remain strings and units stay separate.
3. Served the checked-in public OpenAPI contract, asserted response schema shape over HTTP, documented UI integration and remaining modules, retained original UI startup instructions and added backend54339/API4327 commands. API test discovery covers both suites sequentially; foundation now uses the production exception filter.

## Routes

`POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/me`, `GET /api/v1/projects`, `GET /api/v1/projects/:id`, `GET /api/v1/projects/:id/tasks`, `GET /api/v1/employees`, `GET /api/v1/employees/:id`, `GET /api/v1/overview`, `GET /api/v1/openapi.json`.

Legacy `/api/auth/login` retains its successful response shape. The new public spec route is the only read route without session/tenant headers. Login remains public.

## Verification evidence

All runtime commands used repository-root cwd in the codex-api worktree and the following environment (never UI54329):

```sh
export HELIOS_DB_PORT=54339
export DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios
export ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios
```

| Command | Actual result |
|---|---|
| `HELIOS_DB_PORT=54339 corepack pnpm db:up` | PostgreSQL ready, separate `.data/pg-54339`; host escalation used for shared memory/listening |
| `corepack pnpm db:migrate` | Applied 001_init.sql and 002_project_access.sql; later repeated twice inside each new-suite run with identical ledger timestamps and retained fixtures |
| `corepack pnpm db:seed` | seed ready, isolated backend DB only; prerequisite for existing foundation suite |
| `corepack pnpm test` (final run) | Domain 10/10 + API 12/12 (new9 + foundation3); zero failures/skips/todos |
| `corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts` immediately afterward | 9/9, zero failures/skips/todos; final duration 1045.934625 ms |
| `corepack pnpm --filter @helios/api exec tsc --noEmit` | exit0 |
| `git diff --check` | exit0 |
| `git diff b2ddc9f HEAD --name-only -- apps/web packages/ui` | empty: no UI edits |

The full test command passed three times during implementation, with repeat new-suite runs. Final API combined suite duration was 1790.347459 ms. Tests exercise actual ephemeral HTTP listeners with the same global exception filter as production; no mocked database/services. Restricted role is explicitly asserted NOSUPERUSER/NOBYPASSRLS. Fixtures cover two tenants/two same-tenant projects, foreign-key cross-scope rejection, project/tenant/employee denial, no-task assigned employees, own-profile exception, post-login revocation, actual-assignee assignment, session expiry/logout independence, malformed auth/query/login input, day filtering, report multiplicity, zero acceptance, DST boundaries and contract parity. Teardown closes Nest/pg-boss/pools and removes only the new suite's fixtures. Existing foundation tests retain their seed-based behavior and add local test records.

Initial compile exposed a test UUID literal-type inference mismatch; explicit string annotations fixed it. No runtime test failure remained. Verification required host execution because sandbox shared memory/network restrictions prevent PostgreSQL and HTTP listeners; no automatic approval rejection occurred.

## Commits

- `32ea10b` — isolate PostgreSQL and ledger project ACL migrations.
- `f0ca835` — scoped v1 reads, validated sessions, real overview, HTTP/PG fixtures and static OpenAPI.
- `45a9b51` — API handoff, repeatable backend verification, contract/input parity and raw duplicate-header checks.

Commit count is measured with `git rev-list --count b2ddc9f..45a9b51` (3). Actual token estimate uses the same chars/4 scale as the plan: 95,168 realized diff characters /4 =23,792, excluding this subsequent metadata summary commit. Final metadata is committed separately.

## Deviations

- Added `apps/api/src/api-input.ts` to share validation between auth/controller rather than duplicate it, and touched foundation.test.ts to use the production exception filter. The source/documentation diff therefore touches 15 files instead of the planned13. Scope remains backend only; no new dependency.
- Tracer and expansion were implemented together before the first HTTP run; checkpoints still separately demonstrated migrations/project visibility, then full read/ownership/overview behavior. Static OpenAPI landed with task2 so every committed HTTP suite has its served contract available; task3 finalized handoff/assertions.
- Code review tightened the worker predicate to require assignment of the task's actual assignee when one user has multiple employee records. A dedicated real-PG regression proves that membership plus another own assignment cannot reveal an unassigned task.
- Added duplicate raw-header rejection because Node can discard repeated Authorization values before normalized-header validation. The HTTP test sends actual repeated headers and verifies 401/400.

## Known deferred capabilities

These are explicit planned unavailable outputs, not fabricated business values: `apps/api/src/director-api.service.ts:151` quality, line152 downtimeDuration, line153 idReadiness. Each is `{status:"unavailable",value:null,source:...}` until later pilot modules exist. Tracked in `.planning/WINDOWS.md`. No skipped test or unrun required verification remains.

Legacy mutations retain known project-scope/fixed-project/offline-concurrency limitations and do not synchronize new assignment tables. Legacy desk/summary/file scope is not replaced by v1 ACL; only concrete worker employee exposure was fixed. Phone offline, full-pilot acceptance, file uploads, quality/routes/materials/ID/MFA/backups/load/SLA are untested or unimplemented in this slice. No deployment or production-readiness claim follows.

## Runtime handoff

PostgreSQL remains running in executor session15816 on54339 for independent verification. No backend API/worker demo server was left running; test listeners and pg-boss instances are closed. Backend API may be started with API_PORT4327. Frontend proxy/CORS coordination is documented and not changed here. Main/cursor-ui checkouts, default database54329 and UI sources were untouched.

## Self-Check: PASSED

All seven new source/contract/handoff files exist. All three implementation commits are ancestors of HEAD. Typecheck, whitespace checks and final test commands passed; no tracked file deletion occurred. Parent independent verification remains the next step.
