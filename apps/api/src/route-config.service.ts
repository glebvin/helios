import type {Pool,PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {uuid} from './api-input.js';
import {roleContractAllows} from './role-permissions.js';
import {roleCatalog} from './role-catalog.js';
import {completeCommand,replayCommand,reserveCommand} from './durable-command.js';
import {defaultRouteConfiguration,routeDefinitions,routeConfigCommand,type RouteConfiguration} from './route-config.js';

export class RouteConfigService {
  constructor(private readonly pool:Pool){}
  private async scope(c:PoolClient,a:Actor,projectId:string){
    const membership=(await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' FOR SHARE`,[a.userId])).rows[0];
    const project=(await c.query(`SELECT project_id FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,[projectId,a.userId])).rows[0];
    if(!roleContractAllows({role:membership?.role,tenantId:a.tenantId,projectIds:project?[project.project_id]:[]},'routes.configure',{tenantId:a.tenantId,projectId}))throw httpError(403,'role_denied');
  }
  private async read(c:PoolClient,p:string,version?:number){
    const row=(await c.query(`SELECT version,schema_version AS "schemaVersion",configuration,created_by AS "createdBy",created_at AS "createdAt" FROM route_config_versions WHERE project_id=$1 AND ($2::int IS NULL OR version=$2) ORDER BY version DESC LIMIT 1`,[p,version??null])).rows[0];
    if(!row&&version!==undefined)throw httpError(404,'not_found');
    return row??{version:0,schemaVersion:1,configuration:defaultRouteConfiguration(),createdBy:null,createdAt:null};
  }
  async get(a:Actor,projectId:string,version?:number){
    const p=uuid(projectId);
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.scope(c,a,p);
      const row=await this.read(c,p,version);
      const people=(await c.query(`SELECT m.user_id AS "userId",m.role,u.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id WHERE m.status='active' AND pm.status='active' AND pm.project_id=$1 ORDER BY u.name,m.user_id`,[p])).rows;
      const history=(await c.query(`SELECT version,created_at AS "createdAt" FROM route_config_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 50`,[p])).rows;
      return {...row,projectId:p,documents:routeDefinitions,roles:roleCatalog.map(r=>({code:r.code,label:r.label})),people,history};
    });
  }
  async save(a:Actor,projectId:string,input:unknown){
    const p=uuid(projectId),b=routeConfigCommand(input);
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.scope(c,a,p);
      const {inserted,hash}=await reserveCommand(c,a,`POST /projects/${p}/route-config`,b);
      if(!inserted)return replayCommand(c,a,b.requestId,hash);
      // Lock a stable parent even when there is no first configuration yet.
      await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[p]);
      const before=await this.read(c,p);
      if(before.version!==b.expectedVersion)throw httpError(409,'stale_version');
      await this.assignments(c,p,b.configuration);
      const after=(await c.query(`INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,$3,1,$4,$5) RETURNING project_id AS "projectId",version,schema_version AS "schemaVersion",configuration,created_by AS "createdBy",created_at AS "createdAt"`,[a.tenantId,p,b.expectedVersion+1,JSON.stringify(b.configuration),a.userId])).rows[0];
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'routes.configure','route_configuration',$3,'ok',$4)`,[a.tenantId,a.userId,p,JSON.stringify({requestId:b.requestId,beforeVersion:before.version,afterVersion:after.version})]);
      return completeCommand(c,a,b.requestId,201,after);
    });
  }
  private async assignments(c:PoolClient,p:string,configuration:RouteConfiguration){
    const assignments=configuration.routes.flatMap(({documentType,...row})=>Object.values(row).flat()).filter(x=>x.userId!==null);
    const ids=[...new Set(assignments.map(x=>x.userId))].sort();
    if(!ids.length)return;
    const members=(await c.query(`SELECT user_id,role,status FROM memberships WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE`,[ids])).rows;
    const projects=(await c.query(`SELECT user_id,status FROM project_memberships WHERE project_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR SHARE`,[p,ids])).rows;
    for(const x of assignments)if(!members.some(m=>m.user_id===x.userId&&m.role===x.role&&m.status==='active')||!projects.some(m=>m.user_id===x.userId&&m.status==='active'))throw httpError(422,'route_assignee_denied');
  }
}
