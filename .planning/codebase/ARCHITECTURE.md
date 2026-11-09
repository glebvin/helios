---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
<!-- refreshed: 2026-11-09 -->
# Architecture

**Analysis Date:** 2026-11-09

## System Overview

HELIOS is a single-cabinet workforce desk: one React client, one NestJS API, one pg-boss worker, and one PostgreSQL database. Tenant isolation is a transaction-local `set_config`, not a header the database trusts. Business numbers and scope checks live in `@helios/domain`. The API and the worker are separate processes that share `@helios/api` job code and the same `helios_app` role (`NOBYPASSRLS`).

```text
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (Vite)                           │
│  `apps/web/src/main.tsx` → `App.tsx`                             │
│  director/master: `director.tsx`    worker: `field.tsx`          │
│  session + outbox: `api.ts`, `outbox.ts` (localStorage)          │
└────────────┬───────────────────────────────┬─────────────────────┘
             │  /api  (Vite proxy → :4317)   │  pending events
             ▼                               ▼
┌────────────────────────────┐    ┌──────────────────────────────┐
│  NestJS API  :4317         │    │  same API, sync path         │
│  `apps/api/src/main.ts`    │    │  POST `/api/sync/events`     │
│  `app.module.ts`           │    │  `workforce.service.ts`      │
│  TenantGuard + services    │    └──────────────┬───────────────┘
└────────────┬───────────────┘                   │
             │ withTenant()                      │ boss.send in the
             ▼                                   │ same SQL transaction
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL  127.0.0.1:54329                                     │
│  tables + FORCE RLS (`apps/api/sql/001_init.sql`)                │
│  queue schema `pgboss` (pg-boss)                                 │
│  role `helios_app` for API and worker; `helios` only for migrate │
└────────────┬─────────────────────────────────────────────────────┘
             │ queue `work-report.recorded`
             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Worker process                                                  │
│  `apps/worker/src/main.ts` → `processReportJob` in               │
│  `apps/api/src/jobs.ts` → `report_effects` (idempotent insert)   │
└──────────────────────────────────────────────────────────────────┘

Rules (no I/O): `packages/domain/src/rules.ts`, `decimal.ts`, `ids.ts`
Shared UI kit (not mounted by the desk): `packages/ui/src/`
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Web shell | Login, theme, role switch, flush outbox, pick desk vs phone | `apps/web/src/App.tsx` |
| HTTP client | Bearer + `x-tenant-id`, session in `localStorage` | `apps/web/src/api.ts` |
| Phone outbox | Per-tenant, per-user pending shift and volume events | `apps/web/src/outbox.ts` |
| Desk view-model | Lane, today's tasks, progress, labels | `apps/web/src/model.ts` |
| Director desk | Section nav: overview, inbox, objects, people, board, documents | `apps/web/src/director.tsx` |
| Work board | Drag between assigned → shift → submitted → accepted | `apps/web/src/board.tsx` |
| Inbox | Attention slices (today / overdue / all) | `apps/web/src/inbox.tsx` |
| Worker phone | Shift start, volume submit, local checklist | `apps/web/src/field.tsx` |
| API process | CORS, global exception filter, listen `127.0.0.1` | `apps/api/src/main.ts` |
| HTTP module | Controllers, `TenantGuard`, pool and pg-boss providers | `apps/api/src/app.module.ts` |
| Auth | scrypt passwords, hashed session tokens, membership lookup | `apps/api/src/auth.service.ts` |
| Workforce | Desk reads, tasks, sync, accept, file scope, audit | `apps/api/src/workforce.service.ts` |
| Tenant transaction | `BEGIN` + `set_config` + `COMMIT`, then release | `apps/api/src/db.ts` |
| Jobs | Queue ensure, transactional send payload, idempotent effect | `apps/api/src/jobs.ts` |
| Worker loop | `boss.work` on `work-report.recorded` | `apps/worker/src/main.ts` |
| Domain rules | Quantities, scope, object keys, route/signature predicates | `packages/domain/src/rules.ts` |
| Decimal | Fixed scale `1_000_000n`, string in / string out | `packages/domain/src/decimal.ts` |
| Demo ids | Stable UUIDs, queue name, seed users | `packages/domain/src/ids.ts` |
| Schema | Tables, RLS, `memberships_for_login` | `apps/api/sql/001_init.sql` |
| Local Postgres | Embedded server, role `helios_app`, data in `.data/pg` | `scripts/db.mjs` |

## Pattern Overview

**Overall:** Modular monolith with a split worker. Four layers: browser, HTTP services, pure rules, Postgres (data + queue).

**Key Characteristics:**
- One Nest module. Controllers and the guard live in `apps/api/src/app.module.ts`. Services are the only place that open a tenant transaction.
- `@helios/domain` has no database, Nest, or React imports. API, worker, seed, and the web outbox call it.
- The worker does not boot Nest. It imports `@helios/api/db` and `@helios/api/jobs` (`apps/api/package.json` `exports`).
- Every tenant-table read and write goes through `withTenant` so `app.tenant_id` is transaction-local (`set_config(..., true)` in `apps/api/src/db.ts`).
- Row level security is `ENABLE` + `FORCE` on tenant tables. The app role cannot bypass it (`scripts/db.mjs` creates `helios_app` with `NOBYPASSRLS`).
- pg-boss jobs for a submitted volume are inserted with `db: queryClient(client)` inside the same transaction as `work_reports` (`apps/api/src/workforce.service.ts`). A rollback removes the job.
- Client mutations that must survive a dropped network are outbox events (`shift_start`, `shift_end`, `submit_volume`). Accept and create-task are online `fetch` calls from `apps/web/src/App.tsx`.

## Layers

**Browser:**
- Purpose: Session, role shell, and offline queue.
- Location: `apps/web/src/`
- Contains: React 19 function components, `fetch` wrappers, `localStorage`.
- Depends on: `@helios/domain` (`eventsForSync` in `apps/web/src/outbox.ts`), Vite proxy in `apps/web/vite.config.ts`.
- Used by: The person at `http://127.0.0.1:5173`.

