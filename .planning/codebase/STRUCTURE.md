---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
# Codebase Structure

**Analysis Date:** 2026-11-09

## Directory Layout

```
Helios/
├── apps/
│   ├── api/                 # NestJS HTTP, SQL, seed, foundation test
│   │   ├── sql/001_init.sql
│   │   ├── src/             # runtime modules (flat, no feature folders)
│   │   └── test/foundation.test.ts
│   ├── worker/              # pg-boss consumer, one source file
│   │   └── src/main.ts
│   └── web/                 # Vite React desk and phone
│       ├── index.html
│       ├── public/          # manifest, service worker, fonts
│       └── src/             # UI modules, flat
├── packages/
│   ├── domain/src/          # pure rules, decimal, demo ids
│   └── ui/src/              # ActivityRings + CSS kit (unwired)
├── scripts/db.mjs           # embedded Postgres on :54329
├── docker/init.sql          # role grant for a containerized database
├── docs/architecture/       # diagram spec + rendered HTML
├── .planning/codebase/      # this map
├── package.json             # workspace scripts
├── pnpm-workspace.yaml      # apps/* and packages/*
├── pnpm-lock.yaml
├── tsconfig.base.json
├── PASSPORT.md              # how to boot this checkout
├── .env.example             # present; environment template (contents not mapped)
├── .gitignore               # ignores node_modules, dist, .data, .env
└── .data/pg/                # local Postgres files, gitignored, generated
```

Workspace members (`pnpm-workspace.yaml`): `apps/*`, `packages/*`. Package names: `@helios/api`, `@helios/worker`, `@helios/web`, `@helios/domain`, `@helios/ui`.

## Directory Purposes

**`apps/api/`:**
- Purpose: HTTP API, schema, seed, and the job functions the worker imports.
- Contains: TypeScript ESM (`"type": "module"`), one SQL migration, one node:test file.
- Key files: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/workforce.service.ts`, `apps/api/src/auth.service.ts`, `apps/api/src/db.ts`, `apps/api/src/jobs.ts`, `apps/api/sql/001_init.sql`, `apps/api/src/migrate.ts`, `apps/api/src/seed.ts`, `apps/api/test/foundation.test.ts`.

**`apps/worker/`:**
- Purpose: Second process that consumes `work-report.recorded`.
- Contains: `apps/worker/src/main.ts` only.
- Key files: `apps/worker/src/main.ts`, `apps/worker/package.json` (depends on `@helios/api` and `@helios/domain`).

**`apps/web/`:**
- Purpose: Cabinet UI. Director and master share the desk. Worker gets the phone.
- Contains: React components, CSS, Vite config, public shell.
- Key files: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/outbox.ts`, `apps/web/src/model.ts`, `apps/web/src/director.tsx`, `apps/web/src/board.tsx`, `apps/web/src/inbox.tsx`, `apps/web/src/field.tsx`, `apps/web/src/app.css`, `apps/web/vite.config.ts`, `apps/web/public/sw.js`, `apps/web/public/manifest.webmanifest`.

**`packages/domain/`:**
- Purpose: Shared rules with no I/O. Safe to import from API, worker, seed, tests, and the browser.
- Contains: `packages/domain/src/index.ts` re-exports `decimal.ts`, `rules.ts`, `ids.ts`. Tests sit next to the rules: `packages/domain/src/rules.test.ts`.
- Key files: `packages/domain/src/rules.ts`, `packages/domain/src/decimal.ts`, `packages/domain/src/ids.ts`.

**`packages/ui/`:**
- Purpose: Shared visual kit. Exported from `packages/ui/src/index.ts` as `ActivityRings`, plus CSS paths `./tokens.css` and `./kit.css` (`packages/ui/package.json`).
- Contains: `packages/ui/src/activity.tsx`, `packages/ui/src/tokens.css`, `packages/ui/src/kit.css`.
- Key files: those three. `apps/web` lists `@helios/ui` as a dependency and does not import it. Desk styles live in `apps/web/src/app.css`.

**`scripts/`:**
- Purpose: Machine-local database process.
- Contains: `scripts/db.mjs`.
- Key files: `scripts/db.mjs` (writes `.data/pg`, listens until killed).

**`docker/`:**
- Purpose: Role bootstrap if Postgres is started outside embedded-postgres.
- Contains: `docker/init.sql` (`CREATE ROLE helios_app … NOBYPASSRLS`).
- Key files: `docker/init.sql`. No compose file in the repo. Local boot uses `scripts/db.mjs`.

