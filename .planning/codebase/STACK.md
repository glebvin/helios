---
last_mapped_commit: b2ddc9f065f2bb98e17af36430696d97a4f3b77c
last_mapped_at: 2026-11-09
---
# Technology Stack

**Analysis Date:** 2026-11-09

## Languages

**Primary:**

- TypeScript 5.9.3 — every package. Compiler config extends `tsconfig.base.json`. Dev runner is `tsx`. Locked in `pnpm-lock.yaml`.
- SQL — schema and row-level security in `apps/api/sql/001_init.sql`. Role bootstrap in `docker/init.sql`. Queries are written as SQL strings in `apps/api/src/`.

**Secondary:**

- JavaScript (ESM) — `scripts/db.mjs` starts the local database. `apps/web/public/sw.js` is the production service worker.
- CSS — design tokens in `packages/ui/src/tokens.css` and `packages/ui/src/kit.css`. App layout in `apps/web/src/app.css`. No CSS preprocessor and no utility framework.
- HTML — Vite entry `apps/web/index.html`. Static architecture page `docs/architecture/architecture.html` (generated from `docs/architecture/spec.json`; not part of the running app).

Use `.ts` for server and domain code. Use `.tsx` for React. Keep API and worker imports as Node ESM with a `.js` suffix on relative specifiers (`apps/api/src/main.ts` imports `./app.module.js`).

## Runtime

**Environment:**

- Node.js with native ESM (`"type": "module"` in every `package.json`). The repo does not pin a Node version: no `engines` field, no `.nvmrc`, no `.node-version`. Typings are `@types/node` 24.19.2. TypeScript `target` is `ES2022` in `tsconfig.base.json`.
- API and worker run under `tsx` (`apps/api/package.json`, `apps/worker/package.json`). Tests use the built-in `node:test` runner through `tsx --test`.
- Browser runtime for `@helios/web`: Vite dev server, React 19, and a production-only service worker (`apps/web/src/main.tsx` registers `/sw.js` only when `import.meta.env.PROD`).

**Package Manager:**

