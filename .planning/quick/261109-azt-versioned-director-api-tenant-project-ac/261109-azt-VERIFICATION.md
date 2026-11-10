---
phase: 01-versioned-director-read-api
plan: 261109-azt
verified: 2026-11-09T05:14:26Z
status: passed
score: 6/6 must-have truths verified
source_head: b89a773978747f605ff9ebba87cc6d89faf127d1
baseline: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
verification_mode: independent source review and actual HTTP/PostgreSQL execution
human_verification: []
gaps: []
---

# Independent verification — first director read API

The scoped backend read scenario passes. This verdict covers phase 01/API-01, AUTH-01, ACL-01, DATA-01, TEST-01 and DEV-01; it does not certify the complete pilot or all legacy routes. SUMMARY claims were checked against source and independently rerun commands.

## Observable truths

| Must-have | Result | Evidence |
|---|---|---|
| Authenticated actor/projects/detail/tasks/people/overview through v1; preserve UI contract | VERIFIED | Registered controllers in `app.module.ts`; controller inputs reach `DirectorApiService`; HTTP contract tests exercise every read shape. Existing foundation tests pass. Baseline-to-HEAD diff contains no `apps/web` or `packages/ui` changes. |
| Director tenant scope; master/PTO explicit project access; worker ownership and assignment | VERIFIED | All v1 data queries use transaction-local `withTenant` and RLS. Shared `projectVisible` requires active project membership; workers additionally require their own assigned employee. `taskVisible` checks assignment of the actual assignee, including the multiple-employee-alias case. Employee detail/list/count and overview use scoped predicates. HTTP tests cover other tenant/project, membership revocation, assignment revocation, worker ownership and spoofed role header. |
| Authentication/input failures give controlled errors | VERIFIED | Shared guard validates bearer shape/length, duplicate raw auth/tenant headers and tenant UUID before SQL. Actor derives from unexpired stored session and fresh active membership. Login rejects nonstring bodies/fields; UUID/query/pagination/real-date parsers reject malformed values. HTTP cases return 400/401/403/404 as defined. Logout deletes only the presented session; expiry and other-session survival are tested. |
| Real authorized daily counts and explicit unavailable metrics | VERIFIED | Overview aggregates tasks/shifts/reports separately. Timestamp boundaries use tenant timezone and half-open civil days. DST fixture spans Los Angeles 2026-11-01 (25 hours), tests both boundary exclusions, fallback shift timestamp, duplicate reports, distinct employee counts and acceptance of zero. Quantities retain decimal strings per unit; quality/downtime/ID return unavailable/null/source. |
| Real HTTP/PG isolation, repeatable migrations/tests | VERIFIED | Nest HTTP server with production exception filter, real restricted PG role, unique two-tenant/two-project fixtures, own teardown. Foreign-tenant FK and forced-RLS assertions execute. Migrator reruns twice during each suite and preserves ledger timestamps and fixture rows. Full suite and separate new-suite repeat independently pass. |
| Isolated backend PostgreSQL 54339; no UI DB operations | VERIFIED | All verifier DB commands explicitly used 54339. Read-only `SHOW data_directory` returned this worktree's `.data/pg-54339`; ledger contains 001/002. `scripts/db.mjs` validates port, chooses a separate directory and verifies directory identity before accepting an existing listener. No verifier command migrated/seeded 54329. |

## Required artifacts and wiring

| Artifact/link | Result | Evidence |
|---|---|---|
| `apps/api/sql/002_project_access.sql` | VERIFIED | Additive membership/assignment tables, tenant-composite foreign keys, active/revoked constraints, indexes, forced tenant RLS and app grants. Backfill derives employee assignment only from existing tasks; does not invent master/PTO access. |
| Controller → service → tenant transaction/visibility SQL | VERIFIED | Explicit provider/controller registration and session-derived actor; no client role authorization. HTTP tests reach restricted-role database queries. |
| `apps/api/src/migrate.ts` → ordered SQL/ledger | VERIFIED | Lexical numbered discovery, session advisory lock before ledger/checks, per-file transaction plus ledger insert, rollback on failure and release/unlock/pool closure in finally. Existing files skipped using durable ledger; sequential idempotency exercised. |
| `apps/api/test/director-api.test.ts` → static OpenAPI | VERIFIED | Nine active tests; exact served-file equality, ten-operation inventory and recursive representative response-schema validation. Includes actor/detail/list/overview/login shapes, nullability, required fields and decimal strings. |
| `apps/api/openapi.json` | VERIFIED | Same checked-in file is served publicly; ten current operations, bearer/tenant requirements, pagination/date inputs, unavailable metrics and error status contract. Public login/spec exceptions documented. |
| `docs/director-api.md`, `PASSPORT.md` | VERIFIED | Exact fields, auth/status flow, tenant/day semantics, null quantities, legacy limitations and UI follow-up. Backend-only 54339/4327 instructions retain original UI startup. |
| Touched legacy worker people reads | VERIFIED | `desk` employee query filters `user_id` for worker; employee detail filters worker ownership and validates UUID. HTTP tests confirm desk contains only self and foreign employee detail is 404. Legacy director response fields remain intact. |

## Independently executed checks

Working directory: `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api`.

```sh
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm test
DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts
corepack pnpm --filter @helios/api exec tsc --noEmit
```

- Full command: exit 0; domain 10 passed, API 12 passed, zero failed/skipped/cancelled.
- Separate new-suite repeat: exit 0; 9 passed, zero failed/skipped/cancelled.
- API TypeScript check: exit 0.
- Read-only database check: data directory `/Users/Gleb/Documents/ChatGPT/sites/helios-worktrees/codex-api/.data/pg-54339`; ledger `001_init.sql`, `002_project_access.sql`.
- `git diff --name-only b2ddc9f..HEAD -- apps/web packages/ui`: empty. Working tree was clean before this verification report was added. No application source modified by verifier; no commit made.

## Test quality and decisions

`director-api.test.ts` uses direct fixture setup plus independent literal expected counts/statuses and multi-step revocation/session behavior, rather than expected data generated by the read service. All nine tests are active; no skipped/todo tests or fixture-output writers found in the linked API test files. OpenAPI equality alone is supplemented by actual response validation. Foundation's three real PG/HTTP tests and the ten domain tests also passed.

No CONTEXT.md decision block exists for this quick task; decision-coverage gate is not applicable. No project-local `.cursor/rules`, `.cursor/skills` or `.agents/skills` were present; configured verifier-skill query returned no additional skills. No override was applied and no scoped blocker was found.

## Limits

Migration advisory locking and failure cleanup were source-reviewed; this run exercised sequential idempotency on an already initialized database, not a concurrent migrator race or injected migration failure. Schema matching tests are representative, not exhaustive OpenAPI validation of every possible error/response. Tests require the existing isolated local foundation seed.

Legacy desk/project/summary/file and mutation paths are explicitly outside the general v1 ACL guarantee. The narrowed worker people-read exposure is closed; existing legacy write project authorization/offline validation limitations remain documented. New read access must not be represented as proof that those writes are secured.

No phone offline test, UI integration/CORS verification, S3 upload, MFA, backup/restore, production load/SLA or complete-pilot acceptance is established. These are subsequent work, not missing evidence for the scoped phase-01 read scenario. Human UI verification is N/A for this backend slice.
