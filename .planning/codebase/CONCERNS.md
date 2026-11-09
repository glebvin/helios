---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
# Codebase Concerns

**Analysis Date:** 2026-11-09

## Tech Debt

**Acceptance and task creation are demo constants, not user input:**
- Issue: The desk always accepts quantity `"17"` and always creates a task with planned quantity `"40"` and unit `"м²"`. The inbox button is labeled with that same constant. Partial acceptance in `packages/domain/src/rules.ts` is real, but the client never sends the submitted amount or a typed amount.
- Files: `apps/web/src/App.tsx`, `apps/web/src/inbox.tsx`, `apps/web/src/field.tsx`, `apps/web/src/board.tsx`
- Impact: A worker submission of the phone default `"12"` cannot be accepted (`"17"` is above submitted). A submission above `"17"` is stored as a partial accept with no one choosing the figure. Every new task is the same quantity and unit, on today's client date, on one hardcoded project.
- Fix approach: Pass `submitted_quantity` (or an edited decimal) into `acceptReport`. Send `plannedQuantity`, `unit`, `workDate`, and `projectId` from the create form. Reject the request in `WorkforceService.accept` and `createTask` before SQL.

**Domain rules stop at the package boundary:**
- Issue: `validateRoute`, `maySign`, `mayPublish`, `mayReinspect`, `documentaryReadiness`, `efficiency`, and `attributeCrewVolume` are implemented and unit-tested, then never called from `apps/api` or `apps/web`. The API only uses `assertSameScope`, `partialAcceptance`, `stableEventBody`, `keyBelongsToTenant`, and the id constants.
- Files: `packages/domain/src/rules.ts`, `apps/api/src/workforce.service.ts`, `apps/web/src/field.tsx`
- Impact: Signing routes, publication gates, defect reinspection, crew volume, and documentary money exist only as a library. The quality screen says the records are not there yet. The phone checklist (`flat` / `seam` / `photo`) is written to `localStorage` and does not call `mayPublish`.
- Fix approach: When a workflow needs one of these rules, call it inside the same transaction as the write in `apps/api/src/workforce.service.ts`. Keep the pure function in `packages/domain`. Do not reimplement the comparison in the React layer.

**`version` columns do not lock updates:**
- Issue: `daily_tasks.version`, `shifts.version`, and `work_reports.version` increment, and report jobs carry `version`, but no `UPDATE` predicate checks the version the client saw. `processReportJob` ignores `version` and conflicts only on `(tenant_id, report_id)`.
- Files: `apps/api/sql/001_init.sql`, `apps/api/src/workforce.service.ts`, `apps/api/src/jobs.ts`
- Impact: Two masters accepting the same report both succeed; the last write wins and the previous accepted quantity is gone. A repeated worker delivery does not re-apply by version; it is a no-op even if the report later changes.
- Fix approach: `UPDATE ... WHERE id = $1 AND version = $expected`, return 409 on zero rows, and put the accepted version in the audit row.

**Schema is one re-runnable script, not a migration history:**
- Issue: `apps/api/src/migrate.ts` reads `apps/api/sql/001_init.sql` and runs it as a single batch with no `schema_migrations` table and no `BEGIN`. Objects use `IF NOT EXISTS` or `CREATE OR REPLACE`. Policies are dropped and recreated on every migrate.
- Files: `apps/api/src/migrate.ts`, `apps/api/sql/001_init.sql`
- Impact: A failure halfway through leaves the database half-applied. Editing a column that already exists does nothing on the next run. There is no down migration.
- Fix approach: Add ordered migration files and a `schema_migrations` table. Wrap each file in a transaction. Stop rewriting `001_init.sql` for changes that existing databases must pick up.

**Dead UI and an unused summary payload:**
- Issue: `ForemanPhone` is exported and never mounted. `ActivityRings` is the only export of `@helios/ui`, and `apps/web` lists that package but never imports it. `GET /api/summary` and `desk.summary` always return `sample: true` with fixed rings (`72 / 90`, `6 / 20`, `4 / 12`). The desk computes its own counts and never reads `data.summary`. `clock_requires_review` is selected and returned, and no component reads it.
- Files: `apps/web/src/field.tsx`, `apps/web/src/director.tsx`, `packages/ui/src/activity.tsx`, `packages/ui/src/index.ts`, `apps/web/package.json`, `apps/api/src/workforce.service.ts`, `apps/web/src/api.ts`
- Impact: The "учебные цифры" label never reaches a person, so a later reader can treat the rings as live. Clock-order problems are stored and then invisible. Two copies of "today" metrics can drift (`summaryCounts` versus the overview counters).
- Fix approach: Either render `summary` with the `sample` label kept visible, or stop sending the rings until they are computed from `daily_tasks` and `shifts`. Mount one field shell. Show `clock_requires_review` on the shift card.