**HTTP service:**
- Purpose: Authenticate, bind an actor to one cabinet, run workforce commands.
- Location: `apps/api/src/`
- Contains: Nest controllers, `AuthService`, `WorkforceService`, pg pool, pg-boss publisher.
- Depends on: `@helios/domain`, `pg`, `pg-boss`.
- Used by: The browser and `apps/api/test/foundation.test.ts`.

**Rules:**
- Purpose: Quantities, scope equality, file-key shape, signature and lot math that must not drift between client and server.
- Location: `packages/domain/src/`
- Contains: Pure functions. Throws `Error` with a stable message (`invalid_quantity`, `scope_mismatch`, `bad_filename`).
- Depends on: Nothing outside the package.
- Used by: `apps/api/src/workforce.service.ts`, `apps/api/src/jobs.ts`, `apps/api/src/seed.ts`, `apps/web/src/outbox.ts`, `packages/domain/src/rules.test.ts`.

**Store:**
- Purpose: Tenant rows, audit, idempotency, and the pg-boss queue.
- Location: `apps/api/sql/001_init.sql`, database `helios` on port `54329`.
- Contains: Composite primary keys `(tenant_id, id)`, `client_events`, `report_effects`, `stored_files.object_key`.
- Depends on: Role `helios_app` for the app; role `helios` only in `apps/api/src/migrate.ts`.
- Used by: API pool, worker pool, seed.

**Presentation kit (parallel, unwired):**
- Purpose: Activity rings and token CSS.
- Location: `packages/ui/src/activity.tsx`, `packages/ui/src/tokens.css`, `packages/ui/src/kit.css`.
- Contains: `ActivityRings`.
- Depends on: `motion`, React.
- Used by: Nothing in `apps/web/src`. The desk paints its own CSS variables in `apps/web/src/app.css`.

## Data Flow

### Primary Request Path

Login and desk load. Health is the only unauthenticated GET besides login.

