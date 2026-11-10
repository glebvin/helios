import { readdir, readFile } from "node:fs/promises";
import { adminUrl, createPool } from "./db.js";

const pool = createPool(adminUrl);
const dir = new URL("../sql/", import.meta.url);
const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
for (const name of names) {
  const sql = await readFile(new URL(name, dir), "utf8");
  await pool.query(sql);
}
await pool.end();
console.log("schema ready");