**`docs/architecture/`:**
- Purpose: Diagram source for the four-layer picture (client, service, rules, store).
- Contains: `docs/architecture/spec.json`, `docs/architecture/architecture.html`.
- Key files: `docs/architecture/spec.json`. Not loaded by the API or the web app.

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: HTTP server. `NestFactory.create(AppModule)`, CORS, `AllExceptionsFilter`, listen `API_PORT` or `4317`.
- `apps/worker/src/main.ts`: Queue consumer. Imports `createPool` from `@helios/api/db` and `processReportJob` from `@helios/api/jobs`.
- `apps/web/src/main.tsx`: `createRoot` on `#root` from `apps/web/index.html`.
- `apps/web/src/App.tsx`: Login gate, then `WorkerPhone` or `DirectorDesk`.
- `apps/api/src/migrate.ts`: Applies `apps/api/sql/001_init.sql` with the owner URL.
- `apps/api/src/seed.ts`: Demo users and two cabinets.
- `scripts/db.mjs`: Embedded Postgres.
- `package.json`: `db:up`, `db:migrate`, `db:seed`, `dev:api`, `dev:worker`, `dev:web`, `test`.

**Configuration:**
- `pnpm-workspace.yaml`: workspace globs and `allowBuilds` for `embedded-postgres`, `@embedded-postgres/darwin-arm64`, `esbuild`.
- `tsconfig.base.json`: `ES2022`, `NodeNext`, `strict`, decorators on, `noEmit`.
- `apps/api/tsconfig.json`: extends the base, includes `src` and `test`.
- `apps/worker/tsconfig.json`: extends the base, includes `src`.
- `apps/web/tsconfig.json`: `jsx: react-jsx`, `moduleResolution: bundler`, `types: ["vite/client"]`.
- `packages/domain/tsconfig.json`: extends the base, includes `src`.
- `packages/ui/tsconfig.json`: `jsx: react-jsx`.
- `apps/web/vite.config.ts`: port `5173`, proxy `/api` → `http://127.0.0.1:4317`.
- `.env.example`: present at the repo root. `.env` is gitignored (`.gitignore`). Do not commit either with secret values. Runtime defaults live in `apps/api/src/db.ts` (`DATABASE_URL`, `ADMIN_DATABASE_URL`) and `apps/api/src/main.ts` (`API_PORT`).
- `PASSPORT.md`: ports, seed login, and the three dev processes.

**Core Logic:**
- `apps/api/src/app.module.ts`: `AuthController`, `WorkforceController`, `TenantGuard`, `BossHost`, providers `APP_POOL` and `BOSS`.
- `apps/api/src/db.ts`: `createPool`, `withTenant`, `queryClient`.
- `apps/api/src/workforce.service.ts`: desk, tasks, sync, accept, files, audit.
- `apps/api/src/jobs.ts`: queue create, `reportJob`, `processReportJob`.
- `apps/api/sql/001_init.sql`: tables, indexes, RLS, `memberships_for_login`, grants to `helios_app`.
- `packages/domain/src/rules.ts`: acceptance, scope, file keys, document predicates.
- `packages/domain/src/decimal.ts`: all money and quantity arithmetic (scale 6).
- `apps/web/src/model.ts`: `laneOf`, `dayTasks`, `progress`.
- `apps/web/src/outbox.ts`: enqueue and `pendingFor`.

**Testing:**
- `packages/domain/src/rules.test.ts`: `tsx --test`, no database. Script: `packages/domain/package.json` `"test"`.
- `apps/api/test/foundation.test.ts`: boots `AppModule` on port `0` against the running local Postgres. Script: `apps/api/package.json` `"test"`.
- Root `package.json` `"test"` runs `pnpm -r --if-present test`. Web and worker have no test script.

**Public web assets:**
- `apps/web/public/manifest.webmanifest`: PWA name and `display: standalone`.
- `apps/web/public/sw.js`: shell cache, ignores `/api`.
- `apps/web/public/fonts/Geist-Medium.woff2`, `apps/web/public/fonts/GeistMono-Medium.woff2`.

## Naming Conventions