1. `apps/web/src/main.tsx` mounts `App` inside `MotionConfig`.
2. `login()` in `apps/web/src/api.ts` POSTs `/api/auth/login`. Vite proxies `/api` to `http://127.0.0.1:4317` (`apps/web/vite.config.ts`).
3. `AuthController.login` (`apps/api/src/app.module.ts`) calls `AuthService.login` (`apps/api/src/auth.service.ts`): lookup `users` by email, `verifyPassword` (`apps/api/src/password.ts`), insert `sessions` with SHA-256 of the raw token, 12-hour expiry, then `memberships_for_login(user)`.
4. The browser keeps the first membership as `Session` under `localStorage` key `helios.session` (`apps/web/src/api.ts`).
5. `App` calls `desk(session)` → `GET /api/desk` with `authorization: Bearer …` and `x-tenant-id`.
6. `TenantGuard` (`apps/api/src/app.module.ts`) strips the bearer, calls `AuthService.actor`. That checks `sessions`, then `withTenant` and reads `memberships` for an `active` row. Missing token → 401 `unauthorized`. Unknown membership → 403 `tenant_denied`. The header selects a cabinet; it does not grant one.
7. `WorkforceService.desk` (`apps/api/src/workforce.service.ts`) runs inside `withTenant`. A `worker` role only receives tasks, shifts, and reports tied to `employees.user_id`. Files are omitted for workers.
8. RLS policies `tenant_isolation` compare `tenant_id` (or `tenants.id`) to `app_tenant()` (`apps/api/sql/001_init.sql`). `set_config` is the third argument `true`, so the setting dies at commit.

### Offline Sync

1. Phone and board call `queue()` in `apps/web/src/App.tsx`, which `enqueue`s into `helios.outbox.{tenantId}.{userId}` (`apps/web/src/outbox.ts`).
2. `pendingFor` keeps rows that `eventsForSync` (`packages/domain/src/rules.ts`) marks `pending` for that exact tenant and user.
3. `flush` POSTs `/api/sync/events`. On network failure the event stays `pending` and the UI says the phone still holds it.
4. `WorkforceService.sync` applies each event in its own `withTenant` transaction. `assertSameScope` rejects a body whose `tenantId` or `userId` differs from the actor (403 `scope_mismatch`).
5. `client_events` primary key is `(tenant_id, user_id, event_id)`. A replay with the same `payload_hash` returns the stored JSON plus `duplicate: true`. A different hash is 409 `idempotency_payload_mismatch`.
6. `submit_volume` inserts `work_reports` and `boss.send(QUEUE_WORK_REPORT, …, { db: queryClient(client), group: { id: tenantId } })` before commit.

### Work-Report Effect

1. Only `apps/worker/src/main.ts` calls `boss.work`. The API process starts pg-boss to publish (`BossHost` in `apps/api/src/app.module.ts`) and does not consume.
2. Queue name is `work-report.recorded` (`QUEUE_WORK_REPORT` in `packages/domain/src/ids.ts`). Created with `retryLimit: 5`, `retryDelay: 1`, `expireInSeconds: 120` (`apps/api/src/jobs.ts`).
3. Worker options: `localConcurrency: 2`, `localGroupConcurrency: 1`. `processReportJob` also refuses a second in-flight job per tenant via the module `inflight` map (`maxPerTenant = 1`) and throws `tenant_busy`.
4. The handler inserts `report_effects (tenant_id, report_id, idempotency_key)` `ON CONFLICT (tenant_id, report_id) DO NOTHING`. A second delivery returns `{ applied: false }` and does not add a row.
5. `recordAndMaybeRollback` in `apps/api/src/workforce.service.ts` is the test hook that proves a rolled-back send leaves no `pgboss.job` row (`apps/api/test/foundation.test.ts`).

### Partial Accept

1. Director board calls `acceptReport(session, reportId, "17")` (`apps/web/src/App.tsx`).
2. `POST /api/reports/:id/accept` is forbidden for `role === "worker"` (403 `role_denied`).
3. `partialAcceptance` (`packages/domain/src/rules.ts`) rejects an accepted quantity below 0 or above submitted. The SQL check on `work_reports` repeats that bound (`apps/api/sql/001_init.sql`).
4. The update bumps `version` and writes `audit_log` action `volume_accepted`.

**State Management:**
- Server: no in-memory cabinet cache. Actor is recomputed per request. The only process-local mutable state is `inflight` in `apps/api/src/jobs.ts`.
- Browser: React `useState` in `App`. Persistence is `localStorage`: `helios.session`, `helios.theme`, `helios.outbox.{tenantId}.{userId}`, `helios.check.{tenantId}.{taskId}` (checklist inside `apps/web/src/field.tsx`, phone-only, not synced).
- There is no router. Section and phone tab are component state.

