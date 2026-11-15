import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/http.js";
import { adminUrl, createPool } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { defaultRouteConfiguration } from "../src/route-config.js";
import { checkHttpContract } from "./contract-check.js";

const qaPort = process.env.HELIOS_CHECKLIST_QA_DB_PORT ?? "54563";
assert.ok(["54563","54595"].includes(qaPort));
const password = "fixture-checklist-2026";
const admin = createPool(adminUrl);
let app: { close(): Promise<void>; getUrl(): Promise<string>; useGlobalFilters(filter: unknown): void; listen(port: number, host: string): Promise<void> } | undefined;
let base = "";
let tenant = "";
let foreignTenant = "";
let project = "";
let otherProject = "";
const tokens = new Map<string, string>();
const ids = new Map<string, string>();

const yes = (id: string, prompt: string, critical = false) => ({ id, prompt, kind: "yes_no", pass: "yes", required: true, critical });
const items = [
  yes("seam", "Шов свободен", true),
  { id: "thickness", prompt: "Толщина", kind: "number", required: true, critical: false, unit: "мм", min: "10", max: "20" },
  { id: "photo", prompt: "Фото шва", kind: "photo", required: false, critical: false },
  { id: "drawing", prompt: "Чертёж", kind: "document", required: false, critical: false },
  { id: "batch", prompt: "Партия", kind: "batch", required: false, critical: false },
  ...Array.from({ length: 6 }, (_, index) => yes(`extra-${index + 1}`, `Дополнительный пункт ${index + 1}`)),
];

async function call(who: string, method: string, path: string, body?: unknown, tenantId = tenant) {
  const response = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${tokens.get(who)}`, "x-tenant-id": tenantId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  checkHttpContract(path, method, response.status, data, response.headers);
  return { status: response.status, body: data };
}

function decision(action: string, version: number, extra: Record<string, unknown> = {}) {
  return { requestId: randomUUID(), expectedVersion: version, action, reason: null, ...extra };
}

test.before(async () => {
  const url = new URL((admin.options as { connectionString: string }).connectionString);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, process.env.GITHUB_ACTIONS === "true" ? "54339" : qaPort);
  const directory = (await admin.query("SHOW data_directory")).rows[0].data_directory as string;
  if (process.env.GITHUB_ACTIONS !== "true") assert.equal(realpathSync(directory), realpathSync(fileURLToPath(new URL(`../../../.data/pg-${qaPort}`, import.meta.url))));
  tenant = randomUUID();
  foreignTenant = randomUUID();
  project = randomUUID();
  otherProject = randomUUID();
  const people = ["engineer", "other", "pto", "director", "safety", "zds", "zds2", "worker", "cost", "foreign"].map((name) => ({ name, id: randomUUID(), role: name === "other" || name === "foreign" ? "engineer-pto" : name === "zds" || name === "zds2" ? "zds-soso" : name === "engineer" ? "engineer-pto" : name }));
  for (const person of people) ids.set(person.name, person.id);
  const hash = hashPassword(password);
  await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Checklist QA'),($2,'Foreign checklist')", [tenant, foreignTenant]);
  await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект шаблона'),($1,$3,'Чужой объект')", [tenant, project, otherProject]);
  await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Чужая компания')", [foreignTenant, randomUUID()]);
  for (const person of people) {
    await admin.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [person.id, `${person.id}@checklist.test`, person.name, hash]);
    const home = person.name === "foreign" ? foreignTenant : tenant;
    await admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [home, person.id, person.role]);
    if (person.name !== "foreign") await admin.query("INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)", [tenant, project, person.id]);
  }
  const configuration = defaultRouteConfiguration();
  const route = configuration.routes.find((item) => item.documentType === "inspection-template")!;
  route.preparers[0]!.userId = ids.get("engineer")!;
  route.responsibles[0]!.userId = ids.get("pto")!;
  route.reviewers = [{ role: "director", userId: ids.get("director")! }, { role: "safety", userId: ids.get("safety")! }];
  route.approvers[0]!.userId = ids.get("zds")!;
  await admin.query("INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,1,1,$3,$4)", [tenant, project, JSON.stringify(configuration), ids.get("engineer")]);
  const server = await NestFactory.create(AppModule, { logger: false });
  server.useGlobalFilters(new AllExceptionsFilter());
  await server.listen(0, "127.0.0.1");
  app = server;
  base = await app.getUrl();
  for (const person of people) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${person.id}@checklist.test`, password }) });
    assert.equal(response.status, 201, person.name);
    tokens.set(person.name, (await response.json()).token);
  }
});

