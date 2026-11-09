import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as rawRequest } from "node:http";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module.js";
import { adminUrl, createPool, withTenant } from "../src/db.js";
import { AllExceptionsFilter } from "../src/http.js";
import { hashPassword, hashToken } from "../src/password.js";

const admin = createPool(adminUrl);
const restricted = createPool();
const id = () => randomUUID();
const tenant = id(), foreign = id(), org = id(), foreignOrg = id();
const p1 = id(), p2 = id(), foreignProject = id();
const director = id(), master = id(), worker = id(), pto = id(), outsider = id();
const e1 = id(), e2 = id(), eNoTask = id(), eUnassigned = id(), foreignEmployee = id();
const t1 = id(), t2 = id(), t3 = id();
const users = [director, master, worker, pto, outsider];
const password = "fixture-password";
const tokens = new Map<string, string>();
let app: INestApplication | undefined;
let base: string;

test.after(async () => {
  try { await app?.close(); }
  finally {
    try {
      for (const table of ["crew_members", "crews", "employee_project_assignments", "employee_admission_checks", "admission_template_versions", "admission_templates", "employee_qualifications", "people_command_receipts", "project_memberships", "shifts", "work_reports", "daily_tasks", "employees", "memberships", "projects", "organizations", "audit_log"]) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[tenant, foreign]]);
      }
      await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenant, foreign]]);
      await admin.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [users]);
      await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
    } finally { await Promise.all([admin.end(), restricted.end()]); }
  }
});