**Test-only write path lives on the production service:**
- Issue: `recordAndMaybeRollback` opens its own transaction, inserts a `work_reports` row for `SELECT id FROM daily_tasks LIMIT 1` (no `ORDER BY`), and publishes a pg-boss job on that same client. Nothing in `apps/api/src/app.module.ts` exposes it. `apps/api/test/foundation.test.ts` calls it to prove rollback.
- Files: `apps/api/src/workforce.service.ts`, `apps/api/test/foundation.test.ts`
- Impact: The next person to wire this method to HTTP gets an unbounded insert plus a queue send. `LIMIT 1` can attach the probe to an arbitrary task.
- Fix approach: Move the probe into the test file. Keep production writes on `withTenant` in `apps/api/src/db.ts`.

**Decimal scales disagree:**
- Issue: `parseDecimal` keeps 6 fractional digits (`SCALE = 1_000_000n`). `work_reports.submitted_quantity` and `daily_tasks.planned_quantity` are `numeric(14, 3)`. `submitVolume` does not call `parseDecimal`; it uses `Number(quantity) <= 0`. `divDecimal` returns `"0"` when the divisor is zero instead of failing.
- Files: `packages/domain/src/decimal.ts`, `apps/api/sql/001_init.sql`, `apps/api/src/workforce.service.ts`
- Impact: `"1.2345"` is accepted by the domain helper and rounded by Postgres. `"1e2"` and `"18abc"` pass the `Number` guard (`NaN <= 0` is false) and then fail inside Postgres. A zero divisor becomes a quiet `"0"` if a caller skips the guard in `efficiency`.
- Fix approach: Parse with `parseDecimal` at the service boundary, quantize to 3 places before insert, and throw a 422 `HttpException`. Make `divDecimal` throw on a zero divisor.

**No lint, format, or CI gate:**
- Issue: There is no ESLint, Prettier, or Biome config, and no `.github` workflow. `tsconfig.base.json` sets `"strict": true` and `"noEmit": true`. `pnpm test` is the only check, and it needs a live Postgres.
- Files: `package.json`, `tsconfig.base.json`, `apps/api/package.json`, `packages/domain/package.json`
- Impact: A broken web build or an untyped `as` cast ships without a failing check. API tests do not run in a clean job.
- Fix approach: Add a typecheck script per package and a test job that boots Postgres the way `scripts/db.mjs` does, then run `pnpm test`.

## Known Bugs

**Accepting the worker's default volume returns a generic failure:**
- Symptoms: The phone submits `"12"` unless the person edits the field. `onAccept` posts `acceptedQuantity: "17"`. `partialAcceptance` throws `Error("invalid_quantity")`. That error is not an `HttpException`, so `AllExceptionsFilter` responds `500` with `{ "error": "internal" }`. The desk shows the raw code `internal`.
- Files: `apps/web/src/field.tsx`, `apps/web/src/App.tsx`, `packages/domain/src/rules.ts`, `apps/api/src/workforce.service.ts`, `apps/api/src/http.ts`
- Trigger: Log in as the worker, start a shift, submit the prefilled volume, then accept that report from the director desk or the "Принять 17" button.
- Workaround: Submit at least `"17"` (the board and the foreman review default to `"18"`, which happens to pass).

**Ending a shift can close someone else's open row:**
- Symptoms: `finishShift` selects `WHERE task_id = $1 AND status = 'open' ORDER BY started_at DESC LIMIT 1`. The payload has no `employeeId`. The newest open shift on that task is finished, including another person's.
- Files: `apps/api/src/workforce.service.ts`, `apps/web/src/App.tsx`
- Trigger: Two employees have open shifts on the same task (the start check is per employee, so this is allowed). The worker taps "Завершить смену".
- Workaround: Keep only one open shift per task until the `UPDATE` is scoped with `employee_id` and the caller's employee.

