---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
<!-- refreshed: 2026-11-09 -->
# Coding Conventions

**Analysis Date:** 2026-11-09

## Naming Patterns

**Files:**
- One concern per file. Use lowercase. Multi-word runtime modules use a dot suffix, not kebab-case: `apps/api/src/workforce.service.ts`, `apps/api/src/auth.service.ts`.
- Plain modules stay a single word: `apps/api/src/db.ts`, `apps/api/src/errors.ts`, `apps/api/src/http.ts`, `apps/api/src/jobs.ts`, `apps/api/src/password.ts`, `packages/domain/src/rules.ts`, `packages/domain/src/decimal.ts`, `packages/domain/src/ids.ts`, `apps/web/src/api.ts`, `apps/web/src/model.ts`, `apps/web/src/outbox.ts`.
- React screens are one lowercase word: `apps/web/src/director.tsx`, `apps/web/src/field.tsx`, `apps/web/src/board.tsx`, `apps/web/src/inbox.tsx`, `apps/web/src/dialog.tsx`, `apps/web/src/roles.tsx`, `apps/web/src/icons.tsx`. The root component file is `apps/web/src/App.tsx`.
- Tests: `*.test.ts` beside the domain module (`packages/domain/src/rules.test.ts`) or under `apps/api/test/` (`apps/api/test/foundation.test.ts`).
- SQL migrations: numeric prefix plus snake name, `apps/api/sql/001_init.sql`.
- Package names: `@helios/api`, `@helios/domain`, `@helios/ui`, `@helios/web`, `@helios/worker`.

**Functions:**
- camelCase verbs. Domain predicates start with `may`, `validate`, or `assert`: `maySign`, `mayPublish`, `mayReinspect`, `validateRoute`, `assertSameScope` in `packages/domain/src/rules.ts`.
- Decimal math is `parseDecimal`, `formatDecimal`, `addDecimal`, `subDecimal`, `mulDecimal`, `divDecimal`, `cmpDecimal` in `packages/domain/src/decimal.ts`.
- React components are PascalCase functions: `App`, `DirectorDesk`, `WorkerPhone`, `ForemanPhone`, `WorkBoard`, `Inbox`, `Dialog`, `RoleSwitch`, `ActivityRings`, `Icon`.
- Callback props start with `on`: `onClose`, `onRole`, `onTheme`, `onAccept`, `onStart`, `onSubmit`, `onCreate` in `apps/web/src/director.tsx` and `apps/web/src/field.tsx`.
- Module-private helpers stay unexported at the bottom of the file: `sortValue` in `packages/domain/src/rules.ts`, `actorOf` in `apps/api/src/app.module.ts`, `required` in `apps/api/src/workforce.service.ts`, `explain` and `loadTheme` in `apps/web/src/App.tsx`.

**Variables:**
- camelCase for locals, parameters, and module constants that are not identifiers: `sessionKey` in `apps/web/src/api.ts`, `sampleRings` and `inflight` in `apps/api/src/jobs.ts` / `apps/api/src/workforce.service.ts`, `adminUrl` and `appUrl` in `apps/api/src/db.ts`.
- SCREAMING_SNAKE for shared ids, queue names, and Nest injection tokens: `TENANT_A`, `USER_DIRECTOR`, `QUEUE_WORK_REPORT` in `packages/domain/src/ids.ts`; `APP_POOL` and `BOSS` in `apps/api/src/app.module.ts`.
- `SCALE` in `packages/domain/src/decimal.ts` is the one numeric constant in screaming case.
- Loop items are `item`, `row`, `event`, `task`, `ring`. Do not use single-letter names except decimal operands `a` and `b` and the SVG path `d` on `Icon`.