async function request(path: string, user: string = director, options: RequestInit = {}, tenantId: string = tenant) {
  return fetch(`${base}${path}`, { ...options, headers: {
    authorization: `Bearer ${tokens.get(user)}`, "x-tenant-id": tenantId,
    "content-type": "application/json", ...options.headers,
  } });
}
async function json(path: string, user: string = director) {
  const response = await request(path, user);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
async function login(user: string, legacy = false) {
  const response = await fetch(`${base}${legacy ? "/api/auth/login" : "/api/v1/auth/login"}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${user}@fixture.test`, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

test.before(async () => {
  await admin.query("INSERT INTO tenants (id, name, timezone) VALUES ($1, 'Fixture A', 'America/Los_Angeles'), ($2, 'Fixture B', 'UTC')", [tenant, foreign]);
  const hash = hashPassword(password);
  for (const user of users) await admin.query("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, 'Fixture User', $3)", [user, `${user}@fixture.test`, hash]);
  for (const [user, role] of [[director, "director"], [master, "master"], [worker, "worker"], [pto, "pto"]]) {
    await admin.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)", [tenant, user, role]);
  }
  await admin.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'director')", [foreign, outsider]);
  await admin.query("INSERT INTO organizations (tenant_id,id,kind,name) VALUES ($1,$2,'own','Own'),($3,$4,'own','Foreign')", [tenant, org, foreign, foreignOrg]);
  await admin.query("INSERT INTO projects (tenant_id,id,name) VALUES ($1,$2,'A'),($1,$3,'B'),($4,$5,'Foreign')", [tenant, p1, p2, foreign, foreignProject]);
  for (const [employee, user, name] of [[e1, worker, "A Worker"], [e2, null, "B Employee"], [eNoTask, null, "C No Task"], [eUnassigned, null, "D Unassigned"]]) {
    await admin.query("INSERT INTO employees (tenant_id,id,organization_id,user_id,full_name,phone,document_number) VALUES ($1,$2,$3,$4,$5,$6,$7)", [tenant, employee, org, user, name, `phone-${employee}`, `doc-${employee}`]);
  }
  await admin.query("INSERT INTO employees (tenant_id,id,organization_id,full_name) VALUES ($1,$2,$3,'Foreign')", [foreign, foreignEmployee, foreignOrg]);
  for (const user of [master, worker, pto]) await admin.query("INSERT INTO project_memberships (tenant_id,project_id,user_id) VALUES ($1,$2,$3)", [tenant, p1, user]);
  for (const employee of [e1, e2, eNoTask]) await admin.query("INSERT INTO employee_project_assignments (tenant_id,project_id,employee_id) VALUES ($1,$2,$3)", [tenant, p1, employee]);
  await admin.query("INSERT INTO employee_project_assignments (tenant_id,project_id,employee_id) VALUES ($1,$2,$3)", [tenant, p2, e2]);
  for (const [task, project, employee, unit] of [[t1, p1, e1, "m2"], [t2, p1, e2, "m3"], [t3, p2, e2, "pieces"]]) {
    await admin.query("INSERT INTO daily_tasks (tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES ($1,$2,$3,'Fixture task','2026-11-01',10,$4,$5)", [tenant, task, project, unit, employee]);
  }
  // DST day: 2026-11-01 in Los Angeles spans [07:00Z, next day 08:00Z).
  for (const [task, quantity, accepted, timestamp] of [
    [t1, "2", "0", "2026-11-01T07:00:00Z"],
    [t1, "3", null, "2026-11-02T07:59:59Z"],
    [t2, "4", "1", "2026-11-01T12:00:00Z"],
    [t1, "8", "8", "2026-11-02T08:00:00Z"],
    [t1, "9", null, "2026-11-01T06:59:59Z"],
    [t3, "6", null, "2026-11-01T12:00:00Z"],
  ]) await admin.query("INSERT INTO work_reports (tenant_id,task_id,submitted_quantity,accepted_quantity,created_at) VALUES ($1,$2,$3,$4,$5)", [tenant, task, quantity, accepted, timestamp]);
  for (const [task, employee, start, occurred, status] of [
    [t1, e1, "2026-11-01T07:00:00Z", null, "open"],
    [t1, e1, "2026-11-01T08:00:00Z", "2026-11-01T08:00:00Z", "finished"],
    [t2, e2, "2026-11-02T08:00:00Z", "2026-11-02T07:59:59Z", "open"],
    [t2, e2, "2026-10-30T00:00:00Z", null, "open"],
  ]) await admin.query("INSERT INTO shifts (tenant_id,task_id,employee_id,started_at,occurred_started_at,status) VALUES ($1,$2,$3,$4,$5,$6)", [tenant, task, employee, start, occurred, status]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of users) tokens.set(user, (await login(user)).token);
});

test("HTTP project tracer: director tenant scope, master explicit project scope, durable migrations", async () => {
  assert.deepEqual((await json("/api/v1/projects")).items.map((p: any) => p.id), [p1, p2]);
  assert.deepEqual((await json("/api/v1/projects", master)).items.map((p: any) => p.id), [p1]);
  assert.equal((await request("/api/v1/projects", director, {}, foreign)).status, 403);
  assert.equal((await request("/api/v1/projects", outsider)).status, 403);
  assert.equal((await request(`/api/v1/projects/${foreignProject}`)).status, 404);
  assert.equal((await request(`/api/v1/projects/${p2}`, master)).status, 404);
  const before = await admin.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename");
  for (let n = 0; n < 2; n++) execFileSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], { cwd: new URL("..", import.meta.url), env: process.env });
  assert.deepEqual((await admin.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename")).rows, before.rows);
  assert.equal((await json("/api/v1/projects")).total, 2);
});

test("ACL foreign keys and forced tenant RLS under restricted application role", async () => {
  const role = await restricted.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false });
  for (const values of [[tenant, foreignProject, master], [tenant, p1, outsider]]) {
    await assert.rejects(admin.query("INSERT INTO project_memberships (tenant_id,project_id,user_id) VALUES ($1,$2,$3)", values), (e: any) => e.code === "23503");
  }
  await assert.rejects(admin.query("INSERT INTO employee_project_assignments (tenant_id,project_id,employee_id) VALUES ($1,$2,$3)", [tenant, p1, foreignEmployee]), (e: any) => e.code === "23503");
  assert.equal((await restricted.query("SELECT * FROM project_memberships")).rowCount, 0);
  const result = await withTenant(restricted, foreign, outsider, (c) => c.query("SELECT * FROM employee_project_assignments"));
  assert.equal(result.rowCount, 0);
});

