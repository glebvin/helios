---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
<!-- refreshed: 2026-11-09 -->
# Testing Patterns

**Analysis Date:** 2026-11-09

## Test Framework

**Runner:**
- Node.js built-in test runner, loaded through `tsx`. There is no Jest, Vitest, Mocha, or Playwright dependency and no config file.
- Domain config is the `test` script in `packages/domain/package.json`: `tsx --test src/rules.test.ts`.
- API config is the `test` script in `apps/api/package.json`: `tsx --test test/foundation.test.ts`.
- Root `package.json` fans out with `corepack pnpm -r --if-present test`. Packages without a `test` script are skipped. `@helios/web`, `@helios/ui`, and `@helios/worker` have none.
- Assertion library is `node:assert/strict`, imported as `assert`.
- The runner API is `node:test`, imported as `test`. The API suite also uses `test.after`.

**Run Commands:**
```bash
corepack pnpm test                              # every package that defines test
corepack pnpm --filter @helios/domain test      # packages/domain/src/rules.test.ts
corepack pnpm --filter @helios/api test         # apps/api/test/foundation.test.ts
```

Watch mode and coverage are not scripted. Do not add a second runner to get them. A new `*.test.ts` file does not run until its package `test` script lists it. Today those scripts name one file each. When you add a file, append it (`tsx --test src/rules.test.ts src/decimal.test.ts`) or switch that package to a glob (`tsx --test src/**/*.test.ts`, `tsx --test test/**/*.test.ts`). Keep using `tsx --test` so TypeScript and `.js` import specifiers keep working.

**API test prerequisites:**
- `apps/api/test/foundation.test.ts` talks to a real Postgres and a real Nest process. Start the database with `corepack pnpm db:up` (`scripts/db.mjs`, port `54329`), apply `apps/api/sql/001_init.sql` with `corepack pnpm db:migrate`, and load demo rows with `corepack pnpm db:seed`.
- Connection settings come from `DATABASE_URL` and `ADMIN_DATABASE_URL` read in `apps/api/src/db.ts`. `.env` is gitignored. `.env.example` is present. Do not read or commit either file from a test.
- The suite assumes the seed in `apps/api/src/seed.ts` has inserted `DEMO_USERS` and the two cabinets. It does not migrate or seed by itself.

## Test File Organization

**Location:**
- Pure domain tests sit next to the code they cover: `packages/domain/src/rules.test.ts` covers `packages/domain/src/rules.ts`. Put a new domain test in `packages/domain/src/<module>.test.ts`.
- HTTP and database tests sit in `apps/api/test/`, not beside `apps/api/src`. The only file is `apps/api/test/foundation.test.ts`. `apps/api/tsconfig.json` includes both `src` and `test`.
- Do not put tests under `apps/web`, `packages/ui`, or `apps/worker` until that package has a `test` script. There is no jsdom and no browser runner.

**Naming:**
- File: `<module>.test.ts` or a behavior name (`foundation.test.ts`). Do not use `.spec.ts`.
- Case title: one Russian sentence that states the business rule, not the function name. Match `packages/domain/src/rules.test.ts` and `apps/api/test/foundation.test.ts`.

**Structure:**
```
packages/domain/src/
├── decimal.ts
├── ids.ts
├── index.ts
├── rules.ts
└── rules.test.ts
apps/api/
├── src/
└── test/
    └── foundation.test.ts
```

## Test Structure

**Suite Organization:**
Domain cases are flat. No `describe`, no `before`, no `beforeEach`.

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeCrewVolume,
  partialAcceptance,
} from "./index.js";

test("частичная приёмка 18 и 17 оставляет разницу, норма не выдумывается", () => {
  assert.deepEqual(partialAcceptance("18", "17"), { accepted: "17", difference: "1" });
  assert.equal(efficiency("17", "0.4", "8"), "85");
  assert.equal(efficiency("17", null, "8"), null);
  assert.throws(() => partialAcceptance("18", "19"));
});

