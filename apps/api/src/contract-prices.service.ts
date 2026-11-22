import type { Pool, PoolClient } from 'pg';
import { conflictingPrices, validateContractPrice, type ContractPrice } from '@helios/domain';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import { uuid } from './api-input.js';
import { object } from './people-input.js';
import { roleContractAllows } from './role-permissions.js';
import { completeCommand, replayCommand, reserveCommand } from './durable-command.js';
import { contractPriceCommand, priceImportRows, type PriceImportRow } from './contract-prices.js';

type Revision = { version: number; unit: string; price: string; start: string; end: string; createdAt: string };

/**
 * Действующая редакция — единственная строка вида работ, чей период включает дату компании
 * и чья единица совпадает с текущей единицей вида работ. Её нет — это не цена 0.
 * Исправление добавляет version = expectedVersion + 1 и не переписывает историю.
 * Старый номер остаётся доступным для повторения прежнего расчёта.
 * Две редакции одной единицы с пересечением периодов одновременно не действуют.
 */
export class ContractPriceService {
  constructor(private readonly pool: Pool) {}

  private async scope(c: PoolClient, actor: Actor, projectId?: string, lock = false) {
    const membership = (await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' ${lock ? 'FOR SHARE' : ''}`, [actor.userId])).rows[0];
    const project = projectId
      ? (await c.query(`SELECT project_id FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' ${lock ? 'FOR SHARE' : ''}`, [projectId, actor.userId])).rows[0]
      : undefined;
    const allowed = roleContractAllows(
      { role: membership?.role, tenantId: actor.tenantId, projectIds: project ? [project.project_id] : [] },
      'prices.maintain',
      { tenantId: actor.tenantId, ...(projectId ? { projectId } : {}) },
    );
    if (!allowed) throw httpError(403, 'role_denied');
  }

  async projects(actor: Actor) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      await this.scope(c, actor);
      const projects = (await c.query(
        `SELECT p.id, p.name FROM projects p
         JOIN project_memberships m ON m.project_id=p.id AND m.user_id=$1 AND m.status='active'
         ORDER BY p.name, p.id`,
        [actor.userId],
      )).rows;
      return { projects };
    });
  }

  async read(actor: Actor, projectId: string) {
    const project = uuid(projectId);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      await this.scope(c, actor, project);
      return this.registry(c, actor.tenantId, project);
    });
  }

  async save(actor: Actor, projectId: string, input: unknown) {
    const project = uuid(projectId);
    const command = contractPriceCommand(input);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      await this.scope(c, actor, project);
      const operation = `POST /projects/${project}/contract-prices`;
      const { inserted, hash } = await reserveCommand(c, actor, operation, command);
      const locked = await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project]);
      if (!locked.rowCount) throw httpError(404, 'not_found');
      await this.scope(c, actor, project, true);
      if (!inserted) return replayCommand(c, actor, command.requestId, hash);
      const work = (await c.query(
        `SELECT id, unit, status FROM project_work_types WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE`,
        [project, command.workTypeId],
      )).rows[0];
      if (!work) throw httpError(404, 'not_found');
      if (work.status !== 'active') throw httpError(422, 'reference_denied');
      const stored = (await c.query(
        `SELECT version, unit, price, period_start::text AS start, period_end::text AS "end"
         FROM contract_price_revisions WHERE project_id=$1 AND work_type_id=$2 ORDER BY version`,
        [project, command.workTypeId],
      )).rows as { version: number; unit: string; price: string; start: string; end: string }[];
      const head = stored.at(-1)?.version ?? 0;
      if (head !== command.expectedVersion) throw httpError(409, 'stale_version');
      const next: ContractPrice = {
        projectId: project,
        workTypeId: command.workTypeId,
        unit: work.unit,
        price: command.price,
        start: command.start,
        end: command.end,
        version: command.expectedVersion + 1,
      };
      const issue = validateContractPrice(next);
      if (issue) throw httpError(400, issue);
      const prior = stored.map((row) => ({ ...row, projectId: project, workTypeId: command.workTypeId }));
      const conflict = conflictingPrices([...prior, next])[0];
      if (conflict) throw httpError(409, conflict.reason === 'version' ? 'price_version' : 'price_period');
      const saved = (await c.query(
        `INSERT INTO contract_price_revisions(tenant_id,project_id,work_type_id,version,unit,price,period_start,period_end,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING project_id AS "projectId", work_type_id AS "workTypeId", version, unit, price, period_start::text AS start, period_end::text AS "end"`,
        [actor.tenantId, project, command.workTypeId, next.version, next.unit, next.price, next.start, next.end, actor.userId],
      )).rows[0];
      await c.query(
        `INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details)
         VALUES($1,$2,'prices.record','contract_price',$3,'ok',$4)`,
        [actor.tenantId, actor.userId, command.workTypeId, JSON.stringify({ requestId: command.requestId, projectId: project, version: saved.version, price: saved.price, start: saved.start, end: saved.end })],
      );
      return completeCommand(c, actor, command.requestId, 201, saved);
    });
  }

  checkImport(actor: Actor, projectId: string, input: unknown) {
    const project = uuid(projectId);
    const rows = priceImportRows(input);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      await this.scope(c, actor, project);
      if (!(await c.query(`SELECT id FROM projects WHERE id=$1`, [project])).rowCount) throw httpError(404, 'not_found');
      const preview = await this.assess(c, project, rows);
      return { acceptable: preview.acceptable, rows: preview.rows };
    });
  }

  importPrices(actor: Actor, projectId: string, input: unknown) {
    const project = uuid(projectId);
    const envelope = object(input, ['requestId', 'rows']);
    const requestId = uuid(envelope.requestId).toLowerCase();
    const parsed = priceImportRows({ rows: envelope.rows });
    const command = { requestId, rows: parsed.map(({ line, workTypeName, price, start, end }) => ({ line, workTypeName, price, start, end })) };
    return withTenant(this.pool, actor.tenantId, actor.userId, async (c) => {
      const operation = `POST /projects/${project}/contract-prices/imports`;
      const { inserted, hash } = await reserveCommand(c, actor, operation, command);
      const locked = await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`, [project]);
      if (!locked.rowCount) throw httpError(404, 'not_found');
      await this.scope(c, actor, project, true);
      if (!inserted) return replayCommand(c, actor, requestId, hash);
      const preview = await this.assess(c, project, parsed);
      if (!preview.acceptable) throw httpError(422, 'price_import_rejected');
      const saved = [];
      try {
        for (const row of preview.ready) {
          const version = row.headVersion + 1;
          saved.push((await c.query(
            `INSERT INTO contract_price_revisions(tenant_id,project_id,work_type_id,version,unit,price,period_start,period_end,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING work_type_id AS "workTypeId", version, unit, price, period_start::text AS start, period_end::text AS "end"`,
            [actor.tenantId, project, row.workTypeId, version, row.unit, row.price, row.start, row.end, actor.userId],
          )).rows[0]);
        }
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw httpError(409, 'conflict');
        throw error;
      }
      await c.query(
        `INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details)
         VALUES($1,$2,'prices.import','project',$3,'ok',$4)`,
        [actor.tenantId, actor.userId, project, JSON.stringify({ requestId, count: saved.length })],
      );
      return completeCommand(c, actor, requestId, 201, { revisions: saved });
    });
  }

  private async assess(c: PoolClient, project: string, parsed: PriceImportRow[]) {
    const works = (await c.query(`SELECT id, name, unit, status FROM project_work_types WHERE project_id=$1`, [project])).rows as { id: string; name: string; unit: string; status: string }[];
    const stored = (await c.query(
      `SELECT work_type_id AS "workTypeId", version, unit, price, period_start::text AS start, period_end::text AS "end" FROM contract_price_revisions WHERE project_id=$1`,
      [project],
    )).rows as { workTypeId: string; version: number; unit: string; price: string; start: string; end: string }[];
    const names = new Map<string, number>();
    for (const row of parsed) if (!row.error) names.set(row.workTypeName, (names.get(row.workTypeName) ?? 0) + 1);
    const ready: { workTypeId: string; unit: string; price: string; start: string; end: string; headVersion: number }[] = [];
    const rows = parsed.map((row) => {
      if (row.error) return { ...row, workTypeId: null, unit: null };
      if ((names.get(row.workTypeName) ?? 0) > 1) return { ...row, workTypeId: null, unit: null, error: 'duplicate_work_type' };
      const matches = works.filter((work) => work.name === row.workTypeName);
      if (matches.length !== 1) return { ...row, workTypeId: null, unit: null, error: matches.length === 0 ? 'unknown_work_type' : 'ambiguous_work_type' };
      const work = matches[0];
      if (work.status !== 'active') return { ...row, workTypeId: work.id, unit: work.unit, error: 'archived_work_type' };
      const history = stored.filter((item) => item.workTypeId === work.id);
      const headVersion = history.reduce((max, item) => Math.max(max, item.version), 0);
      ready.push({ workTypeId: work.id, unit: work.unit, price: row.price, start: row.start, end: row.end, headVersion });
      return { ...row, workTypeId: work.id, unit: work.unit };
    });
    const candidates = ready.map((row) => ({ projectId: project, workTypeId: row.workTypeId, unit: row.unit, price: row.price, start: row.start, end: row.end, version: row.headVersion + 1 }));
    const prior = stored.map((row) => ({ projectId: project, ...row }));
    for (const conflict of conflictingPrices([...prior, ...candidates])) {
      if (conflict.reason !== 'period' && conflict.reason !== 'version') continue;
      const hit = rows.find((row) => row.workTypeId === conflict.left.workTypeId && row.start === conflict.left.start && row.end === conflict.left.end && !row.error)
        ?? rows.find((row) => row.workTypeId === conflict.right.workTypeId && row.start === conflict.right.start && row.end === conflict.right.end && !row.error);
      if (hit) hit.error = conflict.reason === 'version' ? 'price_version' : 'price_period';
    }
    const accepted = rows.filter((row) => !row.error);
    return { acceptable: accepted.length === rows.length, rows: rows.map(({ line, workTypeName, workTypeId, unit, price, start, end, error }) => ({ line, workTypeName, workTypeId, unit, price, start, end, error })), ready: ready.filter((row) => accepted.some((item) => item.workTypeId === row.workTypeId && item.start === row.start)) };
  }

  private async registry(c: PoolClient, tenantId: string, projectId: string) {
    const asOf = (await c.query(`SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM tenants WHERE id=$1`, [tenantId])).rows[0]?.day as string;
    if (!asOf) throw httpError(404, 'not_found');
    const workTypes = (await c.query(
      `SELECT id, name, unit, status FROM project_work_types WHERE project_id=$1 ORDER BY name, id`,
      [projectId],
    )).rows as { id: string; name: string; unit: string; status: string }[];
    const revisions = (await c.query(
      `SELECT work_type_id AS "workTypeId", version, unit, price, period_start::text AS start, period_end::text AS "end", created_at AS "createdAt"
       FROM contract_price_revisions WHERE project_id=$1 ORDER BY work_type_id, version`,
      [projectId],
    )).rows as (Revision & { workTypeId: string; createdAt: Date })[];
    return {
      projectId,
      asOf,
      workTypes: workTypes.map((work) => {
        const history = revisions.filter((row) => row.workTypeId === work.id).map((row) => ({
          version: row.version, unit: row.unit, price: row.price, start: row.start, end: row.end, createdAt: new Date(row.createdAt).toISOString(),
        }));
        const acting = history.filter((row) => row.unit === work.unit && row.start <= asOf && asOf <= row.end);
        return { ...work, headVersion: history.at(-1)?.version ?? 0, acting: acting.length === 1 ? acting[0] : null, revisions: history };
      }),
    };
  }
}
