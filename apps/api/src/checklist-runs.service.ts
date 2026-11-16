import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool, PoolClient } from "pg";
import { pinChecklist, validateChecklist, type ChecklistAnswer, type ChecklistItem, type ChecklistRefusal, type ChecklistSnapshot } from "@helios/domain";
import { uuid } from "./api-input.js";
import { checklistItems } from "./checklist-templates.js";
import { completeCommand, replayCommand, reserveCommand } from "./durable-command.js";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { integer, object, text } from "./people-input.js";
import type { Actor } from "./workforce.service.js";

const writers = new Set(["master", "worker"]);
const readers = new Set(["director", "master", "worker", "pto"]);
const fileTypes = ["image/jpeg", "image/png", "application/pdf"] as const;
const fileLimit = 8 * 1024 * 1024;

type RunRow = {
  id: string; projectId: string; taskId: string; templateId: string; edition: number; templateVersion: number;
  items: ChecklistItem[]; answers: ChecklistAnswer[]; verdict: { ok: boolean; refused: boolean; refusals: ChecklistRefusal[] };
  passed: boolean; blocksNext: boolean; actorUserId: string; actorName: string; requestId: string; version: number; createdAt: Date | string;
};

export async function refuseBlockedChecklist(c: PoolClient, tenantId: string, taskId: string) {
  const row = (await c.query(`SELECT blocks_next FROM checklist_runs WHERE tenant_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`, [tenantId, taskId])).rows[0];
  if (row?.blocks_next) throw httpError(422, "checklist_blocked");
}

export class ChecklistRunsService {
  constructor(private readonly pool: Pool) {}

