import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { createPool } from "../src/db.js";
import { AllExceptionsFilter } from "../src/http.js";
import { hashPassword } from "../src/password.js";
import { staffImportBook } from "../../web/src/staff-import.js";

const ci = process.env.GITHUB_ACTIONS === "true";
const expectedPort = ci ? "54339" : "54612";
const expectedDir = ci ? /codex-api\/\.data\/pg-54339$/ : /staff-import-confirm\/\.data\/pg-54612$/;
const password = "staff-import-test";
const tenant = randomUUID();
const otherTenant = randomUUID();
const org = randomUUID();
const otherOrg = randomUUID();
const foreignOrg = randomUUID();
const people = [
  { key: "hr", role: "hr", name: "Кадровик" },
  { key: "director", role: "director", name: "Руководитель" },
  { key: "director2", role: "director", name: "Второй руководитель" },
  { key: "worker", role: "worker", name: "Работник" },
  { key: "master", role: "master", name: "Мастер" },
  { key: "pto", role: "pto", name: "ПТО" },
].map((person) => ({ ...person, id: randomUUID(), email: `${person.key}-${tenant}@staff-import.test` }));
const admin = createPool(process.env.ADMIN_DATABASE_URL);
let app: INestApplication;
let base = "";
const tokens = new Map<string, string>();

before(async () => {
  const live = await admin.query(`SELECT inet_server_port()::text AS port, inet_server_addr()::text AS host, current_setting('data_directory') AS directory`);
  assert.equal(live.rows[0].port, expectedPort);
  assert.match(live.rows[0].host, /^127\.0\.0\.1/);
  assert.match(live.rows[0].directory, expectedDir);
  const hash = hashPassword(password);
  await admin.query(`INSERT INTO tenants(id,name) VALUES($1,'Импорт'),($2,'Чужая')`, [tenant, otherTenant]);
  for (const person of people) {
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [person.id, person.email, person.name, hash]);
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, person.id, person.role]);
  }
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Свой работодатель'),($1,$3,'subcontractor','Другой работодатель')`, [tenant, org, otherOrg]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Чужая компания')`, [otherTenant, foreignOrg]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${server.address().port}`;
  for (const person of people) tokens.set(person.key, await login(person.email));
});

after(async () => {
  await app?.close();
  await admin.end();
});

test("кадры подтверждают пакет, повтор того же запроса не создаёт вторую карточку", async () => {
  const body = book([{ key: "101", fullName: "Иванов Иван Иванович", phone: "+7 900 000-01-01" }, { key: "102", fullName: "Петрова Анна Сергеевна" }]);
  const beforeCounts = await counts();
  const checked = await send("/staff-imports/checks", body, "hr");
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.acceptable, true);
  assert.deepEqual(checked.body.rows.map((row: { disposition: string }) => row.disposition), ["create", "create"]);
  const requestId = randomUUID();
  const saved = await send("/staff-imports", { ...body, requestId, verdictHash: checked.body.verdictHash }, "hr");
  assert.equal(saved.status, 201);
  assert.equal(saved.body.createdCount, 2);
  assert.equal(saved.body.presentCount, 0);
  assert.equal(saved.body.actorName, "Кадровик");
  const replay = await send("/staff-imports", { ...body, requestId, verdictHash: checked.body.verdictHash }, "hr");
  assert.equal(replay.status, 201);
  assert.equal(replay.body.id, saved.body.id);
  assert.equal(await employeeCount(), beforeCounts.employees + 2);
  const cards = await admin.query(`SELECT full_name,personnel_number,document_number,user_id,phone FROM employees WHERE tenant_id=$1 AND personnel_number IN ('101','102') ORDER BY personnel_number`, [tenant]);
  assert.equal(cards.rows[0].document_number, null);
  assert.equal(cards.rows[0].user_id, null);
  assert.equal(cards.rows[0].personnel_number, "101");
  assert.equal(cards.rows[1].document_number, null);
  const afterCounts = await counts();
  assert.equal(afterCounts.users, beforeCounts.users);
  assert.equal(afterCounts.memberships, beforeCounts.memberships);
  assert.equal(afterCounts.invitations, beforeCounts.invitations);
  assert.equal(afterCounts.checks, beforeCounts.checks);
  assert.equal(afterCounts.assignments, beforeCounts.assignments);
  assert.equal((await send("/employees", { requestId: randomUUID(), fullName: "Не через импорт", organizationId: org, phone: null, userId: null }, "hr")).status, 403);
});

