// Local UI check for the personnel order registry. Refuses every other port and database.
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { chromium } from "playwright";
import { hashPassword } from "../apps/api/src/password.ts";

const webPort = 5258, apiPort = 4393, dbPort = 54561;
assert.equal(webPort, 5258);
assert.equal(apiPort, 4393);
assert.equal(dbPort, 54561);
const base = `http://127.0.0.1:${webPort}`;
const db = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${dbPort}/helios` });
await db.connect();
assert.equal((await db.query("SELECT inet_server_port()")).rows[0].inet_server_port, dbPort);
assert.equal(realpathSync((await db.query("SHOW data_directory")).rows[0].data_directory), realpathSync(resolve(".data/pg-54561")));
const tenantId = randomUUID(), projectId = randomUUID(), organizationId = randomUUID(), employeeId = randomUUID();
const hr = { id: randomUUID(), email: `${randomUUID()}@orders.test`, password: "fixture-orders-2026", role: "hr" };
const director = { id: randomUUID(), email: `${randomUUID()}@orders.test`, password: "fixture-orders-2026", role: "director" };
await db.query("INSERT INTO tenants(id,name) VALUES($1,'Orders browser')", [tenantId]);
await db.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя компания')", [tenantId, organizationId]);
await db.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект А')", [tenantId, projectId]);
for (const user of [hr, director]) {
  await db.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [user.id, user.email, user.role, hashPassword(user.password)]);
  await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [tenantId, user.id, user.role]);
}
await db.query("INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Иванов')", [tenantId, employeeId, organizationId]);
mkdirSync(".data/orders-browser", { recursive: true });
writeFileSync(".data/orders-browser/fixture.json", JSON.stringify({ tenantId, projectId, hr, director }));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("Логин", { exact: true }).fill(hr.email);
  await page.getByLabel("Пароль", { exact: true }).fill(hr.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".login"));
  const panel = page.getByRole("region", { name: "Приказы об ответственных", exact: true });
  const field = (name) => panel.locator("label", { hasText: name }).locator("input, select").first();
  await field("Человек").selectOption({ label: "Иванов · Своя компания" });
  await field("Номер").fill("ПР-15");
  const from = await field("Действует с").inputValue();
  const until = new Date(`${from}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 10);
  await field("Действует по").fill(until.toISOString().slice(0, 10));
  await panel.getByRole("button", { name: "Записать приказ", exact: true }).click();
  await page.getByText("Сервер записал приказ ПР-15.", { exact: true }).waitFor();
  await panel.getByText("Истекает", { exact: false }).first().waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Приказы", exact: true }).click();
  await panel.getByRole("button", { name: /ПР-15/ }).waitFor();
  await panel.getByRole("button", { name: "Проверить срок", exact: true }).click();
  await panel.getByText("Приказ действует на эту дату.", { exact: true }).waitFor();
  assert.equal((await db.query("SELECT count(*)::int n FROM responsibility_orders WHERE tenant_id=$1", [tenantId])).rows[0].n, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: ".data/orders-browser/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: ".data/orders-browser/desktop.png", fullPage: true });
  await context.close();
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const directorPage = await other.newPage();
  await directorPage.goto(base);
  await directorPage.getByLabel("Логин", { exact: true }).fill(director.email);
  await directorPage.getByLabel("Пароль", { exact: true }).fill(director.password);
  await directorPage.getByRole("button", { name: "Войти", exact: true }).click();
  await directorPage.waitForFunction(() => !document.querySelector(".login"));
  assert.equal(await directorPage.getByRole("button", { name: "Приказы", exact: true }).count(), 0);
  await other.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, orders: 1, mobile: true, directorHidden: true }));
} catch (error) {
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: ".data/orders-browser/failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await db.end();
}