## Key Abstractions

**Actor:**
- Purpose: The user, cabinet, and role for one request.
- Examples: `apps/api/src/workforce.service.ts` (`export type Actor`), attached as `request.actor` by `TenantGuard`.
- Pattern: Guard resolves it; controllers call `actorOf`; services receive it as the first argument. Do not read `x-tenant-id` inside a service.

**withTenant:**
- Purpose: One pooled client, one transaction, tenant and user GUCs, commit or rollback, always `release`.
- Examples: `apps/api/src/db.ts`, every public method on `WorkforceService` except the test helper `recordAndMaybeRollback`.
- Pattern: Pass a callback. Do not keep the `PoolClient`. Do not call `set_config` outside this helper on the request path.

**Client event:**
- Purpose: Idempotent phone command.
- Examples: `ClientEvent` in `apps/api/src/workforce.service.ts`, `OutboxEvent` in `apps/web/src/outbox.ts`.
- Pattern: Kinds are `shift_start`, `shift_end`, `submit_volume`. Identity is `eventId` plus a canonical JSON hash from `stableEventBody`.

**Lane:**
- Purpose: Derived board column, not a stored status.
- Examples: `laneOf` in `apps/web/src/model.ts`. Order is accepted report, else any report, else an open shift, else `assigned`.
- Pattern: Compute from `Desk`. Do not add a lane column to `daily_tasks`.

**Object key:**
- Purpose: File identity that starts with the cabinet id.
- Examples: `objectKey` and `keyBelongsToTenant` in `packages/domain/src/rules.ts`. Seed writes `stored_files` in `apps/api/src/seed.ts`. `WorkforceService.file` checks the key after the RLS read.
- Pattern: There is no S3 client in the repo. A future object store must use `objectKey` and still authorize through `GET /api/files/:id`.

**Demo cabinet:**
- Purpose: Fixed ids for seed and tests.
- Examples: `TENANT_A`, `TENANT_B`, `DEMO_USERS` in `packages/domain/src/ids.ts`. Seed in `apps/api/src/seed.ts` creates "Учебный кабинет" and "Чужой кабинет".
- Pattern: Import these constants. Do not paste new UUID literals in tests.

## Entry Points

**API:**
- Location: `apps/api/src/main.ts`
- Triggers: `pnpm dev:api` → `tsx src/main.ts` (`apps/api/package.json`). Port `API_PORT` or `4317`, bind `127.0.0.1`.
- Responsibilities: CORS for `http://127.0.0.1:5173` and `http://localhost:5173`, headers `content-type`, `authorization`, `x-tenant-id`, `AllExceptionsFilter`.

**Worker:**
- Location: `apps/worker/src/main.ts`
- Triggers: `pnpm dev:worker`.
- Responsibilities: Own pool, own `PgBoss`, `ensureQueue`, consume `QUEUE_WORK_REPORT`.

**Web:**
- Location: `apps/web/src/main.tsx`, host page `apps/web/index.html`.
- Triggers: `pnpm dev:web` (Vite port 5173). Production build registers `apps/web/public/sw.js` only when `import.meta.env.PROD`.
- Responsibilities: Render `App`. Service worker caches `/` and `/manifest.webmanifest` and never intercepts `/api`.

**Schema:**
- Location: `apps/api/src/migrate.ts` reads `apps/api/sql/001_init.sql` with `adminUrl`.
- Triggers: `pnpm db:migrate`.
- Responsibilities: Apply the single SQL file as the database owner. Not used at request time.

**Seed:**
- Location: `apps/api/src/seed.ts`
- Triggers: `pnpm db:seed`.
- Responsibilities: Users outside RLS (the `users` table has no policy), tenant rows inside `withTenant`.

**Postgres process:**
- Location: `scripts/db.mjs`
- Triggers: `pnpm db:up`.
- Responsibilities: Embedded Postgres in `.data/pg`, port `54329`, create `helios_app` and database `helios` if missing, then stay alive. `docker/init.sql` is the same role grant for a container; the local path does not use it.

**Routes (all under `@Controller("api")` in `apps/api/src/app.module.ts`):**