test("бригадный объём не делится на людей", () => {
  assert.deepEqual(attributeCrewVolume("17", 4), { scope: "crew", quantity: "17", members: 4 });
});
```

The API file boots one shared server at top level, then declares cases. Cleanup is a single `test.after`. Copy this shape for another API file only if that file can own its own port and pool. Do not import `foundation.test.ts`.

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { createPool } from "../src/db.js";

const pool = createPool();
const app = await NestFactory.create(AppModule, { logger: false });
const server = await app.listen(0, "127.0.0.1");
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}/api`;

test("кабинет A не видит человека, файл и связь кабинета B", async () => {
  const director = await login("director@pilot.helios", "pilot-director");
  const deniedEmployee = await fetch(`${base}/employees/${EMPLOYEE_B}`, {
    headers: headers(director.token, TENANT_A),
  });
  assert.equal(deniedEmployee.status, 404);
});

test.after(async () => {
  await app.close();
  await pool.end();
});
```

Helpers `login` and `headers` live in `apps/api/test/foundation.test.ts` under the base URL. Keep them in the test file. `login` asserts status `201` and passes `JSON.stringify(body)` as the assertion message so a failed login shows the error code.

**Patterns:**
- Each `test()` is one rule and may contain several assertions that pin the same rule (allowed route and two forbidden routes in the first domain case; three `mayPublish` calls in the second).
- Build inputs inline. The authority object in the `maySign` case is a literal, then `{ ...authority, end: "2027-01-01" }` for the next assertion. Do not add a factory module.
- Domain imports come from `./index.js` (the public barrel), not from `./rules.ts`, so the test matches what `@helios/domain` exports.
- API cases use global `fetch` against `http://127.0.0.1:<ephemeral>/api`. Bind with `listen(0, "127.0.0.1")`. Do not hardcode `4317` in a test. That port is the dev default in `apps/api/src/main.ts` and the Vite proxy in `apps/web/vite.config.ts`.
- Pass `{ logger: false }` to `NestFactory.create`. The dev entry `apps/api/src/main.ts` is not what tests boot. Tests boot `AppModule` from `apps/api/src/app.module.ts`, which does not install `AllExceptionsFilter`. Assert the HTTP status Nest produces. Do not assert the JSON `{ error }` body from the filter in this suite; the filter is only wired in `main.ts`.
- Cases share the database. `foundation.test.ts` inserts a task named `"Облицовка стен"` and a sync event, and it never deletes them. Later cases must assert on ids they created (`task.id`, `reportId`) or on a predicate (`employees.some(...)`). Do not assert `count(*)` of `daily_tasks` or `work_reports` for the whole tenant.
- The RLS case is the exception: after `withTenant`, a fresh client with no `app.tenant_id` must see `count(*) = 0` on `employees` and an empty `current_setting('app.tenant_id', true)`. That is `apps/api/test/foundation.test.ts` “пул не сохраняет контекст кабинета”.
- Call `WorkforceService.recordAndMaybeRollback` through `app.get(WorkforceService)` when the assertion is about a transaction rollback and `pgboss.job`. Do not add a controller route for that method.
- Async tests are `async () => { ... }` with `await`. There is no `done` callback.
- `test.after` closes the Nest app and then `pool.end()`. A new shared resource opened at top level gets released in that same hook.

## Mocking

**Framework:** None. Do not add `sinon`, `vitest`, or module mocks.

**Patterns:**
The domain suite calls the real functions. The API suite calls the real HTTP stack, the real `pg` pool, and the real `processReportJob`. A representative isolation check:

```typescript
test("офлайн-событие чужого кабинета не уходит в синхронизацию", () => {
  const mine = { tenantId: TENANT_A, userId: USER_WORKER, status: "pending", eventId: "1" };
  const foreign = { tenantId: TENANT_B, userId: USER_WORKER, status: "pending", eventId: "2" };
  const sent = { ...mine, eventId: "3", status: "sent" };
  assert.deepEqual(eventsForSync([mine, foreign, sent], { tenantId: TENANT_A, userId: USER_WORKER }), [mine]);
  assert.throws(() => assertSameScope(foreign, { tenantId: TENANT_A, userId: USER_DIRECTOR }));
});
```

