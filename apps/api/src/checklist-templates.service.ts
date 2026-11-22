import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "./workforce.service.js";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { uuid } from "./api-input.js";
import { completeCommand, replayCommand, reserveCommand } from "./durable-command.js";
import { checklistDecision, checklistDraft, checklistSave, checklistSubmit, nextChecklistStatus, type ChecklistDecision, type ChecklistEditionStatus } from "./checklist-templates.js";
import { orderApplies, type ResponsibilityOrderFact } from "./responsibility-orders.js";
import type { ChecklistItem } from "@helios/domain";

const roles = ["engineer-pto", "pto", "director", "safety", "zds-soso"] as const;
type Slot = { role: string; userId: string };
type Snapshot = { schemaVersion: 1; configurationVersion: number; preparer: Slot; responsible: Slot; reviewers: Slot[]; approver: Slot };
type Edition = {
  templateId: string; projectId: string; edition: number; title: string; items: ChecklistItem[]; status: ChecklistEditionStatus;
  version: number; routeSnapshot: Snapshot | null; createdBy: string;
};

export class ChecklistTemplatesService {
  constructor(private readonly pool: Pool) {}

  async list(a: Actor, projectId?: string) {
    const project = projectId === undefined ? null : uuid(projectId);
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const role = await this.role(c, a, project);
      const projects = (await c.query(`SELECT p.id, p.name FROM projects p JOIN project_memberships pm ON pm.tenant_id=p.tenant_id AND pm.project_id=p.id JOIN memberships m ON m.tenant_id=pm.tenant_id AND m.user_id=pm.user_id WHERE m.user_id=$1 AND m.role=$2 AND m.status='active' AND pm.status='active' ORDER BY p.name, p.id`, [a.userId, role])).rows;
      const selected = project ?? projects[0]?.id ?? null;
      if (project && !projects.some((row) => row.id === project)) throw httpError(403, "role_denied");
      const today = (await c.query(`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM tenants WHERE id=$1`, [a.tenantId])).rows[0].day as string;
      if (!selected) return { today, projectId: null, projects, items: [] };
      const items = (await c.query(`SELECT e.template_id AS "templateId", e.edition, e.title, e.status, e.version, e.created_by AS "createdBy", e.route_snapshot AS "routeSnapshot" FROM checklist_template_editions e WHERE e.project_id=$1 AND e.edition=(SELECT max(edition) FROM checklist_template_editions WHERE template_id=e.template_id) ORDER BY e.created_at DESC, e.template_id`, [selected])).rows;
      return { today, projectId: selected, projects, items: await Promise.all(items.map(async (row) => this.card(c, a, row))) };
    });
  }

  async read(a: Actor, projectId: string, templateId: string, edition?: number) {
    const project = uuid(projectId), id = uuid(templateId);
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      await this.role(c, a, project);
      const row = await this.edition(c, project, id, edition ?? null);
      return this.detail(c, a, row);
    });
  }

  async create(a: Actor, projectId: string, input: unknown) {
    const project = uuid(projectId), body = checklistDraft(input);
    return this.command(a, project, `POST /projects/${project}/checklist-templates`, body, async (c) => {
      const role = await this.role(c, a, project, true);
      const route = await this.route(c, a, project);
      if (role !== "engineer-pto" || route.preparer.userId !== a.userId) throw httpError(403, "role_denied");
      const id = randomUUID();
      await c.query(`INSERT INTO checklist_templates(tenant_id, project_id, id, created_by) VALUES($1,$2,$3,$4)`, [a.tenantId, project, id, a.userId]);
      await c.query(`INSERT INTO checklist_template_editions(tenant_id, project_id, template_id, edition, title, items, status, version, created_by) VALUES($1,$2,$3,1,$4,$5,'draft',1,$6)`, [a.tenantId, project, id, body.title, JSON.stringify(body.items), a.userId]);
      await this.audit(c, a, "checklist.created", id, { requestId: body.requestId, edition: 1 });
      return this.detail(c, a, await this.edition(c, project, id, 1));
    });
  }

  async save(a: Actor, projectId: string, templateId: string, input: unknown) {
    const project = uuid(projectId), id = uuid(templateId), body = checklistSave(input);
    return this.command(a, project, `POST /projects/${project}/checklist-templates/${id}`, body, async (c) => {
      await this.role(c, a, project, true);
      const row = await this.locked(c, project, id);
      if (row.status !== "draft" || !this.preparer(a, row)) throw httpError(403, "role_denied");
      if (row.version !== body.expectedVersion) throw httpError(409, "stale_version");
      await this.event(c, a, row, "save", "draft", body.title, body.items, body.requestId);
      await this.audit(c, a, "checklist.saved", id, { requestId: body.requestId, edition: row.edition, version: row.version + 1 });
      return this.detail(c, a, await this.edition(c, project, id, row.edition));
    });
  }

  async submit(a: Actor, projectId: string, templateId: string, input: unknown) {
    const project = uuid(projectId), id = uuid(templateId);
    const body = checklistSubmit(input);
    return this.command(a, project, `POST /projects/${project}/checklist-templates/${id}/submit`, body, async (c) => {
      await this.role(c, a, project, true);
      const row = await this.locked(c, project, id);
      if (row.status !== "draft" || !this.preparer(a, row)) throw httpError(403, "role_denied");
      if (row.version !== body.expectedVersion) throw httpError(409, "stale_version");
      const route = await this.route(c, a, project);
      if (route.preparer.userId !== a.userId) throw httpError(403, "role_denied");
      await this.event(c, a, row, "submit", "pending_responsible", row.title, row.items, body.requestId, null, route);
      await this.audit(c, a, "checklist.submitted", id, { requestId: body.requestId, edition: row.edition });
      return this.detail(c, a, await this.edition(c, project, id, row.edition));
    });
  }

  async decide(a: Actor, projectId: string, templateId: string, input: unknown) {
    const project = uuid(projectId), id = uuid(templateId), body = checklistDecision(input);
    return this.command(a, project, `POST /projects/${project}/checklist-templates/${id}/decision`, body, async (c) => {
      const role = await this.role(c, a, project, true);
      const row = await this.locked(c, project, id);
      if (row.version !== body.expectedVersion) throw httpError(409, "stale_version");
      if (body.action === "revise") return this.revise(c, a, row, body, role);
      const reviewed = await this.reviewedRoles(c, row);
      if (body.action === "approve" && (row.status !== "pending_approval" || reviewed.length < 2)) throw httpError(409, "reviews_required");
      if (body.action === "review" && reviewed.includes(role)) throw httpError(409, "review_recorded");
      const next = nextChecklistStatus(row.status, body.action, reviewed.length);
      if (!next || !this.holder(a, role, row, body.action, reviewed)) throw httpError(403, "role_denied");
      if (body.action === "accept") {
        const today = (await c.query(`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM tenants WHERE id=$1`, [a.tenantId])).rows[0]?.day as string | undefined;
        const person = (await c.query(`SELECT id, organization_id AS "organizationId" FROM employees WHERE user_id=$1 AND status='active'`, [a.userId])).rows[0] as { id: string; organizationId: string } | undefined;
        const orders = person ? (await c.query(`SELECT id, employee_id AS "employeeId", organization_id AS "organizationId", project_id AS "projectId", document_types AS "documentTypes", valid_from::text AS "validFrom", valid_until::text AS "validUntil", status FROM responsibility_orders WHERE employee_id=$1`, [person.id])).rows as ResponsibilityOrderFact[] : [];
        const authority = orderApplies(orders, { employeeId: person?.id ?? "", organizationId: person?.organizationId ?? "", projectId: project, documentType: "inspection-template", on: today ?? "" });
        if (!authority.applicable) throw httpError(422, authority.reason);
      }
      await this.event(c, a, row, body.action, next, row.title, row.items, body.requestId, body.reason);
      await this.audit(c, a, `checklist.${body.action}`, id, { requestId: body.requestId, edition: row.edition, reason: body.reason });
      return this.detail(c, a, await this.edition(c, project, id, row.edition));
    });
  }

  private async revise(c: PoolClient, a: Actor, row: Edition, body: { requestId: string; content: { title: string; items: ChecklistItem[] } | null }, role: string) {
    if (!["approved", "returned"].includes(row.status) || role !== "engineer-pto" || row.createdBy !== a.userId) throw httpError(403, "role_denied");
    if ((await c.query(`SELECT 1 FROM checklist_template_editions WHERE template_id=$1 AND status IN ('draft','pending_responsible','in_review','pending_approval')`, [row.templateId])).rowCount) throw httpError(409, "edition_open");
    const edition = row.edition + 1;
    const title = body.content?.title ?? row.title;
    const items = body.content?.items ?? row.items;
    try {
      await c.query(`INSERT INTO checklist_template_editions(tenant_id, project_id, template_id, edition, title, items, status, version, created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',1,$7)`, [a.tenantId, row.projectId, row.templateId, edition, title, JSON.stringify(items), a.userId]);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") throw httpError(409, "edition_open");
      throw error;
    }
    await c.query(`INSERT INTO checklist_template_events(tenant_id, id, project_id, template_id, edition, version, action, from_status, to_status, actor_user_id, actor_role, actor_name, reason, request_id) VALUES($1,$2,$3,$4,$5,1,'revise',$6,'draft',$7,$8,$9,NULL,$10)`, [a.tenantId, randomUUID(), row.projectId, row.templateId, edition, row.status, a.userId, a.role, a.name, body.requestId]);
    await this.audit(c, a, "checklist.revised", row.templateId, { requestId: body.requestId, edition, previous: row.edition });
    return this.detail(c, a, await this.edition(c, row.projectId, row.templateId, edition));
  }

  private async command(a: Actor, project: string, operation: string, body: Record<string, unknown>, work: (c: PoolClient) => Promise<Record<string, unknown>>) {
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const { inserted, hash } = await reserveCommand(c, a, operation, body);
      await this.role(c, a, project, true);
      if (!inserted) return replayCommand(c, a, String(body.requestId), hash);
      const result = await work(c);
      return completeCommand(c, a, String(body.requestId), 201, result);
    });
  }

  private async role(c: PoolClient, a: Actor, project: string | null, lock = false) {
    const member = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' ${lock ? "FOR SHARE" : ""}`, [a.userId])).rows[0];
    if (!member || member.role !== a.role || !roles.includes(member.role)) throw httpError(403, "role_denied");
    if (project) {
      const joined = (await c.query(`SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' ${lock ? "FOR SHARE" : ""}`, [project, a.userId])).rowCount;
      if (!joined) throw httpError(403, "role_denied");
    }
    return member.role as string;
  }

  private async route(c: PoolClient, a: Actor, project: string): Promise<Snapshot> {
    const stored = (await c.query(`SELECT version, configuration FROM route_config_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1`, [project])).rows[0];
    const route = stored?.configuration.routes.find((item: { documentType: string }) => item.documentType === "inspection-template");
    const slot = (items: { role: string; userId: string | null }[] | undefined, role: string) => items?.find((item) => item.role === role && item.userId);
    const preparer = slot(route?.preparers, "engineer-pto");
    const responsible = slot(route?.responsibles, "pto");
    const approver = slot(route?.approvers, "zds-soso");
    const reviewers = ["director", "safety"].map((role) => slot(route?.reviewers, role));
    if (!stored || !preparer || !responsible || !approver || reviewers.some((item) => !item)) throw httpError(422, "route_not_configured");
    const snapshot: Snapshot = { schemaVersion: 1, configurationVersion: stored.version, preparer: { role: "engineer-pto", userId: preparer.userId! }, responsible: { role: "pto", userId: responsible.userId! }, reviewers: reviewers.map((item, index) => ({ role: ["director", "safety"][index]!, userId: item!.userId! })), approver: { role: "zds-soso", userId: approver.userId! } };
    for (const item of [snapshot.preparer, snapshot.responsible, ...snapshot.reviewers, snapshot.approver]) {
      const live = (await c.query(`SELECT 1 FROM memberships m JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id WHERE m.user_id=$1 AND m.role=$2 AND m.status='active' AND pm.project_id=$3 AND pm.status='active'`, [item.userId, item.role, project])).rowCount;
      if (!live) throw httpError(422, "route_participant_inactive");
    }
    return snapshot;
  }

  private preparer(a: Actor, row: Edition) {
    return a.role === "engineer-pto" && (row.routeSnapshot?.preparer.userId ?? row.createdBy) === a.userId;
  }

  private holder(a: Actor, role: string, row: Edition, action: ChecklistDecision, reviewed: string[]) {
    const route = row.routeSnapshot;
    if (!route) return false;
    if (action === "accept") return row.status === "pending_responsible" && role === "pto" && route.responsible.userId === a.userId;
    if (action === "review") return row.status === "in_review" && route.reviewers.some((item) => item.role === role && item.userId === a.userId) && !reviewed.includes(role);
    if (action === "approve") return row.status === "pending_approval" && role === "zds-soso" && route.approver.userId === a.userId && reviewed.length >= 2;
    if (action === "return") {
      if (row.status === "pending_responsible") return role === "pto" && route.responsible.userId === a.userId;
      if (row.status === "in_review") return route.reviewers.some((item) => item.role === role && item.userId === a.userId);
      if (row.status === "pending_approval") return role === "zds-soso" && route.approver.userId === a.userId;
    }
    return false;
  }

  private async reviewedRoles(c: PoolClient, row: Edition) {
    return (await c.query(`SELECT DISTINCT actor_role FROM checklist_template_events WHERE template_id=$1 AND edition=$2 AND action='review'`, [row.templateId, row.edition])).rows.map((item) => item.actor_role as string);
  }

  private async event(c: PoolClient, a: Actor, row: Edition, action: string, status: ChecklistEditionStatus, title: string, items: ChecklistItem[], requestId: string, reason: string | null = null, route: Snapshot | null = row.routeSnapshot) {
    const version = row.version + 1;
    await c.query(`INSERT INTO checklist_template_events(tenant_id, id, project_id, template_id, edition, version, action, from_status, to_status, actor_user_id, actor_role, actor_name, reason, request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [a.tenantId, randomUUID(), row.projectId, row.templateId, row.edition, version, action, row.status, status, a.userId, a.role, a.name, reason, requestId]);
    const updated = await c.query(`UPDATE checklist_template_editions SET title=$4, items=$5, status=$6, version=$7, route_snapshot=COALESCE($8, route_snapshot) WHERE template_id=$1 AND edition=$2 AND version=$3`, [row.templateId, row.edition, row.version, title, JSON.stringify(items), status, version, route ? JSON.stringify(route) : null]);
    if (!updated.rowCount) throw httpError(409, "stale_version");
  }

  private async edition(c: PoolClient, project: string, id: string, edition: number | null): Promise<Edition> {
    const row = (await c.query(`SELECT template_id AS "templateId", project_id AS "projectId", edition, title, items, status, version, route_snapshot AS "routeSnapshot", created_by AS "createdBy" FROM checklist_template_editions WHERE project_id=$1 AND template_id=$2 AND ($3::int IS NULL OR edition=$3) ORDER BY edition DESC LIMIT 1`, [project, id, edition])).rows[0];
    if (!row) throw httpError(404, "not_found");
    return row as Edition;
  }

  private async locked(c: PoolClient, project: string, id: string) {
    const row = await this.edition(c, project, id, null);
    const locked = (await c.query(`SELECT template_id AS "templateId", project_id AS "projectId", edition, title, items, status, version, route_snapshot AS "routeSnapshot", created_by AS "createdBy" FROM checklist_template_editions WHERE template_id=$1 AND edition=$2 FOR UPDATE`, [id, row.edition])).rows[0];
    if (!locked) throw httpError(404, "not_found");
    return locked as Edition;
  }

  private async card(c: PoolClient, a: Actor, row: Edition) {
    const approved = (await c.query(`SELECT edition FROM checklist_template_editions WHERE template_id=$1 AND status='approved' ORDER BY edition DESC LIMIT 1`, [row.templateId])).rows[0];
    return { templateId: row.templateId, edition: row.edition, title: row.title, status: row.status, version: row.version, applicableEdition: approved?.edition ?? null, waiting: await this.waiting(c, a, row) };
  }

  private async waiting(c: PoolClient, a: Actor, row: Edition) {
    const route = row.routeSnapshot;
    if (row.status === "draft" || row.status === "returned") return a.role === "engineer-pto" && a.userId === row.createdBy;
    if (!route) return false;
    if (row.status === "pending_responsible") return route.responsible.userId === a.userId;
    if (row.status === "pending_approval") return route.approver.userId === a.userId;
    if (row.status !== "in_review") return false;
    const done = (await c.query(`SELECT 1 FROM checklist_template_events WHERE template_id=$1 AND edition=$2 AND action='review' AND actor_user_id=$3`, [row.templateId, row.edition, a.userId])).rowCount;
    return !done && route.reviewers.some((item) => item.userId === a.userId);
  }

  private async detail(c: PoolClient, a: Actor, row: Edition) {
    const history = (await c.query(`SELECT version, action, from_status AS "fromStatus", to_status AS "toStatus", actor_role AS "actorRole", actor_name AS "actorName", reason, created_at AS "createdAt" FROM checklist_template_events WHERE template_id=$1 AND edition=$2 ORDER BY version`, [row.templateId, row.edition])).rows;
    const reviewed = history.filter((item) => item.action === "review").map((item) => item.actorRole as string);
    const actions: string[] = [];
    if (row.status === "draft" && this.preparer(a, row)) actions.push("save", "submit");
    for (const action of ["accept", "review", "approve", "return"] as const) if (this.holder(a, a.role, row, action, reviewed)) actions.push(action);
    const open = (await c.query(`SELECT 1 FROM checklist_template_editions WHERE template_id=$1 AND status IN ('draft','pending_responsible','in_review','pending_approval')`, [row.templateId])).rowCount;
    if (["approved", "returned"].includes(row.status) && a.role === "engineer-pto" && row.createdBy === a.userId && !open) actions.push("revise");
    const applicable = (await c.query(`SELECT edition, title, version FROM checklist_template_editions WHERE template_id=$1 AND status='approved' ORDER BY edition DESC LIMIT 1`, [row.templateId])).rows[0] ?? null;
    const editions = (await c.query(`SELECT edition, status, version, title FROM checklist_template_editions WHERE template_id=$1 ORDER BY edition`, [row.templateId])).rows;
    return { ...await this.card(c, a, row), items: row.items, route: row.routeSnapshot, history, allowedActions: actions, applicable, editions };
  }

  private async audit(c: PoolClient, a: Actor, action: string, id: string, details: Record<string, unknown>) {
    await c.query(`INSERT INTO audit_log(tenant_id, actor_user_id, action, object_type, object_id, result, details) VALUES($1,$2,$3,'checklist_template',$4,'ok',$5)`, [a.tenantId, a.userId, action, id, JSON.stringify(details)]);
  }
}