| Method | Path | Guard | Handler |
|--------|------|-------|---------|
| POST | `/api/auth/login` | none | `AuthService.login` |
| GET | `/api/health` | none | `{ ok: true }` |
| GET | `/api/summary` | `TenantGuard` | `WorkforceService.summary` |
| GET | `/api/desk` | `TenantGuard` | `WorkforceService.desk` |
| GET | `/api/employees/:id` | `TenantGuard` | `WorkforceService.employee` |
| POST | `/api/tasks` | `TenantGuard` | `WorkforceService.createTask` |
| POST | `/api/sync/events` | `TenantGuard` | `WorkforceService.sync` |
| POST | `/api/reports/:id/accept` | `TenantGuard` | `WorkforceService.accept` |
| GET | `/api/files/:id` | `TenantGuard` | `WorkforceService.file` |

`createTask` writes `project_id = PROJECT_A` (`packages/domain/src/ids.ts`). Cross-tenant employee ids fail the composite foreign key and `mapPgError` turns SQLSTATE `23503` / `23514` into 422 `reference_denied` (`apps/api/src/errors.ts`).

## Architectural Constraints

- **Threading:** One Node event loop per process. API and worker are two processes. pg-boss in the API uses `max: 4` connections (`apps/api/src/jobs.ts`). The worker allows two local jobs and one per group. Do not call `boss.work` from the API process.
- **Global state:** `inflight` in `apps/api/src/jobs.ts` is per process. The API publisher and the worker do not share it. Nest singletons are the pool (`APP_POOL`), `BossHost`, `AuthService`, `WorkforceService`.
- **Circular imports:** None on the runtime graph. `apps/api/src/auth.service.ts` uses `import type { Actor }` from `apps/api/src/workforce.service.ts`. The worker depends on the API package; the API package does not import `apps/worker`.
- **Two database roles:** Request, worker, seed, and tests use `DATABASE_URL` or the `helios_app` default in `apps/api/src/db.ts`. Migrations use `ADMIN_DATABASE_URL` or the `helios` owner. App code must keep the app role or RLS is meaningless.
- **Login tables are outside RLS:** `users` and `sessions` have no policy (`apps/api/sql/001_init.sql`). Membership discovery for login is `SECURITY DEFINER` function `memberships_for_login`. After login, cabinet data goes through `withTenant` only.
- **Roles:** Schema allows `director`, `master`, `worker`, `pto` (`memberships.role`). The UI switch and seed use the first three (`apps/web/src/roles.tsx`, `packages/domain/src/ids.ts`). `pto` has no screen.
- **Ports:** `54329`, `4317`, and `5173` are one instance per machine (`PASSPORT.md`).
- **Domain functions not on the request path yet:** `validateRoute`, `maySign`, `mayPublish`, `mayReinspect`, `documentaryReadiness`, `efficiency`, `attributeCrewVolume` (`packages/domain/src/rules.ts`). Call them from a service inside `withTenant` when a feature needs them. Do not reimplement the arithmetic in React or SQL.
- **Summary rings are sample data:** `sampleRings` in `apps/api/src/workforce.service.ts` is labeled as training numbers. The desk overview does not render `ActivityRings`.

## Anti-Patterns

### Bare pool against tenant tables

**What happens:** A `PoolClient` from `createPool()` runs `SELECT` on `employees` or `daily_tasks` without `withTenant`.
**Why it's wrong:** `FORCE ROW LEVEL SECURITY` hides every row when `app.tenant_id` is unset. The setting is not session-sticky; `apps/api/test/foundation.test.ts` asserts a fresh client sees an empty GUC and `count(*) = 0`.
**Do this instead:** `withTenant(pool, actor.tenantId, actor.userId, (client) => client.query(...))` from `apps/api/src/db.ts`.

### Publishing pg-boss outside the request transaction

**What happens:** `boss.send(QUEUE_WORK_REPORT, job)` without `{ db: queryClient(client) }`.
**Why it's wrong:** The job commits on the boss connection even when the `work_reports` transaction rolls back. `recordAndMaybeRollback` exists to prove the opposite.
**Do this instead:** Send from inside the `withTenant` callback with `db: queryClient(client)` and `group: { id: actor.tenantId }`, as `submitVolume` does in `apps/api/src/workforce.service.ts`.

### Trusting `x-tenant-id` or the event body as authority

