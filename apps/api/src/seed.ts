import {
  DEMO_USERS,
  EMPLOYEE_A,
  EMPLOYEE_B,
  FILE_B,
  ORG_A,
  ORG_B,
  PROJECT_A,
  TENANT_A,
  TENANT_B,
  USER_DIRECTOR,
  USER_MASTER,
  USER_OTHER,
  USER_WORKER,
  objectKey,
} from "@helios/domain";
import { createPool, withTenant } from "./db.js";
import { hashPassword } from "./password.js";

const pool = createPool();

for (const user of DEMO_USERS) {
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [user.id, user.email, user.name, hashPassword(user.password)],
  );
}

await withTenant(pool, TENANT_A, USER_DIRECTOR, async (client) => {
  await client.query(`INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    TENANT_A,
    "Учебный кабинет",
  ]);
  await client.query(
    `INSERT INTO organizations (tenant_id, id, kind, name) VALUES ($1, $2, 'own', $3) ON CONFLICT DO NOTHING`,
    [TENANT_A, ORG_A, "Учебная компания"],
  );
  for (const user of DEMO_USERS.filter((item) => item.id !== USER_OTHER)) {
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [TENANT_A, user.id, user.role],
    );
  }
  await client.query(
    `INSERT INTO employees (tenant_id, id, organization_id, user_id, full_name, phone, document_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [TENANT_A, EMPLOYEE_A, ORG_A, USER_WORKER, "Иван Петров", "+79990001122", "DOC-1"],
  );
  await client.query(
    `INSERT INTO projects (tenant_id, id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [TENANT_A, PROJECT_A, "Учебный объект"],
  );
});

await withTenant(pool, TENANT_B, USER_OTHER, async (client) => {
  await client.query(`INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    TENANT_B,
    "Чужой кабинет",
  ]);
  await client.query(
    `INSERT INTO organizations (tenant_id, id, kind, name) VALUES ($1, $2, 'own', $3) ON CONFLICT DO NOTHING`,
    [TENANT_B, ORG_B, "Чужая компания"],
  );
  await client.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'director') ON CONFLICT DO NOTHING`,
    [TENANT_B, USER_OTHER],
  );
  await client.query(
    `INSERT INTO employees (tenant_id, id, organization_id, user_id, full_name, phone, document_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [TENANT_B, EMPLOYEE_B, ORG_B, USER_OTHER, "Секретный работник", "+79990001122", "DOC-1"],
  );
  await client.query(
    `INSERT INTO stored_files (tenant_id, id, object_key, filename) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [TENANT_B, FILE_B, objectKey(TENANT_B, FILE_B, "scan.pdf"), "scan.pdf"],
  );
});

await pool.end();
console.log("seed ready");
