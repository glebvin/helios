import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { refuseBlockedChecklist } from "../src/checklist-runs.service.js";
import { withTenant, createPool } from "../src/db.js";
import { AllExceptionsFilter } from "../src/http.js";
import { hashPassword } from "../src/password.js";

const ci = process.env.GITHUB_ACTIONS === "true";
const expectedPort = ci ? "54339" : "54621";
const expectedDir = ci ? /codex-api\/\.data\/pg-54339$/ : /checklist-execution\/\.data\/pg-54621$/;
const password = "checklist-run-test";
const tenant = randomUUID();
const otherTenant = randomUUID();
const project = randomUUID();
const otherProject = randomUUID();
const foreignProject = randomUUID();
const template = randomUUID();
const task = randomUUID();
const otherTask = randomUUID();
const foreignTask = randomUUID();
const org = randomUUID();
const foreignOrg = randomUUID();
const people = [
  { key: "master", role: "master", name: "Мастер" },
  { key: "worker", role: "worker", name: "Работник" },
  { key: "other", role: "worker", name: "Чужой работник" },
  { key: "pto", role: "pto", name: "ПТО" },
  { key: "director", role: "director", name: "Руководитель" },
  { key: "hr", role: "hr", name: "Кадры" },
].map((person) => ({ ...person, id: randomUUID(), email: `${person.key}-${tenant}@checklist-run.test` }));
const employee = randomUUID();
const otherEmployee = randomUUID();
const foreignEmployee = randomUUID();
const adminTarget = new URL(process.env.ADMIN_DATABASE_URL ?? "postgres://invalid");
const admin = createPool(adminTarget.toString());
const appPool = createPool(process.env.DATABASE_URL);
let app: INestApplication;
let base = "";
const tokens = new Map<string, string>();
const jpeg = Buffer.from("ffd8ffe000104a4649460001", "hex");
const pdf = Buffer.from("%PDF-1.7\nchecklist\n%%EOF");

