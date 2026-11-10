import { readFile, readdir } from "node:fs/promises";
import { adminUrl, createPool } from "./db.js";

const pool = createPool(adminUrl);
const client = await pool.connect().catch(async (error) => { await pool.end(); throw error; });
try {
  await client.query("SELECT pg_advisory_lock(724617223)");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const directory = new URL("../sql/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const filename of files) {
    if ((await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [filename])).rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(filename, directory), "utf8"));
      // 001 grants all public tables; keep the migration ledger admin-only.
      await client.query("REVOKE ALL ON schema_migrations FROM helios_app");
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log("schema ready");
} finally {
  await client.query("SELECT pg_advisory_unlock(724617223)").catch(() => {});
  client.release();
  await pool.end();
}
