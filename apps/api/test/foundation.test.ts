import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NestFactory } from "@nestjs/core";
import {
  EMPLOYEE_A,
  EMPLOYEE_B,
  FILE_B,
  TENANT_A,
  TENANT_B,
  USER_DIRECTOR,
  USER_MASTER,
} from "@helios/domain";
import { AppModule } from "../src/app.module.js";
import { createPool, withTenant } from "../src/db.js";
import { processReportJob } from "../src/jobs.js";
import { WorkforceService, type Actor } from "../src/workforce.service.js";
import { AllExceptionsFilter } from "../src/http.js";

const pool = createPool();
const app = await NestFactory.create(AppModule, { logger: false });
app.useGlobalFilters(new AllExceptionsFilter());
const server = await app.listen(0, "127.0.0.1");
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const base = `http://127.0.0.1:${port}/api`;

async function login(email: string, password: string) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token: string; user: { id: string }; memberships: { tenant_id: string }[] };
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

function headers(token: string, tenantId: string) {
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}

test("кабинет A не видит человека, файл и связь кабинета B", async () => {
  const director = await login("director@pilot.helios", "pilot-director");
  const other = await login("other@foreign.helios", "pilot-other");
  const deniedEmployee = await fetch(`${base}/employees/${EMPLOYEE_B}`, { headers: headers(director.token, TENANT_A) });
  assert.equal(deniedEmployee.status, 404);
  const deniedFile = await fetch(`${base}/files/${FILE_B}`, { headers: headers(director.token, TENANT_A) });
  assert.equal(deniedFile.status, 404);
  const wrongTenant = await fetch(`${base}/desk`, { headers: headers(director.token, TENANT_B) });
  assert.equal(wrongTenant.status, 403);
  const foreignToken = await fetch(`${base}/desk`, { headers: headers(other.token, TENANT_A) });
  assert.equal(foreignToken.status, 403);
  const crossTask = await fetch(`${base}/tasks`, {
    method: "POST",
    headers: headers(director.token, TENANT_A),
    body: JSON.stringify({
      title: "Чужое назначение",
      employeeId: EMPLOYEE_B,
      plannedQuantity: "1",
      unit: "м2",
      workDate: "2026-11-07",
    }),
  });
  assert.equal(crossTask.status, 422);
  const desk = (await (await fetch(`${base}/desk`, { headers: headers(director.token, TENANT_A) })).json()) as {
    employees: { full_name: string; phone: string }[];
  };
  assert.equal(desk.employees.some((item) => item.full_name === "Секретный работник"), false);
  assert.equal(desk.employees.some((item) => item.phone === "+79990001122"), true);
});

test("пул не сохраняет контекст кабинета", async () => {
  await withTenant(pool, TENANT_A, USER_DIRECTOR, async (client) => {
    await client.query("SELECT count(*) FROM employees");
  });
  const client = await pool.connect();
  try {
    const setting = await client.query(`SELECT current_setting('app.tenant_id', true) AS value`);
    const count = await client.query(`SELECT count(*)::int AS n FROM employees`);
    assert.equal(setting.rows[0].value ?? "", "");
    assert.equal(count.rows[0].n, 0);
  } finally {
    client.release();
  }
});

test("откат записи не оставляет задачу, повтор worker не удваивает эффект", async () => {
  const master = await login("master@pilot.helios", "pilot-master");
  const created = await fetch(`${base}/tasks`, {
    method: "POST",
    headers: headers(master.token, TENANT_A),
    body: JSON.stringify({
      title: "Облицовка стен",
      employeeId: EMPLOYEE_A,
      plannedQuantity: "40",
      unit: "м2",
      workDate: "2026-11-07",
    }),
  });
  const task = (await created.json()) as { id: string };
  assert.equal(created.status, 201, JSON.stringify(task));

  const workforce = app.get(WorkforceService);
  const actor: Actor = {
    userId: USER_MASTER,
    tenantId: TENANT_A,
    role: "master",
    name: "Павел Орлов",
    email: "master@pilot.helios",
  };
  const rolled = await workforce.recordAndMaybeRollback(actor, "2", true);
  const leftover = await pool.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'reportId' = $1`, [
    rolled.reportId,
  ]);
  assert.equal(leftover.rows[0].n, 0);

  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const event = {
    eventId,
    tenantId: TENANT_A,
    userId: USER_MASTER,
    kind: "submit_volume",
    occurredAt,
    payload: { taskId: task.id, quantity: "18" },
  };
  const first = await fetch(`${base}/sync/events`, {
    method: "POST",
    headers: headers(master.token, TENANT_A),
    body: JSON.stringify({ events: [event] }),
  });
  const firstBody = (await first.json()) as { results: { reportId: string; duplicate?: boolean }[] };
  assert.equal(first.status, 201, JSON.stringify(firstBody));
  const second = await fetch(`${base}/sync/events`, {
    method: "POST",
    headers: headers(master.token, TENANT_A),
    body: JSON.stringify({ events: [event] }),
  });
  const secondBody = (await second.json()) as { results: { duplicate?: boolean }[] };
  assert.equal(secondBody.results[0]?.duplicate, true);
  const reports = await withTenant(pool, TENANT_A, USER_MASTER, (client) =>
    client.query(`SELECT count(*)::int AS n FROM work_reports WHERE id = $1`, [firstBody.results[0].reportId]),
  );
  assert.equal(reports.rows[0].n, 1);

  const queued = await pool.query(`SELECT data FROM pgboss.job WHERE data->>'reportId' = $1`, [firstBody.results[0].reportId]);
  assert.equal(queued.rowCount, 1);
  await processReportJob(pool, queued.rows[0].data);
  await processReportJob(pool, queued.rows[0].data);
  const effects = await withTenant(pool, TENANT_A, USER_MASTER, (client) =>
    client.query(`SELECT count(*)::int AS n FROM report_effects WHERE report_id = $1`, [firstBody.results[0].reportId]),
  );
  assert.equal(effects.rows[0].n, 1);

  const foreign = await fetch(`${base}/sync/events`, {
    method: "POST",
    headers: headers(master.token, TENANT_A),
    body: JSON.stringify({
      events: [{ ...event, eventId: randomUUID(), tenantId: TENANT_B }],
    }),
  });
  assert.equal(foreign.status, 403);
});

test.after(async () => {
  await app.close();
  await pool.end();
});
