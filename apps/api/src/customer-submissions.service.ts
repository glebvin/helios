import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { day, uuid } from './api-input.js';
import { integer, object, text } from './people-input.js';
import { httpError } from './errors.js';
import { executionScope, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

type Part = { id: string; taskId: string; replacedBy: { id: string } | null };
const remarkRow = `SELECT r.id, r.body, r.attempt_number AS "attemptNumber", r.responsible_employee_id AS "responsibleEmployeeId", r.due_on::text AS "dueOn", r.closed_at AS "closedAt", t.id AS "taskId" FROM customer_submission_remarks r JOIN customer_remark_tasks t ON t.tenant_id=r.tenant_id AND t.remark_id=r.id`;
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
    const remarks = row ? await this.withPhotos(c, (await c.query(`${remarkRow} WHERE r.project_id=$1 AND r.accepted_part_id=$2 ORDER BY r.created_at, r.id`, [project, id])).rows) : [];
    const scans = row ? (await c.query(`SELECT id AS "fileId", filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256 FROM customer_submission_scans WHERE project_id=$1 AND accepted_part_id=$2 ORDER BY created_at, id`, [project, id])).rows : [];
    return { recorded: !!row, attemptNumber: row?.attemptNumber ?? null, acceptedPartId: accepted.id, checklistRunId: row?.checklistRunId ?? null, recordedAt: row?.recordedAt ?? null, openRemarks: remarks.filter((item: { closedAt: string | null }) => item.closedAt === null).length, remarks, scans };
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
      if (await this.requirement(c, project, source.taskId)) {
        const state = (await c.query(`SELECT to_state FROM internal_inspection_events WHERE accepted_part_id=$1 ORDER BY version DESC LIMIT 1`, [id])).rows[0]?.to_state ?? 'not_submitted';
        if (state !== 'accepted') throw httpError(422, 'internal_inspection_required');
      }
      const nextAttempt = (current.attemptNumber ?? 0) + 1;
      if (current.recorded) {
        if (!current.remarks.some((r: { attemptNumber: number }) => r.attemptNumber === current.attemptNumber)) throw httpError(422, 'remarks_required');
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
      const submission = (await c.query(`SELECT attempt_number FROM customer_submissions WHERE project_id=$1 AND accepted_part_id=$2`, [project, id])).rows[0];
      if (!submission) throw httpError(422, 'submission_required');
      const responsible = (await c.query(`SELECT e.id FROM employees e JOIN employee_project_assignments a ON a.tenant_id=e.tenant_id AND a.employee_id=e.id WHERE e.tenant_id=$1 AND e.id=$2 AND e.status='active' AND a.project_id=$3 AND a.status='active'`, [a.tenantId, b.responsibleEmployeeId, project])).rowCount;
      if (!responsible) throw httpError(422, 'responsible_not_assigned');
      const remarkId = randomUUID();
      const taskId = randomUUID();
      await c.query(`INSERT INTO customer_submission_remarks(tenant_id,id,accepted_part_id,project_id,body,responsible_employee_id,due_on,actor_user_id,request_id,attempt_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [a.tenantId, remarkId, id, project, b.body, b.responsibleEmployeeId, b.dueOn, a.userId, b.requestId, submission.attempt_number]);
      await c.query(`INSERT INTO customer_remark_tasks(tenant_id,id,remark_id,project_id,assignee_employee_id,due_on) VALUES($1,$2,$3,$4,$5,$6)`, [a.tenantId, taskId, remarkId, project, b.responsibleEmployeeId, b.dueOn]);
      const saved = (await this.withPhotos(c, (await c.query(`${remarkRow} WHERE r.id=$1`, [remarkId])).rows))[0];
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
      const saved = (await this.withPhotos(c, (await c.query(`${remarkRow} WHERE r.id=$1`, [remark])).rows))[0];
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_remark_close','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: b.requestId, remarkId: remark })]);
      return completeCommand(c, a, b.requestId, 200, saved);
    });
  }
  photo(a: Actor, project: string, id: string, remark: string, value: unknown) {
    const raw = object(value, ['requestId', 'filename', 'contentType', 'contentBase64']);
    if (raw.contentType !== 'image/jpeg' && raw.contentType !== 'image/png') throw httpError(400, 'invalid_file');
    if (typeof raw.contentBase64 !== 'string' || !raw.contentBase64.trim()) throw httpError(400, 'invalid_file');
    const bytes = Buffer.from(raw.contentBase64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== raw.contentBase64.replace(/\s/g, '')) throw httpError(400, 'invalid_file');
    if (bytes.length > 8388608) throw httpError(413, 'file_too_large');
    if (!photoMatches(raw.contentType, bytes)) throw httpError(422, 'file_denied');
    const body = { requestId: uuid(raw.requestId).toLowerCase(), filename: text(raw.filename, 120), contentType: raw.contentType, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/accepted-parts/${id}/customer-submission/remarks/${remark}/photos`, body);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      await this.part(c, a, project, id);
      if (!receipt.inserted) return replayCommand(c, a, body.requestId, receipt.hash);
      if (!(await c.query(`SELECT 1 FROM customer_submission_remarks WHERE project_id=$1 AND accepted_part_id=$2 AND id=$3`, [project, id, remark])).rowCount) throw httpError(404, 'not_found');
      const existing = (await c.query(`SELECT id AS "fileId", filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256 FROM customer_remark_photos WHERE remark_id=$1 AND sha256=$2`, [remark, body.sha256])).rows[0];
      const fileId = existing?.fileId ?? randomUUID();
      if (!existing) await c.query(`INSERT INTO customer_remark_photos(tenant_id,id,remark_id,project_id,filename,content_type,size_bytes,sha256,bytes,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [a.tenantId, fileId, remark, project, body.filename, body.contentType, body.sizeBytes, body.sha256, bytes, a.userId, body.requestId]);
      const saved = existing ?? { fileId, filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes, sha256: body.sha256 };
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_remark_photo','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: body.requestId, remarkId: remark, fileId, sha256: body.sha256 })]);
      return completeCommand(c, a, body.requestId, 201, saved);
    });
  }
  scan(a: Actor, project: string, id: string, value: unknown) {
    const raw = object(value, ['requestId', 'filename', 'contentType', 'contentBase64']);
    if (raw.contentType !== 'application/pdf') throw httpError(400, 'invalid_file');
    if (typeof raw.contentBase64 !== 'string' || !raw.contentBase64.trim()) throw httpError(400, 'invalid_file');
    const bytes = Buffer.from(raw.contentBase64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== raw.contentBase64.replace(/\s/g, '')) throw httpError(400, 'invalid_file');
    if (bytes.length > 8388608) throw httpError(413, 'file_too_large');
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw httpError(422, 'file_denied');
    const body = { requestId: uuid(raw.requestId).toLowerCase(), filename: text(raw.filename, 120), contentType: 'application/pdf' as const, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
    if (a.role !== 'master') throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      const receipt = await reserveCommand(c, a, `POST /projects/${project}/accepted-parts/${id}/customer-submission/scans`, body);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      await this.part(c, a, project, id);
      if (!receipt.inserted) return replayCommand(c, a, body.requestId, receipt.hash);
      if (!(await c.query(`SELECT 1 FROM customer_submissions WHERE project_id=$1 AND accepted_part_id=$2`, [project, id])).rowCount) throw httpError(422, 'submission_required');
      const existing = (await c.query(`SELECT id AS "fileId", filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256 FROM customer_submission_scans WHERE accepted_part_id=$1 AND sha256=$2`, [id, body.sha256])).rows[0];
      const fileId = existing?.fileId ?? randomUUID();
      if (!existing) await c.query(`INSERT INTO customer_submission_scans(tenant_id,id,accepted_part_id,project_id,filename,content_type,size_bytes,sha256,bytes,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [a.tenantId, fileId, id, project, body.filename, body.contentType, body.sizeBytes, body.sha256, bytes, a.userId, body.requestId]);
      const saved = existing ?? { fileId, filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes, sha256: body.sha256 };
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.customer_submission_scan','accepted_part',$3,'ok',$4)`, [a.tenantId, a.userId, id, JSON.stringify({ requestId: body.requestId, fileId, sha256: body.sha256 })]);
      return completeCommand(c, a, body.requestId, 201, saved);
    });
  }
  async downloadScan(a: Actor, project: string, id: string, scan: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      await this.part(c, a, project, id);
      const file = (await c.query(`SELECT filename, content_type AS "contentType", bytes FROM customer_submission_scans WHERE project_id=$1 AND accepted_part_id=$2 AND id=$3`, [project, id, scan])).rows[0];
      if (!file) throw httpError(404, 'not_found');
      return { filename: file.filename as string, contentType: file.contentType as string, bytes: file.bytes as Buffer };
    });
  }
  async download(a: Actor, project: string, id: string, remark: string, photo: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      await this.part(c, a, project, id);
      const file = (await c.query(`SELECT f.filename, f.content_type AS "contentType", f.bytes FROM customer_remark_photos f
        JOIN customer_submission_remarks r ON r.tenant_id=f.tenant_id AND r.id=f.remark_id
        WHERE r.project_id=$1 AND r.accepted_part_id=$2 AND r.id=$3 AND f.id=$4`, [project, id, remark, photo])).rows[0];
      if (!file) throw httpError(404, 'not_found');
      return { filename: file.filename as string, contentType: file.contentType as string, bytes: file.bytes as Buffer };
    });
  }
  zones(a: Actor, project: string) {
    if (!['master', 'director', 'pto', 'worker'].includes(a.role)) throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      if (!(await c.query(`SELECT p.id FROM projects p WHERE p.tenant_id=$1 AND p.id=$3 AND EXISTS (
        SELECT 1 FROM memberships m WHERE m.tenant_id=p.tenant_id AND m.user_id=$2 AND m.status='active' AND m.role=$4
        AND (m.role='director' OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.tenant_id=p.tenant_id AND pm.project_id=p.id AND pm.user_id=m.user_id AND pm.status='active')))`, [a.tenantId, a.userId, project, a.role])).rowCount) throw httpError(404, 'not_found');
      const zones = (await c.query(`SELECT z.id AS "zoneId", z.name,
        sum(part.attempt_number)::int AS "attemptCount",
        coalesce(sum(part.open_remarks),0)::int AS "openRemarks",
        bool_or(part.has_scan) AS "hasScan"
        FROM (SELECT t.zone_id, cs.attempt_number,
          (SELECT count(*)::int FROM customer_submission_remarks r WHERE r.accepted_part_id=cs.accepted_part_id AND r.closed_at IS NULL) AS open_remarks,
          EXISTS (SELECT 1 FROM customer_submission_scans sc WHERE sc.accepted_part_id=cs.accepted_part_id) AS has_scan
          FROM customer_submissions cs
          JOIN accepted_volume_parts v ON v.tenant_id=cs.tenant_id AND v.id=cs.accepted_part_id
          JOIN managed_execution_reports s ON s.tenant_id=v.tenant_id AND s.report_id=v.report_id ${executionJoin}
          JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id
          WHERE ${executionScope} AND cs.project_id=$3 AND t.zone_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$4)) part
        JOIN project_work_zones z ON z.tenant_id=$1 AND z.project_id=$3 AND z.id=part.zone_id
        GROUP BY z.id, z.name ORDER BY z.name, z.id`, [a.tenantId, a.userId, project, a.role])).rows;
      return { zones };
    });
  }
  myRemarkTasks(a: Actor, project: string) {
    if (!['master', 'director', 'pto', 'worker'].includes(a.role)) throw httpError(403, 'role_denied');
    return withTenant(this.pool, a.tenantId, a.userId, async c => {
      if (!(await c.query(`SELECT p.id FROM projects p WHERE p.tenant_id=$1 AND p.id=$3 AND EXISTS (
        SELECT 1 FROM memberships m WHERE m.tenant_id=p.tenant_id AND m.user_id=$2 AND m.status='active' AND m.role=$4
        AND (m.role='director' OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.tenant_id=p.tenant_id AND pm.project_id=p.id AND pm.user_id=m.user_id AND pm.status='active')))`, [a.tenantId, a.userId, project, a.role])).rowCount) throw httpError(404, 'not_found');
      const items = (await c.query(`SELECT t.id, r.id AS "remarkId", r.accepted_part_id AS "acceptedPartId", r.body, t.due_on::text AS "dueOn", r.closed_at AS "closedAt"
        FROM customer_remark_tasks t
        JOIN customer_submission_remarks r ON r.tenant_id=t.tenant_id AND r.id=t.remark_id
        JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id AND e.user_id=$1 AND e.status='active'
        WHERE t.project_id=$2 ORDER BY t.due_on, t.id`, [a.userId, project])).rows;
      return { items };
    });
  }
  private async withPhotos<T extends { id: string }>(c: PoolClient, remarks: T[]) {
    if (!remarks.length) return [];
    const photos = (await c.query(`SELECT id AS "fileId", remark_id AS "remarkId", filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256 FROM customer_remark_photos WHERE remark_id = ANY($1::uuid[]) ORDER BY created_at, id`, [remarks.map((item) => item.id)])).rows as { remarkId: string }[];
    return remarks.map((item) => ({ ...item, photos: photos.filter((photo) => photo.remarkId === item.id).map(({ remarkId, ...photo }) => photo) }));
  }
}

function photoMatches(type: string, bytes: Buffer) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
}