before(async () => {
  const live = await admin.query(`SELECT inet_server_port()::text AS port, inet_server_addr()::text AS host, current_setting('data_directory') AS directory`);
  assert.equal(adminTarget.hostname, "127.0.0.1");
  assert.equal(live.rows[0].port, expectedPort);
  if (!ci) assert.match(live.rows[0].host, /^127\.0\.0\.1/);
  assert.match(live.rows[0].directory, expectedDir);
  const hash = hashPassword(password);
  await admin.query(`INSERT INTO tenants(id,name) VALUES($1,'Своя'),($2,'Чужая')`, [tenant, otherTenant]);
  for (const person of people) {
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [person.id, person.email, person.name, hash]);
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, person.id, person.role]);
  }
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя компания')`, [tenant, org]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Чужая компания')`, [otherTenant, foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Свой объект'),($1,$3,'Другой объект')`, [tenant, project, otherProject]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Чужой объект')`, [otherTenant, foreignProject]);
  for (const person of people) {
    if (person.key === "hr") continue;
    await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id,status) VALUES($1,$2,$3,'active')`, [tenant, project, person.id]);
  }
  const worker = people.find((person) => person.key === "worker")!;
  const other = people.find((person) => person.key === "other")!;
  const master = people.find((person) => person.key === "master")!;
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id) VALUES($1,$2,$3,'Работник',$4),($1,$5,$3,'Чужой',$6)`, [tenant, employee, org, worker.id, otherEmployee, other.id]);
  await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Шов','2026-11-15',1,'м2',$4),($1,$5,$6,'Чужое','2026-11-15',1,'м2',$7)`, [tenant, task, project, employee, otherTask, otherProject, otherEmployee]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Чужая компания')`, [otherTenant, foreignEmployee, foreignOrg]);
  await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Чужая компания','2026-11-15',1,'м2',$4)`, [otherTenant, foreignTask, foreignProject, foreignEmployee]);
  const items = JSON.stringify([
    { id: "seam", prompt: "Шов свободен", kind: "yes_no", required: true, critical: true, pass: "yes" },
    { id: "thick", prompt: "Толщина", kind: "number", required: true, critical: true, unit: "мм", min: "10", max: "20" },
    { id: "shot", prompt: "Фото шва", kind: "photo", required: true, critical: false },
    { id: "paper", prompt: "Паспорт", kind: "document", required: false, critical: false },
    { id: "lot", prompt: "Партия", kind: "batch", required: false, critical: false },
  ]);
  await admin.query(`INSERT INTO checklist_templates(tenant_id,project_id,id,created_by) VALUES($1,$2,$3,$4)`, [tenant, project, template, master.id]);
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,1,'Шов',$4,'approved',3,$5)`, [tenant, project, template, items, master.id]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const person of people) tokens.set(person.key, await login(person.email));
});

after(async () => {
  await app?.close();
  await appPool.end();
  await admin.end();
});

test("мастер сохраняет прохождение, повтор не создаёт вторую запись, ПТО читает тот же результат", async () => {
  const photo = await send(`/projects/${project}/tasks/${task}/checklist-files`, fileBody("shot", "шов.jpg", "image/jpeg", jpeg), "master");
  assert.equal(photo.status, 201, JSON.stringify(photo.body));
  const again = await send(`/projects/${project}/tasks/${task}/checklist-files`, fileBody("shot", "шов.jpg", "image/jpeg", jpeg, photo.requestId), "master");
  assert.equal(again.status, 201);
  assert.equal(again.body.fileId, photo.body.fileId);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM checklist_run_files WHERE tenant_id=$1`, [tenant])).rows[0].n, 1);
  const answers = [
    { itemId: "seam", value: "yes" },
    { itemId: "thick", value: "12" },
    { itemId: "shot", value: photo.body.fileId },
  ];
  const requestId = randomUUID();
  const saved = await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId, templateId: template, edition: 1, expectedVersion: 0, answers }, "master");
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.passed, true);
  assert.equal(saved.body.blocksNext, false);
  assert.equal(saved.body.templateVersion, 3);
  assert.equal(saved.body.actorName, "Мастер");
  assert.equal(saved.body.files[0].fileId, photo.body.fileId);
  const replay = await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId, templateId: template, edition: 1, expectedVersion: 0, answers }, "master");
  assert.equal(replay.status, 201);
  assert.equal(replay.body.id, saved.body.id);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM checklist_runs WHERE tenant_id=$1`, [tenant])).rows[0].n, 1);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM work_reports WHERE tenant_id=$1`, [tenant])).rows[0].n, 0);
  const read = await send(`/projects/${project}/tasks/${task}/checklist-runs`, undefined, "pto", "GET");
  assert.equal(read.status, 200);
  assert.equal(read.body.latest.id, saved.body.id);
  assert.equal(read.body.latest.answers[0].value, "yes");
  assert.equal(read.body.approved[0].templateId, template);
  assert.equal(read.body.approved[0].edition, 1);
  const bytes = await fetch(`${base}/api/v1/projects/${project}/tasks/${task}/checklist-files/${photo.body.fileId}`, { headers: headers("pto") });
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), jpeg);
});

