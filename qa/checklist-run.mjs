import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { hashPassword } from "../apps/api/src/password.ts";

const password = "checklist-run-browser";
const dbPort = Number(process.env.HELIOS_CHECKLIST_RUN_DB_PORT ?? 54621);
const apiPort = Number(process.env.HELIOS_CHECKLIST_RUN_API_PORT ?? 4423);
const webPort = Number(process.env.HELIOS_CHECKLIST_RUN_WEB_PORT ?? 5297);
assert.equal(dbPort, 54621);
const db = `postgres://helios:helios@127.0.0.1:${dbPort}/helios`;
const web = `http://localhost:${webPort}`;
const admin = new pg.Pool({ connectionString: db });
const tenant = randomUUID();
const project = randomUUID();
const template = randomUUID();
const task = randomUUID();
const org = randomUUID();
const employee = randomUUID();
const people = ["master", "pto", "hr"].map((key) => ({
  key,
  id: randomUUID(),
  role: key,
  email: `${key}-${randomUUID()}@checklist-run.test`,
  label: { master: "Мастер Смены", pto: "Пётр ПТО", hr: "Катя Кадры" }[key],
}));
const byKey = Object.fromEntries(people.map((person) => [person.key, person]));
const jpeg = Buffer.alloc(70_000, 1);
jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff;
const pdf = Buffer.from("%PDF-1.7\nchecklist\n%%EOF");

const directory = (await admin.query("SHOW data_directory")).rows[0].data_directory;
assert.equal(realpathSync(directory), realpathSync(fileURLToPath(new URL("../.data/pg-54621", import.meta.url))));
const hash = hashPassword(password);
await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Прохождение')", [tenant]);
const day = (await admin.query("SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM tenants WHERE id=$1", [tenant])).rows[0].day;
await admin.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя компания')", [tenant, org]);
await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект шва')", [tenant, project]);
for (const person of people) {
  await admin.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [person.id, person.email, person.label, hash]);
  await admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [tenant, person.id, person.role]);
  if (person.key !== "hr") await admin.query("INSERT INTO project_memberships(tenant_id,project_id,user_id,status) VALUES($1,$2,$3,'active')", [tenant, project, person.id]);
}
await admin.query("INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id) VALUES($1,$2,$3,'Работник',$4)", [tenant, employee, org, byKey.master.id]);
await admin.query("INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Шов',$4,1,'м2',$5)", [tenant, task, project, day, employee]);
const items = [
  { id: "seam", prompt: "Шов свободен", kind: "yes_no", required: true, critical: true, pass: "yes" },
  { id: "thick", prompt: "Толщина", kind: "number", required: true, critical: true, unit: "мм", min: "10", max: "20" },
  { id: "shot", prompt: "Фото шва", kind: "photo", required: true, critical: false },
  { id: "paper", prompt: "Паспорт", kind: "document", required: false, critical: false },
  { id: "lot", prompt: "Партия", kind: "batch", required: false, critical: false },
];
await admin.query("INSERT INTO checklist_templates(tenant_id,project_id,id,created_by) VALUES($1,$2,$3,$4)", [tenant, project, template, byKey.master.id]);
await admin.query("INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,1,'Сдача шва',$4,'approved',3,$5)", [tenant, project, template, JSON.stringify(items), byKey.master.id]);

async function login(page, person) {
  await page.goto(web);
  await page.getByLabel("Логин").fill(person.email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByRole("navigation").waitFor();
}

async function logout(page) {
  await page.locator(".avatar").click();
  await page.getByRole("menuitem", { name: "Выйти" }).click();
  await page.getByRole("button", { name: "Войти" }).waitFor();
}

async function openTask(page) {
  await page.getByRole("navigation").getByRole("button", { name: "Задания" }).click();
  await page.getByRole("button", { name: "Шов" }).click();
  await page.getByRole("region", { name: "Чек-лист задания" }).waitFor();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await login(page, byKey.master);
  await openTask(page);
  const checklist = page.getByRole("region", { name: "Чек-лист задания" });
  await checklist.getByText("Редакция 1, версия 3.").waitFor();
  await checklist.getByRole("button", { name: "Да" }).click();
  await checklist.locator("input").first().fill("12");
  await checklist.locator("input[type=file]").nth(0).setInputFiles({ name: "шов.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await checklist.getByText("Сохранено на устройстве").waitFor();
  await checklist.locator("input[type=file]").nth(1).setInputFiles({ name: "паспорт.pdf", mimeType: "application/pdf", buffer: pdf });
  await checklist.getByText("шов.jpg").waitFor();
  await checklist.getByText("паспорт.pdf").waitFor();
  await checklist.getByText("Проверка партии ещё не подключена.").waitFor();
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("helios-managed-offline"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const rows = await new Promise((resolve, reject) => { const request = db.transaction("checklist").objectStore("checklist").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return rows.some((row) => row.answers?.some((answer) => answer.value === "12") && row.files?.length === 2 && row.files.every((file) => file.bytes?.byteLength > 0));
    } finally { db.close(); }
  });
  await page.route("**/api/v1/**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await openTask(page);
  await checklist.getByRole("button", { name: "Да" }).waitFor();
  await checklist.locator("input").first().waitFor();
  assert.equal(await checklist.locator("input").first().inputValue(), "12");
  await checklist.getByText("шов.jpg").waitFor();
  await page.unroute("**/api/v1/**");
  let dropped = false;
  await page.route("**/checklist-runs", async (route) => {
    if (!dropped && route.request().method() === "POST") {
      dropped = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await checklist.getByRole("button", { name: "Сохранить на сервере" }).click();
  await checklist.getByText("Ожидает отправки. Это ещё не запись на сервере.").waitFor();
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM checklist_runs WHERE tenant_id=$1", [tenant])).rows[0].n, 0);
  await page.unroute("**/checklist-runs");
  await checklist.getByRole("button", { name: "Сохранить на сервере" }).click();
  await checklist.getByText("Сервер принял ответы").waitFor();
  await page.reload();
  await openTask(page);
  await checklist.getByText("Сервер принял ответы").waitFor();
  await checklist.getByText("Мастер Смены").waitFor();
  const stored = (await admin.query("SELECT count(*)::int AS runs, (SELECT count(*)::int FROM work_reports WHERE tenant_id=$1) AS reports FROM checklist_runs WHERE tenant_id=$1", [tenant])).rows[0];
  assert.equal(stored.runs, 1);
  assert.equal(stored.reports, 0);
  const photo = (await admin.query("SELECT bytes FROM checklist_run_files WHERE tenant_id=$1 AND filename='шов.jpg'", [tenant])).rows[0];
  assert.equal(photo.bytes.length, jpeg.length);
  assert.equal(photo.bytes[0], 0xff);
  assert.equal(photo.bytes[1], 0xd8);
  assert.equal(photo.bytes[2], 0xff);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `ширина страницы больше окна на ${overflow}px`);
  await logout(page);
  await login(page, byKey.pto);
  await openTask(page);
  await checklist.getByText("Сервер принял ответы").waitFor();
  await checklist.getByText("Мастер Смены").waitFor();
  assert.equal(await checklist.getByRole("button", { name: "Сохранить на сервере" }).count(), 0);
  const ptoOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ptoOverflow <= 1, `ширина страницы ПТО больше окна на ${ptoOverflow}px`);
  await logout(page);
  await login(page, byKey.hr);
  assert.equal(await page.getByRole("button", { name: "Задания" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Сохранить на сервере" }).count(), 0);
  console.log("checklist run browser ok");
} finally {
  await browser.close();
  await admin.end();
}