Worker idempotency is two real calls, then a SQL count:

```typescript
await processReportJob(pool, queued.rows[0].data);
await processReportJob(pool, queued.rows[0].data);
const effects = await withTenant(pool, TENANT_A, USER_MASTER, (client) =>
  client.query(`SELECT count(*)::int AS n FROM report_effects WHERE report_id = $1`, [firstBody.results[0].reportId]),
);
assert.equal(effects.rows[0].n, 1);
```

**What to Mock:**
- Nothing in the current suites. Tenant isolation, password login, RLS, and `ON CONFLICT` only mean something against Postgres.
- If a future pure helper needs a clock, add a parameter the way `elapsed(startedAt, now = Date.now())` does in `apps/web/src/model.ts`. Pass the timestamp. Do not mock `Date`.

**What NOT to Mock:**
- `withTenant`, `createPool`, or `set_config` (`apps/api/src/db.ts`). The pool-reset case exists to prove the session variable does not leak.
- `fetch` in `apps/api/test/foundation.test.ts`. The test is the HTTP contract.
- `@helios/domain` rules from an API test. `accept` already calls `partialAcceptance`. Domain behavior stays in `packages/domain/src/rules.test.ts`.
- `pg-boss` inside the rollback case. `recordAndMaybeRollback` uses the real boss and a transactional `queryClient`. The assertion reads `pgboss.job`.
- Demo ids. Import `TENANT_A`, `TENANT_B`, `EMPLOYEE_A`, `EMPLOYEE_B`, `FILE_B`, `USER_DIRECTOR`, `USER_MASTER` from `@helios/domain`.

## Fixtures and Factories

**Test Data:**
Shared ids live in `packages/domain/src/ids.ts` and are inserted by `apps/api/src/seed.ts`. Tests and seed must use the same constants.

```typescript
export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const USER_DIRECTOR = "11111111-1111-4111-8111-111111111121";
export const USER_MASTER = "11111111-1111-4111-8111-111111111122";
export const USER_WORKER = "11111111-1111-4111-8111-111111111123";
export const EMPLOYEE_A = "11111111-1111-4111-8111-111111111131";
export const EMPLOYEE_B = "22222222-2222-4222-8222-222222222231";
export const PROJECT_A = "11111111-1111-4111-8111-111111111141";
export const FILE_B = "22222222-2222-4222-8222-222222222241";
export const QUEUE_WORK_REPORT = "work-report.recorded";

export const DEMO_USERS = [
  { id: USER_DIRECTOR, email: "director@pilot.helios", name: "Анна Соколова", password: "pilot-director", role: "director" },
  { id: USER_MASTER, email: "master@pilot.helios", name: "Павел Орлов", password: "pilot-master", role: "master" },
  { id: USER_WORKER, email: "worker@pilot.helios", name: "Иван Петров", password: "pilot-worker", role: "worker" },
  { id: USER_OTHER, email: "other@foreign.helios", name: "Чужой пользователь", password: "pilot-other", role: "director" },
] as const;
```

Cabinet A is the pilot tenant. Cabinet B (`TENANT_B`, `EMPLOYEE_B`, `FILE_B`, `other@foreign.helios`) exists so tests can prove a cross-tenant read returns `404` or `403`. `EMPLOYEE_B` is named `"Секретный работник"` in `apps/api/src/seed.ts`. The desk test asserts that name is absent and that the pilot phone is present.

New ids that seed and tests both need go in `packages/domain/src/ids.ts` as UUID-shaped constants (`version` nibble `4`, variant nibble `8`) and get inserted with `ON CONFLICT DO NOTHING` in `apps/api/src/seed.ts`. Ids used only inside one case can be `randomUUID()` from `node:crypto`, as `eventId` is in the sync case.