**A bad outbox event stalls every later event and is described as offline:**
- Symptoms: `sync` applies events in a loop, each in its own transaction. The first failure throws and later events in that request never run. `flush` marks the batch `sent` only when the whole request succeeds. The `catch` always sets "Нет связи", including for `422`, `403`, and `409`.
- Files: `apps/api/src/workforce.service.ts`, `apps/web/src/App.tsx`, `apps/web/src/outbox.ts`
- Trigger: Queue a `submit_volume` with quantity `"0"` or a `shift_end` before a start, then queue a valid event behind it. Stay online and flush.
- Workaround: Delete the `helios.outbox.<tenant>.<user>` localStorage key. The fix is to return per-event results, mark only applied ids `sent`, and surface `body.error` from the API.

**One task is summarized by a single report:**
- Symptoms: `laneOf`, progress, and the inbox use `reports.find` on `task_id`. `desk` orders reports by `created_at DESC`, so the newest row wins. An older unaccepted report disappears from the lane. A newest accepted row marks the whole task accepted.
- Files: `apps/web/src/model.ts`, `apps/api/src/workforce.service.ts`, `apps/web/src/director.tsx`, `apps/web/src/inbox.tsx`
- Trigger: Submit two volumes for one task and accept only the latest.
- Workaround: None in the UI. Aggregate by task (sum, or an explicit report id on the card) before choosing a lane.

**Creating a task always targets `PROJECT_A`:**
- Symptoms: `createTask` inserts `project_id = PROJECT_A` and ignores `desk.projects`. A tenant without that id fails the foreign key. `mapPgError` turns `23503` into `422 reference_denied`. The object `<select>` in the desk has a single option and does not post an id.
- Files: `apps/api/src/workforce.service.ts`, `packages/domain/src/ids.ts`, `apps/web/src/director.tsx`, `apps/api/src/errors.ts`
- Trigger: Seed a second project, or call `POST /api/tasks` as the tenant B director.
- Workaround: Use the pilot tenant only. The insert must take `projectId` and verify the row inside `withTenant`.

**Check failures are reported as a bad reference:**
- Symptoms: `mapPgError` maps both `23503` (foreign key) and `23514` (check) to `reference_denied`. `submitted_quantity > 0` and the accepted-quantity bound are checks. A quantity that rounds to `0` at `numeric(14, 3)` comes back as a reference error.
- Files: `apps/api/src/errors.ts`, `apps/api/sql/001_init.sql`
- Trigger: `POST /api/sync/events` with `quantity: "0.0004"`.
- Workaround: None. Split the SQLSTATE map: `23514` → `422 invalid_quantity`, `23505` → `409`, and leave unknown codes as `500 internal` without the driver message.

**A concurrent duplicate event becomes 500:**
- Symptoms: Idempotency is `SELECT` then, after the write, `INSERT` into `client_events`. The unique key is `(tenant_id, user_id, event_id)`. Two overlapping requests both pass the `SELECT` under `READ COMMITTED`. One commits; the other hits `23505`, which is not mapped, and the filter returns `internal`. The loser's report insert rolls back with `withTenant`, so the row is not doubled, but the client treats it as a hard failure and will retry.
- Files: `apps/api/src/workforce.service.ts`, `apps/api/src/db.ts`, `apps/api/src/errors.ts`
- Trigger: Two overlapping `POST /api/sync/events` with the same `eventId`.
- Workaround: Retry. Catch `23505`, reload the stored `result`, and return it with `duplicate: true`.

**`today` on the phone and `CURRENT_DATE` in SQL can be different days:**
- Symptoms: `todayKey` formats the browser's local date. Summary counts use `work_date = CURRENT_DATE`. `tenants.timezone` defaults to `Europe/Moscow` and is never read. Task lists in the UI filter with `todayKey`, so the desk can hide a row the summary still counts, or the reverse, across midnight.
- Files: `apps/web/src/model.ts`, `apps/api/src/workforce.service.ts`, `apps/api/sql/001_init.sql`
- Trigger: Browser timezone other than the database timezone, with a task dated on the boundary.
- Workaround: Stay in one timezone. Compare dates in the tenant zone on the server and return that date to the client.

**Corrupt localStorage takes down the shell:**
- Symptoms: `loadSession` and `readOutbox` call `JSON.parse` with no guard. A truncated value throws during the first render, before the login form.
- Files: `apps/web/src/api.ts`, `apps/web/src/outbox.ts`
- Trigger: Write `helios.session` or `helios.outbox.*` as non-JSON and reload.
- Workaround: Clear those keys. Parse inside try/catch and drop the bad key.

