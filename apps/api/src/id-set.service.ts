import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';
import { idSetInput } from './id-set.js';

type Row = Record<string, any>;

export class IdSetService {
  constructor(private readonly pool: Pool) {}

  list(actor: Actor, projectId: string) {
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      await this.visible(client, actor, projectId);
      const rows = await this.rows(client, actor, projectId);
      return { items: rows.map(item => this.shape(item)) };
    });
  }

  write(actor: Actor, projectId: string, workTypeId: string, input: unknown) {
    const command = idSetInput(input);
    const operation = `POST /projects/${projectId}/work-types/${workTypeId}/id-set`;
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      const receipt = await reserveCommand(client, actor, operation, command);
      if (!(await client.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`, [actor.tenantId, projectId])).rowCount) throw httpError(404, 'not_found');
      const role = await this.visible(client, actor, projectId);
      if (!receipt.inserted) return replayCommand(client, actor, command.requestId, receipt.hash);
      if (role !== 'engineer-pto') throw httpError(403, 'role_denied');
      const preparer = await this.preparer(client, actor, projectId);
      if (preparer && preparer !== actor.userId) throw httpError(403, 'route_denied');
      const type = (await client.query(`SELECT id, name, unit FROM project_work_types WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status='active' FOR NO KEY UPDATE`, [actor.tenantId, projectId, workTypeId])).rows[0];
      if (!type) throw httpError(404, 'not_found');
      const current = Number((await client.query(`SELECT coalesce(max(version),0)::int n FROM id_set_versions WHERE tenant_id=$1 AND project_id=$2 AND work_type_id=$3`, [actor.tenantId, projectId, workTypeId])).rows[0].n);
      if (current !== command.expectedVersion) throw httpError(409, 'stale_version');
      const version = current + 1;
      await client.query(`INSERT INTO id_set_versions(tenant_id,project_id,work_type_id,version,titles,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [actor.tenantId, projectId, workTypeId, version, JSON.stringify(command.titles), actor.userId, command.requestId]);
      return completeCommand(client, actor, command.requestId, 201, this.shape({ ...type, version, titles: command.titles }));
    });
  }

  private shape(row: Row) {
    return { workTypeId: row.id, name: row.name, unit: row.unit, version: Number(row.version), titles: row.titles as string[] };
  }

  private async rows(client: PoolClient, actor: Actor, projectId: string) {
    return (await client.query(`SELECT t.id, t.name, t.unit, coalesce(s.version,0) AS version, coalesce(s.titles,'[]'::jsonb) AS titles FROM project_work_types t LEFT JOIN LATERAL (SELECT version, titles FROM id_set_versions WHERE tenant_id=t.tenant_id AND project_id=t.project_id AND work_type_id=t.id ORDER BY version DESC LIMIT 1) s ON true WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.status='active' ORDER BY t.name, t.id`, [actor.tenantId, projectId])).rows;
  }

  private async visible(client: PoolClient, actor: Actor, projectId: string) {
    if (!(await client.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, projectId])).rowCount) throw httpError(404, 'not_found');
    const member = (await client.query(`SELECT role, status FROM memberships WHERE tenant_id=$1 AND user_id=$2`, [actor.tenantId, actor.userId])).rows[0];
    if (!member || member.status !== 'active' || member.role !== actor.role || !['engineer-pto', 'pto'].includes(member.role)) throw httpError(403, 'role_denied');
    if (!(await client.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`, [actor.tenantId, projectId, actor.userId])).rowCount) throw httpError(404, 'not_found');
    return member.role as 'engineer-pto' | 'pto';
  }

  private async preparer(client: PoolClient, actor: Actor, projectId: string) {
    const stored = (await client.query(`SELECT configuration FROM route_config_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`, [actor.tenantId, projectId])).rows[0];
    const route = stored?.configuration?.routes?.find((item: { documentType?: string }) => item.documentType === 'documentation-list');
    const userId = route?.preparers?.[0]?.userId;
    return typeof userId === 'string' ? userId : null;
  }
}