test("новый идентификатор пишет историю и не меняет закреплённую редакцию", async () => {
  const photo = (await send(`/projects/${project}/tasks/${task}/checklist-files`, fileBody("shot", "шов.jpg", "image/jpeg", jpeg), "master")).body.fileId;
  const second = await send(`/projects/${project}/tasks/${task}/checklist-runs`, {
    requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 1,
    answers: [{ itemId: "seam", value: "yes" }, { itemId: "thick", value: "12" }, { itemId: "shot", value: photo }],
  }, "master");
  assert.equal(second.status, 201);
  assert.equal(second.body.version, 2);
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,2,'Новая редакция',$4,'approved',1,$5)`, [tenant, project, template, JSON.stringify([{ id: "seam", prompt: "Новый шов", kind: "yes_no", required: true, critical: true, pass: "yes" }]), people.find((person) => person.key === "master")!.id]);
  const read = await send(`/projects/${project}/tasks/${task}/checklist-runs`, undefined, "worker", "GET");
  assert.equal(read.body.history.length, 2);
  assert.equal(read.body.history[0].items[0].prompt, "Шов свободен");
  assert.equal(read.body.history[0].templateVersion, 3);
  assert.equal(read.body.approved[0].edition, 2);
  assert.equal(read.body.approved[0].title, "Новая редакция");
});

test("критичный отказ сохраняется и останавливает следующее действие, партия не считается проверенной", async () => {
  const photo = (await send(`/projects/${project}/tasks/${task}/checklist-files`, fileBody("shot", "шов.jpg", "image/jpeg", jpeg), "master")).body.fileId;
  const failed = await send(`/projects/${project}/tasks/${task}/checklist-runs`, {
    requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 2,
    answers: [{ itemId: "seam", value: "no" }, { itemId: "thick", value: "12" }, { itemId: "shot", value: photo }, { itemId: "lot", value: "batch-1" }],
  }, "master");
  assert.equal(failed.status, 201, JSON.stringify(failed.body));
  assert.equal(failed.body.passed, false);
  assert.equal(failed.body.blocksNext, true);
  assert.equal(failed.body.verdict.refusals.some((item: { reason: string }) => item.reason === "critical_invalid"), true);
  assert.equal(failed.body.verdict.refusals.some((item: { itemId: string; reason: string }) => item.itemId === "lot" && item.reason === "batch_unavailable"), true);
  await assert.rejects(withTenant(appPool, tenant, people.find((person) => person.key === "master")!.id, (c) => refuseBlockedChecklist(c, tenant, task)), (error: { message?: string }) => error.message === "checklist_blocked");
});

test("конфликт версии и отсутствующий файл не оставляют частичную запись", async () => {
  const before = (await admin.query(`SELECT count(*)::int AS n FROM checklist_runs WHERE tenant_id=$1`, [tenant])).rows[0].n;
  const stale = await send(`/projects/${project}/tasks/${task}/checklist-runs`, {
    requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 0,
    answers: [{ itemId: "seam", value: "yes" }, { itemId: "thick", value: "12" }, { itemId: "shot", value: randomUUID() }],
  }, "master");
  assert.equal(stale.status, 409);
  const missing = await send(`/projects/${project}/tasks/${task}/checklist-runs`, {
    requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 3,
    answers: [{ itemId: "seam", value: "yes" }, { itemId: "thick", value: "12" }, { itemId: "shot", value: randomUUID() }],
  }, "master");
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error, "file_denied");
  const forged = await send(`/projects/${project}/tasks/${task}/checklist-files`, fileBody("shot", "нет.jpg", "image/jpeg", Buffer.from("not-a-jpeg")), "master");
  assert.equal(forged.status, 422);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM checklist_runs WHERE tenant_id=$1`, [tenant])).rows[0].n, before);
});

test("чужая компания, объект, задание и запрещённая роль не отдают прохождение", async () => {
  const denied = await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 3, answers: [] }, "director");
  assert.equal(denied.status, 403);
  assert.equal((await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 3, answers: [] }, "hr")).status, 403);
  assert.equal((await send(`/projects/${otherProject}/tasks/${otherTask}/checklist-runs`, undefined, "master", "GET")).status, 403);
  assert.equal((await send(`/projects/${project}/tasks/${otherTask}/checklist-runs`, undefined, "pto", "GET")).status, 404);
  assert.equal((await send(`/projects/${foreignProject}/tasks/${foreignTask}/checklist-runs`, undefined, "pto", "GET")).status, 403);
  assert.equal((await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId: randomUUID(), templateId: template, edition: 1, expectedVersion: 3, answers: [{ itemId: "seam", value: "yes" }] }, "other")).status, 403);
  const draft = randomUUID();
  await admin.query(`INSERT INTO checklist_templates(tenant_id,project_id,id,created_by) VALUES($1,$2,$3,$4)`, [tenant, project, draft, people.find((person) => person.key === "master")!.id]);
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,1,'Черновик',$4,'draft',1,$5)`, [tenant, project, draft, JSON.stringify([{ id: "seam", prompt: "Шов", kind: "yes_no", required: true, critical: false, pass: "yes" }]), people.find((person) => person.key === "master")!.id]);
  const unapproved = await send(`/projects/${project}/tasks/${task}/checklist-runs`, { requestId: randomUUID(), templateId: draft, edition: 1, expectedVersion: 3, answers: [{ itemId: "seam", value: "yes" }] }, "master");
  assert.equal(unapproved.status, 422);
  assert.equal(unapproved.body.error, "template_not_approved");
});

async function login(email: string) {
  const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 201);
  return (await response.json()).token as string;
}

function headers(key: string) {
  return { authorization: `Bearer ${tokens.get(key)}`, "x-tenant-id": tenant, "content-type": "application/json" };
}

function fileBody(itemId: string, filename: string, contentType: string, bytes: Buffer, requestId?: string) {
  return { requestId: requestId ?? randomUUID(), itemId, filename, contentType, fileBase64: bytes.toString("base64") };
}

async function send(path: string, body: unknown, key: string, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: headers(key), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, requestId: (body as { requestId?: string } | undefined)?.requestId };
}
