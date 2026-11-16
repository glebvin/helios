import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import { page, uuid, type Page } from './api-input.js';
import { roleContractAllows } from './role-permissions.js';
import { completeCommand, replayCommand, reserveCommand } from './durable-command.js';
import { materialBatchCreate, materialBatchEdit } from './material-batches.js';
import { controlLabels, controlVerdict, materialControlCommand, pinApprovedChecklist, type ControlVerdict } from './material-control.js';
import { defaultRouteConfiguration } from './route-config.js';
import { validateChecklist, type ChecklistAnswer, type ChecklistItem, type ChecklistSnapshot } from '@helios/domain';
import { readEvidenceRequest, type EvidenceBlobStore } from './evidence-storage.js';
import type { EvidenceType } from './evidence-input.js';

type Revision = {
  version: number; materialName: string; unit: string; batchCode: string; supplierName: string;
  deliveryDocument: string; deliveredOn: string; deliveredQuantity: string; createdAt: string;
};
type DocumentRow = { id: string; filename: string; contentType: EvidenceType; sizeBytes: number; sha256: string; state: 'pending' | 'ready' };

/**
 * Партия принадлежит компании, объекту и работодателю.
 * Текущая редакция — максимальная версия. Прежние строки не переписываются.
 * Статус всегда «Ожидает входного контроля»: этим запросом партию нельзя принять.
 * Документ связан с партией. Пока байты не проверены, он не готов.
 */
export class MaterialBatchService {
  constructor(private readonly pool: Pool, private readonly storage: EvidenceBlobStore) {}

  private async membership(c: PoolClient, actor: Actor, projectId: string, write: boolean, lock = write) {
    const role = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active'${lock ? ' FOR SHARE' : ''}`, [actor.userId])).rows[0]?.role as string | undefined;
    const project = (await c.query(`SELECT project_id FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active'${lock ? ' FOR SHARE' : ''}`, [projectId, actor.userId])).rows[0];
    const permission = write ? 'materials.record' : 'materials.read';
    if (!role || role !== actor.role || !roleContractAllows({ role, tenantId: actor.tenantId, projectIds: project ? [project.project_id] : [] }, permission, { tenantId: actor.tenantId, projectId })) throw httpError(403, 'role_denied');
    return role!;
  }

  private async employerIds(c: PoolClient, actor: Actor, role: string) {
    if (role !== 'supply') return null;
    return (await c.query(`SELECT organization_id FROM employees WHERE user_id=$1 AND status='active' FOR SHARE`, [actor.userId])).rows.map((row) => row.organization_id as string);
  }

  private async owns(c: PoolClient, actor: Actor, role: string, organizationId: string) {
    const ids = await this.employerIds(c, actor, role);
    if (ids && !ids.includes(organizationId)) throw httpError(403, 'employer_denied');
  }

