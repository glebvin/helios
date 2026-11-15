// Confirms one synthetic workbook on the private contour. Does not touch another database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { hashPassword } from "../apps/api/src/password.ts";
import { staffImportBook } from "../apps/web/src/staff-import.ts";

const web = new URL(process.env.HELIOS_IMPORT_WEB ?? "http://127.0.0.1:5291");
const dbPort = process.env.HELIOS_IMPORT_DB_PORT ?? "54612";
assert.equal(web.hostname, "127.0.0.1");
assert.equal(web.port, "5291");
assert.equal(dbPort, "54612");
const password = "staff-import-browser";
const tenant = randomUUID();
const org = randomUUID();
const hr = { id: randomUUID(), email: `hr-${tenant}@staff-import.test`, name: "Кадровик" };
const director = { id: randomUUID(), email: `director-${tenant}@staff-import.test`, name: "Второй руководитель" };
const worker = { id: randomUUID(), email: `worker-${tenant}@staff-import.test`, name: "Работник" };
const db = new pg.Client({ host: "127.0.0.1", port: Number(dbPort), user: "helios", password: "helios", database: "helios" });
await db.connect();
const live = await db.query(`SELECT inet_server_port()::text AS port, inet_server_addr()::text AS host, current_setting('data_directory') AS directory`);
assert.equal(live.rows[0].port, "54612");
assert.match(live.rows[0].host, /^127\.0\.0\.1/);
assert.match(live.rows[0].directory, /staff-import-confirm\/\.data\/pg-54612$/);
const hash = hashPassword(password);
await db.query(`INSERT INTO tenants(id,name) VALUES($1,'Браузерный импорт')`, [tenant]);
for (const person of [
  { ...hr, role: "hr" },
  { ...director, role: "director" },
  { ...worker, role: "worker" },
]) {
  await db.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [person.id, person.email, person.name, hash]);
  await db.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, person.id, person.role]);
}
await db.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Свой работодатель')`, [tenant, org]);
const out = ".data/staff-import-confirm";
await mkdir(out, { recursive: true });
const file = `${out}/example.xlsx`;
await writeFile(file, staffImportBook([
  { key: "701", fullName: "Орлов Сергей Павлович", phone: "+7 900 000-07-01" },
  { key: "702", fullName: "Орлов Сергей Павлович", phone: "+7 900 000-07-02" },
]));
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => console.error("pageerror", error.message));
  await login(page, hr.email, password);
  await openPeople(page);
  await page.getByLabel("Работодатель", { exact: true }).selectOption(org);
  await page.getByLabel("Файл сотрудников Excel").setInputFiles(file);
  await page.getByRole("heading", { name: "Сотрудники ещё не сохранены", exact: true }).waitFor();
  await page.getByText("Строк в предпросмотре: 2. Замечаний в файле: 0.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Проверить на сервере", exact: true }).click();
  await page.getByRole("heading", { name: "Сервер готов сохранить пакет", exact: true }).waitFor();
  await page.getByText("Новая карточка.", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Подтвердить импорт", exact: true }).click();
  await page.getByText("Сотрудники сохранены.", { exact: true }).waitFor();
  await page.getByRole("cell", { name: "Орлов Сергей Павлович" }).first().waitFor();
  assert.equal(await page.getByRole("cell", { name: "Орлов Сергей Павлович" }).count(), 2);
  await page.getByText("Кадровик").first().waitFor();
  await page.reload();
  await openPeople(page);
  await page.getByText("Результат импорта", { exact: true }).waitFor();
  await page.getByText("Создано карточек: 2. Строк без создания: 0.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("cell", { name: "Орлов Сергей Павлович" }).count(), 2);
  await page.getByRole("button", { name: "К", exact: true }).click();
  await page.getByRole("menuitem", { name: "Выйти", exact: true }).click();
  await page.getByRole("heading", { name: "Кто входит", exact: true }).waitFor();
  await login(page, director.email, password);
  await openPeople(page);
  await page.getByText("Результат импорта", { exact: true }).waitFor();
  await page.getByText("Кадровик").first().waitFor();
  assert.equal(await page.getByRole("cell", { name: "Орлов Сергей Павлович" }).count(), 2);
  await page.getByRole("button", { name: "ВР", exact: true }).click();
  await page.getByRole("menuitem", { name: "Выйти", exact: true }).click();
  await login(page, worker.email, password);
  assert.equal(await page.getByRole("button", { name: "Проверить файл", exact: true }).count(), 0);
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const narrow = await phone.newPage();
  await login(narrow, director.email, password);
  await openPeople(narrow);
  await narrow.getByText("Результат импорта", { exact: true }).waitFor();
  await narrow.getByRole("button", { name: "Проверить файл", exact: true }).waitFor();
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);
  await phone.close();
} finally {
  await browser.close();
  await db.end();
}

async function openPeople(page) {
  const people = page.locator("button.nav-item", { hasText: "Люди" });
  await people.waitFor();
  await people.click();
  await page.getByRole("button", { name: "Проверить файл", exact: true }).waitFor();
}

async function login(page, email, secret) {
  await page.goto(web.href);
  await page.getByLabel("Логин", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("helios.session") ?? "null")?.token);
}