## Security Considerations

**Pilot passwords ship in the browser and sign in as a real role:**
- Risk: `DEMO_USERS` in `packages/domain/src/ids.ts` holds the pilot passwords. `apps/web/src/App.tsx` repeats them in `entries`, in the form `defaultValue`, and in `switchRole`. `RoleSwitch` logs into director, master, or worker from any screen. Seed inserts those hashes with `ON CONFLICT (id) DO NOTHING`, so a later password change in source does not replace a hash already stored.
- Files: `packages/domain/src/ids.ts`, `apps/web/src/App.tsx`, `apps/web/src/roles.tsx`, `apps/api/src/seed.ts`, `PASSPORT.md`
- Current mitigation: `apps/api/src/main.ts` listens on `127.0.0.1` and CORS allows only `http://127.0.0.1:5173` and `http://localhost:5173`. That holds only for this bind.
- Recommendations: Remove the role switcher and prefilled passwords from any build that is not a local fixture. Seed demo users only when a dev flag is set. On conflict, update the hash in development or skip seed users entirely in a shared database.

**The session token lives in `localStorage` and logout does not revoke it:**
- Risk: `saveSession` stores the bearer token under `helios.session`. Logout only removes that key. `POST /api/auth/login` inserts a row that expires after 12 hours and leaves older rows valid. There is no logout route, no rotation, and no cleanup of `sessions`. There is no Content-Security-Policy. Any script that can run on the origin can read the token.
- Files: `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/api/src/auth.service.ts`, `apps/web/index.html`, `apps/api/sql/001_init.sql`
- Current mitigation: Auth is a bearer header, not a cookie, so a foreign site does not get the token automatically. The API is bound to loopback.
- Recommendations: Add `DELETE /api/auth/session` that deletes `token_hash`. Call it from `logout`. Expire and delete old `sessions` on a schedule. Add a CSP that forbids inline script. Prefer a short-lived token plus server-side revoke over a 12-hour bearer in `localStorage`.

**Login has no throttle, and the password hash runs on the request thread:**
- Risk: `verifyPassword` uses `scryptSync`, which blocks the Node thread. Missing users return before scrypt, so response time reveals whether the email exists. `POST /api/auth/login` has no rate limit, lockout, or attempt audit.
- Files: `apps/api/src/password.ts`, `apps/api/src/auth.service.ts`, `apps/api/src/app.module.ts`
- Current mitigation: Unknown email and bad password share the message `unauthorized`. Tokens are 32 random bytes, stored as SHA-256.
- Recommendations: Run scrypt even when the user row is missing (compare against a dummy hash). Move hashing off the request thread (`scrypt` callback or a worker). Limit attempts per email and per source address. Audit failures in `audit_log`.

**`users` and `sessions` are outside row-level security, and the app role is broad:**
- Risk: RLS is forced on tenant tables and not on `users` or `sessions`. `helios_app` is granted `SELECT, INSERT, UPDATE, DELETE` on every table in `public`, plus `CREATE` on the database. `memberships_for_login` is `SECURITY DEFINER` and returns every active membership for a user id with no tenant argument. The same role owns the pg-boss schema because the worker connects as `helios_app`. A bug or injection that uses this role can read every password hash and enqueue a job for any tenant. Current queries pass parameters; there is no string-built SQL in the services.
- Files: `apps/api/sql/001_init.sql`, `docker/init.sql`, `scripts/db.mjs`, `apps/api/src/db.ts`, `apps/worker/src/main.ts`
- Current mitigation: `helios_app` is `NOBYPASSRLS`. Tenant policies use `tenant_id = app_tenant()`, and `app_tenant()` is null outside `withTenant`, which the pool test asserts. `set_config(..., true)` is transaction-local.
- Recommendations: Split a login role (users, sessions, the definer function) from the tenant role. Revoke `UPDATE` and `DELETE` on `audit_log`. Revoke `CREATE` once pg-boss's schema exists, or run the boss as its own role. Keep `search_path` pinned on the definer, as it is now.

