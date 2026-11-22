import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import pg from "pg";
import { hashPassword } from "../apps/api/src/password.ts";

const web = process.env.HELIOS_WEB_ORIGIN ?? "http://127.0.0.1:5391";
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const tenant = randomUUID();
const user = randomUUID();
const project = randomUUID();
const password = "import-price-local";
await admin.connect();
await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Импорт цен','Europe/Moscow')`, [tenant]);
await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,'cost-import@prices.test','Смета',$2)`, [user, hashPassword(password)]);
await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'cost')`, [tenant, user]);
await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Дом импорта')`, [tenant, project]);
await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
await admin.query(
  `INSERT INTO project_work_types(tenant_id,project_id,name,unit,requires_rd,requires_material_control,requires_predecessor_acceptance,requires_id)
   VALUES($1,$2,'Штукатурка','м²',false,false,false,false)`,
  [tenant, project],
);
await admin.end();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(web);
await page.getByLabel("Логин").fill("cost-import@prices.test");
await page.getByLabel("Пароль").fill(password);
await page.getByRole("button", { name: "Войти" }).click();
await page.getByRole("heading", { name: "Реестр единицы" }).waitFor();
const table = page.getByLabel("Таблица цен");
await table.fill("Нет такого;10;2026-03-01;2026-03-31\nШтукатурка;;2026-04-01;2026-04-30");
await page.getByRole("button", { name: "Проверить" }).click();
await page.getByRole("alert").waitFor();
const rejected = await page.getByRole("alert").innerText();
if (!rejected.includes("Нет такого вида работ") || !rejected.includes("Цена должна")) throw new Error(rejected);
await table.fill("Штукатурка;12.5;2026-03-01;2026-03-31");
await page.getByRole("button", { name: "Проверить" }).click();
await page.getByRole("status").getByText("12.5 за м²").waitFor();
await page.getByRole("button", { name: "Записать проверенные" }).click();
await page.getByText("Таблица записана.").waitFor();
await page.reload();
await page.getByRole("heading", { name: "Реестр единицы" }).waitFor();
await page.getByRole("tab", { name: "Дом импорта" }).click();
await page.getByText("Версия 1").waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Проверить" }).waitFor();
if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
console.log("price import browser passed");
