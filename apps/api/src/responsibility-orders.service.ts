import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "./workforce.service.js";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { day, queryInput, uuid } from "./api-input.js";
import { roleContractAllows } from "./role-permissions.js";
import { completeCommand, replayCommand, reserveCommand } from "./durable-command.js";
import {
  documentTypeCatalog,
  expiringWithin30Days,
  orderApplies,
  responsibilityOrderCorrect,
  responsibilityOrderCreate,
  responsibilityOrderRevoke,
  type ResponsibilityOrderFact,
} from "./responsibility-orders.js";

const fields = `o.id,o.employee_id AS "employeeId",e.full_name AS "employeeName",o.organization_id AS "organizationId",g.name AS "organizationName",o.project_id AS "projectId",p.name AS "projectName",o.document_types AS "documentTypes",o.order_number AS "orderNumber",o.order_date::text AS "orderDate",o.valid_from::text AS "validFrom",o.valid_until::text AS "validUntil",o.status,o.revocation_reason AS "revocationReason",o.version`;
const joined = `responsibility_orders o JOIN employees e ON e.tenant_id=o.tenant_id AND e.id=o.employee_id JOIN organizations g ON g.tenant_id=o.tenant_id AND g.id=o.organization_id JOIN projects p ON p.tenant_id=o.tenant_id AND p.id=o.project_id`;

type OrderRow = {
  id: string; employeeId: string; employeeName: string; organizationId: string; organizationName: string;
  projectId: string; projectName: string; documentTypes: string[]; orderNumber: string; orderDate: string;
  validFrom: string; validUntil: string; status: "active" | "revoked"; revocationReason: string | null; version: number;
};

export class ResponsibilityOrdersService {
  constructor(private readonly pool: Pool) {}

  private async scope(c: PoolClient, a: Actor, projectId: string, organizationId?: string) {
    const membership = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' FOR SHARE`, [a.userId])).rows[0];
    const projects = (await c.query(`SELECT id FROM projects ORDER BY id`)).rows.map((row) => row.id as string);
    const employers = (await c.query(`SELECT id FROM organizations ORDER BY id`)).rows.map((row) => row.id as string);
    if (!roleContractAllows({
      role: membership?.role, tenantId: a.tenantId, projectIds: projects, employerIds: employers,
    }, "orders.manage", { tenantId: a.tenantId, projectId, employerId: organizationId })) throw httpError(403, "role_denied");
  }

  private async today(c: PoolClient) {
    const row = (await c.query(`SELECT to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS today FROM tenants`)).rows[0];
    if (!row?.today) throw httpError(404, "not_found");
    return row.today as string;
  }

  private present(row: OrderRow, today: string, history?: { version: number; action: string; createdAt: string }[]) {
    return {
      ...row,
      revocationReason: row.revocationReason,
      expiringWithin30Days: expiringWithin30Days(row.status, row.validUntil, today),
      ...(history ? { history } : {}),
    };
  }

  private async history(c: PoolClient, id: string) {
    const rows = (await c.query(`SELECT version,action,created_at AS "createdAt" FROM responsibility_order_revisions WHERE order_id=$1 ORDER BY version`, [id])).rows;
    return rows.map((row) => ({ version: row.version as number, action: row.action as string, createdAt: new Date(row.createdAt).toISOString() }));
  }

  private async one(c: PoolClient, id: string, lock = false) {
    const row = (await c.query(`SELECT ${fields} FROM ${joined} WHERE o.id=$1${lock ? " FOR NO KEY UPDATE OF o" : ""}`, [id])).rows[0] as OrderRow | undefined;
    if (!row) throw httpError(404, "not_found");
    return row;
  }