**Local database and object-store credentials are committed:**
- Risk: Default connection strings with passwords are in source. Compose and the embedded-Postgres bootstrap create the same local roles and an object-store root user. `.gitignore` ignores `.env`. `.env.example` is present; its values were not read.
- Files: `apps/api/src/db.ts`, `scripts/db.mjs`, `docker-compose.yml`, `docker/init.sql`, `.gitignore`
- Current mitigation: Defaults point at `127.0.0.1:54329`. They are local bootstrap credentials, not a hosted secret, and they become production credentials if those defaults are left in place.
- Recommendations: Require `DATABASE_URL` and `ADMIN_DATABASE_URL` outside development. Do not fall back to a password in `db.ts` when `NODE_ENV` is production. Keep compose secrets out of the repo when this stack is shared.

**A worker token can read every colleague's phone and document number, and can write shifts and volumes for any employee in the tenant:**
- Risk: `desk` selects `phone` and `document_number` for all `employees` with no role filter. The worker task and shift queries are filtered; the employee list is not. The TypeScript `Desk` type omits `document_number`, but the JSON still contains it. `startShift` checks that the pair is not already open. It does not check that the caller owns `employeeId` or that the task assignee is that employee. `submitVolume` checks a positive number and the foreign key, not the assignee. `GET /api/files/:id` checks the object-key prefix and not the role, so a worker who knows a file id receives `object_key` and `filename`. `createTask` and `accept` are the only routes that reject `worker`.
- Files: `apps/api/src/workforce.service.ts`, `apps/api/src/app.module.ts`, `apps/web/src/api.ts`
- Current mitigation: Cross-tenant reads fail closed. The foundation test checks tenant A cannot see tenant B's employee, file, or desk. Within the tenant, role checks are mostly left to the UI.
- Recommendations: For `worker`, return only that user's employee row, and omit `document_number` unless the caller is director or master. In `startShift` and `submitVolume`, require the employee to match `employees.user_id` for workers, and the task assignee for everyone. Hide file metadata from `worker` the same way the list query already does.

**The audit log is mutable and incomplete:**
- Risk: `audit` inserts on task create, shift start, shift end, volume submit, and accept. It does not record login, logout, file reads, denied roles, or failed events. The app role can `UPDATE` or `DELETE` `audit_log`. There is no trigger forcing append-only, and no read API.
- Files: `apps/api/src/workforce.service.ts`, `apps/api/sql/001_init.sql`
- Current mitigation: Writes that do get audited run inside the same transaction as the change, so a rolled-back write does not leave an audit row.
- Recommendations: Revoke `UPDATE` and `DELETE` on `audit_log` from `helios_app`. Add a deny policy or a trigger. Log denials after the transaction that saw them, with the actor and the error code.

**Shift timestamps are client-supplied:**
- Risk: `occurredAt` is `new Date().toISOString()` on the device, then stored and compared as text against `toISOString()` of the stored start. A client can send a past or future timestamp. Only `finish < start` sets `clock_requires_review`. Nothing bounds skew, and the flag is not shown.
- Files: `apps/web/src/App.tsx`, `apps/api/src/workforce.service.ts`
- Current mitigation: `started_at` and `finished_at` are `now()` on the server. The client clock is a second pair of columns.
- Recommendations: Reject `occurredAt` that is not a parseable timestamp or that is outside a documented skew of server `now()`. Keep the review flag and show it on the shift.

## Performance Bottlenecks

**`GET /api/desk` loads the whole tenant history on every refresh:**
- Problem: One transaction runs employees, all tasks, all shifts, all reports, organizations, projects, files, and two counts. The web then filters to today in `dayTasks`. Every queued event calls `refresh` again.
- Files: `apps/api/src/workforce.service.ts`, `apps/web/src/model.ts`, `apps/web/src/App.tsx`
- Cause: No `work_date` predicate, no `LIMIT`, no cursor. Indexes `daily_tasks_day` and `shifts_employee` do not help a query that reads every row.
- Improvement path: Add `?date=` and paginate tasks, shifts, and reports. Keep the open-shift count in SQL. Refresh only after a successful flush, not once per keystroke path that already failed.

**Password checks block the API process:**
- Problem: `scryptSync` in the login path stalls every other request on that process while it runs.
- Files: `apps/api/src/password.ts`, `apps/api/src/auth.service.ts`
- Cause: Synchronous scrypt on the Nest event loop, with the default Node scrypt parameters.
- Improvement path: Use async `scrypt`. Cap concurrent login work.