**Files:**
- API services: `{area}.service.ts` — `apps/api/src/workforce.service.ts`, `apps/api/src/auth.service.ts`.
- Nest module stays `apps/api/src/app.module.ts`. New controllers go in that file until the module is split. Do not add `*.controller.ts` beside it and forget to register the class.
- Web screens: one lowercase word, `.tsx` — `apps/web/src/board.tsx`, `apps/web/src/field.tsx`, `apps/web/src/inbox.tsx`, `apps/web/src/director.tsx`.
- Cross-cutting web modules: `api.ts` (transport), `model.ts` (derived view), `outbox.ts` (local queue), `icons.tsx`, `dialog.tsx`, `roles.tsx`.
- SQL: one ordered file, `apps/api/sql/001_init.sql`. The next migration is `002_….sql` in that directory, applied from `apps/api/src/migrate.ts` (today the migrator reads only `001_init.sql`; a second file must be added to that reader in order).
- Tests: `*.test.ts` next to domain source, or under `apps/api/test/` for HTTP.
- ESM imports inside API and domain use the `.js` suffix (`./db.js`, `./rules.js`) even though the source is `.ts`. Web imports omit the suffix (`./App`, `./api`).

**Directories:**
- Apps and packages are the only code roots. No `src/` at the repo root.
- Inside each package, source is flat under `src/`. Do not add `controllers/`, `services/`, or `components/` unless the file count in that package makes a flat folder hard to scan.
- `apps/api/sql/` is schema. `apps/api/test/` is the HTTP suite. `apps/web/public/` is copied as-is by Vite.

**Symbols:**
- TypeScript fields and function names: camelCase (`tenantId`, `partialAcceptance`, `withTenant`).
- SQL columns and JSON from the desk query: snake_case (`full_name`, `work_date`, `assignee_employee_id`, `clock_requires_review`). `Desk` in `apps/web/src/api.ts` matches those names. Map at the service boundary when a new endpoint returns a domain object; do not rename columns only in the client.
- Domain error strings: snake_case (`scope_mismatch`, `invalid_quantity`). HTTP uses the same string as `HttpException` message (`apps/api/src/errors.ts`).
- Roles: `director`, `master`, `worker`, and schema-only `pto`.
- Queue: constant `QUEUE_WORK_REPORT`, value `work-report.recorded` (`packages/domain/src/ids.ts`).
- Demo ids: `TENANT_A`, `USER_DIRECTOR`, `PROJECT_A`, exported from `packages/domain/src/ids.ts`.
- React components: PascalCase function exports (`DirectorDesk`, `WorkBoard`, `WorkerPhone`, `Dialog`).
- CSS: class names in `apps/web/src/app.css` (`.desk`, `.phone`, `.nav-item`). Theme is `document.documentElement.dataset.theme` = `light` | `dark`, key `helios.theme`.
- localStorage prefixes: `helios.session`, `helios.theme`, `helios.outbox.{tenantId}.{userId}`, `helios.check.{tenantId}.{taskId}`.

**Packages:**
- Depend inward: `apps/web` → `@helios/domain` (and the unused `@helios/ui`). `apps/api` → `@helios/domain`. `apps/worker` → `@helios/api` and `@helios/domain`. `packages/domain` depends on nothing. `packages/ui` depends on React and `motion` only.
- Subpath imports of the API are limited to `./db` and `./jobs` (`apps/api/package.json` `exports`). Do not import `apps/api/src/workforce.service.ts` from the worker.

## Where to Add New Code

**New HTTP command (task, shift, report, file):**
- Primary code: handler method on `WorkforceService` in `apps/api/src/workforce.service.ts`, wrapped in `this.with`. Role checks (`actor.role === "worker"`) stay at the top of the method, before the transaction, matching `createTask` and `accept`.
- Route: method on `WorkforceController` in `apps/api/src/app.module.ts`. The class already has `@UseGuards(TenantGuard)`. Public routes stay on `AuthController` in the same file.
- Rules that compare quantities, scope, or file names: `packages/domain/src/rules.ts`, using `packages/domain/src/decimal.ts` for any numeric compare. Add the case to `packages/domain/src/rules.test.ts`.
- Client call: a function next to `desk` / `syncEvents` / `acceptReport` in `apps/web/src/api.ts`.
- If the phone must work offline: extend the `kind` union on `OutboxEvent` (`apps/web/src/outbox.ts`) and on `ClientEvent` (`apps/api/src/workforce.service.ts`), and branch in `dispatch`. Online-only actions stay as direct `fetch` from `apps/web/src/App.tsx`.
- Audit: `this.audit(...)` inside the same transaction.
- Tests: a `node:test` case in `apps/api/test/foundation.test.ts` that logs in through HTTP and asserts status codes. Cabinet ids come from `@helios/domain`.

