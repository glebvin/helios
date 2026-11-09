import { readFile } from "node:fs/promises";
import { adminUrl, createPool } from "./db.js";

const pool = createPool(adminUrl);
const sql = await readFile(new URL("../sql/001_init.sql", import.meta.url), "utf8");
await pool.query(sql);
await pool.end();
console.log("schema ready");
