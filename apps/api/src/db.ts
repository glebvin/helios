import { Pool, type PoolClient } from "pg";

export const adminUrl = process.env.ADMIN_DATABASE_URL ?? "postgres://helios:helios@127.0.0.1:54329/helios";
export const appUrl = process.env.DATABASE_URL ?? "postgres://helios_app:helios_app@127.0.0.1:54329/helios";

export function createPool(connectionString = appUrl): Pool {
  const pool = new Pool({ connectionString });
  pool.on("error", () => console.error("database_unavailable"));
  return pool;
}

export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* транзакция уже закрыта */
    }
    throw error;
  } finally {
    client.release();
  }
}

export function queryClient(client: PoolClient) {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const result = await client.query(text, values);
      return { rows: result.rows };
    },
  };
}
