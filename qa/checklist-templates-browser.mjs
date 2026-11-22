import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { hashPassword } from "../apps/api/src/password.ts";
import { defaultRouteConfiguration } from "../apps/api/src/route-config.ts";

const password = "fixture-checklist-2026";
const dbPort = Number(process.env.HELIOS_CHECKLIST_QA_DB_PORT ?? 54563);
assert.ok([54563,54595].includes(dbPort));
const db = `postgres://helios:helios@127.0.0.1:${dbPort}/helios`;
const api = process.env.HELIOS_CHECKLIST_API ?? `http://127.0.0.1:${dbPort === 54595 ? 4411 : 4395}`;
const web = process.env.HELIOS_CHECKLIST_WEB ?? `http://127.0.0.1:${dbPort === 54595 ? 5283 : 5272}`;
const admin = new pg.Pool({ connectionString: db });
const tenant = randomUUID();
const project = randomUUID();
const other = randomUUID();
const people = ["engineer", "pto", "director", "safety", "zds", "worker", "foreign"].map((name) => ({
  name,
  id: randomUUID(),
  role: name === "foreign" ? "engineer-pto" : name === "engineer" ? "engineer-pto" : name === "zds" ? "zds-soso" : name,
  email: `${name}-${randomUUID()}@checklist.test`,
  label: { engineer: "Инженер Шаблонов", pto: "Пётр Ответственный", director: "Роман Проекта", safety: "Ольга Безопасность", zds: "Зина Утверждающая", worker: "Иван Рабочий", foreign: "Чужая Компания" }[name],
}));
const byName = Object.fromEntries(people.map((person) => [person.name, person]));
const tokens = new Map();

const seam = { id: "seam", prompt: "Шов свободен", kind: "yes_no", pass: "yes", required: true, critical: true };
const thickness = { id: "thickness", prompt: "Толщина", kind: "number", required: true, critical: false, unit: "мм", min: "10", max: "20" };

