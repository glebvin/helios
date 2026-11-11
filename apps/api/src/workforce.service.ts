import { createHash } from "node:crypto";
import {
  PROJECT_A,
  QUEUE_WORK_REPORT,
  assertSameScope,
  keyBelongsToTenant,
  partialAcceptance,
  stableEventBody,
} from "@helios/domain";
import { Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { queryClient, withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { reportJob } from "./jobs.js";
import { uuid } from "./api-input.js";
import { taskJoin, taskVisible } from "./director-api.service.js";
import { parsePlace } from "./place.js";
import { cabinetReadRole } from "./cabinet-roles.js";

export type Actor = {
  userId: string;
  tenantId: string;
  role: string;
  name: string;
  email: string;
};

type ClientEvent = {
  eventId: string;
  tenantId: string;
  userId: string;
  kind: "shift_start" | "shift_end" | "submit_volume";
  occurredAt: string;
  payload: { taskId?: string; employeeId?: string; quantity?: string };
};

const deskEmployeeVisible = `($1 = 'director' OR e.user_id=$2 OR ($1 IN ('master','pto') AND EXISTS (
  SELECT 1 FROM project_memberships own_pm JOIN project_memberships person_pm
    ON person_pm.tenant_id=own_pm.tenant_id AND person_pm.project_id=own_pm.project_id
  WHERE own_pm.user_id=$2 AND own_pm.status='active' AND person_pm.user_id=e.user_id AND person_pm.status='active'
)) OR ($1 IN ('master','pto') AND EXISTS (
  SELECT 1 FROM employee_project_assignments a JOIN project_memberships pm ON pm.tenant_id=a.tenant_id AND pm.project_id=a.project_id
  WHERE a.employee_id=e.id AND a.status='active' AND pm.user_id=$2 AND pm.status='active'
)))`;

const sampleRings = [
  { label: "План", current: 72, target: 90, unit: "%" },
  { label: "Простои", current: 6, target: 20, unit: "ч" },
  { label: "ИД", current: 4, target: 12, unit: "док" },
];

@Injectable()
export class WorkforceService {
  constructor(
    private readonly pool: Pool,
    private readonly boss: PgBoss,
  ) {}

  summary(actor: Actor) {
    return this.with(actor, async (client) => {
      const tasks = await client.query(`SELECT count(*)::int AS n ${taskJoin} WHERE ${taskVisible} AND t.work_date = CURRENT_DATE`,[cabinetReadRole(actor.role),actor.userId]);
      const shifts = await client.query(`SELECT count(*)::int AS n FROM shifts s JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.id=s.task_id JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id WHERE s.status='open' AND ${taskVisible} AND ($1<>'worker' OR s.employee_id IN (SELECT id FROM employees WHERE user_id=$2))`,[cabinetReadRole(actor.role),actor.userId]);
      return {
        sample: true,
        label: "Учебные цифры, не расчёт по объекту",
        rings: sampleRings,
        live: { tasksToday: tasks.rows[0].n as number, openShifts: shifts.rows[0].n as number },
      };
    });
  }

  desk(actor: Actor) {
    return this.with(actor, async (client) => {
      const employees = await client.query(
        `SELECT e.id, e.full_name, e.phone, e.document_number, e.user_id,
           (SELECT role FROM memberships WHERE user_id=e.user_id) AS role FROM employees e
         WHERE ${deskEmployeeVisible} ORDER BY e.full_name`,
        [cabinetReadRole(actor.role), actor.userId],
      );
      const tasks = await client.query(
        `SELECT t.id, t.title, t.work_date::text AS work_date, t.planned_quantity::text, t.unit, t.assignee_employee_id, t.status, t.version, t.project_id
         ${taskJoin}
         WHERE ${taskVisible}
         ORDER BY t.work_date DESC, t.title`,
        [cabinetReadRole(actor.role), actor.userId],
      );
      const shifts = await client.query(
        `SELECT s.id,s.task_id,s.employee_id,s.status,s.version,s.started_at,s.finished_at,s.occurred_started_at,s.occurred_finished_at,s.clock_requires_review
         FROM shifts s JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.id=s.task_id
         JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
         JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id
         WHERE ${taskVisible} AND ($1 <> 'worker' OR s.employee_id IN (SELECT id FROM employees WHERE user_id = $2))
         ORDER BY s.started_at DESC NULLS LAST`,
        [cabinetReadRole(actor.role), actor.userId],
      );
      const reports = await client.query(
        `SELECT r.id, r.task_id, r.submitted_quantity::text, r.accepted_quantity::text, r.version
         FROM work_reports r
         JOIN daily_tasks t ON t.tenant_id = r.tenant_id AND t.id = r.task_id
         JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
         JOIN employees e ON e.tenant_id = t.tenant_id AND e.id = t.assignee_employee_id
         WHERE ${taskVisible}
         ORDER BY r.created_at DESC`,
        [cabinetReadRole(actor.role), actor.userId],
      );
      const cabinet = await client.query(`SELECT name FROM tenants WHERE id = $1`, [actor.tenantId]);
      const organizations = await client.query(`SELECT id, name, kind FROM organizations ORDER BY name`);
      const projects = await client.query(
        `SELECT id, name, address, latitude, longitude FROM projects p WHERE $1='director' OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.status='active') ORDER BY name`, [cabinetReadRole(actor.role),actor.userId],
      );
      const files =
        actor.role === "worker"
          ? { rows: [] }
          : await client.query(`SELECT id, filename FROM stored_files ORDER BY filename`);
      const summary = await this.summaryCounts(client,actor);
      return {
        actor,
        projectId: projects.rows[0]?.id ?? PROJECT_A,
        cabinet: cabinet.rows[0] ?? { name: "Кабинет" },
        organizations: organizations.rows,
        projects: projects.rows,
        files: files.rows,
        employees: employees.rows,
        tasks: tasks.rows,
        shifts: shifts.rows,
        reports: reports.rows,
        summary,
      };
    });
  }

  savePlace(actor: Actor, projectId: string, input: { address?: unknown; latitude?: unknown; longitude?: unknown }) {
    if (actor.role !== "director" && actor.role !== "master") throw httpError(403, "role_denied");
    const place = parsePlace(input);
    if (!place) throw httpError(422, "invalid_place");
    return this.with(actor, async (client) => {
      const updated = await client.query(
        `UPDATE projects
         SET address = $2, latitude = $3, longitude = $4
         WHERE id = $1 AND ($5='director' OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id=projects.id AND pm.user_id=$6 AND pm.status='active'))
         RETURNING id, name, address, latitude, longitude`,
        [projectId, place.address, place.latitude, place.longitude,actor.role,actor.userId],
      );
      if (!updated.rows[0]) throw httpError(404, "not_found");
      await this.audit(client, actor, "project_place_saved", "project", projectId, "ok");
      return updated.rows[0];
    });
  }

  async employee(actor: Actor, id: string) {
    uuid(id);
    const row = await this.with(actor, async (client) => {
      const result = await client.query(`SELECT e.id, e.full_name, e.phone FROM employees e
        WHERE ${deskEmployeeVisible} AND e.id = $3`, [cabinetReadRole(actor.role), actor.userId, id]);
      return result.rows[0] ?? null;
    });
    if (!row) throw httpError(404, "not_found");
    return row;
  }

  createTask(
    actor: Actor,
    input: unknown,
  ) {
    throw httpError(410, "task_creation_retired");
  }

  async sync(actor: Actor, events: ClientEvent[]) {
    const results = [];
    for (const event of events) {
      results.push(await this.with(actor, (client) => this.applyEvent(client, actor, event)));
    }
    return { results };
  }

  accept(actor: Actor, reportId: string, acceptedQuantity: string) {
    if (actor.role === "worker") throw httpError(403, "role_denied");
    return this.with(actor, async (client) => {
      const current = await client.query(
        `SELECT submitted_quantity::text AS submitted,task_id FROM work_reports WHERE tenant_id=$2 AND id = $1`,
        [reportId,actor.tenantId],
      );
      if (!current.rows[0]) throw httpError(404, "not_found");
      await this.legacyTask(client,actor,current.rows[0].task_id);
      const partial = partialAcceptance(current.rows[0].submitted, acceptedQuantity);
      const updated = await client.query(
        `UPDATE work_reports
         SET accepted_quantity = $2, version = version + 1
         WHERE id = $1
         RETURNING id, submitted_quantity::text, accepted_quantity::text, version`,
        [reportId, partial.accepted],
      );
      await this.audit(client, actor, "volume_accepted", "work_report", reportId, "ok");
      return { ...updated.rows[0], difference: partial.difference };
    });
  }

  async file(actor: Actor, id: string) {
    const row = await this.with(actor, async (client) => {
      const result = await client.query(`SELECT id, object_key, filename FROM stored_files WHERE id = $1`, [id]);
      return result.rows[0] ?? null;
    });
    if (!row) throw httpError(404, "not_found");
    if (!keyBelongsToTenant(actor.tenantId, row.object_key)) throw httpError(403, "file_scope");
    return row;
  }

  async recordAndMaybeRollback(actor: Actor, quantity: string, rollback: boolean, taskId: string) {
    const client = await this.pool.connect();
    let reportId = "";
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [actor.tenantId]);
      await this.legacyTask(client,actor,taskId);
      const inserted = await client.query(
        `INSERT INTO work_reports (tenant_id, task_id, submitted_quantity)
         VALUES ($1, $2, $3) RETURNING id, version`,
        [actor.tenantId, taskId, quantity],
      );
      reportId = inserted.rows[0].id;
      await this.boss.send(QUEUE_WORK_REPORT, reportJob(actor.tenantId, reportId, inserted.rows[0].version), {
        db: queryClient(client),
        group: { id: actor.tenantId },
      });
      await client.query(rollback ? "ROLLBACK" : "COMMIT");
      return { reportId, rolledBack: rollback };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* уже закрыта */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private with<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>) {
    return withTenant(this.pool, actor.tenantId, actor.userId, fn);
  }

  private async summaryCounts(client: PoolClient,actor:Actor) {
    const tasks = await client.query(`SELECT count(*)::int AS n ${taskJoin} WHERE ${taskVisible} AND t.work_date = CURRENT_DATE`,[cabinetReadRole(actor.role),actor.userId]);
    const shifts = await client.query(`SELECT count(*)::int AS n FROM shifts s JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.id=s.task_id JOIN projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id WHERE s.status='open' AND ${taskVisible} AND ($1<>'worker' OR s.employee_id IN (SELECT id FROM employees WHERE user_id=$2))`,[cabinetReadRole(actor.role),actor.userId]);
    return {
      sample: true,
      label: "Учебные цифры, не расчёт по объекту",
      rings: sampleRings,
      live: { tasksToday: tasks.rows[0].n as number, openShifts: shifts.rows[0].n as number },
    };
  }

  private async legacyTask(client:PoolClient,actor:Actor,taskId:string) {
    uuid(taskId);
    const task=(await client.query(`SELECT workflow_kind FROM daily_tasks WHERE tenant_id=$1 AND id=$2`,[actor.tenantId,taskId])).rows[0];
    if(!task)throw httpError(404,'not_found');
    if(task.workflow_kind!=='legacy')throw httpError(409,'workflow_not_supported');
  }

  private async applyEvent(client: PoolClient, actor: Actor, event: ClientEvent) {
    try {
      assertSameScope(event, actor);
    } catch {
      throw httpError(403, "scope_mismatch");
    }
    if (!event.eventId || !event.kind || !event.occurredAt) throw httpError(422, "bad_event");
    await this.legacyTask(client,actor,required(event.payload?.taskId,"task_required"));
    const hash = createHash("sha256")
      .update(stableEventBody({ kind: event.kind, occurredAt: event.occurredAt, payload: event.payload ?? {} }))
      .digest("hex");
    const existing = await client.query(
      `SELECT payload_hash, result FROM client_events WHERE user_id = $1 AND event_id = $2`,
      [actor.userId, event.eventId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== hash) throw httpError(409, "idempotency_payload_mismatch");
      return { ...(existing.rows[0].result as object), duplicate: true };
    }
    const result = await this.dispatch(client, actor, event);
    await client.query(
      `INSERT INTO client_events (tenant_id, user_id, event_id, payload_hash, result) VALUES ($1, $2, $3, $4, $5)`,
      [actor.tenantId, actor.userId, event.eventId, hash, result],
    );
    return result;
  }

  private async dispatch(client: PoolClient, actor: Actor, event: ClientEvent) {
    if (event.kind === "shift_start") return this.startShift(client, actor, event);
    if (event.kind === "shift_end") return this.finishShift(client, actor, event);
    if (event.kind === "submit_volume") return this.submitVolume(client, actor, event);
    throw httpError(422, "unsupported_operation");
  }

  private async startShift(client: PoolClient, actor: Actor, event: ClientEvent) {
    const taskId = required(event.payload?.taskId, "task_required");
    await this.legacyTask(client,actor,taskId);
    const employeeId = required(event.payload?.employeeId, "employee_required");
    const open = await client.query(
      `SELECT id FROM shifts WHERE task_id = $1 AND employee_id = $2 AND status = 'open'`,
      [taskId, employeeId],
    );
    if (open.rows[0]) throw httpError(409, "already_started");
    const inserted = await client.query(
      `INSERT INTO shifts (tenant_id, task_id, employee_id, started_at, occurred_started_at, status)
       VALUES ($1, $2, $3, now(), $4, 'open')
       RETURNING id, version, status`,
      [actor.tenantId, taskId, employeeId, event.occurredAt],
    );
    await this.audit(client, actor, "shift_started", "shift", inserted.rows[0].id, "ok");
    return { eventId: event.eventId, shiftId: inserted.rows[0].id, version: inserted.rows[0].version };
  }

  private async finishShift(client: PoolClient, actor: Actor, event: ClientEvent) {
    const taskId = required(event.payload?.taskId, "task_required");
    await this.legacyTask(client,actor,taskId);
    const open = await client.query(
      `SELECT id, occurred_started_at FROM shifts WHERE task_id = $1 AND status = 'open' ORDER BY started_at DESC LIMIT 1`,
      [taskId],
    );
    if (!open.rows[0]) throw httpError(409, "invalid_shift_order");
    const started = new Date(open.rows[0].occurred_started_at).toISOString();
    const review = event.occurredAt < started;
    const updated = await client.query(
      `UPDATE shifts
       SET status = 'finished', finished_at = now(), occurred_finished_at = $2,
           clock_requires_review = $3, version = version + 1
       WHERE id = $1
       RETURNING id, version, clock_requires_review`,
      [open.rows[0].id, event.occurredAt, review],
    );
    await this.audit(client, actor, "shift_finished", "shift", updated.rows[0].id, "ok");
    return { eventId: event.eventId, shiftId: updated.rows[0].id, version: updated.rows[0].version, clockRequiresReview: review };
  }

  private async submitVolume(client: PoolClient, actor: Actor, event: ClientEvent) {
    const taskId = required(event.payload?.taskId, "task_required");
    await this.legacyTask(client,actor,taskId);
    const quantity = required(event.payload?.quantity, "quantity_required");
    if (Number(quantity) <= 0) throw httpError(422, "invalid_quantity");
    const inserted = await client.query(
      `INSERT INTO work_reports (tenant_id, task_id, submitted_quantity)
       VALUES ($1, $2, $3)
       RETURNING id, version, submitted_quantity::text`,
      [actor.tenantId, taskId, quantity],
    );
    const job = reportJob(actor.tenantId, inserted.rows[0].id, inserted.rows[0].version);
    await this.boss.send(QUEUE_WORK_REPORT, job, { db: queryClient(client), group: { id: actor.tenantId } });
    await this.audit(client, actor, "volume_submitted", "work_report", inserted.rows[0].id, "ok");
    return { eventId: event.eventId, reportId: inserted.rows[0].id, version: inserted.rows[0].version, submitted: quantity };
  }

  private async audit(client: PoolClient, actor: Actor, action: string, objectType: string, objectId: string, result: string) {
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, object_type, object_id, result)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor.tenantId, actor.userId, action, objectType, objectId, result],
    );
  }
}

function required(value: string | undefined, message: string): string {
  if (!value) throw httpError(422, message);
  return value;
}
