import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import type { Pool } from "pg";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/http.js";
import { adminUrl, appUrl, createPool, withTenant } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { plusDays } from "../src/responsibility-orders.js";
import { checkHttpContract } from "./contract-check.js";

const qaPort = process.env.HELIOS_ORDERS_QA_DB_PORT ?? "54561";
assert.ok(["54561", "54591"].includes(qaPort));
const admin = createPool(adminUrl), application = createPool(appUrl);
let fixture: Awaited<ReturnType<typeof build>>, app: any, base: string;
const tokens = new Map<string, string>();

async function build(pool: Pool) {
  const url = new URL((pool.options as { connectionString: string }).connectionString);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, process.env.GITHUB_ACTIONS === "true" ? "54339" : qaPort);
  if (process.env.GITHUB_ACTIONS !== "true") assert.equal(realpathSync((await pool.query("SHOW data_directory")).rows[0].data_directory), realpathSync(fileURLToPath(new URL(`../../../.data/pg-${qaPort}`, import.meta.url))));
  const tenantId = randomUUID(), foreignId = randomUUID(), projectId = randomUUID(), otherProjectId = randomUUID(), foreignProjectId = randomUUID();
  const ownId = randomUUID(), otherOrgId = randomUUID(), foreignOrgId = randomUUID(), personId = randomUUID(), otherPersonId = randomUUID();
  const users = ["hr", "hr", "director", "admin"].map((role) => ({ id: randomUUID(), role, email: `${randomUUID()}@orders.test`, password: "fixture-orders-2026", name: role }));
  const foreignUser = { id: randomUUID(), role: "hr", email: `${randomUUID()}@orders.test`, password: "fixture-orders-2026", name: "foreign" };
  await pool.query("INSERT INTO tenants(id,name) VALUES($1,'Orders QA'),($2,'Foreign orders')", [tenantId, foreignId]);
  await pool.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя компания'),($1,$3,'subcontractor','Другая компания'),($4,$5,'own','Чужая компания')", [tenantId, ownId, otherOrgId, foreignId, foreignOrgId]);
  await pool.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект А'),($1,$3,'Объект Б'),($4,$5,'Чужой объект')", [tenantId, projectId, otherProjectId, foreignId, foreignProjectId]);
  for (const user of [...users, foreignUser]) {
    await pool.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [user.id, user.email, user.name, hashPassword(user.password)]);
    await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [user === foreignUser ? foreignId : tenantId, user.id, user.role]);
  }
  await pool.query("INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Иванов'),($1,$4,$5,'Петров')", [tenantId, personId, ownId, otherPersonId, otherOrgId]);
  return { tenantId, foreignId, projectId, otherProjectId, foreignProjectId, ownId, otherOrgId, foreignOrgId, personId, otherPersonId, users, foreignUser };
}
async function remove(pool: Pool, row: Awaited<ReturnType<typeof build>>) {
  const tenants = [row.tenantId, row.foreignId], ids = [...row.users, row.foreignUser].map((user) => user.id);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [ids]);
  for (const table of ["responsibility_order_revisions", "responsibility_orders", "people_command_receipts", "employees", "organizations", "projects", "audit_log", "memberships"]) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  }
  await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
}
async function call(userIndex: number, method = "GET", path = `/api/v1/responsibility-orders?projectId=${fixture.projectId}`, body?: unknown, tenant = fixture.tenantId) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${tokens.get(userIndex < 0 ? fixture.foreignUser.id : fixture.users[userIndex]!.id)}`, "x-tenant-id": tenant, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  checkHttpContract(path, method, response.status, data, response.headers);
  return { status: response.status, body: data };
}
function draft(today: string, until: string, person = fixture.personId, organization = fixture.ownId, project = fixture.projectId) {
  return { requestId: randomUUID(), employeeId: person, organizationId: organization, projectId: project, documentTypes: ["hidden-works-act"], orderNumber: "ПР-1", orderDate: today, validFrom: today, validUntil: until };
}

test.before(async () => {
  fixture = await build(admin);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  for (const user of [...fixture.users, fixture.foreignUser]) {
    const response = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: user.password }) });
    assert.equal(response.status, 201);
    tokens.set(user.id, (await response.json()).token);
  }
});
test.after(async () => { await app?.close(); try { if (fixture) await remove(admin, fixture); } finally { await admin.end(); await application.end(); } });

test("кадры создают приказ, второй вход читает его, повтор не плодит запись", async () => {
  const today = (await call(0)).body.today as string;
  const command = draft(today, plusDays(today, 10));
  const created = await call(0, "POST", "/api/v1/responsibility-orders", command);
  assert.equal(created.status, 201);
  assert.equal(created.body.expiringWithin30Days, true);
  assert.equal(created.body.history.length, 1);
  assert.deepEqual((await call(0, "POST", "/api/v1/responsibility-orders", command)).body, created.body);
  const read = await call(1, "GET", `/api/v1/responsibility-orders/${created.body.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.employeeName, "Иванов");
  assert.equal(read.body.organizationName, "Своя компания");
  assert.equal((await admin.query("SELECT count(*)::int n FROM responsibility_orders WHERE tenant_id=$1", [fixture.tenantId])).rows[0].n, 1);
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='orders.created'", [fixture.tenantId])).rows[0].n, 1);
  const corrected = await call(1, "POST", `/api/v1/responsibility-orders/${created.body.id}`, { requestId: randomUUID(), expectedVersion: 1, documentTypes: ["hidden-works-act", "daily-task"], orderNumber: "ПР-1а", orderDate: today, validFrom: today, validUntil: plusDays(today, 40) });
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.version, 2);
  assert.equal(corrected.body.expiringWithin30Days, false);
  assert.equal((await call(1, "POST", `/api/v1/responsibility-orders/${created.body.id}`, { requestId: randomUUID(), expectedVersion: 1, documentTypes: ["hidden-works-act"], orderNumber: "ПР-1", orderDate: today, validFrom: today, validUntil: plusDays(today, 10) })).status, 409);
  const results = await Promise.all([0, 1].map((index) => call(index, "POST", `/api/v1/responsibility-orders/${created.body.id}`, { requestId: randomUUID(), expectedVersion: 2, documentTypes: ["hidden-works-act"], orderNumber: `ПР-${index}`, orderDate: today, validFrom: today, validUntil: plusDays(today, 20) })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const current = (await call(0, "GET", `/api/v1/responsibility-orders/${created.body.id}`)).body;
  const revoked = await call(0, "POST", `/api/v1/responsibility-orders/${created.body.id}/revoke`, { requestId: randomUUID(), expectedVersion: current.version, reason: "Увольнение не требуется, приказ отозван вручную" });
  assert.equal(revoked.status, 201);
  assert.equal(revoked.body.status, "revoked");
  assert.equal((await call(1, "GET", `/api/v1/responsibility-orders/${created.body.id}`)).body.revocationReason, revoked.body.revocationReason);
  const check = await call(1, "GET", `/api/v1/responsibility-orders/applicability?employeeId=${fixture.personId}&organizationId=${fixture.ownId}&projectId=${fixture.projectId}&documentType=hidden-works-act&on=${today}`);
  assert.equal(check.body.reason, "revoked");
  assert.equal(check.body.applicable, false);
});