Quantities in domain fixtures are strings: `"30"`, `"18"`, `"0.4"`. Dates in rules are `YYYY-MM-DD` strings (`"2026-11-03"`). The API task fixture uses `workDate: "2026-11-07"`, `unit: "м2"`, `plannedQuantity: "40"`.

Login in the API test uses the demo email and password from `DEMO_USERS`. Do not invent a second user in the test body. There is no signup route.

**Location:**
- Identifiers: `packages/domain/src/ids.ts`.
- Rows: `apps/api/src/seed.ts`.
- Per-case payloads: inline in the test file.
- No `fixtures/` directory, no snapshot files, no factories.

## Coverage

**Requirements:** None enforced. No coverage script, no `c8`, no `nyc`, no threshold in CI. There is no `.github` workflow.

**View Coverage:**
```bash
# Not configured. Do not add a coverage gate as part of a feature change.
corepack pnpm --filter @helios/domain test
corepack pnpm --filter @helios/api test
```

`packages/domain/src/decimal.ts` has no direct test file. Its behavior is pinned only where `rules.test.ts` calls `partialAcceptance`, `efficiency`, and `documentaryReadiness`. A decimal bug that those cases do not hit will not fail the suite. Add `packages/domain/src/decimal.test.ts` and register it in `packages/domain/package.json` when changing parse, scale, or division.

## Test Types

**Unit Tests:**
- Scope: pure functions in `packages/domain`. No I/O.
- File: `packages/domain/src/rules.test.ts` (10 cases).
- Cover both the accepting input and the rejecting input in the same case when they are one rule. `maySign` checks an expired window, the wrong project, and a valid window. `validateRoute` checks one valid route and two invalid ones.
- `eventsForSync` must keep only `status === "pending"` rows for the same `tenantId` and `userId`. `objectKey` must throw on a `..` filename. `stableEventBody` must be identical for reordered object keys.
- Assert the error exists with `assert.throws`. The current cases do not check `error.message`. When the code string is the contract (`invalid_quantity`, `scope_mismatch`, `bad_filename`, `crew_empty`, `bad_decimal:`), assert it:

```typescript
assert.throws(() => partialAcceptance("18", "19"), { message: "invalid_quantity" });
```

**Integration Tests:**
- Scope: one Nest app, one pool, real SQL, real `pg-boss` tables. File: `apps/api/test/foundation.test.ts` (3 cases plus `test.after`).
- “кабинет A не видит человека, файл и связь кабинета B” checks `GET /api/employees/:id` and `GET /api/files/:id` return `404` for cabinet B ids, `GET /api/desk` with the other tenant header or the other token returns `403`, `POST /api/tasks` onto `EMPLOYEE_B` returns `422`, and the desk payload hides `"Секретный работник"`.
- “пул не сохраняет контекст кабинета” checks `withTenant` does not leave `app.tenant_id` on the next client, and RLS then returns no `employees` rows.
- “откат записи не оставляет задачу, повтор worker не удваивает эффект” creates a task (`201`), rolls a report back so `pgboss.job` has `0` rows for that `reportId`, posts the same sync event twice (`duplicate: true`, one `work_reports` row), runs `processReportJob` twice (one `report_effects` row), and posts a foreign `tenantId` on the event (`403`).
- Headers are `authorization: Bearer <token>`, `x-tenant-id`, and `content-type: application/json`, built by `headers()` in the test file. That matches `TenantGuard` in `apps/api/src/app.module.ts`.
- Read SQL through `withTenant(pool, TENANT_A, USER_MASTER, ...)` or a raw `pool.query` when the table is outside RLS (`pgboss.job`). Use the same parameter style as production (`$1`).

**E2E Tests:**
- Not used. No Playwright, Cypress, or browser harness. `@helios/web` has no test script. Do not add an end-to-end runner for a domain or API rule that `node:test` can already hit.
- Service worker `apps/web/public/sw.js` is untested. Leave it that way unless the change is specifically about caching.

