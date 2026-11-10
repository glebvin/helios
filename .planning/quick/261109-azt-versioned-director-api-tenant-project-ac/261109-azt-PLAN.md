---
phase: 01-versioned-director-read-api
plan: 261109-azt
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [API-01, AUTH-01, ACL-01, DATA-01, TEST-01, DEV-01]
files_modified:
  - scripts/db.mjs
  - apps/api/sql/002_project_access.sql
  - apps/api/src/migrate.ts
  - apps/api/src/auth.service.ts
  - apps/api/src/app.module.ts
  - apps/api/src/workforce.service.ts
  - apps/api/src/director-api.controller.ts
  - apps/api/src/director-api.service.ts
  - apps/api/test/director-api.test.ts
  - apps/api/package.json
  - apps/api/openapi.json
  - docs/director-api.md
  - PASSPORT.md
estimate:
  tokens: 38000
  raw_tokens: 38000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - Authenticated clients can read current actor, visible projects, project detail, project tasks, employees and actual daily overview through /api/v1 without changing the existing UI contract.
    - Directors see only their tenant; master and PTO see explicitly assigned projects; workers see only their own employee records and tasks in assigned projects.
    - Missing, malformed, expired or revoked authentication and invalid identifiers, pagination and dates fail predictably without PostgreSQL exceptions escaping as server errors.
    - Overview counts reflect authorized database records for the requested day; missing quality and ID capabilities return unavailable rather than invented values.
    - Real HTTP/PostgreSQL tests prove two-tenant and two-project isolation, worker restrictions, validation, repeatable migrations and stable repeated test runs.
    - Backend verification uses port 54339 and its own local PostgreSQL data directory; it never migrates or seeds the UI database on port 54329.
  artifacts:
    - path: apps/api/sql/002_project_access.sql
      provides: Additive project memberships, employee assignments, same-tenant foreign keys and forced tenant RLS
    - path: apps/api/src/director-api.controller.ts
      provides: Versioned read endpoints with validated inputs and shared session guard
    - path: apps/api/src/director-api.service.ts
      provides: Authorization-scoped SQL reads and actual daily counts
    - path: apps/api/test/director-api.test.ts
      provides: Real HTTP/PostgreSQL acceptance tests with isolated fixtures
    - path: apps/api/openapi.json
      provides: Checked-in route, response, authentication and error contract
    - path: docs/director-api.md
      provides: Cursor UI handoff and reproducible backend-only verification commands
  key_links:
    - from: apps/api/src/director-api.controller.ts
      to: apps/api/src/director-api.service.ts
      via: Session-derived actor, parsed query parameters and explicit project authorization
    - from: apps/api/src/director-api.service.ts
      to: apps/api/sql/002_project_access.sql
      via: Transaction-scoped withTenant plus explicit project and employee visibility predicates
    - from: apps/api/src/migrate.ts
      to: apps/api/sql/002_project_access.sql
      via: Ordered SQL discovery and durable migration ledger
    - from: apps/api/test/director-api.test.ts
      to: apps/api/openapi.json
      via: Route availability and required response-schema/status assertions
---

<objective>
Deliver the first complete server-side read scenario for the director UI: a logged-in actor chooses a permitted object, reads its tasks and people, and sees daily counts sourced from the database.

This is the first server slice, not the complete customer pilot. Retain NestJS/TypeScript, PostgreSQL, current pg-boss foundation and all existing successful legacy response shapes. Do not edit apps/web, packages/ui, the Cursor UI worktree or the primary checkout. No deployment or main-branch merge.
</objective>

<execution_context>
@/Users/Gleb/.cursor/gsd-core/workflows/execute-plan.md
@/Users/Gleb/.cursor/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@PASSPORT.md
@apps/api/src/app.module.ts
@apps/api/src/auth.service.ts
@apps/api/src/workforce.service.ts
@apps/api/src/db.ts
@apps/api/src/migrate.ts
@apps/api/sql/001_init.sql
@apps/api/test/foundation.test.ts
@scripts/db.mjs
</context>

<scope_and_decisions>
No new runtime dependencies are necessary. Use Nest decorators, pg parameterized queries, node:test and existing tsx tooling. Static OpenAPI JSON is sufficient; do not add Swagger UI or a schema-generator dependency.