  async list(a: Actor, projectId?: string) {
    const project = projectId ? uuid(projectId).toLowerCase() : null;
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      await this.scope(c, a, project ?? undefined);
      const today = await this.today(c);
      const items = (await c.query(`SELECT ${fields} FROM ${joined} WHERE ($1::uuid IS NULL OR o.project_id=$1) ORDER BY o.valid_until,o.order_number,o.id`, [project])).rows as OrderRow[];
      const employees = (await c.query(`SELECT e.id,e.full_name AS name,e.organization_id AS "organizationId",g.name AS "organizationName" FROM employees e JOIN organizations g ON g.tenant_id=e.tenant_id AND g.id=e.organization_id WHERE e.status='active' ORDER BY e.full_name,e.id LIMIT 500`)).rows;
      const projects = (await c.query(`SELECT id,name FROM projects ORDER BY name,id LIMIT 200`)).rows;
      return { today, projectId: project, items: items.map((row) => this.present(row, today)), catalog: { employees, projects, documentTypes: documentTypeCatalog() } };
    });
  }

  async read(a: Actor, id: string) {
    const orderId = uuid(id).toLowerCase();
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const row = await this.one(c, orderId);
      await this.scope(c, a, row.projectId, row.organizationId);
      return this.present(row, await this.today(c), await this.history(c, orderId));
    });
  }

  async applicability(a: Actor, query: Record<string, unknown>) {
    queryInput(query, ["employeeId", "organizationId", "projectId", "documentType", "on"]);
    const employeeId = uuid(query.employeeId).toLowerCase();
    const organizationId = uuid(query.organizationId).toLowerCase();
    const projectId = uuid(query.projectId).toLowerCase();
    const documentType = typeof query.documentType === "string" ? query.documentType : "";
    const on = day(query.on);
    if (!on || !documentTypeCatalog().some((item) => item.code === documentType)) throw httpError(400, "invalid_query");
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      await this.scope(c, a, projectId, organizationId);
      const rows = (await c.query(`SELECT id,employee_id AS "employeeId",organization_id AS "organizationId",project_id AS "projectId",document_types AS "documentTypes",valid_from::text AS "validFrom",valid_until::text AS "validUntil",status FROM responsibility_orders WHERE employee_id=$1 ORDER BY version,id`, [employeeId])).rows as ResponsibilityOrderFact[];
      return orderApplies(rows, { employeeId, organizationId, projectId, documentType, on });
    });
  }

  async create(a: Actor, input: unknown) {
    const body = responsibilityOrderCreate(input);
    return this.command(a, `POST /responsibility-orders`, body, async (c) => {
      await this.scope(c, a, body.projectId, body.organizationId);
      const employee = (await c.query(`SELECT organization_id,status FROM employees WHERE id=$1 FOR SHARE`, [body.employeeId])).rows[0];
      if (!employee) throw httpError(404, "not_found");
      if (employee.organization_id !== body.organizationId) throw httpError(422, "employee_company");
      if (employee.status !== "active") throw httpError(422, "employee_archived");
      const id = randomUUID();
      const row = (await c.query(`INSERT INTO responsibility_orders(tenant_id,id,organization_id,project_id,employee_id,order_number,order_date,valid_from,valid_until,document_types,status,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',1) RETURNING id`, [a.tenantId, id, body.organizationId, body.projectId, body.employeeId, body.orderNumber, body.orderDate, body.validFrom, body.validUntil, body.documentTypes])).rows[0];
      return this.saved(c, a, row.id, "created", null);
    });
  }

  async correct(a: Actor, id: string, input: unknown) {
    const orderId = uuid(id).toLowerCase();
    const body = responsibilityOrderCorrect(input);
    return this.command(a, `POST /responsibility-orders/${orderId}`, body, async (c) => {
      const current = await this.one(c, orderId, true);
      await this.scope(c, a, current.projectId, current.organizationId);
      if (current.version !== body.expectedVersion) throw httpError(409, "stale_version");
      if (current.status !== "active") throw httpError(409, "order_revoked");
      await c.query(`UPDATE responsibility_orders SET order_number=$2,order_date=$3,valid_from=$4,valid_until=$5,document_types=$6,version=version+1 WHERE id=$1`, [orderId, body.orderNumber, body.orderDate, body.validFrom, body.validUntil, body.documentTypes]);
      return this.saved(c, a, orderId, "corrected", current);
    });
  }

  async revoke(a: Actor, id: string, input: unknown) {
    const orderId = uuid(id).toLowerCase();
    const body = responsibilityOrderRevoke(input);
    return this.command(a, `POST /responsibility-orders/${orderId}/revoke`, body, async (c) => {
      const current = await this.one(c, orderId, true);
      await this.scope(c, a, current.projectId, current.organizationId);
      if (current.version !== body.expectedVersion) throw httpError(409, "stale_version");
      if (current.status !== "active") throw httpError(409, "order_revoked");
      await c.query(`UPDATE responsibility_orders SET status='revoked',revocation_reason=$2,version=version+1 WHERE id=$1`, [orderId, body.reason]);
      return this.saved(c, a, orderId, "revoked", current);
    });
  }

  private async saved(c: PoolClient, a: Actor, id: string, action: string, before: OrderRow | null) {
    const today = await this.today(c);
    const after = this.present(await this.one(c, id), today);
    await c.query(`INSERT INTO responsibility_order_revisions(tenant_id,order_id,version,action,snapshot,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`, [a.tenantId, id, after.version, action, JSON.stringify(after), a.userId]);
    await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,$3,'responsibility_order',$4,'ok',$5)`, [a.tenantId, a.userId, `orders.${action}`, id, JSON.stringify({ before, after })]);
    return this.present(await this.one(c, id), today, await this.history(c, id));
  }

  private async command(a: Actor, operation: string, body: Record<string, unknown>, apply: (c: PoolClient) => Promise<Record<string, unknown>>) {
    return withTenant(this.pool, a.tenantId, a.userId, async (c) => {
      const { inserted, hash } = await reserveCommand(c, a, operation, body);
      if (!inserted) return replayCommand(c, a, String(body.requestId), hash);
      return completeCommand(c, a, String(body.requestId), 201, await apply(c));
    });
  }
}
