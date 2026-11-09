---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
# External Integrations

**Analysis Date:** 2026-11-09

## APIs & External Services

**Third-party HTTP APIs:**

- None. No Stripe, Supabase, AWS SDK, email, SMS, OAuth, or LLM client appears in `package.json` files or `pnpm-lock.yaml`. Application `fetch` calls stay on loopback or same-origin `/api`.

**First-party HTTP (the only network API):**

- NestJS API in `apps/api/src/main.ts`, controllers in `apps/api/src/app.module.ts`. Binds `127.0.0.1` and `API_PORT` (default `4317`).
- Browser client: `apps/web/src/api.ts`. Vite proxies `/api` to `http://127.0.0.1:4317` (`apps/web/vite.config.ts`).
- Auth header pair on every protected call: `authorization: Bearer <token>` and `x-tenant-id`.

Routes to keep stable when adding a client:

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| `GET` | `/api/health` | none | `AuthController.health` |
| `POST` | `/api/auth/login` | none | `AuthController.login` |
| `GET` | `/api/summary` | bearer + tenant | `WorkforceController.summary` |
| `GET` | `/api/desk` | bearer + tenant | `WorkforceController.desk` |
| `GET` | `/api/employees/:id` | bearer + tenant | `WorkforceController.employee` |
| `POST` | `/api/tasks` | bearer + tenant | `WorkforceController.createTask` |
| `POST` | `/api/sync/events` | bearer + tenant | `WorkforceController.sync` |
| `POST` | `/api/reports/:id/accept` | bearer + tenant | `WorkforceController.accept` |
| `GET` | `/api/files/:id` | bearer + tenant | `WorkforceController.file` |

`GET /api/files/:id` returns `{ id, object_key, filename }` from Postgres. It does not stream object bytes.

**Object storage (declared, not called):**