test("чужая компания и объект, запрещённые роли, истёкший приказ и изоляция", async () => {
  const catalog = await call(0, "GET", "/api/v1/responsibility-orders");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.projectId, null);
  assert.ok(catalog.body.catalog.projects.some((project: { id: string }) => project.id === fixture.projectId));
  const today = catalog.body.today as string;
  const expired = await call(0, "POST", "/api/v1/responsibility-orders", { ...draft(plusDays(today, -20), plusDays(today, -1), fixture.otherPersonId, fixture.otherOrgId), orderNumber: "ПР-стар" });
  assert.equal(expired.status, 201);
  assert.equal(expired.body.expiringWithin30Days, false);
  const past = await call(0, "GET", `/api/v1/responsibility-orders/applicability?employeeId=${fixture.otherPersonId}&organizationId=${fixture.otherOrgId}&projectId=${fixture.projectId}&documentType=hidden-works-act&on=${today}`);
  assert.deepEqual({ applicable: past.body.applicable, reason: past.body.reason }, { applicable: false, reason: "expired" });
  const wrongType = await call(0, "GET", `/api/v1/responsibility-orders/applicability?employeeId=${fixture.otherPersonId}&organizationId=${fixture.otherOrgId}&projectId=${fixture.projectId}&documentType=daily-task&on=${plusDays(today, -5)}`);
  assert.equal(wrongType.body.reason, "type");
  const wrongObject = await call(0, "GET", `/api/v1/responsibility-orders/applicability?employeeId=${fixture.otherPersonId}&organizationId=${fixture.otherOrgId}&projectId=${fixture.otherProjectId}&documentType=hidden-works-act&on=${plusDays(today, -5)}`);
  assert.equal(wrongObject.body.reason, "object");
  assert.equal((await call(0, "POST", "/api/v1/responsibility-orders", draft(today, plusDays(today, 5), fixture.personId, fixture.otherOrgId))).status, 422);
  assert.equal((await call(0, "POST", "/api/v1/responsibility-orders", draft(today, plusDays(today, 5), fixture.personId, fixture.foreignOrgId, fixture.foreignProjectId))).status, 403);
  assert.equal((await call(0, "GET", `/api/v1/responsibility-orders?projectId=${fixture.foreignProjectId}`)).status, 403);
  for (const index of [2, 3]) {
    assert.equal((await call(index)).status, 403);
    assert.equal((await call(index, "POST", "/api/v1/responsibility-orders", draft(today, plusDays(today, 5)))).status, 403);
  }
  assert.equal((await call(-1, "GET", `/api/v1/responsibility-orders?projectId=${fixture.projectId}`, undefined, fixture.foreignId)).status, 403);
  assert.equal((await withTenant(application, fixture.foreignId, fixture.foreignUser.id, (c) => c.query("SELECT id FROM responsibility_orders"))).rowCount, 0);
});

test("повтор команды не возвращает данные после снятия роли кадров", async () => {
  const today = (await call(0)).body.today as string;
  const body = draft(today, plusDays(today, 10));
  const created = await call(0, "POST", "/api/v1/responsibility-orders", body);
  assert.equal(created.status, 201);
  await admin.query("UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2", [fixture.tenantId, fixture.users[0]!.id]);
  try {
    assert.equal((await call(0, "POST", "/api/v1/responsibility-orders", body)).status, 403);
  } finally {
    await admin.query("UPDATE memberships SET role='hr' WHERE tenant_id=$1 AND user_id=$2", [fixture.tenantId, fixture.users[0]!.id]);
  }
});