**Types:**
- PascalCase `type` aliases, not `interface`. Examples: `Authority`, `Lot`, `ScopedEvent` in `packages/domain/src/rules.ts`; `Actor`, `ClientEvent` in `apps/api/src/workforce.service.ts`; `Session`, `Desk` in `apps/web/src/api.ts`; `Lane` in `apps/web/src/model.ts`; `OutboxEvent` in `apps/web/src/outbox.ts`; `ActivityRing` in `packages/ui/src/activity.tsx`; `WorkReportJob` in `apps/api/src/jobs.ts`.
- String unions for closed sets: `Lane` is `"assigned" | "shift" | "submitted" | "accepted"`; event `kind` is `"shift_start" | "shift_end" | "submit_volume"`; outbox `status` is `"pending" | "sent"`; roles are `"director" | "master" | "worker"`.
- Do not introduce a separate `Props` type. Inline the prop object on the function parameter, as in `RoleSwitch` (`apps/web/src/roles.tsx`) and `ActivityRings` (`packages/ui/src/activity.tsx`).

**Identifiers across the boundary:**
- TypeScript fields are camelCase: `tenantId`, `userId`, `plannedQuantity`, `acceptedQuantity`, `eventId`, `occurredAt`.
- Postgres columns and tables are snake_case: `tenant_id`, `full_name`, `planned_quantity`, `work_date`, `daily_tasks`, `work_reports`, `client_events` in `apps/api/sql/001_init.sql`.
- HTTP JSON that is a `SELECT` row stays snake_case. The web `Desk` type in `apps/web/src/api.ts` mirrors those columns (`full_name`, `work_date`, `planned_quantity`, `assignee_employee_id`, `clock_requires_review`). Request bodies written by the web client are camelCase (`employeeId`, `plannedQuantity`, `workDate`, `acceptedQuantity` in `apps/web/src/api.ts` and `WorkforceController` in `apps/api/src/app.module.ts`).
- Error codes are snake_case strings, shared by domain, API, and the web copy map. See Error Handling.

**Storage keys:**
- Prefix browser keys with `helios.`: `helios.session` and the pattern is in `apps/web/src/api.ts`; `helios.theme` in `apps/web/src/App.tsx`; `helios.outbox.${tenantId}.${userId}` in `apps/web/src/outbox.ts`; `helios.check.${tenantId}.${taskId}` in `apps/web/src/field.tsx`.

## Code Style

**Formatting:**
- No Prettier, Biome, or EditorConfig file. Match the existing layout by hand.
- Two-space indent. Double quotes. Semicolons. Trailing commas in multiline calls, object types, and arrays.
- Numeric separators on large literals: `1_000_000n` in `packages/domain/src/decimal.ts`, `3_600_000` in `apps/web/src/model.ts`.
- Keep SQL in template strings inside the function that runs it. Put the SQL text first and the parameter array on the next line when the statement is long, as in `apps/api/src/workforce.service.ts` and `apps/api/src/auth.service.ts`.
- JSX may be dense. Short elements stay on one line (`<span className="bars"><i /><i /><i /></span>` in `apps/web/src/App.tsx`). Multi-prop components break one prop per line (`DirectorDesk` in `apps/web/src/director.tsx`).
- User-visible copy is Russian. Format dates and times with `"ru-RU"` (`clock` in `apps/web/src/model.ts`, the date line in `apps/web/src/director.tsx`).

**Linting:**
- No ESLint config and no lint script. TypeScript `strict` is the check.
- `tsconfig.base.json` sets `target` `ES2022`, `module` `NodeNext`, `moduleResolution` `NodeNext`, `strict`, `skipLibCheck`, `esModuleInterop`, `experimentalDecorators`, `emitDecoratorMetadata`, `sourceMap`, `noEmit`, `types: ["node"]`.
- `apps/api`, `apps/worker`, and `packages/domain` extend that base unchanged.
- `apps/web/tsconfig.json` overrides to `jsx: react-jsx`, `module: ESNext`, `moduleResolution: bundler`, `types: ["vite/client"]`.
- `packages/ui/tsconfig.json` overrides to `jsx: react-jsx` and `types: ["react"]`.
- Every package is `"type": "module"`. Run API and worker through `tsx`. Run the web app through Vite. Do not add a `tsc` emit step.