Authorization policy: active director tenant membership grants tenant-wide reads. Master/PTO require explicit active project membership; worker requires explicit active project membership and sees only employee rows linked to actor.userId and their assigned tasks. Employee assignment is modeled independently of a task so an employee with no tasks can still appear in a permitted project. List endpoints hide inaccessible resources; detail endpoints use 404 for absent or inaccessible resources. A missing/invalid/expired session is 401; a valid session lacking active tenant membership is 403. Syntactically malformed UUIDs or parameters are 400. Unsupported or revoked project scope is never inferred from a client-provided role or tenant header alone.

Read endpoints: GET /api/v1/me; GET /api/v1/projects; GET /api/v1/projects/:id; GET /api/v1/projects/:id/tasks; GET /api/v1/employees; GET /api/v1/employees/:id; GET /api/v1/overview; GET /api/v1/openapi.json. Add POST /api/v1/auth/logout to revoke the presented session only, plus POST /api/v1/auth/login as a compatible alias of the validated login implementation. Preserve /api/auth/login and existing authenticated routes.

Lists return {items, total, limit, offset}; define consistent camelCase item fields. Pagination uses integer limit 1..100, default 25, and nonnegative integer offset, default 0; duplicate/array parameters are rejected. Project tasks accept optional day YYYY-MM-DD; employees accept optional projectId. Overview accepts optional projectId and day. Validate real calendar dates, not just their shape. An omitted day is the current civil date in the tenant's stored timezone; use that timezone for timestamp day boundaries. Return the applied day and timezone in overview.

Overview includes actual visible assigned-employee count, task count for day, distinct employees who started shifts on day, current open shifts explicitly labeled as current, submitted/accepted report counts for day, and per-unit quantities if quantities are returned. Never sum m², m³ and pieces into one number. Distinguish no records (zero) from unavailable capabilities. Quality, downtime duration and ID readiness have unavailable status and null value until their storage/calculation exists. No sample rings or demo constants in new endpoints. Do not relabel report acceptance as completed task status.

Out of scope for this slice: mutation API redesign, robust offline event concurrency, upload implementation, route engine, materials/ID implementation, MFA, full-pilot acceptance, new UI, load/SLA claims. Existing legacy mutation/project-scope limitations must be documented rather than represented as solved by this read API. Close only the concrete legacy worker employee-list/detail exposure in touched read paths without reshaping valid director responses.
</scope_and_decisions>

<tasks>

<task type="tracer" tdd="true">
  <name>1. Prove a real authorized project-list request from HTTP to PostgreSQL</name>
  <files>scripts/db.mjs, apps/api/sql/002_project_access.sql, apps/api/src/migrate.ts, apps/api/src/app.module.ts, apps/api/src/director-api.controller.ts, apps/api/src/director-api.service.ts, apps/api/test/director-api.test.ts</files>
  <behavior>
    - A director lists projects only in their active tenant; a master sees only a project with explicit active membership.
    - A project membership or employee assignment cannot reference a project, user membership or employee from another tenant.
    - Applying all migrations twice retains data and does not duplicate rows or replay applied migrations.
  </behavior>
  <action>
    First make local Postgres isolation explicit: scripts/db.mjs accepts a validated HELIOS_DB_PORT override with existing default 54329 preserved, prints the selected port and derives a distinct local data directory for nondefault ports. Never treat an unrelated listener as a valid isolated database. Backend execution sets HELIOS_DB_PORT=54339 with matching DATABASE_URL and ADMIN_DATABASE_URL; do not modify default database URLs or the UI environment. Starting a listening PostgreSQL process requires the host escalation mechanism when sandbox startup fails; report a concrete denied environment capability, never silently use port 54329.

    Add 002_project_access.sql with project_memberships (tenant_id, project_id, user_id, status) and employee_project_assignments (tenant_id, project_id, employee_id, status). Enforce active/revoked statuses, composite primary keys, tenant-scoped foreign keys, indexes and forced tenant RLS with explicit application grants. Project memberships reference tenant memberships. Assignments reference both tenant projects and tenant employees. No all-project grants or guessed backfill: existing daily_tasks can justify employee assignment backfill, but cannot justify master/PTO access grants. Tests explicitly create necessary memberships.

    Replace the single-file migrator with lexically ordered numbered SQL migrations and a durable ledger. Use advisory locking and transactionally record only successful files. Handle an existing database initialized by 001_init.sql safely: 001 is idempotent, so run it once under the ledger before 002 rather than marking unverified schema applied. Always release pool/lock on failure. Never drop or recreate application tables.

    Add and register the versioned controller/service, initially wiring GET /api/v1/projects through the existing session guard and withTenant. Build one shared project-visibility predicate used by subsequent endpoints. Create real HTTP tests using NestFactory and AllExceptionsFilter, PostgreSQL with the restricted application role, and independent admin fixture setup. Give each test suite random tenant/user/project IDs and cleanup only those fixtures. Do not rely on random preexisting seed tasks or wall-clock dates. The first tracer test must exercise real login, tenant header and database project filtering, not mocked service calls.
  </action>
  <verify>
    <automated>DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm db:migrate && DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm db:migrate && DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts</automated>
  </verify>
  <done>A real authenticated project-list request returns only permitted rows; two sequential migrations preserve fixtures; the isolated process uses 54339 and no command touches the UI database.</done>
