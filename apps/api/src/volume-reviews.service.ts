import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { partialAcceptance } from '@helios/domain';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import { integer, object, text } from './people-input.js';
import { uuid, type Page } from './api-input.js';
import { executionScope, executionClock, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

function commandInput(input: unknown) {
  const b = object(input, ['requestId', 'expectedVersion', 'checklistRunId', 'acceptedQuantity', 'reason']);
  if (typeof b.acceptedQuantity !== 'string' || !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(b.acceptedQuantity)) throw httpError(400, 'invalid_quantity');
  return { requestId: uuid(b.requestId).toLowerCase(), expectedVersion: integer(b.expectedVersion, 0), checklistRunId: uuid(b.checklistRunId).toLowerCase(), acceptedQuantity: b.acceptedQuantity, reason: b.reason === null || b.reason === undefined ? null : text(b.reason, 500) };
}
const currentRole = `EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$4)`;
const from = `FROM managed_execution_reports s ${executionJoin}
  JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id
  JOIN managed_execution_events ev ON ev.tenant_id=s.tenant_id AND ev.actor_user_id=s.actor_user_id AND ev.request_id=s.request_id
  LEFT JOIN master_volume_reviews v ON v.tenant_id=s.tenant_id AND v.report_id=s.report_id`;
const fields = `s.report_id AS "reportId",s.project_id AS "projectId",s.task_id AS "taskId",s.submitted_quantity::text AS "submittedQuantity",t.title,t.unit,
  ev.occurred_at AS "occurredAt",coalesce(v.version,0) AS version,
  CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id',v.id,'acceptedPartId',CASE WHEN v.accepted_quantity>0 THEN v.id ELSE NULL END,'acceptedQuantity',v.accepted_quantity::text,'differenceQuantity',v.difference_quantity::text,'reason',v.reason,'checklistRunId',v.checklist_run_id,'actorName',v.actor_name,'createdAt',v.created_at) END AS review,
  (SELECT jsonb_build_object('id',cr.id,'version',cr.version,'passed',cr.passed,'blocksNext',cr.blocks_next,'templateVersion',cr.template_version,'edition',cr.edition)
   FROM checklist_runs cr WHERE cr.tenant_id=s.tenant_id AND cr.project_id=s.project_id AND cr.task_id=s.task_id ORDER BY cr.version DESC LIMIT 1) AS checklist`;

export class VolumeReviewsService {
  constructor(private readonly pool: Pool) {}

  private async project(c: PoolClient, a: Actor, project: string) {
    if (!['master', 'director', 'pto', 'worker'].includes(a.role)) throw httpError(403, 'role_denied');
    const allowed = await c.query(`SELECT p.id FROM projects p LEFT JOIN employees e ON e.tenant_id=p.tenant_id
      WHERE ${executionScope} AND ${currentRole} LIMIT 1`, [a.tenantId, a.userId, project, a.role]);
    if (!allowed.rowCount) throw httpError(404, 'not_found');
  }

  list(a: Actor, project: string, day: string, page: Page) {
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      await this.project(c, a, project);
      const clock = await executionClock(c, a, day);
      const values = [a.tenantId, a.userId, project, a.role, day, clock.timezone];
      const where = `WHERE ${executionScope} AND ${currentRole} AND ev.occurred_at>=($5::date::timestamp AT TIME ZONE $6) AND ev.occurred_at<(($5::date+1)::timestamp AT TIME ZONE $6)`;
      // One statement snapshot: a concurrent decision cannot mix old totals with new rows.
      const result = (await c.query(`WITH scoped AS MATERIALIZED (SELECT ${fields} ${from} ${where})
        SELECT (SELECT count(*)::int FROM scoped) AS total,
        coalesce((SELECT jsonb_agg(to_jsonb(paged) ORDER BY paged."occurredAt",paged."reportId") FROM
          (SELECT * FROM scoped ORDER BY "occurredAt","reportId" LIMIT $7 OFFSET $8) paged),'[]'::jsonb) AS items,
        coalesce((SELECT jsonb_agg(to_jsonb(summary) ORDER BY summary.unit) FROM
          (SELECT unit,sum("submittedQuantity"::numeric)::text AS "submittedQuantity",sum((review->>'acceptedQuantity')::numeric)::text AS "acceptedQuantity",count(review)::int AS "reviewedReports",count(*) FILTER (WHERE review IS NULL)::int AS "unreviewedReports" FROM scoped GROUP BY unit) summary),'[]'::jsonb) AS totals`, [...values, page.limit, page.offset])).rows[0];
      return { ...result, ...page };
    });
  }

  private async card(c: PoolClient, a: Actor, project: string, report: string) {
    const row = (await c.query(`SELECT ${fields} ${from} WHERE ${executionScope} AND ${currentRole} AND s.report_id=$5`, [a.tenantId, a.userId, project, a.role, report])).rows[0];
    if (!row) throw httpError(404, 'not_found');
    return { ...row, history: row.review ? [row.review] : [] };
  }

  read(a: Actor, project: string, report: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      await this.project(c, a, project);
      return this.card(c, a, project, report);
    });
  }

  review(a: Actor, project: string, report: string, input: unknown) {
    const b = commandInput(input);
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/volume-reviews/${report}`, b);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      const source = (await c.query(`SELECT task_id FROM managed_execution_reports WHERE project_id=$1 AND report_id=$2`, [project, report])).rows[0];
      if (!source) throw httpError(404, 'not_found');
      await c.query(`SELECT id FROM daily_tasks WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE`, [project, source.task_id]);
      const role = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' FOR SHARE`, [a.userId])).rows[0]?.role;
      const assigned = await c.query(`SELECT user_id FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' FOR SHARE`, [project, a.userId]);
      if (role !== 'master' || !assigned.rowCount) throw httpError(403, 'role_denied');
      if (!receipt.inserted) return replayCommand(c, a, b.requestId, receipt.hash);
      const row = await this.card(c, a, project, report);
      if (row.version !== b.expectedVersion) throw httpError(409, 'stale_version');
      if (row.review) throw httpError(409, 'review_closed');
      if (!row.checklist) throw httpError(422, 'self_control_required');
      if (row.checklist.id !== b.checklistRunId) throw httpError(409, 'checklist_changed');
      if (!row.checklist.passed || row.checklist.blocksNext) throw httpError(422, 'self_control_required');
      let part;
      try { part = partialAcceptance(row.submittedQuantity, b.acceptedQuantity); }
      catch { throw httpError(422, 'quantity_exceeds_submitted'); }
      if (part.difference !== '0' && !b.reason) throw httpError(422, 'reason_required');
      const name = (await c.query(`SELECT name FROM users WHERE id=$1`, [a.userId])).rows[0].name;
      await c.query(`INSERT INTO master_volume_reviews(tenant_id,report_id,id,submitted_quantity,accepted_quantity,difference_quantity,reason,checklist_run_id,actor_user_id,actor_name,request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [a.tenantId, report, randomUUID(), row.submittedQuantity, part.accepted, part.difference, b.reason, b.checklistRunId, a.userId, name, b.requestId]);
      const saved = await this.card(c, a, project, report);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'volumes.master_review','managed_report',$3,'ok',$4)`, [a.tenantId, a.userId, report, JSON.stringify({ requestId: b.requestId, submittedQuantity: row.submittedQuantity, review: saved.review })]);
      return completeCommand(c, a, b.requestId, 201, saved);
    });
  }
}