**The worker and the API each open a pool and a pg-boss connection set:**
- Problem: `createPool()` uses the `pg` default of 10 clients. `createBoss()` sets `max: 4`. API and worker each construct both. A desk request holds one client for every query in the transaction. Login and `recordAndMaybeRollback` take more clients from the same pool.
- Files: `apps/api/src/db.ts`, `apps/api/src/jobs.ts`, `apps/api/src/app.module.ts`, `apps/worker/src/main.ts`
- Cause: No explicit pool budget, and the boss is started inside the API even though the API only publishes.
- Improvement path: Set `max` from configuration. Publish with a small pool. Let the worker be the only process that calls `boss.work`.

## Fragile Areas

**Tenant context is correct only when every statement stays on the `withTenant` client:**
- Files: `apps/api/src/db.ts`, `apps/api/src/workforce.service.ts`, `apps/api/src/auth.service.ts`
- Why fragile: `set_config(..., true)` dies at `COMMIT` or `ROLLBACK`. A query on `pool` instead of the passed client sees no tenant and returns zero tenant rows, or, for `users` and `sessions`, sees every row. `recordAndMaybeRollback` reimplements the transaction instead of calling `withTenant`. Login correctly uses the pool because RLS would hide memberships; that split is easy to copy into a tenant query.
- Safe modification: Add new tenant reads and writes only inside the callback passed to `withTenant`. Pass `queryClient(client)` into `boss.send` so the job insert joins the transaction, as `submitVolume` does.
- Test coverage: `apps/api/test/foundation.test.ts` checks that a fresh client sees an empty `app.tenant_id` and zero employees. It does not scan the service for pool queries.

**Offline behavior depends on the tab staying open:**
- Files: `apps/web/public/sw.js`, `apps/web/src/main.tsx`, `apps/web/src/outbox.ts`, `apps/web/index.html`
- Why fragile: The service worker precaches `/` and `/manifest.webmanifest` only, and only in production. Other requests are network-first, then `caches.match`. Script and CSS are module imports from `apps/web/src/main.tsx`, not precached. API calls are skipped. The outbox is localStorage, so a queued event survives a reload only if the shell itself loads. `pending` is cleared in the client when the batch returns, not when each result is checked. Sent events are never removed, so the key grows without a cap.
- Safe modification: Precache the built assets with a versioned cache name. Keep API uncached. Cap the outbox and drop `sent` rows after the server result is stored. Register the worker only after that precache list exists.
- Test coverage: `eventsForSync` is tested in `packages/domain/src/rules.test.ts`. The service worker, flush, and localStorage cap are not.

**Shift and report writes assume a quiet database:**
- Files: `apps/api/src/workforce.service.ts`, `apps/api/sql/001_init.sql`
- Why fragile: The open-shift check is `SELECT` then `INSERT` with no partial unique index on `(tenant_id, task_id, employee_id) WHERE status = 'open'`. Two concurrent starts can both insert. `finishShift` then closes one of them. `employees.user_id` has no foreign key to `users`. `client_events.user_id` and `audit_log.actor_user_id` have no foreign key either.
- Safe modification: Add the partial unique index and map `23505` to `409 already_started`. Add the foreign keys before relying on `user_id` for authorization.
- Test coverage: The foundation test covers a sequential duplicate event. It does not cover two overlapping shift starts.

**Embedded Postgres treats "port open" as "this data directory is ready":**
- Files: `scripts/db.mjs`, `PASSPORT.md`
- Why fragile: If anything accepts connections on `54329`, the script exits 0 and never checks the data directory or the role. `PASSPORT.md` says the port is one per machine. The process that does start Postgres waits forever and never calls `stop()`. A second Helios checkout can migrate and seed the first checkout's database.
- Safe modification: Identify the server (database name plus a Helios marker) before exiting. Stop the embedded server on `SIGINT`. Refuse to migrate when the reached server is not this checkout's `.data/pg`.
- Test coverage: None.

**The worker imports API source and has no shutdown path:**
- Files: `apps/worker/src/main.ts`, `apps/api/package.json`, `apps/api/src/app.module.ts`
- Why fragile: `@helios/api` exports `./db` and `./jobs` as TypeScript source. The worker and the API each call `createBoss` and `ensureQueue`. `BossHost` stops with `{ graceful: false }`. The worker never handles `SIGTERM`, so an active job waits for `expireInSeconds: 120` and then retries. `localGroupConcurrency: 1` and the in-process `inflight` map enforce one job per tenant only inside that process. A second worker process does not see the map.
- Safe modification: One publisher, one worker, graceful `boss.stop()`. Put the per-tenant limit in Postgres (advisory lock or a queue group the worker is the only consumer of) if more than one worker will run.
- Test coverage: `processReportJob` is called twice in the foundation test and the effect row stays at one. The test does not start `apps/worker/src/main.ts`.

