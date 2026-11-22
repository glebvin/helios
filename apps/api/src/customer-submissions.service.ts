import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { day, uuid } from './api-input.js';
import { integer, object, text } from './people-input.js';
import { httpError } from './errors.js';
import { executionScope, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

type Part = { id: string; taskId: string; replacedBy: { id: string } | null };
function input(value: unknown) {
  const b = object(value, ['requestId', 'expectedVersion']);
  return { requestId: uuid(b.requestId).toLowerCase(), expectedVersion: integer(b.expectedVersion, 0) };
}
function remarkInput(value: unknown) {
  const b = object(value, ['requestId', 'body', 'responsibleEmployeeId', 'dueOn']);
  const dueOn = day(b.dueOn);
  if (!dueOn) throw httpError(400, 'invalid_day');
  return { requestId: uuid(b.requestId).toLowerCase(), body: text(b.body, 500), responsibleEmployeeId: uuid(b.responsibleEmployeeId).toLowerCase(), dueOn };
}
function closeInput(value: unknown) {
  const b = object(value, ['requestId']);
  return { requestId: uuid(b.requestId).toLowerCase() };
}
export class CustomerSubmissionsService {
  constructor(private readonly pool: Pool) {}
  private async part(c: PoolClient, a: Actor, project: string, id: string): Promise<Part> {
    if (!['master', 'director', 'pto', 'worker'].includes(a.role)) throw httpError(403, 'role_denied');
    const row = (await c.query(`SELECT v.id, s.task_id AS "taskId" FROM accepted_volume_parts v
      JOIN managed_execution_reports s ON s.tenant_id=v.tenant_id AND s.report_id=v.report_id ${executionJoin}
      WHERE ${executionScope} AND v.id=$4 AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$5)`,
      [a.tenantId, a.userId, project, id, a.role])).rows[0] as { id: string; taskId: string } | undefined;
    if (!row) throw httpError(404, 'not_found');
    const replacedBy = (await c.query(`SELECT id FROM volume_corrections WHERE previous_part_id=$1 UNION ALL SELECT accepted_part_id AS id FROM internal_inspection_splits WHERE original_part_id=$1 LIMIT 1`, [id])).rows[0] ?? null;
    return { ...row, replacedBy };
  }
  private async requirement(c: PoolClient, project: string, taskId: string) {
    const row = (await c.query(`SELECT COALESCE(wt.hidden_work,false) AS hidden, COALESCE(o.kind='subcontractor',false) AS subcontract, p.internal_inspection_required AS "projectRequired"
      FROM projects p LEFT JOIN daily_tasks t ON t.tenant_id=p.tenant_id AND t.project_id=p.id AND t.id=$2
      LEFT JOIN project_work_types wt ON wt.tenant_id=t.tenant_id AND wt.id=t.work_type_id
      LEFT JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id
      LEFT JOIN organizations o ON o.tenant_id=e.tenant_id AND o.id=e.organization_id
      WHERE p.id=$1`, [project, taskId])).rows[0];
    return row?.hidden === true || row?.subcontract === true || row?.projectRequired !== false;
  }
  private async card(c: PoolClient, a: Actor, project: string, id: string, source?: Part) {
    const accepted = source ?? await this.part(c, a, project, id);
    const row = (await c.query(`SELECT attempt_number AS "attemptNumber", checklist_run_id AS "checklistRunId", created_at AS "recordedAt" FROM customer_submissions WHERE project_id=$1 AND accepted_part_id=$2`, [project, id])).rows[0] ?? null;
    const remarks = row ? (await c.query(`SELECT id, body, responsible_employee_id AS "responsibleEmployeeId", due_on::text AS "dueOn", closed_at AS "closedAt" FROM customer_submission_remarks WHERE project_id=$1 AND accepted_part_id=$2 ORDER BY created_at, id`, [project, id])).rows : [];
    return { recorded: !!row, attemptNumber: row?.attemptNumber ?? null, acceptedPartId: accepted.id, checklistRunId: row?.checklistRunId ?? null, recordedAt: row?.recordedAt ?? null, openRemarks: remarks.filter((item: { closedAt: string | null }) => item.closedAt === null).length, remarks };
  }
  read(a: Actor, project: string, id: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR SHARE`, [project])).rowCount) throw httpError(404, 'not_found');
      return this.card(c, a, project, id);
    });
  }
  submit(a: Actor, project: string, id: string, value: unknown) {
    const b = input(value);
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/accepted-parts/${id}/customer-submission`, b);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      const source = await this.part(c, a, project, id);
      if (!receipt.inserted) return replayCommand(c, a, b.requestId, receipt.hash);
      if (source.replacedBy) throw httpError(409, 'part_superseded');
      const current = await this.card(c, a, project, id, source);
      if ((current.attemptNumber ?? 0) !== b.expectedVersion) throw httpError(409, 'stale_version');
      const selfControl = (await c.query(`SELECT id, passed, blocks_next AS "blocksNext" FROM checklist_runs WHERE project_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`, [project, source.taskId])).rows[0] ?? null;
      if (!selfControl?.passed || selfControl.blocksNext) throw httpError(422, 'self_control_required');
      if (!current.recorded && await this.requirement(c, project, source.taskId)) {
        const state = (await c.query(`SELECT to_state FROM internal_inspection_events WHERE accepted_part_id=$1 ORDER BY version DESC LIMIT 1`, [id])).rows[0]?.to_state ?? 'not_submitted';
        if (state !== 'accepted') throw httpError(422, 'internal_inspection_required');
      }
      const nextAttempt = (current.attemptNumber ?? 0) + 1;
      if (current.recorded) {
        if (current.remarks.length === 0) throw httpError(422, 'remarks_required');
        if (current.openRemarks > 0) throw httpError(422, 'remarks_open');
        await c.query(`UPDATE customer_submissions SET attempt_number=$3, checklist_run_id=$4, request_id=$5 WHERE accepted_part_id=$1 AND project_id=$2`, [id, project, nextAttempt, selfControl.id, b.requestId]);
      } else {
        await c.query(`INSERT INTO customer_submissions(tenant_id,accepted_part_id,project_id,id,attempt_number,checklist_run_id,actor_user_id,request_id) VALUES($1,$2,$3,$4,1,$5,$6,$7)`, [a.tenantId, id, project, randomUUID(), selfControl.id, a.userId, b.requestId]);
      }
      await c.query(`INSERT INTO customer_submission_attempts(tenant_id,accepted_part_id,attempt_number,checklist_run_id,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6)`, [a.tenantId, id, nextAttempt, selfControl.id, a.userId, b.requestId]);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_submission','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: b.requestId, attemptNumber: nextAttempt, checklistRunId: selfControl.id })]);
      return completeCommand(c, a, b.requestId, 201, await this.card(c, a, project, id, source));
    });
  }
  remark(a: Actor, project: string, id: string, value: unknown) {
    const b = remarkInput(value);
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/accepted-parts/${id}/customer-submission/remarks`, b);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      await this.part(c, a, project, id);
      if (!receipt.inserted) return replayCommand(c, a, b.requestId, receipt.hash);
      if (!(await c.query(`SELECT 1 FROM customer_submissions WHERE project_id=$1 AND accepted_part_id=$2`, [project, id])).rowCount) throw httpError(422, 'submission_required');
      const responsible = (await c.query(`SELECT e.id FROM employees e JOIN employee_project_assignments a ON a.tenant_id=e.tenant_id AND a.employee_id=e.id WHERE e.tenant_id=$1 AND e.id=$2 AND e.status='active' AND a.project_id=$3 AND a.status='active'`, [a.tenantId, b.responsibleEmployeeId, project])).rowCount;
      if (!responsible) throw httpError(422, 'responsible_not_assigned');
      const remarkId = randomUUID();
      await c.query(`INSERT INTO customer_submission_remarks(tenant_id,id,accepted_part_id,project_id,body,responsible_employee_id,due_on,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [a.tenantId, remarkId, id, project, b.body, b.responsibleEmployeeId, b.dueOn, a.userId, b.requestId]);
      const saved = (await c.query(`SELECT id, body, responsible_employee_id AS "responsibleEmployeeId", due_on::text AS "dueOn", closed_at AS "closedAt" FROM customer_submission_remarks WHERE id=$1`, [remarkId])).rows[0];
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_remark','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: b.requestId, remarkId })]);
      return completeCommand(c, a, b.requestId, 201, saved);
    });
  }
  closeRemark(a: Actor, project: string, id: string, remark: string, value: unknown) {
    const b = closeInput(value);
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/accepted-parts/${id}/customer-submission/remarks/${remark}/close`, b);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      await this.part(c, a, project, id);
      if (!receipt.inserted) return replayCommand(c, a, b.requestId, receipt.hash);
      const row = (await c.query(`SELECT id, closed_at AS "closedAt" FROM customer_submission_remarks WHERE project_id=$1 AND accepted_part_id=$2 AND id=$3`, [project, id, remark])).rows[0];
      if (!row) throw httpError(404, 'not_found');
      if (row.closedAt) throw httpError(409, 'remark_closed');
      await c.query(`UPDATE customer_submission_remarks SET closed_at=now() WHERE id=$1`, [remark]);
      const saved = (await c.query(`SELECT id, body, responsible_employee_id AS "responsibleEmployeeId", due_on::text AS "dueOn", closed_at AS "closedAt" FROM customer_submission_remarks WHERE id=$1`, [remark])).rows[0];
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_remark_close','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: b.requestId, remarkId: remark })]);
      return completeCommand(c, a, b.requestId, 200, saved);
    });
  }
}