**Language rules:**
- Prefer `const`. Use `let` only when the binding is reassigned (`ready`, `debt`, `money` in `documentaryReadiness`).
- Early-return guards before the happy path (`maySign`, `efficiency`, `httpError` callers, `verifyPassword`).
- Narrow unknown errors with `instanceof Error` (`apps/web/src/App.tsx`, `scripts/db.mjs`) or an `in` check (`mapPgError` in `apps/api/src/errors.ts`, `AllExceptionsFilter` in `apps/api/src/http.ts`).
- Cast `pg` cell values at the boundary (`as string`, `as number`). Keep the rest of the function typed.
- Use `unknown` for untrusted JSON (`stableEventBody(value: unknown)`).
- Default missing request fields with `?? ""` or `?? []` in the controller (`apps/api/src/app.module.ts`). Do not add class-validator DTOs.
- Quantities and money in domain and API are decimal strings. Compute them with `packages/domain/src/decimal.ts` (`bigint` scaled by `1_000_000n`). Do not use JavaScript `number` for stored quantities. The display helpers `amount` and `progress` in `apps/web/src/model.ts` are the exception, and they only format or draw a bar.

## Import Organization

**Order:**
1. `node:` builtins (`node:crypto`, `node:fs/promises`, `node:assert/strict`, `node:test`).
2. Workspace packages (`@helios/domain`, `@helios/api/db`, `@helios/api/jobs`, `@helios/ui`).
3. Third-party packages (`@nestjs/common`, `pg`, `pg-boss`, `react`, `motion/react`).
4. Relative imports.
5. Side-effect CSS last (`import "./app.css"` in `apps/web/src/main.tsx`).

Put `import type` on its own line when the whole import is types (`import type { Pool } from "pg"` in `apps/api/src/auth.service.ts`, `import type { Desk, Session } from "./api"` in `apps/web/src/director.tsx`). When a value import needs one type, inline it: `import { WorkforceService, type Actor } from "./workforce.service.js"` in `apps/api/src/app.module.ts`.

**Path aliases:**
- None. Do not add `paths` to `tsconfig`.
- Cross-package imports use the package name. `@helios/domain` resolves to `packages/domain/src/index.ts`. `@helios/api/db` and `@helios/api/jobs` resolve through the `exports` map in `apps/api/package.json`.
- NodeNext relative imports include the `.js` suffix even though the source is `.ts`: `from "./decimal.js"`, `from "./db.js"`, `from "../src/app.module.js"`. This applies to `apps/api`, `apps/worker` consumers of those files, `packages/domain`, and the `packages/ui` barrel (`packages/ui/src/index.ts` exports from `./activity.js`).
- Vite files omit the suffix: `from "./api"`, `from "./App"`, `from "./model"` under `apps/web/src`.

**Entry scripts:**
- `apps/api/src/main.ts` and `apps/api/src/app.module.ts` start with `import "reflect-metadata"`. Any new Nest entry must do the same. Domain, web, and worker do not import it.

## Error Handling