  list(a: Actor, projectId: string, taskId: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      await this.access(c, a, projectId, taskId, false);
      const history = await this.rows(c, projectId, taskId);
      const approved = (await c.query(
        `SELECT DISTINCT ON (template_id) template_id AS "templateId", edition, title, version, items
         FROM checklist_template_editions WHERE project_id=$1 AND status='approved' ORDER BY template_id, edition DESC`,
        [projectId],
      )).rows;
      return { latest: history.at(-1) ?? null, history, approved };
    });
  }

  save(a: Actor, projectId: string, taskId: string, input: unknown) {
    const body = runInput(input);
    const operation = `POST /projects/${projectId}/tasks/${taskId}/checklist-runs`;
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const receipt = await reserveCommand(c, a, operation, body);
      const task = await this.access(c, a, projectId, taskId, true);
      if (!receipt.inserted) return replayCommand(c, a, body.requestId, receipt.hash);
      const current = Number((await c.query(`SELECT version FROM checklist_runs WHERE project_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`, [projectId, taskId])).rows[0]?.version ?? 0);
      if (current !== body.expectedVersion) throw httpError(409, "stale_version");
      const edition = (await c.query(
        `SELECT template_id AS "templateId", edition, version, items FROM checklist_template_editions WHERE project_id=$1 AND template_id=$2 AND edition=$3 AND status='approved'`,
        [projectId, body.templateId, body.edition],
      )).rows[0];
      if (!edition) throw httpError(422, "template_not_approved");
      const items = checklistItems(edition.items);
      const snapshot: ChecklistSnapshot = { ...pinChecklist({ id: edition.templateId, version: edition.version, items }), templateVersion: edition.version };
      const verdict = judge(snapshot, body.answers);
      await this.filesMatch(c, projectId, taskId, snapshot, body.answers);
      const id = randomUUID();
      const version = current + 1;
      await c.query(
        `INSERT INTO checklist_runs(tenant_id,id,project_id,task_id,template_id,edition,template_version,items,answers,verdict,passed,blocks_next,actor_user_id,request_id,version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [a.tenantId, id, projectId, task.id, body.templateId, body.edition, edition.version, JSON.stringify(items), JSON.stringify(body.answers), JSON.stringify(verdict), verdict.ok, verdict.refused, a.userId, body.requestId, version],
      );
      const saved = (await this.rows(c, projectId, taskId)).at(-1);
      if (!saved) throw httpError(500, "internal");
      return completeCommand(c, a, body.requestId, 201, saved as unknown as Record<string, unknown>);
    });
  }

  upload(a: Actor, projectId: string, taskId: string, input: { requestId: unknown; itemId: unknown; filename: unknown; contentType: unknown; bytes: Buffer }) {
    const body = fileInput(input);
    const operation = `POST /projects/${projectId}/tasks/${taskId}/checklist-files`;
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const sha = createHash("sha256").update(body.bytes).digest("hex");
      const receipt = await reserveCommand(c, a, operation, { requestId: body.requestId, itemId: body.itemId, filename: body.filename, contentType: body.contentType, sha256: sha });
      await this.access(c, a, projectId, taskId, true);
      if (!receipt.inserted) return replayCommand(c, a, body.requestId, receipt.hash);
      if (!matches(body.contentType, body.bytes)) throw httpError(422, "file_denied");
      const existing = (await c.query(
        `SELECT id FROM checklist_run_files WHERE project_id=$1 AND task_id=$2 AND item_id=$3 AND sha256=$4 AND uploaded_by=$5`,
        [projectId, taskId, body.itemId, sha, a.userId],
      )).rows[0];
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        await c.query(
          `INSERT INTO checklist_run_files(tenant_id,id,project_id,task_id,item_id,filename,content_type,size_bytes,sha256,bytes,uploaded_by,request_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [a.tenantId, id, projectId, taskId, body.itemId, body.filename, body.contentType, body.bytes.length, sha, body.bytes, a.userId, body.requestId],
        );
      }
      return completeCommand(c, a, body.requestId, 201, { fileId: id, itemId: body.itemId, filename: body.filename, contentType: body.contentType, sizeBytes: body.bytes.length, sha256: sha });
    });
  }

  async download(a: Actor, projectId: string, taskId: string, fileId: string) {
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      await this.access(c, a, projectId, taskId, false);
      const file = (await c.query(
        `SELECT filename, content_type AS "contentType", bytes FROM checklist_run_files WHERE project_id=$1 AND task_id=$2 AND id=$3`,
        [projectId, taskId, fileId],
      )).rows[0];
      if (!file) throw httpError(404, "not_found");
      return { filename: file.filename as string, contentType: file.contentType as string, bytes: file.bytes as Buffer };
    });
  }

  private async rows(c: PoolClient, projectId: string, taskId: string) {
    const rows = (await c.query(
      `SELECT r.id, r.project_id AS "projectId", r.task_id AS "taskId", r.template_id AS "templateId", r.edition,
              r.template_version AS "templateVersion", r.items, r.answers, r.verdict, r.passed, r.blocks_next AS "blocksNext",
              r.actor_user_id AS "actorUserId", u.name AS "actorName", r.request_id AS "requestId", r.version, r.created_at AS "createdAt"
       FROM checklist_runs r JOIN users u ON u.id=r.actor_user_id
       WHERE r.project_id=$1 AND r.task_id=$2 ORDER BY r.version`,
      [projectId, taskId],
    )).rows as RunRow[];
    const listed = [];
    for (const row of rows) {
      listed.push({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        files: (await c.query(
          `SELECT id AS "fileId", item_id AS "itemId", filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256
           FROM checklist_run_files WHERE project_id=$1 AND task_id=$2 AND id=ANY($3::uuid[]) ORDER BY created_at, id`,
          [projectId, taskId, row.answers.filter((answer) => row.items.some((item) => item.id === answer.itemId && (item.kind === "photo" || item.kind === "document"))).map((answer) => answer.value)],
        )).rows,
      });
    }
    return listed;
  }

  private async filesMatch(c: PoolClient, projectId: string, taskId: string, snapshot: ChecklistSnapshot, answers: ChecklistAnswer[]) {
    for (const item of snapshot.items) {
      if (item.kind !== "photo" && item.kind !== "document") continue;
      const answer = answers.find((row) => row.itemId === item.id);
      if (!answer) continue;
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(answer.value)) throw httpError(422, "file_denied");
      const file = (await c.query(
        `SELECT content_type FROM checklist_run_files WHERE project_id=$1 AND task_id=$2 AND id=$3 AND item_id=$4`,
        [projectId, taskId, answer.value, item.id],
      )).rows[0];
      const photo = item.kind === "photo";
      if (!file || (photo ? !String(file.content_type).startsWith("image/") : file.content_type !== "application/pdf")) throw httpError(422, "file_denied");
    }
  }

  private async access(c: PoolClient, a: Actor, projectId: string, taskId: string, write: boolean) {
    const member = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' FOR SHARE`, [a.userId])).rows[0];
    if (!member || member.role !== a.role || !(write ? writers : readers).has(member.role)) throw httpError(403, "role_denied");
    if (!(await c.query(`SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' FOR SHARE`, [projectId, a.userId])).rowCount) throw httpError(403, "role_denied");
    await c.query(`SELECT id FROM daily_tasks WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE`, [projectId, taskId]);
    const task = (await c.query(`SELECT id, project_id AS "projectId", assignee_employee_id AS "assigneeEmployeeId", workflow_kind AS "workflowKind", status FROM daily_tasks WHERE project_id=$1 AND id=$2`, [projectId, taskId])).rows[0];
    if (!task) throw httpError(404, "not_found");
    if (task.projectId !== projectId) throw httpError(422, "task_denied");
    if (member.role === "worker") {
      const employee = (await c.query(`SELECT id FROM employees WHERE user_id=$1 AND status='active' FOR SHARE`, [a.userId])).rows[0];
      if (employee?.id !== task.assigneeEmployeeId || (task.workflowKind !== "legacy" && task.status !== "published")) throw httpError(403, "role_denied");
      if (!(await c.query(`SELECT employee_id FROM employee_project_assignments WHERE project_id=$1 AND employee_id=$2 AND status='active' FOR SHARE`, [projectId, employee.id])).rowCount) throw httpError(403, "role_denied");
    }
    return task as { id: string; projectId: string; assigneeEmployeeId: string };
  }
}

