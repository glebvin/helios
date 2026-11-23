import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "./workforce.service.js";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { reserveCommand, replayCommand, completeCommand } from "./durable-command.js";
import { executionClock } from "./execution-read.js";
import { canonicalSource, timeSource } from "./time-source.js";
import { closeCommand, correctionCommand, revisionCommand } from "./primary-day-input.js";

type Row = Record<string, any>;
type Facts = { sourceHash: string; presenceMs: string; idleMs: string; workMs: string; breakMs: string; downtimeMs: string; shifts: { shiftId: string; mode: string; ms: string; open: boolean }[] };
type Line = { employeeId: string; fullName: string; facts: Facts };

// Primary close is version 1 and immutable. A consolidated revision stores the close hashes,
// not a live reread. The next revision copies those hashes and cites one correction.
// Live execution after the close is returned beside the snapshot and does not replace it.
export class PrimaryDayService {
  constructor(private readonly pool: Pool) {}

  day(actor: Actor, projectId: string, day: string, organizationId?: string) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      const role = await this.role(client, actor, projectId);
      const organization = await this.organization(client, actor, projectId, role, organizationId);
      return this.view(client, actor, projectId, organization, day);
    });
  }

  consolidated(actor: Actor, projectId: string, day: string) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      const role = await this.role(client, actor, projectId);
      if (role !== "hr" && role !== "master") throw httpError(403, "role_denied");
      const organization = role === "master" ? await this.organization(client, actor, projectId, role) : undefined;
      return this.sheet(client, actor, projectId, day, organization);
    });
  }

  close(actor: Actor, projectId: string, day: string, input: unknown) {
    const command = closeCommand(input);
    return this.command(actor, projectId, `POST /projects/${projectId}/time/primary-days/${day}/close`, command, async (client) => {
      if ((await this.role(client, actor, projectId)) !== "master") throw httpError(403, "role_denied");
      const preparer = await this.dayPreparer(client, actor, projectId);
      if (preparer && preparer !== actor.userId) throw httpError(403, "route_denied");
      const organization = await this.organization(client, actor, projectId, "master", command.organizationId);
      const current = await this.closeRow(client, actor, projectId, organization, day);
      if ((current ? 1 : 0) !== command.expectedCloseVersion) throw httpError(409, "stale_version");
      const built = await this.lines(client, actor, projectId, organization, day);
      if (!built.lines.length) throw httpError(422, "recorded_time_required");
      if (built.open) throw httpError(422, "open_intervals");
      if (built.future) throw httpError(422, "future_day");
      if (built.hash !== command.sourceHash) throw httpError(409, "stale_source");
      await client.query(`INSERT INTO primary_day_closes(tenant_id,project_id,organization_id,day,version,source_hash,snapshot,actor_user_id,request_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`, [actor.tenantId, projectId, organization, day, built.hash, JSON.stringify({ timezone: built.timezone, employees: built.lines }), actor.userId, command.requestId]);
      await this.audit(client, actor, "primary_day_closed", organization, { day, projectId, version: 1, sourceHash: built.hash, requestId: command.requestId });
      return this.view(client, actor, projectId, organization, day);
    });
  }

  correct(actor: Actor, projectId: string, day: string, input: unknown) {
    const command = correctionCommand(input);
    return this.command(actor, projectId, `POST /projects/${projectId}/time/primary-days/${day}/corrections`, command, async (client) => {
      if ((await this.role(client, actor, projectId)) !== "master") throw httpError(403, "role_denied");
      const organization = await this.organization(client, actor, projectId, "master", command.organizationId);
      const current = await this.closeRow(client, actor, projectId, organization, day);
      if (!current) throw httpError(409, "primary_close_required");
      const latest = await this.latestRevision(client, actor, projectId, day);
      const cited = (latest?.closes ?? []).find((item: Row) => item.organizationId === organization);
      if (!latest) throw httpError(409, "revision_required");
      const count = Number((await client.query(`SELECT count(*)::int n FROM time_corrections WHERE tenant_id=$1 AND project_id=$2 AND organization_id=$3 AND day=$4`, [actor.tenantId, projectId, organization, day])).rows[0].n);
      if (count !== command.expectedCorrectionVersion) throw httpError(409, "stale_version");
      const open = await client.query(`SELECT 1 FROM time_corrections c WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.organization_id=$3 AND c.day=$4 AND NOT EXISTS (SELECT 1 FROM consolidated_time_revisions r WHERE r.tenant_id=c.tenant_id AND r.correction_id=c.id)`, [actor.tenantId, projectId, organization, day]);
      if (open.rowCount) throw httpError(409, "correction_open");
      const built = await this.lines(client, actor, projectId, organization, day);
      if (!built.lines.length) throw httpError(422, "recorded_time_required");
      if (built.open) throw httpError(422, "open_intervals");
      if (built.future) throw httpError(422, "future_day");
      if (built.hash !== command.sourceHash) throw httpError(409, "stale_source");
      const baseline = cited?.sourceHash ?? current.source_hash;
      const id = randomUUID();
      await client.query(`INSERT INTO time_corrections(tenant_id,id,project_id,organization_id,day,corrects_version,corrects_hash,reason,actor_user_id,request_id,source_hash,snapshot) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11)`, [actor.tenantId, id, projectId, organization, day, baseline, command.reason, actor.userId, command.requestId, built.hash, JSON.stringify({ timezone: built.timezone, employees: built.lines })]);
      await this.audit(client, actor, "primary_day_correction_prepared", id, { day, projectId, organizationId: organization, correctsHash: baseline, sourceHash: built.hash, requestId: command.requestId });
      return this.view(client, actor, projectId, organization, day);
    });
  }

  issue(actor: Actor, projectId: string, day: string, input: unknown) {
    const command = revisionCommand(input);
    return this.command(actor, projectId, `POST /projects/${projectId}/time/consolidated/${day}/revisions`, command, async (client) => {
      if ((await this.role(client, actor, projectId)) !== "hr") throw httpError(403, "role_denied");
      await client.query(`SELECT revision FROM consolidated_time_heads WHERE tenant_id=$1 AND project_id=$2 AND day=$3 FOR NO KEY UPDATE`, [actor.tenantId, projectId, day]);
      const head = await this.latestRevision(client, actor, projectId, day);
      const current = head ? Number(head.revision) : 0;
      if (current !== command.expectedRevision) throw httpError(409, "stale_version");
      let closes: Row[];
      let correctionId: string | null = null;
      if (current === 0) {
        const rows = (await client.query(`SELECT organization_id, source_hash FROM primary_day_closes WHERE tenant_id=$1 AND project_id=$2 AND day=$3 ORDER BY organization_id`, [actor.tenantId, projectId, day])).rows;
        if (!rows.length) throw httpError(422, "primary_close_required");
        closes = rows.map((row) => ({ organizationId: row.organization_id, sourceHash: row.source_hash, version: 1 }));
      } else {
        if (!head) throw httpError(409, "stale_version");
        const correction = (await client.query(`SELECT * FROM time_corrections WHERE tenant_id=$1 AND id=$2 AND project_id=$3 AND day=$4`, [actor.tenantId, command.correctionId, projectId, day])).rows[0];
        if (!correction) throw httpError(404, "not_found");
        if ((await client.query(`SELECT 1 FROM consolidated_time_revisions WHERE tenant_id=$1 AND correction_id=$2`, [actor.tenantId, correction.id])).rowCount) throw httpError(409, "stale_version");
        const cited = head.closes.find((item: Row) => item.organizationId === correction.organization_id);
        const primary = await this.closeRow(client, actor, projectId, correction.organization_id, day);
        if (!primary || (cited?.sourceHash ?? primary.source_hash) !== correction.corrects_hash) throw httpError(409, "revision_required");
        const amended = { organizationId: correction.organization_id, version: 1, sourceHash: correction.source_hash, correctionId: correction.id };
        closes = head.closes.map((item: Row) => item.organizationId === correction.organization_id ? amended : item);
        if (!cited) closes.push(amended);
        correctionId = correction.id;
      }
      const next = current + 1;
      await client.query(`INSERT INTO consolidated_time_revisions(tenant_id,project_id,day,revision,previous_revision,closes,correction_id,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [actor.tenantId, projectId, day, next, current || null, JSON.stringify(closes), correctionId, actor.userId, command.requestId]);
      await client.query(`INSERT INTO consolidated_time_heads(tenant_id,project_id,day,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,project_id,day) DO UPDATE SET revision=EXCLUDED.revision`, [actor.tenantId, projectId, day, next]);
      await this.audit(client, actor, "consolidated_time_issued", projectId, { day, revision: next, correctionId, requestId: command.requestId });
      return this.sheet(client, actor, projectId, day);
    });
  }

  private command(actor: Actor, projectId: string, operation: string, command: { requestId: string }, work: (client: PoolClient) => Promise<Row>) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      const receipt = await reserveCommand(client, actor, operation, JSON.parse(JSON.stringify(command)));
      if (!(await client.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`, [actor.tenantId, projectId])).rowCount) throw httpError(404, "not_found");
      await client.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR NO KEY UPDATE`, [actor.tenantId, actor.userId]);
      await this.role(client, actor, projectId);
      if (!receipt.inserted) return replayCommand(client, actor, command.requestId, receipt.hash);
      const body = await work(client);
      return completeCommand(client, actor, command.requestId, 201, body);
    });
  }

  private async role(client: PoolClient, actor: Actor, projectId: string) {
    if (!(await client.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, projectId])).rowCount) throw httpError(404, "not_found");
    const member = (await client.query(`SELECT role, status FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE`, [actor.tenantId, actor.userId])).rows[0];
    if (!member || member.role !== actor.role || member.status !== "active" || (member.role !== "master" && member.role !== "hr")) throw httpError(403, "role_denied");
    if (!(await client.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active' FOR SHARE`, [actor.tenantId, projectId, actor.userId])).rowCount) throw httpError(404, "not_found");
    return member.role as "master" | "hr";
  }

  private async organization(client: PoolClient, actor: Actor, projectId: string, role: "master" | "hr", requested?: string) {
    if (role === "master") {
      const cards = (await client.query(`SELECT organization_id FROM employees WHERE tenant_id=$1 AND user_id=$2 AND status='active' ORDER BY id FOR SHARE`, [actor.tenantId, actor.userId])).rows;
      if (cards.length !== 1) throw httpError(403, "employer_denied");
      const organization = cards[0].organization_id as string;
      if (requested && requested !== organization) throw httpError(403, "employer_denied");
      return organization;
    }
    if (!requested) throw httpError(400, "invalid_input");
    if (!(await client.query(`SELECT 1 FROM organizations WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, requested])).rowCount) throw httpError(404, "not_found");
    const assigned = await client.query(`SELECT 1 FROM employees e JOIN employee_project_assignments a ON a.tenant_id=e.tenant_id AND a.employee_id=e.id WHERE e.tenant_id=$1 AND e.organization_id=$2 AND a.project_id=$3 AND a.status='active' AND e.status='active' UNION ALL SELECT 1 FROM primary_day_closes WHERE tenant_id=$1 AND organization_id=$2 AND project_id=$3 LIMIT 1`, [actor.tenantId, requested, projectId]);
    if (!assigned.rowCount) throw httpError(403, "employer_denied");
    return requested;
  }

  private async dayPreparer(client: PoolClient, actor: Actor, projectId: string) {
    const stored = (await client.query(`SELECT configuration FROM route_config_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`, [actor.tenantId, projectId])).rows[0];
    const route = stored?.configuration?.routes?.find((item: { documentType?: string }) => item.documentType === "day-close");
    const userId = route?.preparers?.[0]?.userId;
    return typeof userId === "string" ? userId : null;
  }

  private async closeRow(client: PoolClient, actor: Actor, projectId: string, organization: string, day: string) {
    return (await client.query(`SELECT * FROM primary_day_closes WHERE tenant_id=$1 AND project_id=$2 AND organization_id=$3 AND day=$4`, [actor.tenantId, projectId, organization, day])).rows[0] as Row | undefined;
  }

  private async lines(client: PoolClient, actor: Actor, projectId: string, organization: string, day: string) {
    const clock = await executionClock(client, actor, day);
    const employees = (await client.query(`SELECT DISTINCT e.id, e.full_name FROM employees e JOIN managed_shifts s ON s.tenant_id=e.tenant_id AND s.employee_id=e.id WHERE e.tenant_id=$1 AND e.organization_id=$2 AND s.project_id=$3 ORDER BY e.id`, [actor.tenantId, organization, projectId])).rows;
    const lines: Line[] = [];
    let open = false;
    let future = false;
    for (const employee of employees) {
      const current = await timeSource(client, actor, projectId, employee.id, day, clock);
      if (!current.recorded) continue;
      open ||= current.source.hasOpenIntervals;
      future ||= current.future;
      const totals = current.source.totals;
      lines.push({ employeeId: employee.id, fullName: employee.full_name, facts: { sourceHash: current.sourceHash, presenceMs: totals.presenceMs, idleMs: totals.idleMs, workMs: totals.workMs, breakMs: totals.breakMs, downtimeMs: totals.downtimeMs, shifts: current.source.segments.map((segment: Row) => ({ shiftId: segment.shiftId, mode: segment.mode, ms: segment.ms, open: segment.open })).sort((a: Row, b: Row) => a.shiftId.localeCompare(b.shiftId) || a.mode.localeCompare(b.mode)) } });
    }
    const hash = createHash("sha256").update(canonicalSource({ schemaVersion: 1, projectId, organizationId: organization, day, employees: lines.map((line) => ({ employeeId: line.employeeId, sourceHash: line.facts.sourceHash })) })).digest("hex");
    return { lines, hash, open, future, timezone: clock.timezone };
  }

  private async view(client: PoolClient, actor: Actor, projectId: string, organization: string, day: string) {
    const built = await this.lines(client, actor, projectId, organization, day);
    const closed = await this.closeRow(client, actor, projectId, organization, day);
    const name = (await client.query(`SELECT name FROM organizations WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, organization])).rows[0];
    if (!name) throw httpError(404, "not_found");
    const snapshot = new Map<string, Line>(((closed?.snapshot.employees ?? []) as Line[]).map((line) => [line.employeeId, line]));
    const live = new Map(built.lines.map((line) => [line.employeeId, line]));
    const ids = [...new Set([...live.keys(), ...snapshot.keys()])].sort();
    const sheet = await this.sheet(client, actor, projectId, day, actor.role === "master" ? organization : undefined);
    const issued = sheet.revisions.at(-1)?.closes.find((item: Row) => item.organizationId === organization)?.snapshot;
    const issuedLines = new Map<string, Line>((issued?.employees ?? []).map((line: Line) => [line.employeeId, line]));
    const correctionCount = Number((await client.query(`SELECT count(*) n FROM time_corrections WHERE tenant_id=$1 AND project_id=$2 AND organization_id=$3 AND day=$4`, [actor.tenantId, projectId, organization, day])).rows[0].n);
    const correction = (await client.query(`SELECT c.*, r.revision AS accepted_revision FROM time_corrections c LEFT JOIN consolidated_time_revisions r ON r.tenant_id=c.tenant_id AND r.correction_id=c.id WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.organization_id=$3 AND c.day=$4 ORDER BY c.recorded_at DESC LIMIT 1`, [actor.tenantId, projectId, organization, day])).rows[0];
    const author = closed ? await this.userName(client, closed.actor_user_id) : null;
    return {
      projectId, organizationId: organization, organizationName: name.name as string, day, timezone: built.timezone,
      closeVersion: closed ? 1 : 0, closedAt: closed ? closed.recorded_at.toISOString() : null, closedBy: closed ? closed.actor_user_id : null, closedByName: author,
      liveHash: built.hash, snapshotHash: closed ? closed.source_hash : null, diverged: closed ? built.hash !== closed.source_hash : false,
      employees: ids.map((id) => ({ employeeId: id, fullName: (live.get(id) ?? snapshot.get(id))!.fullName, live: live.get(id)?.facts ?? null, snapshot: snapshot.get(id)?.facts ?? null, consolidated: issuedLines.get(id)?.facts ?? null })),
      correctionVersion: correctionCount, revision: sheet.revision, revisions: sheet.revisions,
      correction: correction ? { id: correction.id, reason: correction.reason, correctsVersion: 1, correctsHash: correction.corrects_hash, sourceHash: correction.source_hash, recordedAt: correction.recorded_at.toISOString(), recordedBy: correction.actor_user_id, recordedByName: await this.userName(client, correction.actor_user_id), acceptedRevision: correction.accepted_revision === null ? null : Number(correction.accepted_revision) } : null,
    };
  }

  private async sheet(client: PoolClient, actor: Actor, projectId: string, day: string, organization?: string) {
    const rows = (await client.query(`SELECT * FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 ORDER BY revision`, [actor.tenantId, projectId, day])).rows;
    const names = new Map<string, string>();
    for (const row of rows) if (!names.has(row.actor_user_id)) names.set(row.actor_user_id, await this.userName(client, row.actor_user_id));
    const revisions = [];
    for (const row of rows) {
      const closes = [];
      for (const close of row.closes.filter((item: Row) => !organization || item.organizationId === organization)) {
        const saved = close.correctionId
          ? (await client.query(`SELECT snapshot,source_hash FROM time_corrections WHERE tenant_id=$1 AND project_id=$2 AND organization_id=$3 AND day=$4 AND id=$5`, [actor.tenantId,projectId,close.organizationId,day,close.correctionId])).rows[0]
          : await this.closeRow(client,actor,projectId,close.organizationId,day);
        if (!saved || saved.source_hash !== close.sourceHash) throw httpError(409,"snapshot_missing");
        closes.push({...close,snapshot:saved.snapshot});
      }
      const ownCorrection = !organization || !row.correction_id || (await client.query(`SELECT 1 FROM time_corrections WHERE tenant_id=$1 AND id=$2 AND organization_id=$3`,[actor.tenantId,row.correction_id,organization])).rowCount;
      revisions.push({ revision: Number(row.revision), previousRevision: row.previous_revision === null ? null : Number(row.previous_revision), issuedAt: row.recorded_at.toISOString(), issuedBy: row.actor_user_id, issuedByName: names.get(row.actor_user_id)!, correctionId: ownCorrection ? row.correction_id : null, closes });
    }
    return { projectId, day, revision: revisions.at(-1)?.revision ?? 0, revisions };
  }

  private async latestRevision(client: PoolClient, actor: Actor, projectId: string, day: string) {
    return (await client.query(`SELECT * FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 ORDER BY revision DESC LIMIT 1`, [actor.tenantId, projectId, day])).rows[0] as Row | undefined;
  }

  private async userName(client: PoolClient, userId: string) {
    const row = (await client.query(`SELECT name FROM users WHERE id=$1`, [userId])).rows[0];
    if (!row?.name) throw httpError(404, "not_found");
    return row.name as string;
  }

  private async audit(client: PoolClient, actor: Actor, action: string, objectId: string, details: Row) {
    await client.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,$3,'primary_day',$4,'ok',$5)`, [actor.tenantId, actor.userId, action, objectId, JSON.stringify(details)]);
  }
}
