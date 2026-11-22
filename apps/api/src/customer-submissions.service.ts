import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { uuid } from './api-input.js';
import { integer, object } from './people-input.js';
import { httpError } from './errors.js';
import { executionScope, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

type Part = { id: string; taskId: string; replacedBy: { id: string } | null };
function input(value: unknown) {
  const b = object(value, ['requestId', 'expectedVersion']);
  return { requestId: uuid(b.requestId).toLowerCase(), expectedVersion: integer(b.expectedVersion, 0) };
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
    return { recorded: !!row, attemptNumber: row?.attemptNumber ?? null, acceptedPartId: accepted.id, checklistRunId: row?.checklistRunId ?? null, recordedAt: row?.recordedAt ?? null };
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
      if ((current.recorded ? 1 : 0) !== b.expectedVersion) throw httpError(409, 'stale_version');
      const selfControl = (await c.query(`SELECT id, passed, blocks_next AS "blocksNext" FROM checklist_runs WHERE project_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`, [project, source.taskId])).rows[0] ?? null;
      if (!selfControl?.passed || selfControl.blocksNext) throw httpError(422, 'self_control_required');
      if (await this.requirement(c, project, source.taskId)) {
        const state = (await c.query(`SELECT to_state FROM internal_inspection_events WHERE accepted_part_id=$1 ORDER BY version DESC LIMIT 1`, [id])).rows[0]?.to_state ?? 'not_submitted';
        if (state !== 'accepted') throw httpError(422, 'internal_inspection_required');
      }
      await c.query(`INSERT INTO customer_submissions(tenant_id,accepted_part_id,project_id,id,attempt_number,checklist_run_id,actor_user_id,request_id) VALUES($1,$2,$3,$4,1,$5,$6,$7)`, [a.tenantId, id, project, randomUUID(), selfControl.id, a.userId, b.requestId]);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_submission','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: b.requestId, attemptNumber: 1, checklistRunId: selfControl.id })]);
      return completeCommand(c, a, b.requestId, 201, await this.card(c, a, project, id, source));
    });
  }
}
