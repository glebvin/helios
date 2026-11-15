import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { hashPassword } from "../apps/api/src/password.ts";

const dbPort = 54571;
const apiPort = 4397;
const webPort = 5268;
const root = fileURLToPath(new URL("..", import.meta.url));
const qaDir = path.join(root, ".data/phone-qa");
const password = "phone-browser-password";
const email = `director-${randomUUID()}@invite.test`;
const phone = "+79005550067";
const children = [];

function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  let text = "";
  child.stdout.on("data", (chunk) => { text += chunk; });
  child.stderr.on("data", (chunk) => { text += chunk; });
  return { child, output: () => text };
}

async function waitFor(read, needle) {
  const started = Date.now();
  while (!read().includes(needle)) {
    if (Date.now() - started > 30000) throw new Error(`timeout waiting for ${needle}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const db = run("node", ["scripts/db.mjs", "up"], { HELIOS_DB_PORT: String(dbPort) });
  await waitFor(db.output, "postgres");
  const admin = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${dbPort}/helios` });
  await admin.connect();
  const placed = await admin.query("SELECT inet_server_port() AS port, current_setting('data_directory') AS dir");
  assert.equal(Number(placed.rows[0].port), dbPort);
  assert.equal(placed.rows[0].dir.endsWith(`.data/pg-${dbPort}`), true);
  await admin.end();
  const migrate = spawn("corepack", ["pnpm", "--filter", "@helios/api", "migrate"], {
    cwd: root,
    env: {
      ...process.env,
      HELIOS_DB_PORT: String(dbPort),
      DATABASE_URL: `postgres://helios_app:helios_app@127.0.0.1:${dbPort}/helios`,
      ADMIN_DATABASE_URL: `postgres://helios:helios@127.0.0.1:${dbPort}/helios`,
    },
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => migrate.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`migrate ${code}`))));
  const seed = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${dbPort}/helios` });
  await seed.connect();
  const tenant = randomUUID();
  const org = randomUUID();
  const project = randomUUID();
  const director = randomUUID();
  await seed.query("INSERT INTO tenants(id,name) VALUES($1,'Phone QA')", [tenant]);
  await seed.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Phone QA')", [tenant, org]);
  await seed.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект телефона')", [tenant, project]);
  await seed.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'QA Director',$3)", [director, email, hashPassword(password)]);
  await seed.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')", [tenant, director]);
  await seed.end();
  const api = run("corepack", ["pnpm", "--filter", "@helios/api", "dev"], {
    API_PORT: String(apiPort),
    HELIOS_DB_PORT: String(dbPort),
    DATABASE_URL: `postgres://helios_app:helios_app@127.0.0.1:${dbPort}/helios`,
    ADMIN_DATABASE_URL: `postgres://helios:helios@127.0.0.1:${dbPort}/helios`,
    HELIOS_PHONE_PROVIDER: "synthetic",
    HELIOS_PHONE_CODE_SECRET: "qa-phone-secret-0123456789abcdef",
    HELIOS_PHONE_QA_DIR: qaDir,
  });
  await waitFor(api.output, "api http");
  const web = run("corepack", ["pnpm", "--filter", "@helios/web", "dev"], {
    HELIOS_WEB_PORT: String(webPort),
    HELIOS_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  });
  await waitFor(web.output, "Local:");
  const base = `http://localhost:${webPort}`;
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const directorPage = await desktop.newPage();
  directorPage.setDefaultTimeout(15000);
  await directorPage.goto(base);
  await directorPage.getByLabel("Логин", { exact: true }).fill(email);
  await directorPage.getByLabel("Пароль", { exact: true }).fill(password);
  await directorPage.getByRole("button", { name: "Войти", exact: true }).click();
  await directorPage.getByRole("button", { name: "Люди", exact: true }).click();
  await directorPage.getByRole("button", { name: "Пригласить работника", exact: true }).click();
  const dialog = directorPage.getByRole("dialog");
  await dialog.getByLabel("Телефон", { exact: true }).fill(phone);
  await dialog.getByRole("button", { name: "Создать ссылку", exact: true }).click();
  const link = await dialog.getByLabel("Ссылка приглашения").inputValue();
  assert.equal(link.startsWith(`${base}/join/`), true);
  await dialog.getByText("+7 ··· 67").waitFor();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await directorPage.getByRole("button", { name: "QD", exact: true }).click();
  await directorPage.getByRole("menuitem", { name: "Выйти", exact: true }).click();
  await directorPage.getByRole("heading", { name: "Кто входит" }).waitFor();
  const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const join = await narrow.newPage();
  join.setDefaultTimeout(15000);
  await join.goto(link);
  await join.getByLabel("Имя и фамилия").fill("Иван Петров");
  await join.getByRole("button", { name: "Получить код", exact: true }).click();
  await join.getByLabel("Код из сообщения").waitFor();
  const code = JSON.parse(readFileSync(`${qaDir}/codes.json`, "utf8"))[phone];
  assert.equal(/^\d{6}$/.test(code), true);
  await join.getByLabel("Код из сообщения").fill(code);
  await join.getByRole("button", { name: "Войти", exact: true }).click();
  await join.getByRole("heading", { name: "Моя смена", exact: true }).waitFor();
  await join.reload();
  await join.getByRole("heading", { name: "Моя смена", exact: true }).waitFor();
  const cabinet = await join.locator("body").innerText();
  assert.equal(cabinet.includes(code), false);
  const narrowFit = await join.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  assert.equal(narrowFit, true);
  await join.getByRole("button", { name: "Профиль", exact: true }).click();
  await join.getByRole("button", { name: "Выйти", exact: true }).click();
  await join.getByRole("heading", { name: "Кто входит" }).waitFor();
  const clock = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${dbPort}/helios` });
  await clock.connect();
  await clock.query("UPDATE phone_challenges SET created_at = now() - interval '2 minutes' WHERE phone = $1", [phone]);
  await clock.end();
  await join.getByRole("button", { name: "Войти по телефону", exact: true }).click();
  await join.getByLabel("Телефон", { exact: true }).fill(phone);
  await join.getByRole("button", { name: "Получить код", exact: true }).click();
  await join.getByLabel("Код", { exact: true }).waitFor();
  const next = JSON.parse(readFileSync(`${qaDir}/codes.json`, "utf8"))[phone];
  assert.equal(next === code, false);
  await join.getByLabel("Код", { exact: true }).fill(next);
  await join.getByRole("button", { name: "Войти", exact: true }).click();
  await join.getByRole("heading", { name: "Моя смена", exact: true }).waitFor();
  assert.equal((await join.locator("body").innerText()).includes(next), false);
  await desktop.close();
  await narrow.close();
  const passwordPage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  await passwordPage.goto(base);
  await passwordPage.getByLabel("Логин", { exact: true }).fill(email);
  await passwordPage.getByLabel("Пароль", { exact: true }).fill(password);
  await passwordPage.getByRole("button", { name: "Войти", exact: true }).click();
  await passwordPage.getByRole("button", { name: "Люди", exact: true }).waitFor();
  const loginFit = await passwordPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  assert.equal(loginFit, true);
  console.log("phone login browser: invite, join, reopen, phone login, password login, 390px");
} finally {
  await browser.close().catch(() => undefined);
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
}