- MinIO in `docker-compose.yml` (`minio/minio:RELEASE.2025-04-22T22-12-26Z`), S3 API on host port `9100`, console on `9101`.
- SDK/Client: none. No `@aws-sdk/*` and no `minio` package in `pnpm-lock.yaml`. No source file reads `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, or `S3_REGION`.
- Auth: those five names exist only in `.env.example`.
- Metadata for a file lives in `stored_files` (`apps/api/sql/001_init.sql`). Keys are strings `{tenantId}/{fileId}/{filename}` built by `objectKey` in `packages/domain/src/rules.ts`. `WorkforceService.file` in `apps/api/src/workforce.service.ts` rejects a key that fails `keyBelongsToTenant`.
- Seed inserts one foreign-tenant row in `apps/api/src/seed.ts`. It does not upload an object.
- To store bytes, add a client that reads the `S3_*` variables and call it from `WorkforceService`. Do not invent a second key layout; keep `objectKey`.

## Data Storage

**Databases:**

- PostgreSQL, one database for product tables and the pg-boss queue.
  - Connection: `DATABASE_URL` (application role) and `ADMIN_DATABASE_URL` (migration role), both read in `apps/api/src/db.ts`. Host and port for local development are `127.0.0.1:54329`.
  - Client: `pg` `Pool` via `createPool()`. Tenant-scoped work goes through `withTenant`, which sets `app.tenant_id` and `app.user_id` for the transaction and commits or rolls back.
  - Schema: `apps/api/src/migrate.ts` executes `apps/api/sql/001_init.sql` with the admin pool.
  - Application role: `helios_app`, `NOSUPERUSER NOBYPASSRLS NOCREATEDB`, created by `scripts/db.mjs` and by `docker/init.sql`. Grants are at the bottom of `apps/api/sql/001_init.sql`.
  - Row-level security: `ENABLE` and `FORCE` plus policy `tenant_isolation` on tenant-owned tables. The predicate is `tenant_id = app_tenant()` (`apps/api/sql/001_init.sql`). `users` and `sessions` are not tenant-scoped. Login membership lookup is `memberships_for_login(uuid)`, `SECURITY DEFINER`.
  - Local process (the one `pnpm db:up` starts): `embedded-postgres` 18.6.0-beta.19 in `scripts/db.mjs`. Data directory `.data/pg` (gitignored). The script exits immediately if something is already accepting connections on `54329`.
  - Alternate container: `docker-compose.yml` service `postgres`, image `postgres:16-alpine`, published as `54329:5432`, volume `helios_pg`, init script `docker/init.sql`. Do not start it while `scripts/db.mjs` owns the port. The two servers are different major versions (embedded 18 beta vs image 16).

Open a tenant transaction like `apps/api/src/db.ts`:

```ts
await client.query("BEGIN");
await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
```

Use the application pool (`DATABASE_URL`) for requests, seed, and the worker. Use the admin pool (`ADMIN_DATABASE_URL`) only from `apps/api/src/migrate.ts`. New tables that hold tenant data need the same RLS loop as the tables listed in `001_init.sql`.

**Queue (same database, not a separate broker):**

- pg-boss 12.38.1. Connection string is `appUrl` (`apps/api/src/jobs.ts`). Queue name is `QUEUE_WORK_REPORT` from `packages/domain`.
- API `BossHost` starts the boss and calls `ensureQueue` (`retryLimit: 5`, `retryDelay: 1`, `expireInSeconds: 120`).
- Worker `apps/worker/src/main.ts` calls `boss.work` and `processReportJob`. Per-tenant in-process cap is `maxPerTenant = 1` in `apps/api/src/jobs.ts`.
- Idempotency row: `report_effects` (`tenant_id`, `report_id`) in `apps/api/sql/001_init.sql`.
- Publishing from an open transaction uses `boss.send(..., { db: queryClient(client), group: { id: tenantId } })` in `WorkforceService.recordAndMaybeRollback` (`apps/api/src/workforce.service.ts`). Pass the same client so a SQL rollback drops the job.

**File storage:**

- Metadata in Postgres table `stored_files`.
- Object bytes: not implemented. MinIO is only a Compose service (`docker-compose.yml` volume `helios_files`). See the object-storage note above.

**Browser storage (not a server):**

- `localStorage` keys:
  - `helios.session` — `apps/web/src/api.ts`
  - `helios.theme` — `apps/web/src/App.tsx`
  - `helios.outbox.<tenantId>.<userId>` — offline queue in `apps/web/src/outbox.ts`
  - per-task checklist keys written in `apps/web/src/field.tsx`
- Cache API: `apps/web/public/sw.js`, cache `helios-shell-v1`, shell documents only. Requests under `/api` are not cached.
- No IndexedDB, Redis, or other cache.

**Caching:**

- None on the server. Do not add a shared cache until a deploy target exists. The service worker must keep skipping `/api`.

## Authentication & Identity

**Auth provider:**

- Custom, in-process. No OAuth, OIDC, session cookie library, or JWT library.
- Implementation:
  - Passwords: `scrypt` via `node:crypto` in `apps/api/src/password.ts`. Stored form is `scrypt:<salt hex>:<hash hex>`. Verification uses `timingSafeEqual`.
  - Tokens: `randomBytes(32).toString("hex")` returned to the client once. The database stores `sha256` of the token (`hashToken`). Table `sessions` (`apps/api/sql/001_init.sql`) holds `user_id`, `token_hash`, `expires_at`.
  - Lifetime: `now() + interval '12 hours'` on insert in `apps/api/src/auth.service.ts`.
  - Login: `POST /api/auth/login` looks up `users` by lowercased email, checks the password, inserts a session, and returns memberships from `memberships_for_login`.
  - Request auth: `TenantGuard` in `apps/api/src/app.module.ts` strips `Bearer`, reads `x-tenant-id`, and calls `AuthService.actor`. Missing token is HTTP 401 `unauthorized`. Unknown session or inactive membership is HTTP 403 `tenant_denied`.
  - Client persistence: the raw bearer token is stored in `localStorage` under `helios.session` (`apps/web/src/api.ts`). The web app uses the first membership as `tenantId` and `role`.
- Demo identities are inserted by `apps/api/src/seed.ts` from `DEMO_USERS` in `@helios/domain`. `PASSPORT.md` documents the pilot login. Do not copy that password into new docs.
- Roles allowed by the schema check: `director`, `master`, `worker`, `pto` (`memberships.role` in `apps/api/sql/001_init.sql`). Worker-only desk filters and `role_denied` on task create and report accept live in `apps/api/src/workforce.service.ts`.

Add a new authenticated route with `@UseGuards(TenantGuard)` on the controller (the pattern on `WorkforceController`). Do not trust a tenant id from the JSON body; `TenantGuard` is what sets `request.actor`.

## Monitoring & Observability

**Error tracking:**

- None. No Sentry, OpenTelemetry, or metrics package.

**Logs:**

- `console.log` for process start (`apps/api/src/main.ts`, `apps/worker/src/main.ts`), migrate (`apps/api/src/migrate.ts`), and seed (`apps/api/src/seed.ts`).
- `console.error` for HTTP 500s in `AllExceptionsFilter` (`apps/api/src/http.ts`). The response body for status ≥ 500 is `{ error: "internal" }`; lower statuses return the exception message.
- The worker redacts the password in the connection string before logging (`appUrl.replace(/:[^:@/]+@/, ":***@")` in `apps/worker/src/main.ts`). Keep that redaction if the log line changes.
- Tests boot Nest with `{ logger: false }` (`apps/api/test/foundation.test.ts`).
- Product audit rows, separate from process logs: table `audit_log`, written by `WorkforceService` for `task_created` and `volume_accepted`.

## CI/CD & Deployment

**Hosting:**

- None. No Dockerfile for the apps, no platform config, no reverse proxy. The API listens on loopback only (`apps/api/src/main.ts`).

**CI pipeline:**

- None. No `.github` workflows and no other CI config.

Local verification commands are in `PASSPORT.md`: `corepack pnpm test` and `curl -s http://127.0.0.1:4317/api/health` (expects `{"ok":true}`). `pnpm test` runs `packages/domain` rules and `apps/api/test/foundation.test.ts`. The API test needs Postgres up.