**Not covered, and where a new test goes:**
- `packages/domain/src/decimal.ts` — add `packages/domain/src/decimal.test.ts`.
- `apps/api/src/password.ts` (`hashPassword`, `verifyPassword`, `hashToken`) — a `node:test` file under `apps/api/test/` with no database. Register it in the `test` script. Do not log hashes.
- `apps/api/src/http.ts` — only meaningful if the test boots `main.ts` or mounts `AllExceptionsFilter`. The foundation suite does not.
- `apps/web/src/model.ts` — pure, no DOM except `todayKey` and `clock`. A future `node:test` file can import `laneOf`, `progress`, `amount`, `elapsed`, and `statusLabel` once `@helios/web` has a `test` script. Pass `now` into `elapsed`.
- `apps/web/src/outbox.ts` and `apps/web/src/api.ts` need `localStorage` and `fetch`. Do not add them until a DOM or stub is an explicit decision. Prefer extending `eventsForSync` tests in the domain package for scoping rules.
- `packages/ui/src/activity.tsx`, `apps/web/src/App.tsx`, and the screen components have no component tests. Do not introduce Testing Library for a style or copy change.
- `apps/worker/src/main.ts` has no test. Job behavior is covered by calling `processReportJob` from the API suite. Test a worker change there, not by spawning the worker process.

## Common Patterns

**Async Testing:**
```typescript
test("откат записи не оставляет задачу, повтор worker не удваивает эффект", async () => {
  const master = await login("master@pilot.helios", "pilot-master");
  const created = await fetch(`${base}/tasks`, {
    method: "POST",
    headers: headers(master.token, TENANT_A),
    body: JSON.stringify({
      title: "Облицовка стен",
      employeeId: EMPLOYEE_A,
      plannedQuantity: "40",
      unit: "м2",
      workDate: "2026-11-07",
    }),
  });
  const task = (await created.json()) as { id: string };
  assert.equal(created.status, 201, JSON.stringify(task));
});
```

Cast JSON with `as { ... }` at the boundary, the same way `foundation.test.ts` casts `{ token: string }` and `{ results: { reportId: string; duplicate?: boolean }[] }`. Assert the status before using the body. Put `JSON.stringify` of the body in the assertion message when a non-201 would otherwise hide the error code.

Sync a client event by posting `{ events: [event] }` to `/api/sync/events`. Reuse the same `eventId` to prove idempotency. Change `tenantId` on a copy of the event to prove scope rejection. Generate fresh ids with `randomUUID()` so a second run of the file does not collide on `client_events`.

**Error Testing:**
```typescript
assert.throws(() => partialAcceptance("18", "19"));
assert.throws(() => assertSameScope(foreign, { tenantId: TENANT_A, userId: USER_DIRECTOR }));
assert.throws(() => objectKey(TENANT_A, EMPLOYEE_A, "../secret.jpg"));
```

HTTP failures are status assertions, not thrown exceptions:

```typescript
assert.equal(deniedEmployee.status, 404);
assert.equal(wrongTenant.status, 403);
assert.equal(crossTask.status, 422);
assert.equal(foreign.status, 403);
```

There is no `assert.rejects` in the tree. Use it only when the function under test returns a rejected promise. Domain throws are synchronous. API client errors in this suite are response statuses.

`assert.equal` for scalars, booleans, and status codes. `assert.deepEqual` for objects and filtered arrays (`documentaryReadiness` result, `attributeCrewVolume` result, `eventsForSync` result). Compare decimal results as strings (`"30"`, `"20000"`, `"85"`), never as numbers.

**What a new case must include:**
- A Russian title that names the rule a reviewer can fail.
- The forbidden input and the allowed input, when both exist.
- For money or quantity, a missing-price or null case that must stay `null` (`documentaryReadiness` with `price: null` expects `debtRub === null`).
- For tenancy, an actor from cabinet A and a row from cabinet B.
- For writes, an assertion on the id that was created and a second call that must not double the effect.

---

*Testing analysis: 2026-11-09*