**Patterns:**
- Domain throws `new Error("<snake_case_code>")`. The message is the contract, not a sentence. Codes in `packages/domain/src/rules.ts` and `packages/domain/src/decimal.ts`: `invalid_quantity`, `crew_empty`, `scope_mismatch`, `bad_file_id`, `bad_filename`, `bad_decimal:<raw>`.
- Return `null` when a value is unknowable. Do not coerce it to zero. `efficiency` returns `null` when `norm` is `null` or hours are `0`. `documentaryReadiness` sets `debtRub` to `null` when any priced lot is missing a price. `divDecimal` is the exception that returns `"0"` on division by zero; do not copy that into business rules.
- API code does not throw bare `Error` for client failures. Call `httpError(status, message)` from `apps/api/src/errors.ts`, which returns an `HttpException`. Throw it.
- Translate domain errors at the service boundary. `applyEvent` catches `assertSameScope` and throws `httpError(403, "scope_mismatch")` in `apps/api/src/workforce.service.ts`.
- Map Postgres integrity failures in the `catch` of the write: `mapPgError` turns SQLSTATE `23503` and `23514` into `422 reference_denied` and rethrows everything else (`apps/api/src/errors.ts`, used by `createTask`).
- `AllExceptionsFilter` in `apps/api/src/http.ts` is the only global filter. Register it in `apps/api/src/main.ts` with `app.useGlobalFilters(new AllExceptionsFilter())`. Status under 500 responds `{ error: <exception message> }`. Status 500 and above responds `{ error: "internal" }` and `console.error`s the exception. Do not put stack traces or SQL text in the JSON body.
- Guards throw. `TenantGuard` throws `401 unauthorized` or `403 tenant_denied`. It does not return `false` (`apps/api/src/app.module.ts`).
- `AuthService.actor` returns `null` when the session or membership is missing. The guard turns that `null` into `403`.
- Web `request` in `apps/web/src/api.ts` throws `new Error(body.error ?? "request_failed")` when `response.ok` is false. Callers read `error.message` as the code.
- Map codes to Russian sentences in `explain` inside `apps/web/src/App.tsx`. Add a new user-visible code there in the same change that introduces it. Unknown codes fall through as the raw code.

**Status codes to reuse:**

| Code | Status | Where it is raised |
|------|--------|--------------------|
| `unauthorized` | 401 | `AuthService.login`, `TenantGuard` |
| `tenant_denied` | 403 | `TenantGuard`, `actorOf`; also thrown by `login` in `apps/web/src/api.ts` when the user has no membership |
| `role_denied` | 403 | `createTask`, `accept` |
| `scope_mismatch` | 403 | `applyEvent` |
| `file_scope` | 403 | `file` |
| `not_found` | 404 | `employee`, `accept`, `file` |
| `already_started` | 409 | `startShift` |
| `invalid_shift_order` | 409 | `finishShift` |
| `idempotency_payload_mismatch` | 409 | `applyEvent` |
| `reference_denied` | 422 | `mapPgError` |
| `task_required`, `employee_required`, `quantity_required`, `bad_event`, `unsupported_operation`, `invalid_quantity` | 422 | `required`, `dispatch`, `submitVolume`, `recordAndMaybeRollback` |
| `tenant_busy` | n/a (job throw) | `processReportJob` in `apps/api/src/jobs.ts` |
| `internal` | 500 | `AllExceptionsFilter` replacement message |

**Transactions:**
- Tenant-scoped work goes through `withTenant` in `apps/api/src/db.ts`. It `BEGIN`s, `set_config('app.tenant_id', ...)`, `set_config('app.user_id', ...)`, runs the callback, then `COMMIT`. On failure it `ROLLBACK`s, ignores a rollback error when the transaction is already closed, and rethrows the original error. The comment in that `catch` stays Russian and explains why the rollback error is ignored.
- Services call the private `with(actor, fn)` wrapper on `WorkforceService` instead of opening their own transactions.
- `recordAndMaybeRollback` in `apps/api/src/workforce.service.ts` is the one manual transaction. It exists so the API test can prove a rollback removes the queued job. Do not add an HTTP route for it.

## Logging

**Framework:** `console`

**Patterns:**
- Log process lifecycle once: `console.log(\`api http://127.0.0.1:${port}\`)` in `apps/api/src/main.ts`, `console.log("schema ready")` in `apps/api/src/migrate.ts`, `console.log("seed ready")` in `apps/api/src/seed.ts`, `console.log(\`worker listening ${...}\`)` in `apps/worker/src/main.ts`.
- Redact credentials before printing a connection string. `apps/worker/src/main.ts` replaces the password with `***`.
- Log unexpected server failures only in `AllExceptionsFilter`, and only when `status >= 500`.
- Do not log tokens, password hashes, request bodies, or row dumps.
- Tests construct Nest with `{ logger: false }` (`apps/api/test/foundation.test.ts`). Leave that in place.
- `scripts/db.mjs` logs `"postgres already listening on 54329"` or `"postgres ready on 54329"`.