test.after(async () => {
  await app?.close();
  try {
    if (tenant) {
      const tenants = [tenant, foreignTenant];
      for (const table of ["checklist_template_events", "checklist_template_editions", "checklist_templates", "people_command_receipts", "route_config_versions", "audit_log", "project_memberships", "memberships", "projects"]) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
      }
      await admin.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [[...ids.values()]]);
      await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[...ids.values()]]);
      await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
    }
  } finally { await admin.end(); }
});

test("template draft follows PTO, both reviews and ZDS, then a new edition leaves the approved one unchanged", async () => {
  const root = `/api/v1/projects/${project}/checklist-templates`;
  const badPass = await call("engineer", "POST", root, { requestId: randomUUID(), title: "Плохой", items: [{ id: "seam", prompt: "Шов", kind: "yes_no", required: true, critical: true }] });
  assert.equal(badPass.status, 400);
  assert.equal(badPass.body.error, "invalid_template");
  const badBounds = await call("engineer", "POST", root, { requestId: randomUUID(), title: "Плохой", items: [{ id: "thickness", prompt: "Толщина", kind: "number", required: true, critical: false, unit: "мм", min: "20", max: "10" }] });
  assert.equal(badBounds.status, 400);
  const command = { requestId: randomUUID(), title: "Сдача шва", items };
  const created = await call("engineer", "POST", root, command);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.items.length, 11);
  assert.equal(created.body.status, "draft");
  assert.deepEqual(created.body.allowedActions, ["save", "submit"]);
  const replay = await call("engineer", "POST", root, command);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.templateId, created.body.templateId);
  assert.equal((await admin.query("SELECT count(*)::int n FROM checklist_templates WHERE tenant_id=$1", [tenant])).rows[0].n, 1);
  const template = `${root}/${created.body.templateId}`;
  const version = created.body.version as number;
  const [first, second] = await Promise.all([
    call("engineer", "POST", template, { requestId: randomUUID(), expectedVersion: version, title: "Первая правка", items }),
    call("engineer", "POST", template, { requestId: randomUUID(), expectedVersion: version, title: "Вторая правка", items }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  assert.equal([first, second].find((item) => item.status === 409)!.body.error, "stale_version");
  const current = [first, second].find((item) => item.status === 201)!.body;
  const submitted = await call("engineer", "POST", `${template}/submit`, { requestId: randomUUID(), expectedVersion: current.version });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.status, "pending_responsible");
  assert.equal(submitted.body.route.configurationVersion, 1);
  const replacement = defaultRouteConfiguration();
  const changed = replacement.routes.find((item) => item.documentType === "inspection-template")!;
  changed.preparers[0]!.userId = ids.get("engineer")!;
  changed.responsibles[0]!.userId = ids.get("pto")!;
  changed.reviewers = [{ role: "director", userId: ids.get("director")! }, { role: "safety", userId: ids.get("safety")! }];
  changed.approvers[0]!.userId = ids.get("zds2")!;
  await admin.query("INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,2,1,$3,$4)", [tenant, project, JSON.stringify(replacement), ids.get("engineer")]);
  const early = await call("zds", "POST", `${template}/decision`, decision("approve", submitted.body.version));
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "reviews_required");
  const accepted = await call("pto", "POST", `${template}/decision`, decision("accept", submitted.body.version));
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.status, "in_review");
  assert.equal((await call("zds", "POST", `${template}/decision`, decision("approve", accepted.body.version))).body.error, "reviews_required");
  const reviewed = await call("director", "POST", `${template}/decision`, decision("review", accepted.body.version));
  assert.equal(reviewed.status, 201);
  assert.equal(reviewed.body.status, "in_review");
  const duplicate = await call("director", "POST", `${template}/decision`, decision("review", reviewed.body.version));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "review_recorded");
  const safety = await call("safety", "POST", `${template}/decision`, decision("review", reviewed.body.version));
  assert.equal(safety.status, 201);
  assert.equal(safety.body.status, "pending_approval");
  assert.equal((await call("zds2", "POST", `${template}/decision`, decision("approve", safety.body.version))).status, 403);
  const approved = await call("zds", "POST", `${template}/decision`, decision("approve", safety.body.version));
  assert.equal(approved.status, 201);
  assert.equal(approved.body.status, "approved");
  assert.equal(approved.body.applicable.edition, 1);
  const reread = await call("pto", "GET", `${template}?edition=1`);
  assert.equal(reread.status, 200);
  assert.equal(reread.body.status, "approved");
  assert.equal(reread.body.items.length, 11);
  assert.equal(reread.body.route.configurationVersion, 1);
  assert.equal(reread.body.history.some((event: { action: string }) => event.action === "approve"), true);
  const revised = await call("engineer", "POST", `${template}/decision`, decision("revise", approved.body.version, { title: "Сдача шва, редакция 2", items }));
  assert.equal(revised.status, 201);
  assert.equal(revised.body.edition, 2);
  assert.equal(revised.body.status, "draft");
  const previous = await call("director", "GET", `${template}?edition=1`);
  assert.equal(previous.body.status, "approved");
  assert.equal(previous.body.history.some((event: { action: string }) => event.action === "revise"), false);
  assert.equal(previous.body.items[0].prompt, "Шов свободен");
  const sent = await call("engineer", "POST", `${template}/submit`, { requestId: randomUUID(), expectedVersion: revised.body.version });
  assert.equal(sent.status, 201);
  const emptyReason = await call("pto", "POST", `${template}/decision`, decision("return", sent.body.version, { reason: " " }));
  assert.equal(emptyReason.status, 400);
  assert.equal(emptyReason.body.error, "reason_required");
  const returned = await call("pto", "POST", `${template}/decision`, decision("return", sent.body.version, { reason: "Нет схемы узла" }));
  assert.equal(returned.status, 201);
  assert.equal(returned.body.status, "returned");
  assert.equal(returned.body.history.at(-1).reason, "Нет схемы узла");
  assert.equal((await call("director", "GET", `${template}?edition=1`)).body.status, "approved");
  assert.equal((await call("worker", "POST", root, command)).status, 403);
  assert.equal((await call("other", "POST", root, { ...command, requestId: randomUUID() })).status, 403);
  assert.equal((await call("engineer", "POST", `/api/v1/projects/${otherProject}/checklist-templates`, { ...command, requestId: randomUUID() })).status, 403);
  assert.equal((await call("foreign", "POST", root, { ...command, requestId: randomUUID() }, foreignTenant)).status, 403);
  assert.equal((await call("engineer", "POST", "/api/v1/employees", {})).status, 403);
  assert.equal((await call("engineer", "GET", "/api/v1/projects")).status, 403);
  assert.equal((await call("cost", "GET", "/api/v1/checklist-templates")).status, 403);
  assert.equal((await call("safety", "POST", root, { ...command, requestId: randomUUID() })).status, 403);
  assert.equal((await call("zds", "POST", `${template}/submit`, { requestId: randomUUID(), expectedVersion: returned.body.version })).status, 403);
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action LIKE 'checklist.%'", [tenant])).rows[0].n > 0, true);
});

test("an old template receipt cannot bypass revoked project access", async () => {
  const path = `/api/v1/projects/${project}/checklist-templates`;
  const body = {requestId:randomUUID(),title:"Replay permission proof",items:[yes("one","Ready",true)]};
  const saved = await call("engineer","POST",path,body);
  assert.equal(saved.status,201,JSON.stringify(saved.body));
  await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[tenant,project,ids.get("engineer")]);
  try {assert.equal((await call("engineer","POST",path,body)).status,403);}
  finally {await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[tenant,project,ids.get("engineer")]);}
});