## Environment Configuration

**Required env vars:**

- `DATABASE_URL` — application role connection string. Read by `apps/api/src/db.ts`. Fallback exists for local `127.0.0.1:54329` when unset.
- `ADMIN_DATABASE_URL` — migration role connection string. Read by `apps/api/src/migrate.ts` through `adminUrl`.
- `API_PORT` — optional. Default `4317` in `apps/api/src/main.ts`.

**Declared but unused:**

- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_REGION`

Names only. Values belong in `.env`, which is gitignored, or in the local process environment. `.env.example` is the committed template.

**Secrets location:**

- `.env` — listed in `.gitignore`, not present in the tree. `PASSPORT.md` says it is not part of a git checkout.
- `.env.example` — committed names and local examples. Do not quote it into other files.
- Local fallbacks and the embedded-server bootstrap contain development credentials in `apps/api/src/db.ts` and `scripts/db.mjs`.
- `docker-compose.yml` sets `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MINIO_ROOT_USER`, and `MINIO_ROOT_PASSWORD` for the optional containers. `docker/init.sql` sets the application role password. Treat those as local compose credentials. Do not copy the values into source, docs, or a new environment file.

There is no secrets manager, no KMS, and no sealed production config.

## Webhooks & Callbacks

**Incoming:**

- None. No route under `apps/api/src/app.module.ts` is a third-party callback. `POST /api/sync/events` accepts the web client's own outbox (`apps/web/src/outbox.ts` → `syncEvents` in `apps/web/src/api.ts`), not an external webhook.

**Outgoing:**

- None. The API and worker talk to Postgres only. The web app's `fetch` targets relative `/api` paths. The service worker's `fetch` is the browser Cache API fallback and returns early for `/api` (`apps/web/public/sw.js`).

---

*Integration audit: 2026-11-09*
