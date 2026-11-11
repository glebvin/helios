// Disposable GitHub Actions PostgreSQL only. Never use this on the staging server.
import pg from 'pg';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('This initializer is restricted to GitHub Actions');
}
const url = new URL(process.env.ADMIN_DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '54339' || url.pathname !== '/helios') {
  throw new Error('Unexpected CI database target');
}
const admin = new pg.Client({connectionString:url.href});
await admin.connect();
try {
  const target = (await admin.query("SELECT current_database() db, current_user usr, inet_server_port() port, current_setting('data_directory') dir")).rows[0];
  if (target.db !== 'helios' || target.usr !== 'helios' || target.port !== 54339 || !target.dir.endsWith('codex-api/.data/pg-54339')) {
    throw new Error('CI server does not match the existing isolated-test safety fence');
  }
  const existing = await admin.query("SELECT to_regclass('public.schema_migrations') AS ledger");
  if (existing.rows[0].ledger) throw new Error('CI expects a fresh empty database');
  await admin.query("CREATE ROLE helios_app LOGIN PASSWORD 'helios_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB");
  await admin.query("GRANT CREATE ON DATABASE helios TO helios_app");
} finally { await admin.end(); }