## Scaling Limits

**One heavy report job per tenant is local to the process:**
- Current capacity: `maxPerTenant = 1` in a module-level `Map`, plus pg-boss `localGroupConcurrency: 1` and `localConcurrency: 2` in the worker. Retry limit is 5, retry delay is 1 second, expiry is 120 seconds.
- Limit: Two worker processes will run two jobs for the same tenant. The effect table still refuses a second row for the same `report_id`. Different reports for one tenant can run together across processes. `tenant_busy` burns a retry.
- Scaling path: Keep a single worker until the limit lives in the database. Do not raise `localGroupConcurrency` and expect the `Map` to cover other machines.

**Desk and session tables grow without a bound:**
- Current capacity: Pilot seed is four users and two tenants. Desk returns every task, shift, report, and file. `sessions` and `client_events` only insert. The outbox keeps every sent event.
- Limit: The first long-lived tenant will send its full history on each `GET /api/desk`. Expired sessions remain usable as lookup rows forever. localStorage quotas drop the outbox writes.
- Scaling path: Paginate desk queries. Delete expired sessions. Store idempotency results with a retention window. Trim `sent` outbox entries.

**Connection budget is the default pool:**
- Current capacity: About 10 `pg` clients plus 4 boss clients per process, times two processes, against one Postgres on port `54329`.
- Limit: Concurrent desk requests plus login plus the worker exhaust the pool and wait. Embedded Postgres is a development server.
- Scaling path: Explicit pool sizes, a real Postgres, and a desk query that does not hold a transaction open for eight round trips.

## Dependencies at Risk

**`embedded-postgres` is a beta pinned for local bootstrap:**
- Risk: Root `package.json` depends on `embedded-postgres` `18.6.0-beta.19`. `pnpm-workspace.yaml` allows the build of `@embedded-postgres/darwin-arm64`. `docker-compose.yml` offers Postgres 16 instead, with a different bootstrap (`docker/init.sql`).
- Impact: A beta bump can break `pnpm db:up` on arm64. Compose and the embedded server can disagree about roles if only one path is used.
- Migration plan: Move local development onto the Postgres 16 service, or pin a stable embedded build and test both boot paths.

**`motion` is depended on twice at different ranges:**
- Risk: `apps/web/package.json` depends on `motion` `^12.43.0`. `packages/ui/package.json` depends on `motion` `^12.23.24` and also lists React as a direct dependency and a peer. The web app does not import `@helios/ui`.
- Impact: A future import of `ActivityRings` can load a second Motion runtime beside `apps/web/src/board.tsx` and `apps/web/src/inbox.tsx`.
- Migration plan: One `motion` range at the workspace root. Make `packages/ui` a peer of that range before the web imports it.

**Queue behavior is pinned to pg-boss 12:**
- Risk: `pg-boss` is pinned to `12.38.1` in `apps/api` and `apps/worker`. NestJS is ranged at `^11.1.6`. The job call passes a custom `db` client so the insert shares the request transaction. That option is version-specific.
- Impact: A pg-boss upgrade that ignores `db` will publish a job that survives the rollback `recordAndMaybeRollback` is meant to prove, or the reverse: a commit whose job never lands.
- Migration plan: Keep the pin until an upgrade test asserts the rollback case in `apps/api/test/foundation.test.ts` still sees zero `pgboss.job` rows.

**MinIO is declared and unused:**
- Risk: `docker-compose.yml` runs MinIO. No package depends on an S3 client. `stored_files` holds `object_key` and `filename` only.
- Impact: The compose file teaches operators that files are stored. They are not. The image and the open ports are extra surface for a stack that does not upload.
- Migration plan: Remove the service until `WorkforceService.file` streams bytes, or add the client and a private bucket whose key is `objectKey` from `packages/domain/src/rules.ts`.

## Missing Critical Features