</task>

<task type="auto" tdd="true">
  <name>2. Expand the authorized read scenario to actor, project tasks, people and daily overview</name>
  <files>apps/api/src/auth.service.ts, apps/api/src/app.module.ts, apps/api/src/director-api.controller.ts, apps/api/src/director-api.service.ts, apps/api/src/workforce.service.ts, apps/api/test/director-api.test.ts</files>
  <behavior>
    - Two tenants and two projects inside one tenant demonstrate cross-tenant denial and same-tenant project denial for master/PTO.
    - A worker sees only their own employee and task records, including no other workers' phone/document data in legacy desk or employee detail.
    - Day filtering and overview counts use actual authorized rows; two reports for one task do not duplicate task, employee or shift counts.
    - Invalid UUIDs, duplicate queries, impossible dates, bad pagination, malformed authorization/header shapes and invalid login bodies return defined 4xx errors.
    - Expired/revoked sessions fail; logout revokes only its presented session and keeps another session valid.
  </behavior>
  <action>
    Add the remaining routes and contract behavior in scope_and_decisions. Parse request inputs before SQL; do not coerce arrays, null, objects or booleans into valid strings. Validate tenant UUID before use in app_tenant casts. Validate bearer token shape and upper length using the token format actually produced by password.ts. Keep valid legacy login and guard behavior compatible, while malformed authentication returns controlled errors. Return only allowed actor fields; no hashes or token material in /me.

    Enforce role and project scope in every query, including total counts, detail joins, project-filtered employee registry and overview aggregates. A worker's employee-project assignment and project membership are both necessary for project reads; task reads also require own assignee. Unassigned employees remain visible only to a tenant director or the employee themself. Return only fields needed for the read contract; omit document_number and other sensitive fields from registries. Avoid broad SELECT * joins and SQL assembled from untrusted sort/query values.

    Compute independent aggregates instead of multiplying shifts/tasks/reports through one multi-join. SQL timestamps must use half-open timezone-aware boundaries for the selected civil day. Report counts use work_reports.created_at; shift-start count uses occurred_started_at with started_at fallback, documented in the response contract. A null accepted_quantity is not accepted; accepted quantity 0 is a reviewed report with zero accepted amount, not a successful full task. Keep numeric quantities lossless as decimal strings. Include status/source semantics for each unavailable metric.

    Apply low-impact worker filtering to legacy desk employees and employee detail, retaining response fields and existing director behavior. Do not claim all legacy mutations are secured by this change; list remaining work in handoff. Tests cover forbidden employee/project IDs, inactive project membership, revoked tenant membership, expired session, lost access after login and conflicting client-supplied scope. All endpoints must respond through the same error filter as production. Ensure fixture teardown closes Nest, pg-boss and both pools even on assertion failure.
  </action>
  <verify>
    <automated>DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts</automated>
  </verify>
  <done>Every listed authenticated read route works over HTTP with real PostgreSQL; scope denials and validation cases pass; overview values reconcile exactly with known fixtures and contain no synthetic production percentages.</done>
</task>