function judge(snapshot: ChecklistSnapshot, answers: ChecklistAnswer[]) {
  const verdict = validateChecklist(snapshot, answers);
  const refusals = [...verdict.refusals];
  for (const item of snapshot.items) {
    if (item.kind !== "batch") continue;
    const filled = answers.some((answer) => answer.itemId === item.id && answer.value.trim());
    if (!filled || refusals.some((refusal) => refusal.itemId === item.id)) continue;
    refusals.push({ itemId: item.id, reason: "batch_unavailable" });
  }
  const refused = refusals.some((refusal) => refusal.reason.startsWith("critical") || snapshot.items.some((item) => item.critical && item.kind === "batch" && refusal.itemId === item.id && refusal.reason === "batch_unavailable"));
  return { ok: refusals.length === 0, refused, refusals };
}

function runInput(input: unknown) {
  const body = object(input, ["requestId", "templateId", "edition", "expectedVersion", "answers"]);
  if (!Array.isArray(body.answers) || body.answers.length > 40) throw httpError(400, "invalid_body");
  const answers = body.answers.map((row) => {
    const answer = object(row, ["itemId", "value"]);
    return { itemId: text(answer.itemId, 64), value: text(answer.value, 80) };
  });
  return {
    requestId: uuid(body.requestId).toLowerCase(),
    templateId: uuid(body.templateId).toLowerCase(),
    edition: integer(body.edition),
    expectedVersion: integer(body.expectedVersion, 0),
    answers,
  };
}

export async function readChecklistUpload(req: IncomingMessage): Promise<Buffer> {
  const type = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/octet-stream") throw httpError(415, "octet_stream_required");
  const length = req.headers["content-length"];
  if (length !== undefined && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > fileLimit)) throw httpError(413, "file_too_large");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown) => { if (settled) return; settled = true; req.resume(); reject(error); };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > fileLimit) { fail(httpError(413, "file_too_large")); return; }
      chunks.push(chunk);
    });
    req.once("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks, size)); } });
    req.once("aborted", () => fail(httpError(400, "upload_aborted")));
    req.once("error", () => fail(httpError(400, "upload_interrupted")));
    if (req.aborted) fail(httpError(400, "upload_aborted"));
    else if (req.readableEnded) { settled = true; resolve(Buffer.alloc(0)); }
  });
}

function fileInput(input: { requestId: unknown; itemId: unknown; filename: unknown; contentType: unknown; bytes: Buffer }) {
  if (!Buffer.isBuffer(input.bytes)) throw httpError(400, "invalid_file");
  if (typeof input.contentType !== "string" || !fileTypes.includes(input.contentType as typeof fileTypes[number])) throw httpError(400, "invalid_file");
  if (input.bytes.length > fileLimit) throw httpError(413, "file_too_large");
  if (input.bytes.length < 1) throw httpError(422, "file_denied");
  return { requestId: uuid(input.requestId).toLowerCase(), itemId: text(input.itemId, 64), filename: text(input.filename, 120), contentType: input.contentType, bytes: input.bytes };
}

function matches(type: string, bytes: Buffer) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  return type === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-";
}
