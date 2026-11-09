import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, ".data/pg");
const port = 54329;
const adminUrl = "postgres://helios:helios@127.0.0.1:54329/postgres";

async function reachable() {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

if (await reachable()) {
  console.log("postgres already listening on 54329");
  process.exit(0);
}

await mkdir(directory, { recursive: true });
const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  user: "helios",
  password: "helios",
  port,
  persistent: true,
});

try {
  await postgres.initialise();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/exists|initdb/i.test(message)) throw error;
}
await postgres.start();

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'helios_app'");
if (role.rowCount === 0) {
  await admin.query("CREATE ROLE helios_app LOGIN PASSWORD 'helios_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB");
}
const database = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'helios'");
if (database.rowCount === 0) await admin.query("CREATE DATABASE helios OWNER helios");
await admin.end();

const helios = new pg.Client({ connectionString: "postgres://helios:helios@127.0.0.1:54329/helios" });
await helios.connect();
await helios.query("GRANT CREATE ON DATABASE helios TO helios_app");
await helios.end();
console.log("postgres ready on 54329");
await new Promise(() => {});