**What happens:** A handler uses the header or `event.tenantId` as the row's `tenant_id` without `TenantGuard` and `assertSameScope`.
**Why it's wrong:** The header only chooses which membership to load. A body cabinet that is not the actor's is 403. RLS will also hide the other cabinet, which turns cross-tenant writes into `reference_denied` rather than a clean authorization error if the scope check is skipped.
**Do this instead:** Take `Actor` from `actorOf`. Compare events with `assertSameScope` (`packages/domain/src/rules.ts`) before insert.

### App connections as the owner role

**What happens:** `createPool(adminUrl)` or `ADMIN_DATABASE_URL` in a request or worker path.
**Why it's wrong:** The owner bypasses the point of `NOBYPASSRLS`. Migrate is the only caller of `adminUrl` (`apps/api/src/migrate.ts`).
**Do this instead:** Default `createPool()` so the connection string stays `appUrl`.

### Second consumer of `work-report.recorded`

**What happens:** `boss.work` added to `apps/api/src/main.ts` or another script while `apps/worker/src/main.ts` is also running.
**Why it's wrong:** Effects are idempotent, so double apply is safe, but `inflight` and `localGroupConcurrency` are per process. Two consumers defeat the one-heavy-step-per-cabinet rule.
**Do this instead:** Keep consumption in `apps/worker/src/main.ts` only.

### Shared outbox key

**What happens:** One `localStorage` key for every user on the phone.
**Why it's wrong:** `eventsForSync` would be the only filter, and a bug in that filter would upload another cabinet's shift.
**Do this instead:** Key `helios.outbox.${tenantId}.${userId}` and send only `pendingFor` (`apps/web/src/outbox.ts`).

## Error Handling

**Strategy:** Domain and services throw `HttpException` via `httpError(status, code)`. Postgres constraint failures become 422. Anything else becomes 500. The client throws `Error` whose message is the `error` string.

**Patterns:**
- `httpError` in `apps/api/src/errors.ts` builds `HttpException`. Codes in use: `unauthorized`, `tenant_denied`, `role_denied`, `not_found`, `reference_denied`, `scope_mismatch`, `bad_event`, `idempotency_payload_mismatch`, `already_started`, `invalid_shift_order`, `invalid_quantity`, `task_required`, `employee_required`, `quantity_required`, `unsupported_operation`, `file_scope`.
- `AllExceptionsFilter` (`apps/api/src/http.ts`) reads `exception.status` or `HttpException.getStatus()`. Body is `{ error: message }` below 500 and `{ error: "internal" }` at 500. Status ≥ 500 is `console.error`.
- `mapPgError` maps `23503` and `23514` to `reference_denied` and rethrows the rest.
- `withTenant` rolls back, swallows a rollback that fails because the transaction is already closed, then rethrows the original error.
- Browser `explain` in `apps/web/src/App.tsx` maps a few codes to Russian sentences. Unknown codes render as the raw code.
- Domain predicates that are not HTTP-aware throw `Error` (`invalid_quantity`, `crew_empty`, `bad_decimal:…`, `bad_file_id`, `bad_filename`). Callers that surface them to HTTP must catch and pass `httpError`. `partialAcceptance` is called inside `accept` without a catch; a bad quantity becomes a 500 today because the message is not an `HttpException`. New command methods should catch domain `Error` and map the message with `httpError(422, error.message)`.

## Cross-Cutting Concerns

**Logging:** `console.log` on API and worker boot (`apps/api/src/main.ts`, `apps/worker/src/main.ts`, migrate, seed, `scripts/db.mjs`). The worker redacts the password in the URL before printing. Request errors at 500 go to `console.error`. There is no request id and no audit of reads. Mutations call `WorkforceService.audit` → `audit_log`.

**Validation:** Hand-checked fields (`required` in `apps/api/src/workforce.service.ts`) and domain functions. No `class-validator` pipe. Nest body types are inline optional strings defaulted to `""`.

**Authentication:** Bearer token, stored only as SHA-256 (`hashToken` in `apps/api/src/password.ts`). Password hash is `scrypt:salt:hash`. Session lifetime is 12 hours. CORS allow-list is the two local Vite origins. `TenantGuard` is class-level on `WorkforceController` and absent on `AuthController`.

---

*Architecture analysis: 2026-11-09*