**Documents, quality, and PTO are placeholders:**
- Problem: The quality section renders an empty message. Documents list filenames from `stored_files` and do not download. "Передать в ПТО" calls `accept`, which sets `accepted_quantity`. The `pto` role is allowed by the membership check constraint and has no seed user and no distinct permissions. Problem text and the break toggle stay in component state or `localStorage`.
- Blocks: A real handover to a PTO reviewer, photo evidence, and a defect loop (`mayReinspect`).

**Files are a key check without an object store:**
- Problem: `GET /api/files/:id` returns metadata after `keyBelongsToTenant`. Nothing uploads, signs, or deletes an object. `docs/architecture/spec.json` describes S3 once MinIO is up.
- Blocks: Photos on the checklist, and any document the desk lists as a file.

**One membership is chosen by array order:**
- Problem: `login` in `apps/web/src/api.ts` uses `memberships[0]`. `memberships_for_login` has no `ORDER BY`. There is no tenant switcher.
- Blocks: A person who belongs to two cabinets. The seed users each have one membership, so the pilot hides this.

**Server session is not part of logout:**
- Problem: Logout is local only. Role switch logs in as another pilot user and leaves the previous session row in place.
- Blocks: A lost laptop or a shared browser cannot end access before the 12-hour expiry.

**No production runtime:**
- Problem: There is no Dockerfile, process manifest, or host config. Health returns `{ ok: true }` and does not query Postgres. The worker has no health signal.
- Blocks: A deploy that should fail when the database or the queue is down.

**Tenant timezone is stored and ignored:**
- Problem: `tenants.timezone` is never selected. Scheduling uses the database clock and the browser clock.
- Blocks: A cabinet that must operate in `Europe/Moscow` while the server or the phone is elsewhere.

## Test Coverage Gaps

**HTTP coverage is one shared-database file:**
- What's not tested: Login throttle and the timing path, session revoke, role denial on `startShift` and `submitVolume`, `finishShift` choosing the wrong employee, accept of a quantity above submitted (the 500 path), `23514` versus `23503`, concurrent duplicate `eventId`, partial unique shifts, `PROJECT_A` on a second project, worker visibility of `document_number`, and file access by role.
- Files: `apps/api/test/foundation.test.ts`, `apps/api/src/workforce.service.ts`, `apps/api/src/auth.service.ts`
- Risk: The tenant-isolation cases pass while the worker-volume accept bug and the shift-close bug stay untested.
- Priority: High

**Tests write the pilot database and do not clean up:**
- What's not tested: Isolation. The file logs in as the seed users, inserts a task titled "Облицовка стен", submits a volume, and leaves those rows. It requires Postgres already listening. There is no transaction wrapped around the suite and no delete in `test.after` beyond closing the app and the pool.
- Files: `apps/api/test/foundation.test.ts`, `apps/api/src/seed.ts`
- Risk: Re-runs accumulate tasks and reports. A second checkout pointed at the same port corrupts the first tenant's desk. Order and leftover rows make failures look like product bugs.
- Priority: High

**The web app has no tests:**
- What's not tested: `laneOf`, `todayKey`, `progress`, outbox flush, poison-event retention, the hardcoded accept and create payloads, service worker caching, and session JSON parse failure.
- Files: `apps/web/src/model.ts`, `apps/web/src/outbox.ts`, `apps/web/src/App.tsx`, `apps/web/public/sw.js`
- Risk: The accept constant and the offline copy can change without a failing check. `pnpm test` never starts Vite.
- Priority: High

**Domain tests do not cover the helpers the API can misuse:**
- What's not tested: `divDecimal` on zero, `parseDecimal` rejection of exponent notation, scale mismatch with `numeric(14, 3)`, and `keyBelongsToTenant` on a key that starts with the tenant id but is not `objectKey` output. Happy paths for routes, signatures, lots, and crew volume are covered, and those functions are still unwired.
- Files: `packages/domain/src/rules.test.ts`, `packages/domain/src/decimal.ts`, `packages/domain/src/rules.ts`
- Risk: A service that starts calling `divDecimal` or `Number()` will not be caught by the existing domain tests.
- Priority: Medium

**The worker process is untested:**
- What's not tested: `apps/worker/src/main.ts` startup, graceful stop, `tenant_busy` retry behavior, and two processes consuming one group.
- Files: `apps/worker/src/main.ts`, `apps/api/src/jobs.ts`
- Risk: A pg-boss upgrade or a second worker can double-run different reports for one tenant while the in-process map still looks correct in a unit call.
- Priority: Medium

---

*Concerns audit: 2026-11-09*