## Comments

**When to Comment:**
- Comment a business invariant the code does not spell out. Write it in Russian, as a JSDoc block immediately above the function.
- `documentaryReadiness` and `attributeCrewVolume` in `packages/domain/src/rules.ts`, and `processReportJob` in `apps/api/src/jobs.ts`, are the models.
- A file-level note is for provenance only. `packages/ui/src/activity.tsx` credits the MIT ring drawing it adapts. Do not add file banners elsewhere.
- Inline comments are for a non-obvious `catch`, in Russian: `/* транзакция уже закрыта */` in `apps/api/src/db.ts`, `/* уже закрыта */` in `recordAndMaybeRollback`.
- Do not comment what the next line does. Do not leave commented-out code. The tree has no `TODO`, `FIXME`, or `HACK` markers; do not add them. Track follow-up work outside the source.

**JSDoc/TSDoc:**
- One short Russian block on the invariant. No `@param` or `@returns` tags. Exported types are not documented with TSDoc.

## Function Design

**Size:**
- Domain functions stay a single rule, under roughly 40 lines. Add a new exported function in `packages/domain/src/rules.ts` (or `decimal.ts` for arithmetic) instead of growing a neighbor.
- `WorkforceService` (`apps/api/src/workforce.service.ts`) is the workforce write model. Add a new workforce operation as a method on that class. Add a private method for a step only that class uses (`applyEvent`, `dispatch`, `startShift`, `finishShift`, `submitVolume`, `audit`). Extract a new service only for a different bounded context, and register it the same way as `AuthService` in `apps/api/src/app.module.ts`.
- Web screens are large (`apps/web/src/field.tsx`, `apps/web/src/inbox.tsx`, `apps/web/src/director.tsx`). Extend the screen that already owns the role. A new screen is a new file under `apps/web/src/`, imported by `App` or `DirectorDesk`.

**Parameters:**
- Domain: primitives and small object types. `maySign(authority, project, document, serverDate)`. Dates and quantities are strings.
- Services: `actor: Actor` first, then ids, then an input object. `createTask(actor, input)`, `accept(actor, reportId, acceptedQuantity)`, `sync(actor, events)`.
- React: one destructured props argument. Event handlers are `onX`. Optional display inputs have defaults (`Icon` defaults `size = 18`; `elapsed` defaults `now = Date.now()`).
- Pass time in. Do not call `Date.now()` inside a helper that tests will want to pin. `elapsed` already takes `now`.

**Return values:**
- Domain returns a plain object or a boolean. Annotate the return type on exported domain functions.
- Async service methods either are `async` or return the promise from `this.with(...)` directly (`summary`, `desk`, `createTask`, `accept`). Both are fine. Do not wrap a `this.with` call in a redundant `async` unless the method has code after the transaction.
- Controllers return the service promise. Nest serializes it. There is no response DTO class.
- Web fetch helpers return the parsed body. `login` returns `Promise<Session>`. `desk` is an arrow that returns `request<Desk>(...)`.

## Module Design

**Exports:**
- Named exports only. The only default export is `apps/web/vite.config.ts` (`export default defineConfig`).
- React components are named `export function`. Do not `export default` a component.
- Small HTTP helpers in `apps/web/src/api.ts` may be `export const desk = ...` arrows. Prefer `export function` for anything with a body.
- Re-export a type next to its value when callers need both: `export { ActivityRings, type ActivityRing } from "./activity.js"` and `export type { Section, Lane }` at the bottom of `apps/web/src/director.tsx`.

**Barrel files:**
- `packages/domain/src/index.ts` is `export *` of `./decimal.js`, `./rules.js`, and `./ids.js`. Domain consumers import from `@helios/domain`, not from a deep path.
- `packages/ui/src/index.ts` is an explicit named re-export. Add new UI components there. CSS is a separate export (`./tokens.css`, `./kit.css` in `packages/ui/package.json`), not a TypeScript export.
- Apps have no `index.ts` barrel. Import the file.