async function call(who, method, path, body, tenantId = tenant) {
  const response = await fetch(api + path, {
    method,
    headers: { authorization: `Bearer ${tokens.get(who)}`, "x-tenant-id": tenantId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, body: data };
}

async function login(page, person) {
  await page.goto(web);
  await page.getByLabel("Логин").fill(person.email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Шаблоны" }).waitFor();
}

async function logout(page) {
  await page.locator(".avatar").click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();
  await page.getByRole("button", { name: "Войти" }).waitFor();
}

async function templates(page) {
  await page.getByRole("navigation").getByRole("button", { name: "Шаблоны" }).click();
  await page.getByRole("heading", { name: /Шаблоны сдачи/ }).waitFor();
}

const url = new URL(db);
assert.equal(url.port, String(dbPort));
const directory = (await admin.query("SHOW data_directory")).rows[0].data_directory;
assert.equal(realpathSync(directory), realpathSync(fileURLToPath(new URL(`../.data/pg-${dbPort}`, import.meta.url))));
const hash = hashPassword(password);
await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Checklist browser')", [tenant]);
await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект шаблона'),($1,$3,'Чужой объект')", [tenant, project, other]);
for (const person of people) {
  const home = person.name === "foreign" ? tenant : tenant;
  await admin.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [person.id, person.email, person.label, hash]);
  if (person.name === "foreign") {
    const foreignTenant = randomUUID();
    await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Чужая компания')", [foreignTenant]);
    person.tenant = foreignTenant;
    await admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [foreignTenant, person.id, person.role]);
  } else {
    person.tenant = tenant;
    await admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [tenant, person.id, person.role]);
    await admin.query("INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)", [tenant, project, person.id]);
  }
}
const organization = randomUUID(), ptoEmployee = randomUUID(), order = randomUUID();
await admin.query("INSERT INTO organizations(tenant_id,id,kind,name)VALUES($1,$2,'own','QA')",[tenant,organization]);
await admin.query("INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name)VALUES($1,$2,$3,$4,'PTO QA')",[tenant,ptoEmployee,organization,byName.pto.id]);
await admin.query("INSERT INTO responsibility_orders(tenant_id,id,organization_id,project_id,employee_id,order_number,order_date,valid_from,valid_until,document_types,status,version)VALUES($1,$2,$3,$4,$5,'QA','2026-01-01','2026-01-01','2099-12-31',ARRAY['inspection-template'],'active',1)",[tenant,order,organization,project,ptoEmployee]);
const configuration = defaultRouteConfiguration();
const route = configuration.routes.find((item) => item.documentType === "inspection-template");
route.preparers[0].userId = byName.engineer.id;
route.responsibles[0].userId = byName.pto.id;
route.reviewers = [{ role: "director", userId: byName.director.id }, { role: "safety", userId: byName.safety.id }];
route.approvers[0].userId = byName.zds.id;
await admin.query("INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,1,1,$3,$4)", [tenant, project, JSON.stringify(configuration), byName.engineer.id]);
for (const person of people) {
  const response = await fetch(`${api}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email, password }) });
  assert.equal(response.status, 201, person.name);
  tokens.set(person.name, (await response.json()).token);
}
const root = `/api/v1/projects/${project}/checklist-templates`;
const command = { requestId: randomUUID(), title: "Серверная проверка", items: [seam, thickness] };
const created = await call("engineer", "POST", root, command);
assert.equal(created.status, 201);
assert.equal((await call("engineer", "POST", root, command)).body.templateId, created.body.templateId);
const stale = await Promise.all([
  call("engineer", "POST", `${root}/${created.body.templateId}`, { requestId: randomUUID(), expectedVersion: created.body.version, title: "Одна", items: [seam, thickness] }),
  call("engineer", "POST", `${root}/${created.body.templateId}`, { requestId: randomUUID(), expectedVersion: created.body.version, title: "Другая", items: [seam, thickness] }),
]);
assert.deepEqual(stale.map((item) => item.status).sort(), [201, 409]);
const submitted = await call("engineer", "POST", `${root}/${created.body.templateId}/submit`, { requestId: randomUUID(), expectedVersion: stale.find((item) => item.status === 201).body.version });
assert.equal((await call("zds", "POST", `${root}/${created.body.templateId}/decision`, { requestId: randomUUID(), expectedVersion: submitted.body.version, action: "approve", reason: null })).status, 409);
assert.equal((await call("worker", "POST", root, { ...command, requestId: randomUUID() })).status, 403);
assert.equal((await call("engineer", "POST", `/api/v1/projects/${other}/checklist-templates`, { ...command, requestId: randomUUID() })).status, 403);
assert.equal((await call("foreign", "POST", root, { ...command, requestId: randomUUID() }, byName.foreign.tenant)).status, 403);
assert.equal((await call("engineer", "GET", "/api/v1/projects")).status, 403);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await login(page, byName.engineer);
  await templates(page);
  await page.getByRole("button", { name: "Новый черновик" }).click();
  await page.getByLabel("Название").fill("Сдача шва");
  await page.getByLabel("Пункт").fill("Шов свободен");
  await page.getByRole("button", { name: "Добавить пункт" }).click();
  await page.getByLabel("Пункт").nth(1).fill("Толщина");
  await page.getByLabel("Тип").nth(1).selectOption("number");
  await page.getByLabel("Единица").fill("мм");
  await page.getByLabel("Допуск от").fill("10");
  await page.getByLabel("Допуск до").fill("20");
  let lostCreate = null;
  await page.route("**/api/v1/projects/*/checklist-templates", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    lostCreate = route.request().postDataJSON();
    const response = await route.fetch(); assert.equal(response.status(), 201);
    await route.abort("failed");
    await page.unroute("**/api/v1/projects/*/checklist-templates");
  });
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await page.getByText("Нет ответа сервера.", {exact:true}).waitFor();
  const retryCreate = page.waitForRequest((request) => request.method() === "POST" && /\/checklist-templates$/.test(new URL(request.url()).pathname));
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  assert.deepEqual((await retryCreate).postDataJSON(), lostCreate);
  assert.equal((await admin.query("SELECT count(*)::int n FROM checklist_template_editions WHERE tenant_id=$1 AND title='Сдача шва'", [tenant])).rows[0].n, 1);

  await page.getByRole("button", { name: /Сдача шва/ }).waitFor();
  await page.getByRole("button", { name: "Отправить по маршруту" }).click();
  const draft = () => page.getByRole("button", { name: /Сдача шва/ });
  await draft().getByText("У ответственного").waitFor();
  await logout(page);

  await login(page, byName.pto);
  await templates(page);
  await draft().click();
  assert.equal(await page.getByRole("button", { name: "Утвердить" }).count(), 0);
  await admin.query("UPDATE responsibility_orders SET status='revoked',revocation_reason='QA' WHERE id=$1", [order]);
  await page.getByRole("button", { name: "Принять ответственность" }).click();
  await page.getByText("Приказ отозван. Принятие шаблона им не подтверждается.", { exact: true }).waitFor();
  assert.equal((await admin.query("SELECT count(*)::int n FROM checklist_template_events WHERE tenant_id=$1 AND action='accept'", [tenant])).rows[0].n, 0);
  await admin.query("UPDATE responsibility_orders SET status='active',revocation_reason=NULL WHERE id=$1", [order]);
  await page.getByRole("button", { name: "Принять ответственность" }).click();
  await draft().getByText("На согласовании").waitFor();
  await logout(page);

  await login(page, byName.director);
  await templates(page);
  await draft().click();
  await page.getByRole("button", { name: "Согласовать" }).click();
  await page.getByText("Согласование записано").waitFor();
  assert.equal(await page.getByRole("button", { name: "Утвердить" }).count(), 0);
  await logout(page);

  await login(page, byName.safety);
  await templates(page);
  await draft().click();
  await page.getByRole("button", { name: "Согласовать" }).click();
  await page.getByText("Согласование записано").waitFor();
  await logout(page);

  await login(page, byName.zds);
  await templates(page);
  await page.getByRole("button", { name: /Сдача шва/ }).click();
  await page.getByRole("button", { name: "Утвердить" }).click();
  await page.getByText("Версия утверждена.").waitFor();
  await page.reload();
  await page.getByText("Для применения доступна редакция").waitFor();
  await logout(page);

  await login(page, byName.director);
  await templates(page);
  await page.getByText("Для применения доступна редакция").waitFor();
  await logout(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, byName.engineer);
  await templates(page);
  await page.getByRole("button", { name: /Сдача шва/ }).click();
  await page.getByRole("button", { name: "Новая редакция" }).click();
  await page.getByText("Открыта новая редакция.").waitFor();
  await page.getByLabel("Название").fill("Сдача шва, правка");
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await page.getByRole("button", { name: "Отправить по маршруту" }).click();
  await page.getByText("У ответственного").waitFor();
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(narrow <= 1, `overflow ${narrow}`);
  await logout(page);

  await login(page, byName.pto);
  await templates(page);
  await page.getByRole("button", { name: "Вернуть" }).click();
  await page.getByRole("alert").getByText("Укажите причину возврата.").waitFor();
  await page.getByLabel("Причина возврата").fill("Нет схемы узла");
  await page.getByRole("button", { name: "Вернуть" }).click();
  await page.getByText("Шаблон возвращён.").waitFor();
  await page.getByText("Нет схемы узла").waitFor();
  await page.reload();
  await templates(page);
  await page.getByRole("button", { name: /Сдача шва/ }).click();
  await page.getByRole("listitem").getByText("Нет схемы узла").waitFor();
  await page.getByText("Для применения доступна редакция").waitFor();
  const mobile = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(mobile <= 1, `overflow ${mobile}`);
  console.log(JSON.stringify({ ok: true, desktop: true, mobile: true, overflow: mobile }));
} finally {
  await page.close();
  await browser.close();
  const tenants = [tenant, byName.foreign.tenant];
  for (const table of ["checklist_template_events", "checklist_template_editions", "checklist_templates", "responsibility_order_revisions", "responsibility_orders", "people_command_receipts", "route_config_versions", "audit_log", "employees", "organizations", "project_memberships", "memberships", "projects"]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
  }
  await admin.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [people.map((person) => person.id)]);
  await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [people.map((person) => person.id)]);
  await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await admin.end();
}