test("тот же файл с новым идентификатором не перезаписывает карточки", async () => {
  const body = book([{ key: "101", fullName: "Иванов Иван Иванович", phone: "+7 900 000-01-01" }, { key: "102", fullName: "Петрова Анна Сергеевна" }]);
  const checked = await send("/staff-imports/checks", body, "hr");
  const again = await send("/staff-imports", { ...body, requestId: randomUUID(), verdictHash: checked.body.verdictHash }, "hr");
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.createdCount, 0);
  assert.equal(again.body.presentCount, 2);
  assert.deepEqual(again.body.rows.map((row: { outcome: string }) => row.outcome), ["present", "present"]);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1 AND personnel_number IN ('101','102')`, [tenant])).rows[0].n, 2);
  const version = await admin.query(`SELECT version FROM employees WHERE tenant_id=$1 AND personnel_number='101'`, [tenant]);
  assert.equal(version.rows[0].version, 1);
});

test("одинаковое ФИО с другим табельным номером создаёт отдельную карточку", async () => {
  const body = book([{ key: "103", fullName: "Иванов Иван Иванович", phone: "+7 900 000-01-03" }]);
  const checked = await send("/staff-imports/checks", body, "hr");
  assert.equal(checked.body.rows[0].disposition, "create");
  const saved = await send("/staff-imports", { ...body, requestId: randomUUID(), verdictHash: checked.body.verdictHash }, "hr");
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.createdCount, 1);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1 AND full_name='Иванов Иван Иванович'`, [tenant])).rows[0].n, 2);
});

test("дубль в файле и ошибочная строка не сохраняют часть пакета", async () => {
  const duplicate = book([
    { key: "201", fullName: "Один", phone: "+7 900 000-02-01" },
    { key: "201", fullName: "Другой", phone: "+7 900 000-02-02" },
  ]);
  const bad = book([
    { key: "202", fullName: "Годный", phone: "+7 900 000-02-03" },
    { key: "203", fullName: "" },
  ]);
  const phones = book([
    { key: "204", fullName: "Первый", phone: "+7 900 000-02-04" },
    { key: "205", fullName: "Второй", phone: "+7 900 000-02-04" },
  ]);
  for (const file of [duplicate, bad, phones]) {
    const checked = await send("/staff-imports/checks", file, "hr");
    assert.equal(checked.body.acceptable, false);
    const denied = await send("/staff-imports", { ...file, requestId: randomUUID(), verdictHash: checked.body.verdictHash }, "hr");
    assert.equal(denied.status, 422);
  }
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1 AND personnel_number LIKE '20%'`, [tenant])).rows[0].n, 0);
});

test("совпадение с базой не перезаписывает карточку и не выбирает чужую", async () => {
  await card(otherOrg, "301", "Чужой работник", "+7 900 000-03-01");
  await card(org, "302", "Старое имя", "+7 900 000-03-02");
  await card(org, "303", "Телефон занят", "+7 900 000-03-03");
  const foreign = book([{ key: "310", fullName: "Новый человек", phone: "+7 900 000-03-01" }]);
  const conflict = book([{ key: "302", fullName: "Новое имя", phone: "+7 900 000-03-02" }]);
  const ambiguous = book([{ key: "311", fullName: "Другой номер", phone: "+7 900 000-03-03" }]);
  for (const [file, disposition] of [[foreign, "foreign"], [conflict, "conflict"], [ambiguous, "ambiguous"]] as const) {
    const checked = await send("/staff-imports/checks", file, "hr");
    assert.equal(checked.body.rows[0].disposition, disposition);
    assert.equal((await send("/staff-imports", { ...file, requestId: randomUUID(), verdictHash: checked.body.verdictHash }, "hr")).status, 422);
  }
  const kept = await admin.query(`SELECT full_name FROM employees WHERE tenant_id=$1 AND personnel_number='302'`, [tenant]);
  assert.equal(kept.rows[0].full_name, "Старое имя");
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1 AND personnel_number IN ('310','311')`, [tenant])).rows[0].n, 0);
});

