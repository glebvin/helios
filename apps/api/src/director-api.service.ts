import {managedOverview} from './execution-read.js';
import type { Pool, PoolClient } from "pg";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import type { Actor } from "./workforce.service.js";
import type { Page } from "./api-input.js";

// $1 = trusted actor role, $2 = trusted actor user ID. All callers use withTenant.
// Project membership alone is insufficient for workers: their employee must be assigned.
const projectVisible = `($1 = 'director' OR (
  $1 IN ('master', 'pto', 'worker') AND EXISTS (
    SELECT 1 FROM project_memberships pm WHERE pm.tenant_id = p.tenant_id
      AND pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
  ) AND ($1 <> 'worker' OR EXISTS (
    SELECT 1 FROM employee_project_assignments a JOIN employees own
      ON own.tenant_id = a.tenant_id AND own.id = a.employee_id
    WHERE a.tenant_id = p.tenant_id AND a.project_id = p.id AND a.status = 'active' AND own.user_id = $2
  ))
))`;
export const taskVisible = `${projectVisible} AND ($1 <> 'worker' OR ((t.workflow_kind='legacy' OR t.status='published') AND e.user_id = $2 AND EXISTS (
  SELECT 1 FROM employee_project_assignments own_assignment
  WHERE own_assignment.tenant_id = t.tenant_id AND own_assignment.project_id = t.project_id
    AND own_assignment.employee_id = e.id AND own_assignment.status = 'active'
)))`;
export const taskJoin = `FROM daily_tasks t JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
  JOIN employees e ON e.tenant_id = t.tenant_id AND e.id = t.assignee_employee_id`;
export const taskFields = `t.id,t.project_id AS "projectId",t.title,t.work_date::text AS "workDate",t.planned_quantity::text AS "plannedQuantity",t.unit,t.assignee_employee_id AS "assigneeEmployeeId",t.status,t.version,t.workflow_kind AS "workflowKind",t.plan_revision AS "planRevision",t.zone_id AS "zoneId",t.work_type_id AS "workTypeId",t.responsible_user_id AS "responsibleUserId",t.rd_reference AS "rdReference",t.planned_start AS "plannedStart",t.planned_end AS "plannedEnd",t.publication_snapshot_id AS "publicationSnapshotId"`;
const projectFields = `p.id, p.name`;
const employeeFields = `e.id, e.full_name AS "fullName", e.phone, e.organization_id AS "organizationId", e.user_id AS "userId", e.version, e.status`;

export class DirectorApiService {
  constructor(private readonly pool: Pool) {}
  projectVisibility() { return projectVisible; }

