# HELIOS synthetic staging

Hostname: `helios-test.evegunina.ru`. Server: existing SSH alias `progress-interface`.
This branch is an isolated deployment snapshot. Cursor's integration worktree is not modified.

## Build

Use the repository's installed locked dependencies, then `python3 deploy/helios-staging/build.py`.
This emits real decorator metadata with TypeScript, preserves SQL/OpenAPI relative paths and compiles frontend before transfer.
The runtime npm lock is separate from the development pnpm lock. Runtime dependencies are fixed; local workspace packages export emitted JavaScript.

On this Mac Docker is unavailable. Only the already compiled runtime is sent; the small Linux image installs production dependencies on VPS. Do not run TypeScript/Vite builds on the VPS. Limit build memory and verify the existing site's health throughout. No source credentials, local database folders or Mac node_modules are included.

## Deploy boundaries

- `/opt/helios-staging/releases/<commit>` contains immutable release files.
- `/opt/helios-staging/current` points to the selected release; explicit Compose project `helios-staging` keeps volumes stable.
- `.env` and private credentials belong outside Git under `/opt/helios-staging`, mode 0600.
- Use independent PostgreSQL and evidence volumes. No exposed host ports.
- Edge network `helios-staging-edge` connects only the HELIOS gateway and existing public Caddy. Its membership must also be retained in the public proxy's Compose configuration.
- Public Caddy proxies only this new hostname to `helios-staging-gateway:8080`; preserve all existing routes.
- Gateway serves UI and forwards the original `/api/*` path. API listens on 0.0.0.0 inside its private container via a dedicated staging entry, leaving local development entry untouched.
- The API login endpoint has a small global staging rate cap, 30 attempts/minute. This is not a full production anti-abuse system.
- Create `helios_app` using a generated password before migration. API never receives ADMIN_DATABASE_URL. SQL owner and runtime roles are separate.
- Never run the default dev seed on the internet. `seed-staging.mjs` accepts three randomly generated private credentials mounted readonly at `/run/helios-credentials.json`. It refuses automatic reinitialisation.
- `worker` runs the existing pg-boss consumer; no additional Redis is used.

## Acceptance and rollback

Before publishing: build and fresh/repeated migrations; login/me; default password rejection; worker cannot approve; hidden file rejection; private evidence write/read; full synthetic day including current hour approval and a valid XLSX. Check both old and new HTTPS hosts.

After publishing: restart services and confirm the same database/evidence; test a database/files backup and restoration in a separate disposable database. Save actual results in the deployment report.

Rollback application by selecting the previous release/image with the same permanent volumes. Do not run `down -v`. Database migrations are not automatically reversible; verify schema compatibility before rolling back code. The public Caddy config is backed up before editing; validate candidate and restore/reload the saved config if the old site regresses.

No physical phone/offline/production acceptance is claimed. See `docs/integration-status.md` for the demonstration boundaries.