test("actor and paginated camelCase read contracts, active project ACL and worker ownership", async () => {
  assert.deepEqual(Object.keys(await json("/api/v1/me")).sort(), ["email", "name", "role", "tenantId", "userId"]);
  assert.equal((await json("/api/v1/projects?limit=1&offset=5")).total, 2);
  assert.equal((await json("/api/v1/projects?limit=1&offset=5")).items.length, 0);
  assert.equal((await json(`/api/v1/projects/${p1}/tasks?day=2026-11-01`, master)).total, 2);
  const workerTasks = await json(`/api/v1/projects/${p1}/tasks`, worker);
  assert.equal(workerTasks.total, 1);
  assert.equal(workerTasks.items[0].assigneeEmployeeId, e1);
  assert.equal(workerTasks.items[0].plannedQuantity, "10.000");
  assert.equal((await json(`/api/v1/projects/${p1}/tasks?day=2026-11-02`)).total, 0);
  assert.equal((await json(`/api/v1/employees?projectId=${p1}`, master)).total, 3);
  assert.equal((await json("/api/v1/employees", master)).total, 3);
  assert.equal((await json("/api/v1/employees")).total, 4);
  const employees = await json("/api/v1/employees", worker);
  assert.equal(employees.total, 1);
  assert.equal(employees.items[0].id, e1);
  assert.equal("document_number" in employees.items[0], false);
  assert.equal("documentNumber" in employees.items[0], false);
  assert.equal((await request(`/api/v1/employees/${e2}`, worker)).status, 404);
  assert.equal((await request(`/api/v1/employees/${eUnassigned}`, master)).status, 404);
  assert.equal((await request(`/api/v1/employees/${foreignEmployee}`)).status, 404);
  assert.equal((await request(`/api/v1/employees?projectId=${p2}`, pto)).status, 404);
  assert.equal((await request(`/api/v1/projects/${p2}/tasks`, worker)).status, 404);
  const legacy = await json("/api/desk", worker);
  assert.deepEqual(legacy.employees.map((e: any) => e.id), [e1]);
  assert.equal((await request(`/api/employees/${e2}`, worker)).status, 404);
  assert.equal((await request(`/api/employees/${e1}`, worker)).status, 200);
});

test("overview reconciles independent real counts, DST half-open dates, lossless per-unit quantities", async () => {
  const overview = await json(`/api/v1/overview?projectId=${p1}&day=2026-11-01`, master);
  assert.equal(overview.day, "2026-11-01");
  assert.equal(overview.timezone, "America/Los_Angeles");
  assert.equal(overview.assignedEmployees, 3);
  assert.equal(overview.tasksForDay, 2);
  assert.equal(overview.employeesStartedShiftsForDay, 2);
  assert.equal(overview.currentOpenShifts, 3);
  assert.equal(overview.submittedReportsForDay, 3);
  assert.equal(overview.reviewedReportsForDay, 2);
  assert.deepEqual(overview.quantities, [
    { unit: "m2", submittedQuantity: "5.000", acceptedQuantity: "0.000" },
    { unit: "m3", submittedQuantity: "4.000", acceptedQuantity: "1.000" },
  ]);
  for (const metric of [overview.quality, overview.downtimeDuration, overview.idReadiness]) {
    assert.equal(metric.status, "unavailable"); assert.equal(metric.value, null); assert.ok(metric.source);
  }
  const own = await json("/api/v1/overview?day=2026-11-01", worker);
  assert.equal(own.tasksForDay, 1); assert.equal(own.assignedEmployees, 1); assert.equal(own.currentOpenShifts, 1);
  assert.equal(own.submittedReportsForDay, 2); assert.equal(own.reviewedReportsForDay, 1);
  const empty = await json("/api/v1/overview?day=2020-01-01", master);
  assert.equal(empty.tasksForDay, 0); assert.equal(empty.submittedReportsForDay, 0); assert.deepEqual(empty.quantities, []);
  const today = await admin.query("SELECT to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS day");
  assert.equal((await json("/api/v1/overview")).day, today.rows[0].day);
  assert.equal((await request(`/api/v1/overview?projectId=${p2}`, master)).status, 404);
});