<task type="auto" tdd="true">
  <name>3. Publish the UI handoff and prove the complete read slice is repeatable</name>
  <files>apps/api/openapi.json, apps/api/src/director-api.controller.ts, apps/api/test/director-api.test.ts, apps/api/package.json, docs/director-api.md, PASSPORT.md</files>
  <behavior>
    - GET /api/v1/openapi.json returns the checked-in OpenAPI contract without a secret or a database row in it.
    - The contract describes the implemented endpoints, required headers, list/detail responses and error statuses; representative response keys are asserted in HTTP tests.
    - All existing foundation tests and the new suite pass on the backend database, followed by a second new-suite run without duplicate fixture failures.
  </behavior>
  <action>
    Check in OpenAPI 3 JSON with stable operation IDs, bearer security and x-tenant-id requirements, real schemas, pagination/date parameters, unavailable metric representation and 400/401/403/404 statuses. Serve this same file rather than a second copied object. The spec route can be public; document that exception clearly. Add a test that loads the route and compares its version/path inventory and representative responses to implemented schemas without a new validation dependency.

    Update the API test script to discover both foundation.test.ts and director-api.test.ts. Prevent concurrent suites from racing on shared seeded foundation data: either use test-concurrency=1 or keep the new suite fully independent with explicit unique fixtures; the actual final command must demonstrably pass in repeat runs. Document prerequisites including seed for existing foundation tests. Do not silently seed production or alter worker behavior just to make tests pass.

    Write docs/director-api.md for the Cursor UI implementer: auth flow, tenant selection, exact field names, example login/project/tasks/overview requests, dates/timezones, missing metrics and limitations of legacy write routes. State which screens have no supporting business module yet. Update PASSPORT.md with backend-only startup using HELIOS_DB_PORT=54339, both connection URLs, distinct API port 4327, and exact migration/seed/test commands; retain the existing original startup section for the UI. All commands assume repository-root cwd and no hard-coded absolute checkout path. Mention frontend proxy/CORS configuration is a coordinated follow-up and do not change apps/web.

    Run the full suite and repeat the new suite. Record actual commands, totals, failures and what remains untested in the quick SUMMARY. No claim about phone offline, full-pilot readiness or production load follows from these tests. Preserve the primary checkout and Cursor branch throughout. Code commits, if requested by the executor workflow, belong only to the current codex-api branch; this planning agent does not commit.
  </action>
  <verify>
    <automated>DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm test && DATABASE_URL=postgres://helios_app:helios_app@127.0.0.1:54339/helios ADMIN_DATABASE_URL=postgres://helios:helios@127.0.0.1:54339/helios corepack pnpm --filter @helios/api exec tsx --test test/director-api.test.ts</automated>
  </verify>
  <done>The OpenAPI endpoint matches the checked-in contract, the Cursor UI handoff is actionable, full tests plus repeat new tests pass, and the summary distinguishes implemented server reads from remaining pilot modules.</done>
</task>

</tasks>

<source_audit>
| Source | ID | Requirement/decision | Coverage |
| --- | --- | --- | --- |
| GOAL | phase 01 | Versioned read API, access, real overview and contract | Tasks 1–3 |
| REQ | API-01 | Projects/detail/tasks/employees/overview | Tasks 1–2; contract task 3 |
| REQ | AUTH-01 | Validated login/session, actor, logout | Task 2 |
| REQ | ACL-01 | Tenant/project/worker visibility | Tasks 1–2 |
| REQ | DATA-01 | Actual counts, unavailable missing modules | Task 2 |
| REQ | TEST-01 | HTTP/PG, two tenants/projects, bad input | Tasks 1–3 |
| REQ | DEV-01 | Isolated DB and reproducible commands | Tasks 1 and 3 |
| RESEARCH | none | No RESEARCH.md supplied; inspected current source, no external dependency selected | Not applicable |
| CONTEXT | orchestrator constraints | Existing UI/legacy contract preserved, backend branch only | All tasks |
| CONTEXT | D-IDs | No CONTEXT.md or numbered decisions supplied | Not applicable |

Subsequent-pilot requirements are explicitly assigned to roadmap phases 02–05 and are not silently claimed by this slice.
</source_audit>

<verification>
Run real HTTP tests against PostgreSQL on 54339. Verify migrator repeatability, tenant isolation under the restricted role, explicit project denial, own-worker filtering, deterministic day counts and input/session failure cases. Run existing domain/foundation tests plus the new suite, then repeat the new suite. Inspect git diff to ensure no UI files changed and summarize remaining legacy mutation limitations. The PostgreSQL server is an external prerequisite started separately, not a mocked in-memory substitute.
</verification>

<success_criteria>
All must_haves truths are demonstrated with actual test output; no main/UI database or UI source edits; static OpenAPI and human-readable handoff are checked in; remaining pilot mechanisms are explicitly distinguished from delivered functionality.
</success_criteria>

<output>
After execution, create .planning/quick/261109-azt-versioned-director-api-tenant-project-ac/261109-azt-SUMMARY.md with status, exact tests, commits if any, deviations and remaining work. Do not update ROADMAP completion for the complete pilot.
</output>