  async projects(actor: Actor) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active'`, [actor.userId])).rows[0]?.role as string | undefined;
      if (!role || !['master', 'supply', 'pto', 'director'].includes(role)) throw httpError(403, 'role_denied');
      const projects = (await c.query(
        `SELECT p.id, p.name FROM projects p JOIN project_memberships m ON m.project_id=p.id AND m.user_id=$1 AND m.status='active' ORDER BY p.name, p.id`,
        [actor.userId],
      )).rows;
      return { projects };
    });
  }

  async list(actor: Actor, projectId: string, query: Page, q: string, usable: { zoneId: string; workTypeId: string } | null = null) {
    const project = uuid(projectId);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      const employers = await this.employerIds(c, actor, role);
      const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const filter = `b.project_id=$1 AND ($2='' OR r.material_name ILIKE $3 ESCAPE '\\' OR r.batch_code ILIKE $3 ESCAPE '\\' OR r.supplier_name ILIKE $3 ESCAPE '\\') AND ($4::uuid[] IS NULL OR b.organization_id=ANY($4))
        AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM material_controls mc JOIN material_control_steps s ON s.control_id=mc.id AND s.version=(SELECT max(version) FROM material_control_steps WHERE control_id=mc.id) WHERE mc.batch_id=b.id AND mc.zone_id=$5 AND mc.work_type_id=$6 AND s.verdict='accepted' AND (SELECT batch_version FROM material_control_steps WHERE control_id=mc.id AND action='prepare' ORDER BY version DESC LIMIT 1)=r.version))`;
      const scope = [project, q, like, employers, usable?.zoneId ?? null, usable?.workTypeId ?? null];
      const total = Number((await c.query(
        `SELECT count(*)::int n FROM material_batches b JOIN material_batch_revisions r ON r.batch_id=b.id AND r.version=(SELECT max(version) FROM material_batch_revisions WHERE batch_id=b.id) WHERE ${filter}`,
        scope,
      )).rows[0].n);
      const rows = (await c.query(
        `SELECT b.id, b.organization_id AS "organizationId", o.name AS "organizationName", r.version, r.material_name AS "materialName", r.unit, r.batch_code AS "batchCode", r.supplier_name AS "supplierName", r.delivery_document AS "deliveryDocument", r.delivered_on::text AS "deliveredOn", r.delivered_quantity AS "deliveredQuantity", r.status
         FROM material_batches b JOIN organizations o ON o.id=b.organization_id JOIN material_batch_revisions r ON r.batch_id=b.id AND r.version=(SELECT max(version) FROM material_batch_revisions WHERE batch_id=b.id)
         WHERE ${filter} ORDER BY r.material_name, b.id LIMIT $7 OFFSET $8`,
        [...scope, query.limit, query.offset],
      )).rows;
      const documents = await this.documents(c, project, rows.map((row) => row.id));
      const choices = (await c.query(
        `SELECT id, name FROM organizations WHERE ($1::uuid[] IS NULL OR id=ANY($1)) AND kind<>'customer' ORDER BY name, id`,
        [employers],
      )).rows;
      return { projectId: project, total, limit: query.limit, offset: query.offset, employers: choices, items: rows.map((row) => this.item(project, row, documents.get(row.id) ?? [])) };
    });
  }

  async read(actor: Actor, projectId: string, batchId: string) {
    const project = uuid(projectId);
    const batch = uuid(batchId);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      return this.card(c, actor, role, project, batch);
    });
  }

  async create(actor: Actor, projectId: string, input: unknown) {
    const project = uuid(projectId);
    const command = materialBatchCreate(input);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      const { inserted, hash } = await reserveCommand(c, actor, `POST /projects/${project}/material-batches`, command);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      await this.membership(c, actor, project, true);
      await this.owns(c, actor, role, command.organizationId);
      if (!inserted) return replayCommand(c, actor, command.requestId, hash);
      if (!(await c.query(`SELECT 1 FROM organizations WHERE id=$1 AND kind<>'customer'`, [command.organizationId])).rowCount) throw httpError(404, 'not_found');
      await this.codeFree(c, project, command.organizationId, command.batchCode, null);
      const id = randomUUID();
      await c.query(`INSERT INTO material_batches(tenant_id,project_id,id,organization_id) VALUES($1,$2,$3,$4)`, [actor.tenantId, project, id, command.organizationId]);
      await this.revision(c, actor, project, id, 1, command);
      await this.declare(c, actor, project, id, command.documents);
      await this.audit(c, actor, command.requestId, id, 1);
      return completeCommand(c, actor, command.requestId, 201, await this.card(c, actor, role, project, id));
    });
  }

  async edit(actor: Actor, projectId: string, batchId: string, input: unknown) {
    const project = uuid(projectId);
    const batch = uuid(batchId);
    const command = materialBatchEdit(input);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      const { inserted, hash } = await reserveCommand(c, actor, `POST /projects/${project}/material-batches/${batch}`, command);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      const head = (await c.query(`SELECT organization_id FROM material_batches WHERE project_id=$1 AND id=$2`, [project, batch])).rows[0];
      if (!head) throw httpError(404, 'not_found');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('material-batch'), hashtext($1::text))`, [batch]);
      await this.membership(c, actor, project, true);
      await this.owns(c, actor, role, head.organization_id);
      if (!inserted) return replayCommand(c, actor, command.requestId, hash);
      const current = Number((await c.query(`SELECT max(version) AS version FROM material_batch_revisions WHERE batch_id=$1`, [batch])).rows[0].version);
      if (current !== command.expectedVersion) throw httpError(409, 'stale_version');
      await this.codeFree(c, project, head.organization_id, command.batchCode, batch);
      await this.revision(c, actor, project, batch, current + 1, command);
      await this.declare(c, actor, project, batch, command.documents);
      await this.audit(c, actor, command.requestId, batch, current + 1);
      return completeCommand(c, actor, command.requestId, 201, await this.card(c, actor, role, project, batch));
    });
  }

  async upload(actor: Actor, projectId: string, batchId: string, documentId: string, request: IncomingMessage) {
    const project = uuid(projectId);
    const batch = uuid(batchId);
    const document = uuid(documentId);
    const pending = await withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, true);
      const row = await this.document(c, actor, role, project, batch, document, true);
      if (row.state === 'ready') return row;
      return row;
    });
    if (pending.state === 'ready') {
      request.resume();
      return { id: pending.id, state: pending.state };
    }
    const bytes = await readEvidenceRequest(request, { sizeBytes: pending.sizeBytes, sha256: pending.sha256, contentType: pending.contentType });
    await this.storage.put(actor.tenantId, document, bytes, { sizeBytes: pending.sizeBytes, sha256: pending.sha256, contentType: pending.contentType });
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, true);
      const row = await this.document(c, actor, role, project, batch, document, true);
      if (row.state !== 'ready') {
        await c.query(`UPDATE material_batch_documents SET state='ready' WHERE project_id=$1 AND batch_id=$2 AND id=$3`, [project, batch, document]);
        await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'materials.document','material_batch_document',$3,'ok',$4)`, [actor.tenantId, actor.userId, document, JSON.stringify({ batchId: batch, sha256: row.sha256 })]);
      }
      return { id: document, state: 'ready' };
    });
  }

  async download(actor: Actor, projectId: string, batchId: string, documentId: string) {
    const project = uuid(projectId);
    const batch = uuid(batchId);
    const document = uuid(documentId);
    const row = await withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      const found = await this.document(c, actor, role, project, batch, document);
      if (found.state !== 'ready') throw httpError(409, 'document_pending');
      return found;
    });
    const bytes = await this.storage.get(actor.tenantId, document, { sizeBytes: row.sizeBytes, sha256: row.sha256, contentType: row.contentType });
    await withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const role = await this.membership(c, actor, project, false);
      await this.document(c, actor, role, project, batch, document);
    });
    return { bytes, filename: row.filename, contentType: row.contentType };
  }

  private async codeFree(c: PoolClient, project: string, organization: string, code: string, except: string | null) {
    const clash = (await c.query(
      `SELECT 1 FROM material_batches b JOIN material_batch_revisions r ON r.batch_id=b.id AND r.version=(SELECT max(version) FROM material_batch_revisions WHERE batch_id=b.id)
       WHERE b.project_id=$1 AND b.organization_id=$2 AND lower(r.batch_code)=lower($3) AND ($4::uuid IS NULL OR b.id<>$4)`,
      [project, organization, code, except],
    )).rowCount;
    if (clash) throw httpError(409, 'batch_code_taken');
  }

  private async revision(c: PoolClient, actor: Actor, project: string, batch: string, version: number, command: { materialName: string; unit: string; batchCode: string; supplierName: string; deliveryDocument: string; deliveredOn: string; deliveredQuantity: string }) {
    await c.query(
      `INSERT INTO material_batch_revisions(tenant_id,project_id,batch_id,version,material_name,unit,batch_code,supplier_name,delivery_document,delivered_on,delivered_quantity,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [actor.tenantId, project, batch, version, command.materialName, command.unit, command.batchCode, command.supplierName, command.deliveryDocument, command.deliveredOn, command.deliveredQuantity, actor.userId],
    );
  }

  private async declare(c: PoolClient, actor: Actor, project: string, batch: string, documents: { filename: string; contentType: string; sizeBytes: number; sha256: string }[]) {
    for (const document of documents) {
      await c.query(
        `INSERT INTO material_batch_documents(tenant_id,project_id,batch_id,id,filename,content_type,size_bytes,sha256,state,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
        [actor.tenantId, project, batch, randomUUID(), document.filename, document.contentType, document.sizeBytes, document.sha256, actor.userId],
      );
    }
  }

  private async documents(c: PoolClient, project: string, ids: string[]) {
    const map = new Map<string, DocumentRow[]>();
    if (!ids.length) return map;
    const rows = (await c.query(
      `SELECT batch_id AS "batchId", id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256, state FROM material_batch_documents WHERE project_id=$1 AND batch_id=ANY($2::uuid[]) ORDER BY created_at, id`,
      [project, ids],
    )).rows as (DocumentRow & { batchId: string })[];
    for (const row of rows) {
      const list = map.get(row.batchId) ?? [];
      list.push(row);
      map.set(row.batchId, list);
    }
    return map;
  }

  private item(project: string, row: Record<string, unknown>, documents: DocumentRow[]) {
    return {
      ...row, projectId: project, status: 'awaiting_control', statusLabel: 'Ожидает входного контроля',
      documents: documents.map(({ id, filename, contentType, sizeBytes, sha256, state }) => ({ id, filename, contentType, sizeBytes, sha256, state })),
    };
  }

  private async card(c: PoolClient, actor: Actor, role: string, project: string, batch: string) {
    const row = (await c.query(
      `SELECT b.id, b.organization_id AS "organizationId", o.name AS "organizationName", r.version, r.material_name AS "materialName", r.unit, r.batch_code AS "batchCode", r.supplier_name AS "supplierName", r.delivery_document AS "deliveryDocument", r.delivered_on::text AS "deliveredOn", r.delivered_quantity AS "deliveredQuantity", r.status
       FROM material_batches b JOIN organizations o ON o.id=b.organization_id JOIN material_batch_revisions r ON r.batch_id=b.id AND r.version=(SELECT max(version) FROM material_batch_revisions WHERE batch_id=b.id)
       WHERE b.project_id=$1 AND b.id=$2`,
      [project, batch],
    )).rows[0];
    if (!row) throw httpError(404, 'not_found');
    await this.owns(c, actor, role, row.organizationId);
    const history = (await c.query(
      `SELECT version, material_name AS "materialName", unit, batch_code AS "batchCode", supplier_name AS "supplierName", delivery_document AS "deliveryDocument", delivered_on::text AS "deliveredOn", delivered_quantity AS "deliveredQuantity", created_at AS "createdAt"
       FROM material_batch_revisions WHERE batch_id=$1 ORDER BY version`,
      [batch],
    )).rows as Revision[];
    const documents = (await this.documents(c, project, [batch])).get(batch) ?? [];
    const control = await this.controlView(c, project, batch);
    const intake = await this.intake(c, project);
    return { ...this.item(project, row, documents), history: history.map((item) => ({ ...item, createdAt: new Date(item.createdAt).toISOString() })), control, intake };
  }

  private async document(c: PoolClient, actor: Actor, role: string, project: string, batch: string, document: string, lock = false) {
    const head = (await c.query(`SELECT organization_id FROM material_batches WHERE project_id=$1 AND id=$2`, [project, batch])).rows[0];
    if (!head) throw httpError(404, 'not_found');
    await this.owns(c, actor, role, head.organization_id);
    const row = (await c.query(
      `SELECT id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", sha256, state FROM material_batch_documents WHERE project_id=$1 AND batch_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`,
      [project, batch, document],
    )).rows[0] as DocumentRow | undefined;
    if (!row) throw httpError(404, 'not_found');
    return row;
  }

  async decide(actor: Actor, projectId: string, batchId: string, input: unknown) {
    const project = uuid(projectId);
    const batch = uuid(batchId);
    const command = materialControlCommand(input);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project])).rowCount) throw httpError(404, 'not_found');
      const role = await this.membership(c, actor, project, false, true);
      const operation = `POST /projects/${project}/material-batches/${batch}/control`;
      const { inserted, hash } = await reserveCommand(c, actor, operation, command);
      const head = (await c.query(`SELECT organization_id FROM material_batches WHERE project_id=$1 AND id=$2`, [project, batch])).rows[0];
      if (!head) throw httpError(404, 'not_found');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('material-control'), hashtext($1::text))`, [batch]);
      await this.membership(c, actor, project, false, true);
      await this.owns(c, actor, role, head.organization_id);
      const route = await this.incomingRoute(c, project);
      const allowed = { prepare: route.prepare, data: route.data, responsible: route.responsible, review: route.review }[command.action];
      if (!allowed.includes(role)) throw httpError(403, 'route_denied');
      if (!inserted) return replayCommand(c, actor, command.requestId, hash);
      const current = await this.controlRow(c, project, batch);
      if ((current?.version ?? 0) !== command.expectedVersion) throw httpError(409, 'stale_version');
      if (command.action !== 'prepare' && !current) throw httpError(409, 'control_missing');
      const batchVersion = Number((await c.query(`SELECT max(version) AS version FROM material_batch_revisions WHERE batch_id=$1`, [batch])).rows[0].version);
      if (command.action !== 'prepare' && current?.batchVersion !== batchVersion) throw httpError(409, 'control_outdated');
      if (command.action !== 'prepare' && current?.steps.at(-1)?.verdict === 'accepted') throw httpError(409, 'control_completed');
      let snapshot = current?.snapshot;
      let answers = current?.answers ?? [];
      let controlId = current?.id;
      if (command.action === 'prepare') {
        snapshot = await this.pinTemplate(c, project, command, current);
        await this.bindEvidence(c, project, batch, snapshot, command.answers);
        answers = command.answers;
        if (!controlId) {
          controlId = randomUUID();
          await c.query(
            `INSERT INTO material_controls(tenant_id,project_id,batch_id,id,zone_id,work_type_id,template_id,edition,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [actor.tenantId, project, batch, controlId, command.zoneId, command.workTypeId, command.templateId, snapshot.templateVersion, JSON.stringify(snapshot), actor.userId],
          );
        }
      }
      const checklist = validateChecklist(snapshot!, answers);
      if (checklist.refused && command.action !== 'prepare' && !(command.action === 'review' && command.decision === 'return')) throw httpError(409, 'control_refused');
      const steps = [...(current?.steps ?? []), { action: command.action, decision: 'decision' in command ? command.decision : null, dataMark: 'dataMark' in command ? command.dataMark : null }];
      const verdict = controlVerdict(checklist, steps);
      if (command.action === 'review' && command.decision === 'agree' && verdict !== 'accepted') throw httpError(409, 'route_incomplete');
      await c.query(
        `INSERT INTO material_control_steps(tenant_id,project_id,control_id,version,action,answers,data_mark,decision,verdict,actor_user_id,actor_role,reason,request_id,snapshot,batch_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [actor.tenantId, project, controlId, command.expectedVersion + 1, command.action, command.action === 'prepare' ? JSON.stringify(answers) : null, 'dataMark' in command ? command.dataMark : null, 'decision' in command ? command.decision : null, verdict, actor.userId, role, 'reason' in command ? command.reason : null, command.requestId, command.action === 'prepare' ? JSON.stringify(snapshot) : null, command.action === 'prepare' ? batchVersion : null],
      );
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'materials.control','material_batch',$3,'ok',$4)`, [actor.tenantId, actor.userId, batch, JSON.stringify({ requestId: command.requestId, version: command.expectedVersion + 1, verdict })]);
      return completeCommand(c, actor, command.requestId, 201, await this.card(c, actor, role, project, batch));
    });
  }

  private async incomingRoute(c: PoolClient, project: string) {
    const stored = (await c.query(`SELECT configuration FROM route_config_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1`, [project])).rows[0]?.configuration;
    const routes = stored?.routes ?? defaultRouteConfiguration().routes;
    const route = routes.find((item: { documentType: string }) => item.documentType === 'incoming-materials');
    if (!route) throw httpError(422, 'route_not_configured');
    const names = (slot: string) => ((route[slot] ?? []) as { role: string }[]).map((item) => item.role);
    return { prepare: names('preparers'), data: names('dataProviders'), responsible: names('responsibles'), review: names('reviewers') };
  }

  private async pinTemplate(c: PoolClient, project: string, command: { zoneId: string; workTypeId: string; templateId: string }, current: { zoneId: string; workTypeId: string; templateId: string; snapshot: ChecklistSnapshot } | null) {
    if (!(await c.query(`SELECT 1 FROM project_work_zones WHERE project_id=$1 AND id=$2 AND status='active'`, [project, command.zoneId])).rowCount) throw httpError(404, 'not_found');
    if (!(await c.query(`SELECT 1 FROM project_work_types WHERE project_id=$1 AND id=$2 AND status='active'`, [project, command.workTypeId])).rowCount) throw httpError(404, 'not_found');
    if (current) {
      if (current.zoneId !== command.zoneId || current.workTypeId !== command.workTypeId || current.templateId !== command.templateId) throw httpError(409, 'control_scope');
    }
    const edition = (await c.query(`SELECT edition, items FROM checklist_template_editions WHERE project_id=$1 AND template_id=$2 AND status='approved' ORDER BY edition DESC LIMIT 1`, [project, command.templateId])).rows[0];
    if (!edition) throw httpError(404, 'template_not_approved');
    return pinApprovedChecklist(command.templateId, edition.edition, edition.items as ChecklistItem[]);
  }

  private async bindEvidence(c: PoolClient, project: string, batch: string, snapshot: ChecklistSnapshot, answers: ChecklistAnswer[]) {
    for (const item of snapshot.items) {
      const answer = answers.find((row) => row.itemId === item.id);
      if (!answer) continue;
      if (item.kind === 'batch' && answer.value !== batch) throw httpError(422, 'batch_mismatch');
      if (item.kind === 'document' || item.kind === 'photo') {
        const document = uuid(answer.value);
        const ready = (await c.query(`SELECT content_type FROM material_batch_documents WHERE project_id=$1 AND batch_id=$2 AND id=$3 AND state='ready'`, [project, batch, document])).rows[0];
        if (!ready || (item.kind === 'photo' ? !String(ready.content_type).startsWith('image/') : ready.content_type !== 'application/pdf')) throw httpError(422, 'document_not_ready');
      }
    }
  }

  private async controlRow(c: PoolClient, project: string, batch: string) {
    const row = (await c.query(`SELECT id, zone_id AS "zoneId", work_type_id AS "workTypeId", template_id AS "templateId", edition, snapshot FROM material_controls WHERE project_id=$1 AND batch_id=$2`, [project, batch])).rows[0] as { id: string; zoneId: string; workTypeId: string; templateId: string; edition: number; snapshot: ChecklistSnapshot } | undefined;
    if (!row) return null;
    const steps = (await c.query(`SELECT version, action, answers, snapshot, batch_version AS "batchVersion", data_mark AS "dataMark", decision, verdict, actor_role AS "actorRole", reason, created_at AS "createdAt" FROM material_control_steps WHERE control_id=$1 ORDER BY version`, [row.id])).rows as { version: number; action: 'prepare' | 'data' | 'responsible' | 'review'; answers: ChecklistAnswer[] | null; snapshot: ChecklistSnapshot | null; batchVersion: number | null; dataMark: string | null; decision: string | null; verdict: ControlVerdict; actorRole: string; reason: string | null; createdAt: string }[];
    const prepared = [...steps].reverse().find((step) => step.action === 'prepare');
    return { ...row, snapshot: prepared?.snapshot ?? row.snapshot, edition: prepared?.snapshot?.templateVersion ?? row.edition, batchVersion: prepared?.batchVersion ?? 0, version: steps.at(-1)?.version ?? 0, steps, answers: prepared?.answers ?? [] };
  }

  private async controlView(c: PoolClient, project: string, batch: string) {
    const row = await this.controlRow(c, project, batch);
    if (!row) return null;
    const batchVersion = Number((await c.query(`SELECT max(version) AS version FROM material_batch_revisions WHERE batch_id=$1`, [batch])).rows[0].version);
    const verdict = row.batchVersion === batchVersion ? row.steps.at(-1)?.verdict ?? 'awaiting' : 'awaiting';
    return {
      id: row.id, version: row.version, zoneId: row.zoneId, workTypeId: row.workTypeId, templateId: row.templateId, edition: row.edition,
      verdict, verdictLabel: controlLabels[verdict], items: row.snapshot.items,
      steps: row.steps.map((step) => ({ ...step, createdAt: new Date(step.createdAt).toISOString(), answers: step.answers ?? [] })),
    };
  }

  private async intake(c: PoolClient, project: string) {
    const zones = (await c.query(`SELECT id, name FROM project_work_zones WHERE project_id=$1 AND status='active' ORDER BY name, id`, [project])).rows;
    const workTypes = (await c.query(`SELECT id, name FROM project_work_types WHERE project_id=$1 AND status='active' ORDER BY name, id`, [project])).rows;
    const templates = (await c.query(
      `SELECT template_id AS id, title, edition, items FROM checklist_template_editions e WHERE project_id=$1 AND status='approved' AND edition=(SELECT max(edition) FROM checklist_template_editions WHERE template_id=e.template_id AND status='approved') ORDER BY title, template_id`,
      [project],
    )).rows;
    return { zones, workTypes, templates };
  }

  private async audit(c: PoolClient, actor: Actor, requestId: string, batch: string, version: number) {
    await c.query(
      `INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'materials.record','material_batch',$3,'ok',$4)`,
      [actor.tenantId, actor.userId, batch, JSON.stringify({ requestId, version })],
    );
  }
}

export function materialPage(query: Record<string, unknown>) {
  return page(query);
}