test("access is rechecked after login, including membership and assignment revocation", async () => {
  await admin.query("UPDATE project_memberships SET status = 'revoked' WHERE tenant_id=$1 AND user_id=$2", [tenant, pto]);
  assert.equal((await json("/api/v1/projects", pto)).total, 0);
  assert.equal((await request(`/api/v1/projects/${p1}`, pto)).status, 404);
  await admin.query("UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND employee_id=$2", [tenant, e1]);
  assert.equal((await json("/api/v1/projects", worker)).total, 0);
  assert.equal((await request(`/api/v1/projects/${p1}/tasks`, worker)).status, 404);
  // The worker's own profile remains readable even without a project assignment.
  assert.equal((await request(`/api/v1/employees/${e1}`, worker)).status, 200);
  await admin.query("UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND employee_id=$2", [tenant, e1]);
  await admin.query("UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2", [tenant, pto]);
  assert.equal((await request("/api/v1/me", pto)).status, 403);
  assert.equal((await login(pto)).memberships.length, 0);
});

test("worker task authorization requires assignment of its actual assignee employee", async () => {
  const additionalEmployee = id();
  await admin.query("INSERT INTO employees (tenant_id,id,organization_id,user_id,full_name) VALUES ($1,$2,$3,$4,'Own unassigned alias')", [tenant, additionalEmployee, org, worker]);
  await admin.query("INSERT INTO daily_tasks (tenant_id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES ($1,$2,'Unassigned alias task','2026-11-03',1,'m2',$3)", [tenant, p1, additionalEmployee]);
  assert.equal((await json(`/api/v1/projects/${p1}/tasks`, worker)).total, 1);
  assert.equal((await json("/api/v1/overview?day=2026-11-03", worker)).tasksForDay, 0);
  await admin.query("INSERT INTO employee_project_assignments (tenant_id,project_id,employee_id) VALUES ($1,$2,$3)", [tenant, p1, additionalEmployee]);
  assert.equal((await json(`/api/v1/projects/${p1}/tasks`, worker)).total, 2);
  await admin.query("UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND employee_id=$2", [tenant, additionalEmployee]);
  assert.equal((await json(`/api/v1/projects/${p1}/tasks`, worker)).total, 1);
});

test("malformed UUID, query/date/pagination/header/login inputs fail with controlled 4xx", async () => {
  for (const path of [
    "/api/v1/projects/nope", "/api/v1/employees/nope", "/api/v1/employees?projectId=nope",
    "/api/v1/projects?limit=0", "/api/v1/projects?limit=101", "/api/v1/projects?offset=-1",
    "/api/v1/projects?offset=1.5", "/api/v1/projects?limit=1&limit=2", "/api/v1/projects?limit[]=2",
    "/api/v1/overview?day=2026-02-30", "/api/v1/overview?day=2026-13-01", "/api/v1/overview?day=0000-01-01",
    "/api/v1/overview?day=2026-11-01&day=2026-11-02", "/api/v1/overview?projectId=nope",
    "/api/v1/projects?role=director",
  ]) assert.equal((await request(path)).status, 400, path);
  for (const authorization of ["", "Bearer bad", "Basic abc", `Bearer ${"a".repeat(65)}`, ["Bearer a", "Bearer b"].join(", ")]) {
    assert.equal((await request("/api/v1/me", director, { headers: { authorization } })).status, 401);
  }
  for (const tenantId of ["", "nope", `${tenant}, ${foreign}`]) assert.equal((await request("/api/v1/me", director, {}, tenantId)).status, 400);
  for (const body of [null, [], {}, { email: [] ,password }, { email: `${director}@fixture.test`, password: true }, { email: 1, password }, { email: {}, password }, { email: "x", password: "x".repeat(1025) }]) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal((await request("/api/v1/me", director, { headers: { authorization: `Bearer ${"a".repeat(64)}` } })).status, 401);
  const spoofed = await request(`/api/v1/projects/${p2}`, master, { headers: { "x-role": "director" } });
  assert.equal(spoofed.status, 404);
  for (const [header, expected] of [["authorization", 401], ["x-tenant-id", 400]] as const) {
    const headers: Record<string, string | string[]> = { authorization: `Bearer ${tokens.get(director)}`, "x-tenant-id": tenant };
    headers[header] = [headers[header] as string, headers[header] as string];
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = rawRequest(`${base}/api/v1/me`, { headers }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode));
      });
      req.on("error", reject); req.end();
    });
    assert.equal(status, expected, `duplicate ${header}`);
  }
});