- pnpm 12.18.0, declared as `"packageManager": "pnpm@12.18.0"` in `package.json`. Invoke it through Corepack (`corepack pnpm …`), which is what the root scripts and `PASSPORT.md` use.
- Lockfile: present, `pnpm-lock.yaml` (`lockfileVersion: 9.0`).
- Workspace: `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

```yaml
packages:
  - apps/*
  - packages/*
```

Install and task entry points live on the root `package.json`:

```json
"packageManager": "pnpm@12.18.0",
"scripts": {
  "db:up": "node scripts/db.mjs up",
  "db:migrate": "corepack pnpm --filter @helios/api migrate",
  "db:seed": "corepack pnpm --filter @helios/api seed",
  "test": "corepack pnpm -r --if-present test",
  "dev:api": "corepack pnpm --filter @helios/api dev",
  "dev:worker": "corepack pnpm --filter @helios/worker dev",
  "dev:web": "corepack pnpm --filter @helios/web dev"
}
```

`pnpm-workspace.yaml` allows builds for `embedded-postgres`, `@embedded-postgres/darwin-arm64`, and `esbuild`. Do not add another dependency that needs a postinstall build without extending `allowBuilds`.

## Frameworks

**Core:**

- NestJS 11.2.8 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`; ranges in `apps/api/package.json` are `^11.1.6`) — HTTP API in `apps/api/src/main.ts` and `apps/api/src/app.module.ts`. Decorators require `reflect-metadata` 0.2.2, imported first in `apps/api/src/main.ts`. `experimentalDecorators` and `emitDecoratorMetadata` are on in `tsconfig.base.json`.
- Express 5.2.1 — HTTP adapter pulled in by `@nestjs/platform-express`. Application code does not import `express` directly. Add routes as Nest controllers in `apps/api/src/app.module.ts`.
- React 19.3.1 and React DOM 19.3.1 (`^19.2.0` in `apps/web/package.json` and `packages/ui/package.json`) — UI. JSX runtime is `react-jsx` (`apps/web/tsconfig.json`, `packages/ui/tsconfig.json`).
- Vite 7.3.7 with `@vitejs/plugin-react` 5.2.0 — web dev server and production build (`apps/web/vite.config.ts`, `apps/web/package.json`).
- Motion 12.43.0 — animation. Import from `motion/react` (`apps/web/src/main.tsx`, `apps/web/src/board.tsx`, `apps/web/src/inbox.tsx`, `packages/ui/src/activity.tsx`). `framer-motion@12.43.0` appears in `pnpm-lock.yaml` only as a transitive package. Do not import `framer-motion`.
- pg-boss 12.38.1 — Postgres-backed job queue shared by `apps/api/src/jobs.ts` and `apps/worker/src/main.ts`.

**Testing:**

- `node:test` plus `node:assert/strict`, executed by `tsx --test`.
  - Domain: `packages/domain/src/rules.test.ts` (`packages/domain/package.json` script `test`).
  - API: `apps/api/test/foundation.test.ts` boots a real Nest app with `NestFactory.create` and calls it over HTTP. It needs Postgres already listening.
- No Vitest, Jest, Playwright, or Testing Library config is present.

**Build/Dev:**

- TypeScript 5.9.3 — typecheck configuration only. `tsconfig.base.json` sets `"noEmit": true`. The web production bundle is `vite build` (`apps/web/package.json`). API and worker are not compiled to `dist` for dev; `tsx` runs the TypeScript sources.
- `tsx` 4.23.15 — API dev, migrate, seed, worker dev, and tests.
- `embedded-postgres` 18.6.0-beta.19 — local Postgres process started by `scripts/db.mjs`. This is the path `pnpm db:up` uses. Data directory is `.data/pg` (gitignored).

Workspace packages (all private, version `0.1.0`):

| Package | Path | Role |
|---------|------|------|
| `@helios/domain` | `packages/domain` | Pure rules, decimal math, ids. No runtime dependencies. |
| `@helios/ui` | `packages/ui` | Shared React components. Exports `.`, `./tokens.css`, `./kit.css`. |
| `@helios/api` | `apps/api` | Nest HTTP API, SQL, pool, queue helpers. Exports `./db` and `./jobs`. |
| `@helios/worker` | `apps/worker` | pg-boss consumer. Depends on `@helios/api` and `@helios/domain`. |
| `@helios/web` | `apps/web` | Vite + React client. Depends on `@helios/domain` and `@helios/ui`. |

Link workspace packages with `"workspace:*"`. `@helios/ui` also peer-depends on `react` `^19`.

`@helios/domain` implements decimal arithmetic with `bigint` in `packages/domain/src/decimal.ts` (scale `1_000_000n`). Do not add a decimal library for quantities that already go through `parseDecimal` / `formatDecimal`.

## Key Dependencies

**Critical:**

- `pg` 8.23.1 (`^8.16.3` in the root `package.json` and `apps/api/package.json`) — the only database client. Pools are created in `apps/api/src/db.ts`. Types: `@types/pg` 8.23.1.
- `pg-boss` 12.38.1 (exact pin in `apps/api/package.json` and `apps/worker/package.json`) — queue `work-report` lives in the same Postgres database as product tables. Create the boss with `createBoss()` in `apps/api/src/jobs.ts` (`max: 4`). The API starts it in `BossHost` (`apps/api/src/app.module.ts`). The worker consumes it in `apps/worker/src/main.ts` (`localConcurrency: 2`, `localGroupConcurrency: 1`).
- `rxjs` 7.8.2 — Nest peer dependency declared on `@helios/api`. Application source does not import it.
- `reflect-metadata` 0.2.2 — required before Nest boots. Keep the side-effect import at the top of `apps/api/src/main.ts`.

**Infrastructure:**

- `embedded-postgres` 18.6.0-beta.19 (root devDependency) — development database. `scripts/db.mjs` listens on `127.0.0.1:54329`, creates the application role, and creates the `helios` database when missing.
- Docker images, optional and not invoked by the npm scripts:
  - `postgres:16-alpine` — `docker-compose.yml` service `postgres`, host port `54329`.
  - `minio/minio:RELEASE.2025-04-22T22-12-26Z` — service `minio`, host ports `9100` (S3 API) and `9101` (console).

The documented local database is the embedded Postgres 18 beta from `scripts/db.mjs`, not the Docker Postgres 16 image. Do not run both against port `54329`. `PASSPORT.md` states that `54329`, `4317`, and `5173` are one set per machine.

There is no ORM, query builder, Redis client, AWS SDK, or MinIO SDK in `pnpm-lock.yaml`.

## Configuration

**Environment:**

- Committed template: `.env.example` (names only; do not copy values into docs or new files).
- `.env` is listed in `.gitignore` and is not in the tree.
- Variables the process actually reads:
  - `API_PORT` — `apps/api/src/main.ts`. Default `4317`. The server binds `127.0.0.1` only.
  - `DATABASE_URL` — application role, `apps/api/src/db.ts` (`appUrl`). Used by the API pool, the worker, seed, and pg-boss.
  - `ADMIN_DATABASE_URL` — migration role, `apps/api/src/db.ts` (`adminUrl`). Used by `apps/api/src/migrate.ts`.
- Variables named in `.env.example` and not read by any `.ts`, `.tsx`, `.js`, or `.mjs` file: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`.
- When `DATABASE_URL` or `ADMIN_DATABASE_URL` is unset, `apps/api/src/db.ts` falls back to a local URL on `127.0.0.1:54329`. `scripts/db.mjs` hardcodes the same host and port for the embedded server. Keep new configuration on environment variables; do not add another hardcoded credential.

CORS origins are hardcoded, not configured:

```ts
app.enableCors({
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  allowedHeaders: ["content-type", "authorization", "x-tenant-id"],
});
```

That block is in `apps/api/src/main.ts`. Add a new web origin there when the dev URL changes.

Vite proxies same-origin `/api` to the API (`apps/web/vite.config.ts`):

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
});
```

The browser calls relative `/api/...` paths (`apps/web/src/api.ts`). Do not point the client at an absolute API origin.

TypeScript bases (`tsconfig.base.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`apps/web/tsconfig.json` overrides `module` to `ESNext`, `moduleResolution` to `bundler`, and `types` to `["vite/client"]`. `packages/ui/tsconfig.json` sets `types` to `["react"]`. Keep those overrides. Do not turn `noEmit` off for the web package; Vite emits the bundle.

**Build:**

- `tsconfig.base.json` plus per-package `tsconfig.json` files under `apps/api`, `apps/web`, `apps/worker`, `packages/domain`, `packages/ui`.
- `apps/web/vite.config.ts` — dev server and build. No `build.outDir` override, so production output is `apps/web/dist` (gitignored via `dist` in `.gitignore`).
- No ESLint, Prettier, Biome, Webpack, or `tsup` config.
- No application Dockerfile. `docker-compose.yml` only runs Postgres and MinIO.

## Platform Requirements

**Development:**

- Node.js compatible with `@types/node` 24 and with `node:test`, plus Corepack so `pnpm@12.18.0` resolves.
- Three processes after the database is up (`PASSPORT.md`):
  - `corepack pnpm db:up` then `db:migrate` then `db:seed`
  - `corepack pnpm dev:api` — `http://127.0.0.1:4317`
  - `corepack pnpm dev:worker`
  - `corepack pnpm dev:web` — `http://127.0.0.1:5173`
- `pnpm db:up` needs a writable `.data/pg` directory and a free port `54329`. On this machine the embedded binary is the darwin-arm64 build allowed in `pnpm-workspace.yaml`.
- API tests (`apps/api/test/foundation.test.ts`) require that Postgres. Domain tests do not.
- Fonts are local files, not a CDN: `apps/web/public/fonts/Geist-Medium.woff2` and `apps/web/public/fonts/GeistMono-Medium.woff2`.
- PWA shell: `apps/web/public/manifest.webmanifest` (`display: standalone`, `lang: ru`) and `apps/web/public/sw.js` (cache name `helios-shell-v1`). The worker caches `/` and `/manifest.webmanifest` and does not intercept `/api`.

**Production:**

- Not detected. Nothing in the repo deploys the API, worker, or web build. The API listen address is loopback (`apps/api/src/main.ts`). Treat hosting, TLS, and a production Postgres as unset until a deploy target is added.

---

*Stack analysis: 2026-11-09*
