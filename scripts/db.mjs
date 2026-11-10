import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portValue = process.env.HELIOS_DB_PORT ?? "54329";
if (!/^\d+$/.test(portValue) || Number(portValue) < 1024 || Number(portValue) > 65535) {
  throw new Error("HELIOS_DB_PORT must be an integer from 1024 to 65535");
}
const port = Number(portValue);
const directory = path.join(root, port === 54329 ? ".data/pg" : `.data/pg-${port}`);
const adminUrl = `postgres://helios:helios@127.0.0.1:${port}/postgres`;

async function reachable() {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    const result = await client.query("SHOW data_directory");
    if (path.resolve(result.rows[0].data_directory) !== directory) {
      throw new Error(`Port ${port} belongs to another PostgreSQL directory`);
    }
    await client.end();
    return true;
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof Error && error.message.includes("belongs to another")) throw error;
    return false;
  }
}

if (await reachable()) {
  console.log(`postgres already listening on ${port} (${directory})`);
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

if (!existsSync(path.join(directory, "PG_VERSION"))) await postgres.initialise();
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

const helios = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${port}/helios` });
await helios.connect();
await helios.query("GRANT CREATE ON DATABASE helios TO helios_app");
await helios.end();
console.log(`postgres ready on ${port} (${directory})`);
await new Promise(() => {});