**Nest module shape:**
- Keep controllers, guards, and the module class in `apps/api/src/app.module.ts` until a second module exists. `AuthController` is public. `WorkforceController` is `@UseGuards(TenantGuard)`.
- Inject with `@Injectable()` classes and `@Inject(Token)` on the constructor parameter (`AuthService` takes `Pool`; `TenantGuard` takes `AuthService`). Register services with `useFactory` and `inject` in the `providers` array. Pool and pg-boss are tokens `APP_POOL` and `BOSS`, not class tokens.
- `BossHost` implements `OnModuleInit` and `OnModuleDestroy`. `AppModule` implements `OnModuleDestroy` and calls `pool.end()`. Follow that for any new long-lived client.
- Queue name lives in `packages/domain/src/ids.ts` as `QUEUE_WORK_REPORT` (`"work-report.recorded"`). `apps/api/src/jobs.ts` re-exports it. Workers import it from `@helios/domain` (`apps/worker/src/main.ts`).

**SQL:**
- Parameterize every value with `$1`, `$2`, … . Do not interpolate user input into SQL text.
- Cast numeric columns to text in the select list when the result crosses to TypeScript (`planned_quantity::text`, `count(*)::int AS n`).
- Compare roles in SQL with the actor parameter (`$1 <> 'worker' OR e.user_id = $2` in `desk`), not by filtering rows in JavaScript after a full-table read.
- Idempotent writes use `ON CONFLICT DO NOTHING` and `RETURNING` (`processReportJob`, `apps/api/src/seed.ts`).
- Schema changes go in a new file `apps/api/sql/00N_*.sql`. `apps/api/src/migrate.ts` currently reads only `001_init.sql`. A second migration file has to be executed from `migrate.ts` as well.

**React and CSS:**
- Function components and hooks only. State is `useState` in the component that owns it. There is no context, reducer store, or data library. `App` holds `session`, `data`, `error`, `pending`, `section`, and `theme`, and passes callbacks down.
- Prefix a floating promise with `void` (`void refresh(session)`, `void enter(...)`, `void navigator.serviceWorker.register("/sw.js")` in `apps/web/src/main.tsx`).
- Effects return a cleanup (`apps/web/src/dialog.tsx` removes the keydown listener and restores focus; `apps/web/src/field.tsx` clears the interval; `ActivityRings` stops motion controls).
- Dialog focus trapping stays in `apps/web/src/dialog.tsx`. New modals use `Dialog` rather than a second focus trap.
- Motion comes from `motion/react`. The tree is wrapped in `<MotionConfig reducedMotion="user">` in `apps/web/src/main.tsx`. Animated components read `useReducedMotion` and paint the final state immediately when it is set, as `ActivityRings` does.
- Colors come from CSS variables in `packages/ui/src/tokens.css` (`--ink`, `--muted`, `--brand`, `--danger`, …). Web chrome classes live in `apps/web/src/app.css` (`.login`, `.role-pick`, `.wordmark`, `.field`, `.alert`, `.fill`, `.ghost`, `.phone`, `.is-on`). Shared kit classes live in `packages/ui/src/kit.css`. Class names are short kebab-case. One-off layout uses an inline `style`. Theme is `document.documentElement.dataset.theme` set to `"light"` or `"dark"` from `apps/web/src/App.tsx`.
- Icons are a single `Icon` plus a `paths` object in `apps/web/src/icons.tsx`. Add a path there; do not add an icon package.

**Scripts:**
- Top-level await is the script style (`apps/api/src/main.ts`, `migrate.ts`, `seed.ts`, `apps/worker/src/main.ts`, `scripts/db.mjs`). No `main()` wrapper and no `.then` chain at the top level.

---

*Convention analysis: 2026-11-09*