  private with<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>) {
    return withTenant(this.pool, actor.tenantId, actor.userId, fn);
  }

  async projectExists(client: PoolClient, actor: Actor, projectId: string) {
    const result = await client.query(`SELECT ${projectFields} FROM projects p
      WHERE ${projectVisible} AND p.id = $3`, [actor.role, actor.userId, projectId]);
    if (!result.rows[0]) throw httpError(404, "not_found");
    return result.rows[0];
  }

  me(actor: Actor) { return { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, name: actor.name, email: actor.email }; }

  projects(actor: Actor, page: Page) {
    return this.with(actor, async (client) => {
      const values = [actor.role, actor.userId];
      const count = await client.query(`SELECT count(*)::int AS total FROM projects p WHERE ${projectVisible}`, values);
      const items = await client.query(`SELECT ${projectFields} FROM projects p WHERE ${projectVisible}
        ORDER BY p.name, p.id LIMIT $3 OFFSET $4`, [...values, page.limit, page.offset]);
      return { items: items.rows, total: count.rows[0].total, ...page };
    });
  }

  project(actor: Actor, id: string) { return this.with(actor, (client) => this.projectExists(client, actor, id)); }

  tasks(actor: Actor, projectId: string, page: Page, day?: string, status?:string, id?:string) {
    return this.with(actor, async (client) => {
      await this.projectExists(client, actor, projectId);
      const values = [actor.role, actor.userId, projectId, day ?? null, status??null, id??null];
      const where = `${taskVisible} AND p.id = $3 AND ($4::date IS NULL OR t.work_date = $4::date) AND ($5::text IS NULL OR t.status=$5) AND ($6::uuid IS NULL OR t.id=$6)`;
      const count = await client.query(`SELECT count(*)::int AS total ${taskJoin} WHERE ${where}`, values);
      const items = await client.query(`SELECT ${taskFields}
        ${taskJoin} WHERE ${where} ORDER BY t.work_date DESC, t.title, t.id LIMIT $7 OFFSET $8`,
      [...values, page.limit, page.offset]);
      if(id){if(!items.rows[0])throw httpError(404,'not_found');return items.rows[0];}
      return { items: items.rows, total: count.rows[0].total, ...page };
    });
  }

  employeeVisible() {
    return `(($3::uuid IS NULL AND ($1 IN ('director','hr') OR e.user_id = $2)) OR EXISTS (
      SELECT 1 FROM employee_project_assignments a JOIN projects p ON p.tenant_id = a.tenant_id AND p.id = a.project_id
      WHERE a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.status = 'active'
        AND ($3::uuid IS NULL OR p.id = $3) AND ${projectVisible}
        AND ($1 <> 'worker' OR e.user_id = $2)
    ))`;
  }

  employees(actor: Actor, page: Page, projectId?: string) {
    return this.with(actor, async (client) => {
      if (projectId) await this.projectExists(client, actor, projectId);
      const values = [actor.role, actor.userId, projectId ?? null];
      const where = this.employeeVisible();
      const count = await client.query(`SELECT count(*)::int AS total FROM employees e WHERE ${where}`, values);
      const items = await client.query(`SELECT ${employeeFields} FROM employees e WHERE ${where}
        ORDER BY e.full_name, e.id LIMIT $4 OFFSET $5`, [...values, page.limit, page.offset]);
      return { items: items.rows, total: count.rows[0].total, ...page };
    });
  }

  employee(actor: Actor, id: string) {
    return this.with(actor, client => this.employeeExists(client,actor,id));
  }

  async employeeExists(client: PoolClient, actor: Actor, id: string) {
      const result = await client.query(`SELECT ${employeeFields} FROM employees e
        WHERE ${this.employeeVisible()} AND e.id = $4`, [actor.role, actor.userId, null, id]);
      if (!result.rows[0]) throw httpError(404, "not_found");
      return result.rows[0];
  }

  overview(actor: Actor, projectId?: string, requestedDay?: string) {
    return this.with(actor, async (client) => {
      if (projectId) await this.projectExists(client, actor, projectId);
      const tenant = await client.query(`SELECT timezone
        FROM tenants WHERE id = $1`, [actor.tenantId]);
      const timezone = tenant.rows[0].timezone as string;
      if(!(await client.query('SELECT 1 FROM pg_timezone_names WHERE name=$1',[timezone])).rowCount)throw httpError(422,'invalid_tenant_timezone');
      const day = requestedDay ?? (await client.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS day",[timezone])).rows[0].day as string;
      const values = [actor.role, actor.userId, projectId ?? null, day, timezone];
      const scope = `${taskVisible} AND ($3::uuid IS NULL OR p.id = $3)`;
      const boundary = `created_at >= ($4::date::timestamp AT TIME ZONE $5)
        AND created_at < (($4::date + 1)::timestamp AT TIME ZONE $5)`;
      const counts = await client.query(`WITH visible_tasks AS (
          SELECT t.id, t.tenant_id, t.project_id, t.work_date,t.workflow_kind ${taskJoin} WHERE ${scope}
        ), visible_shifts AS (
          SELECT s.* FROM shifts s JOIN visible_tasks t ON t.tenant_id = s.tenant_id AND t.id = s.task_id
          JOIN employees se ON se.tenant_id = s.tenant_id AND se.id = s.employee_id
          WHERE t.workflow_kind='legacy' AND ($1 <> 'worker' OR (se.user_id = $2 AND EXISTS (
            SELECT 1 FROM employee_project_assignments a WHERE a.tenant_id = s.tenant_id
              AND a.project_id = t.project_id AND a.employee_id = s.employee_id AND a.status = 'active'
          )))
        ), daily_reports AS (
          SELECT r.* FROM work_reports r JOIN visible_tasks t ON t.tenant_id = r.tenant_id AND t.id = r.task_id
          WHERE t.workflow_kind='legacy' AND ${boundary}
        ) SELECT
          (SELECT count(*)::int FROM visible_tasks WHERE work_date = $4::date) AS "tasksForDay",
          (SELECT count(DISTINCT employee_id)::int FROM visible_shifts
            WHERE coalesce(occurred_started_at, started_at) >= ($4::date::timestamp AT TIME ZONE $5)
              AND coalesce(occurred_started_at, started_at) < (($4::date + 1)::timestamp AT TIME ZONE $5)) AS "employeesStartedShiftsForDay",
          (SELECT count(*)::int FROM visible_shifts WHERE status = 'open') AS "currentOpenShifts",
          (SELECT count(*)::int FROM daily_reports) AS "submittedReportsForDay",
          (SELECT count(*)::int FROM daily_reports WHERE accepted_quantity IS NOT NULL) AS "reviewedReportsForDay"`, values);
      const employees = await client.query(`SELECT count(DISTINCT a.employee_id)::int AS n
        FROM employee_project_assignments a JOIN projects p ON p.tenant_id = a.tenant_id AND p.id = a.project_id
        JOIN employees e ON e.tenant_id = a.tenant_id AND e.id = a.employee_id
        WHERE a.status = 'active' AND ${projectVisible} AND ($1 <> 'worker' OR e.user_id = $2)
          AND ($3::uuid IS NULL OR p.id = $3)`, values.slice(0, 3));
      const quantities = await client.query(`SELECT t.unit, sum(r.submitted_quantity)::text AS "submittedQuantity",
          sum(r.accepted_quantity)::text AS "acceptedQuantity"
        FROM work_reports r JOIN daily_tasks t ON t.tenant_id = r.tenant_id AND t.id = r.task_id
        JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
        JOIN employees e ON e.tenant_id = t.tenant_id AND e.id = t.assignee_employee_id
        WHERE ${scope} AND t.workflow_kind='legacy' AND ${boundary} GROUP BY t.unit ORDER BY t.unit`, values);
      const unavailable = (source: string) => ({ status: "unavailable", value: null, source });
      return {
        day, timezone, projectId: projectId ?? null,
        assignedEmployees: employees.rows[0].n,
        ...counts.rows[0], quantities: quantities.rows,
        managedExecution: await managedOverview(client,actor,projectId,day),
        shiftStartSource: "occurred_started_at with started_at fallback",
        reportDateSource: "work_reports.created_at",
        quality: unavailable("quality inspections not implemented"),
        downtimeDuration: unavailable("downtime intervals not implemented"),
        idReadiness: unavailable("ID registry not implemented"),
      };
    });
  }
}