test("изменение между проверкой и подтверждением не записывает пакет", async () => {
  await card(org, "401", "Было", "+7 900 000-04-01");
  const file = book([{ key: "401", fullName: "Было", phone: "+7 900 000-04-01" }]);
  const checked = await send("/staff-imports/checks", file, "hr");
  assert.equal(checked.body.rows[0].disposition, "present");
  await admin.query(`UPDATE employees SET full_name='Стало', version=version+1 WHERE tenant_id=$1 AND personnel_number='401'`, [tenant]);
  const requestId = randomUUID();
  const denied = await send("/staff-imports", { ...file, requestId, verdictHash: checked.body.verdictHash }, "hr");
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "import_changed");
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM staff_imports WHERE tenant_id=$1 AND request_id=$2`, [tenant, requestId])).rows[0].n, 0);
  const name = await admin.query(`SELECT full_name FROM employees WHERE tenant_id=$1 AND personnel_number='401'`, [tenant]);
  assert.equal(name.rows[0].full_name, "Стало");
});

test("чужая компания, чужой работодатель и запрещённая роль не импортируют", async () => {
  const file = book([{ key: "501", fullName: "Никто", phone: "+7 900 000-05-01" }]);
  assert.equal((await send("/staff-imports/checks", { ...file, organizationId: foreignOrg }, "hr")).status, 422);
  assert.equal((await send("/staff-imports", { ...file, organizationId: foreignOrg, requestId: randomUUID(), verdictHash: "a".repeat(64) }, "hr")).status, 422);
  for (const role of ["worker", "master", "pto"]) {
    assert.equal((await send("/staff-imports/checks", file, role)).status, 403);
    assert.equal((await send("/staff-imports", { ...file, requestId: randomUUID(), verdictHash: "b".repeat(64) }, role)).status, 403);
  }
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1 AND personnel_number='501'`, [tenant])).rows[0].n, 0);
});

test("результат импорта виден после чтения и второму разрешённому входу", async () => {
  const listed = await send("/staff-imports?limit=20&offset=0", undefined, "director2", "GET");
  assert.equal(listed.status, 200);
  assert.ok(listed.body.total >= 2);
  const first = listed.body.items[0];
  assert.equal(typeof first.actorName, "string");
  assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof first.createdCount, "number");
  assert.ok(listed.body.items.some((item: { presentCount: number }) => item.presentCount === 2));
  const registry = await send("/employees?limit=100&offset=0", undefined, "director2", "GET");
  const names = registry.body.items.map((item: { fullName: string }) => item.fullName);
  assert.ok(names.includes("Иванов Иван Иванович"));
  assert.ok(names.includes("Петрова Анна Сергеевна"));
  const hrList = await send("/employees?limit=100&offset=0", undefined, "hr", "GET");
  assert.equal(hrList.body.total, registry.body.total);
});

function book(rows: { key: string; fullName: string; phone?: string }[]) {
  return { organizationId: org, fileBase64: Buffer.from(staffImportBook(rows)).toString("base64") };
}

async function card(organizationId: string, number: string, fullName: string, phone: string) {
  await admin.query(
    `INSERT INTO employees(tenant_id,id,organization_id,full_name,phone,personnel_number) VALUES($1,$2,$3,$4,$5,$6)`,
    [tenant, randomUUID(), organizationId, fullName, phone, number],
  );
}

async function employeeCount() {
  return (await admin.query(`SELECT count(*)::int AS n FROM employees WHERE tenant_id=$1`, [tenant])).rows[0].n as number;
}

async function counts() {
  const one = async (sql: string) => (await admin.query(sql, [tenant])).rows[0].n as number;
  return {
    employees: await employeeCount(),
    users: (await admin.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n as number,
    memberships: await one(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1`),
    invitations: await one(`SELECT count(*)::int AS n FROM invitations WHERE tenant_id=$1`),
    checks: await one(`SELECT count(*)::int AS n FROM employee_admission_checks WHERE tenant_id=$1`),
    assignments: await one(`SELECT count(*)::int AS n FROM employee_project_assignments WHERE tenant_id=$1`),
  };
}

async function login(email: string) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).token as string;
}

async function send(path: string, body: Record<string, unknown> | undefined, role: string, method?: string) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${tokens.get(role)}`, "x-tenant-id": tenant, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}