**New desk section:**
- Implementation: a section id on `Section` in `apps/web/src/director.tsx`, a `nav` entry, and a render branch beside `overview` / `mine` / `tasks`.
- Shared row math: `apps/web/src/model.ts` (`laneOf`, `dayTasks`). Do not re-derive lanes inside the section.
- Chrome (focus trap): `apps/web/src/dialog.tsx`. Icons: `paths` in `apps/web/src/icons.tsx`.
- Styles: `apps/web/src/app.css`. Do not start a second stylesheet. `packages/ui/src/kit.css` is a different token set (`--hairline`, `--brand`); mixing it with `app.css` (`--line`, `--accent`) will fork the theme.

**New phone screen:**
- Worker flow: `WorkerPhone` in `apps/web/src/field.tsx`. `App` mounts it when `session.role === "worker"`.
- Foreman phone: `ForemanPhone` is exported from `apps/web/src/field.tsx` and is not mounted. Master and director both render `DirectorDesk` (`apps/web/src/App.tsx`). A phone for the master replaces that branch; it does not get a second outbox.

**New pure rule:**
- Implementation: `packages/domain/src/rules.ts`.
- Export: already covered by `export * from "./rules.js"` in `packages/domain/src/index.ts`.
- Tests: `packages/domain/src/rules.test.ts`.
- Stable demo ids, queue names, and seed accounts: `packages/domain/src/ids.ts`. Seed reads `DEMO_USERS` from there (`apps/api/src/seed.ts`).

**New table or column:**
- SQL: `apps/api/sql/001_init.sql` while this file is still the whole schema (it uses `IF NOT EXISTS` and `DROP POLICY IF EXISTS`). Include `tenant_id` on the primary key, a composite foreign key to the parent `(tenant_id, id)`, and add the table name to the RLS loop in that file.
- Grants: the file already `GRANT`s all tables in `public` to `helios_app` at the end. Re-run `pnpm db:migrate` after an edit.
- Access from TypeScript: only inside `withTenant`. Inserts copy `actor.tenantId` from the guard, not from the JSON body.

**New background effect:**
- Payload type and handler: `apps/api/src/jobs.ts` (`WorkReportJob`, `processReportJob`).
- Queue constant: `packages/domain/src/ids.ts`.
- Publisher: `boss.send` inside the workforce transaction with `queryClient(client)`.
- Consumer: `apps/worker/src/main.ts` only.
- Idempotency row: a table keyed by `(tenant_id, …)` with `ON CONFLICT DO NOTHING`, same shape as `report_effects`.

**Shared visual component:**
- Implementation: `packages/ui/src/`, export from `packages/ui/src/index.ts`.
- Wire it from `apps/web` with an explicit import. Adding the dependency in `apps/web/package.json` does not mount it. `ActivityRings` is the current example of an export with no caller.

**Utilities:**
- Password and token hashing: `apps/api/src/password.ts`. Do not hash in the domain package.
- HTTP status mapping: `apps/api/src/errors.ts`.
- Decimal strings: `packages/domain/src/decimal.ts`. Never `Number` for stored quantities on the server. The desk uses `Number` only for bar widths in `progress` (`apps/web/src/model.ts`).

## Special Directories

**`.data/`:**
- Purpose: Embedded Postgres data directory (`scripts/db.mjs` sets `databaseDir` to `.data/pg`).
- Generated: Yes.
- Committed: No (`.gitignore`).

**`node_modules/` and `apps/*/node_modules/`:**
- Purpose: pnpm install output. Workspace links point at `packages/*`.
- Generated: Yes.
- Committed: No.

**`dist/`:**
- Purpose: Declared gitignored. Vite `build` writes under `apps/web`. API and worker run via `tsx` and do not emit (`noEmit` in `tsconfig.base.json`).
- Generated: Yes, when `pnpm --filter @helios/web build` runs.
- Committed: No.

**`.env`:**
- Purpose: Optional overrides for `DATABASE_URL`, `ADMIN_DATABASE_URL`, `API_PORT`. Defaults in `apps/api/src/db.ts` and `apps/api/src/main.ts` are enough for the local ports in `PASSPORT.md`.
- Generated: No. `.env.example` is the committed template name; `.env` itself is gitignored. Contents are not part of this map.

**`docs/architecture/`:**
- Purpose: Static diagram (`spec.json` consumed by `architecture.html`).
- Generated: The HTML is a viewer; edit `docs/architecture/spec.json` when the layer picture changes.
- Committed: Yes.

**`apps/web/public/`:**
- Purpose: Files served from the site root (`/sw.js`, `/manifest.webmanifest`, `/fonts/…`).
- Generated: No.
- Committed: Yes.

---

*Structure analysis: 2026-11-09*