test("invalid/expired sessions are 401 and logout revokes only the presented session", async () => {
  const a = await login(director, true), b = await login(director);
  const tokenRequest = (token: string, path = "/api/v1/me", method = "GET") => request(path, director, { method, headers: { authorization: `Bearer ${token}` } });
  await admin.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [hashToken(a.token)]);
  assert.equal((await tokenRequest(a.token)).status, 401);
  assert.equal((await tokenRequest(b.token)).status, 200);
  const response = await tokenRequest(b.token, "/api/v1/auth/logout", "POST");
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { ok: true });
  assert.equal((await tokenRequest(b.token)).status, 401);
  assert.equal((await request("/api/v1/me")).status, 200);
});

test("public OpenAPI is the checked-in contract and preserves ten old plus twenty people operations with additive task routes", async () => {
  const response = await fetch(`${base}/api/v1/openapi.json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.deepEqual(spec, JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8")));
  assert.equal(spec.openapi, "3.0.3");
  assert.equal(Object.values(spec.paths).reduce((n: number, path: any) => n + Object.keys(path).length, 0), 58);
  for (const path of ["/api/v1/me", "/api/v1/projects", "/api/v1/projects/{id}", "/api/v1/projects/{id}/tasks", "/api/v1/employees", "/api/v1/employees/{id}", "/api/v1/overview", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/openapi.json"]) assert.ok(spec.paths[path], path);
  const inventory = [
    ['post','/employees'],['put','/employees/{id}'],['get','/employees/{id}/qualifications'],['post','/employees/{id}/qualifications'],['put','/employees/{id}/qualifications/{qid}'],
    ['get','/projects/{p}/admission-template'],['get','/projects/{p}/admission-template/versions'],['post','/projects/{p}/admission-template'],['put','/projects/{p}/admission-template'],
    ['get','/employees/{id}/admission-checks'],['get','/employees/{id}/admission-checks/{check}'],['post','/employees/{id}/admission-checks'],
    ['get','/projects/{p}/memberships'],['put','/projects/{p}/memberships/{user}'],['get','/projects/{p}/assignments'],['put','/projects/{p}/assignments/{e}'],
    ['get','/projects/{p}/crews'],['get','/projects/{p}/crews/{crew}'],['post','/projects/{p}/crews'],['put','/projects/{p}/crews/{crew}/members/{e}'],
  ];
  for(const [method,path] of inventory) assert.ok(spec.paths[`/api/v1${path}`]?.[method!],`${method} ${path}`);
  for(const schema of ['E','Q','T','C','A','M','CurrentAdmission'])assert.ok(spec.components.schemas[schema],schema);
  function matches(value: any, schema: any, at: string): void {
    if (schema.$ref) return matches(value, spec.components.schemas[schema.$ref.split("/").pop()], at);
    if (value === null && schema.nullable) return;
    if (schema.enum) assert.ok(schema.enum.includes(value), `${at} enum`);
    if (schema.type === "object") {
      assert.equal(typeof value, "object", at); assert.ok(value !== null && !Array.isArray(value), at);
      for (const key of schema.required ?? []) assert.ok(key in value, `${at}.${key}`);
      for (const [key, child] of Object.entries(value)) {
        if (schema.additionalProperties === false) assert.ok(key in schema.properties, `${at}.${key} unexpected`);
        if (schema.properties[key]) matches(child, schema.properties[key], `${at}.${key}`);
      }
    } else if (schema.type === "array") {
      assert.ok(Array.isArray(value), at); value.forEach((child: any, index: number) => matches(child, schema.items, `${at}[${index}]`));
    } else if (schema.type === "integer") {
      assert.ok(Number.isSafeInteger(value), at);
      if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, at);
      if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, at);
    } else {
      assert.equal(typeof value, schema.type, at);
      if (schema.pattern) assert.match(value, new RegExp(schema.pattern), at);
    }
  }
  for (const [path, schemaName] of [["/api/v1/me", "Actor"], [`/api/v1/projects/${p1}`, "Project"], [`/api/v1/employees/${e1}`, "Employee"], ["/api/v1/overview?day=2026-11-01", "Overview"], ["/api/v1/projects", "ProjectList"], ["/api/v1/employees", "EmployeeList"], [`/api/v1/projects/${p1}/tasks`, "TaskList"]]) {
    const body = await json(path!);
    matches(body, spec.components.schemas[schemaName!], schemaName!);
  }
  matches(await login(director), spec.components.schemas.Login, "Login");
});
