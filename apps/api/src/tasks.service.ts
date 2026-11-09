import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import type {Page} from './api-input.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {DirectorApiService,taskFields} from './director-api.service.js';
import {catalogInput,taskInput} from './task-input.js';
import {reserveCommand,replayCommand,completeCommand,type CommandResult} from './durable-command.js';
type Row=Record<string,any>;
type Catalog='zones'|'work-types';
const catalogs={zones:'project_work_zones','work-types':'project_work_types'} as const;
function catalogFields(kind:Catalog) {return `id,project_id AS "projectId",name,version,status${kind==='work-types'?`,unit,requires_rd AS "requiresRd",requires_material_control AS "requiresMaterialControl",requires_predecessor_acceptance AS "requiresPredecessorAcceptance",requires_id AS "requiresId"`:''}`;}
export class TasksService {
  constructor(private readonly pool:Pool,private readonly api:DirectorApiService) {}
  private with<T>(a:Actor,f:(c:PoolClient)=>Promise<T>) {return withTenant(this.pool,a.tenantId,a.userId,f);}
  private version(row:Row|undefined,expected:number) {if(!row || row.version!==expected)throw httpError(409,'stale_version');}
  private async projectLock(c:PoolClient,a:Actor,p:string) {
    if(!(await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,p])).rowCount)throw httpError(404,'not_found');
  }
  private async memberLocks(c:PoolClient,a:Actor,p:string,ids:(string|null|undefined)[]) {
    const unique=[...new Set(ids.filter(Boolean))].sort();
    await c.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,unique]);
    await c.query(`SELECT user_id FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=ANY($3::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,p,unique]);
  }
  // Always a fresh statement after lock waits: Guard's role and earlier row snapshots are not authority.
  private async authorize(c:PoolClient,a:Actor,p:string,write=false,directorOnly=false) {
    const member=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
    if(!member || member.status!=='active' || !['director','master',...(write?[]:['pto'])].includes(member.role) || (directorOnly && member.role!=='director'))throw httpError(403,'role_denied');
    if(member.role!=='director' && !(await c.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`,[a.tenantId,p,a.userId])).rowCount)throw httpError(404,'not_found');
    return member.role as string;
  }
  private async command(a:Actor,p:string,operation:string,b:Row,status:number,directorOnly:boolean,lock:(c:PoolClient)=>Promise<unknown>,run:(c:PoolClient)=>Promise<Row>):Promise<CommandResult> {
    try{return await this.with(a,async c=>{
      const receipt=await reserveCommand(c,a,operation,b);
      await this.projectLock(c,a,p);
      if(!receipt.inserted){
        // Replay never takes employee/task locks after memberships. Business invalidation must not replace the original result.
        await this.memberLocks(c,a,p,[a.userId]);await this.authorize(c,a,p,true,directorOnly);
        return replayCommand(c,a,b.requestId,receipt.hash);
      }
      await lock(c);
      await this.authorize(c,a,p,true,directorOnly);
      const body=await run(c);
      return completeCommand(c,a,b.requestId,status,body);
    });}catch(error:any){
      if(error.code==='23505')throw httpError(409,'conflict');
      if(['23503','23514'].includes(error.code))throw httpError(422,'reference_denied');
      throw error;
    }
  }
  private async audit(c:PoolClient,a:Actor,requestId:string,type:string,id:string,before:Row|null,after:Row) {
    await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'tasks.command',$3,$4,'ok',$5)`,[a.tenantId,a.userId,type,id,JSON.stringify({requestId,before,after})]);
  }
  catalogs(a:Actor,p:string,kind:Catalog,pg:Page) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);await this.authorize(c,a,p);
      const table=catalogs[kind],fields=catalogFields(kind);
      const total=(await c.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1 AND project_id=$2`,[a.tenantId,p])).rows[0].n;
      const items=(await c.query(`SELECT ${fields} FROM ${table} WHERE tenant_id=$1 AND project_id=$2 ORDER BY name,id LIMIT $3 OFFSET $4`,[a.tenantId,p,pg.limit,pg.offset])).rows;
      return {items,total,...pg};
    });
  }
  writeCatalog(a:Actor,p:string,kind:Catalog,input:unknown,id?:string) {
    const b:Row=catalogInput(input,kind,!!id),table=catalogs[kind],fields=catalogFields(kind);
    return this.command(a,p,`${id?'PUT':'POST'} /projects/${p}/${kind}${id?`/${id}`:''}`,b,id?200:201,true,c=>this.memberLocks(c,a,p,[a.userId]),async c=>{
      let before=null;
      if(id){before=(await c.query(`SELECT ${fields} FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,p,id])).rows[0];if(!before)throw httpError(404,'not_found');this.version(before,b.expectedVersion);}
      const key=id??randomUUID();
      const cols=kind==='work-types'?['unit','requires_rd','requires_material_control','requires_predecessor_acceptance','requires_id']:[];
      const data=kind==='work-types'?[b.unit,b.requiresRd,b.requiresMaterialControl,b.requiresPredecessorAcceptance,b.requiresId]:[];
      const values=[a.tenantId,p,key,b.name,...data];
      let after;
      if(id){
        const assignments=['name=$4',...cols.map((col,i)=>`${col}=$${i+5}`),`status=$${values.length+1}`,'version=version+1'];
        after=(await c.query(`UPDATE ${table} SET ${assignments.join(',')} WHERE tenant_id=$1 AND project_id=$2 AND id=$3 RETURNING ${fields}`,[...values,b.status])).rows[0];
      }else after=(await c.query(`INSERT INTO ${table}(tenant_id,project_id,id,name${cols.length?','+cols.join(','):''}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING ${fields}`,values)).rows[0];
      await this.audit(c,a,b.requestId,kind,key,before,after);return after;
    });
  }
  // Project is locked before this hint; employee locks use only keys. A changed hint aborts rather than acquiring earlier-tier locks late.
  private async planLocks(c:PoolClient,a:Actor,p:string,b:Row,id?:string) {
    const hint=id?(await c.query(`SELECT id,project_id,assignee_employee_id,responsible_user_id,version FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0]:null;
    if(id && !hint)throw httpError(404,'not_found');
    const ids=[...new Set([hint?.assignee_employee_id,b.assigneeEmployeeId].filter(Boolean))].sort();
    await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,[a.tenantId,ids]);
    const employees=(await c.query(`SELECT id,user_id,status FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[a.tenantId,ids])).rows;
    await this.memberLocks(c,a,p,[a.userId,hint?.responsible_user_id,b.responsibleUserId,...employees.map(e=>e.user_id)]);
    if(id){
      await c.query(`SELECT id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,p,id]);
      const fresh=(await c.query(`SELECT assignee_employee_id,responsible_user_id,project_id,version FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0];
      if(!fresh || ['assignee_employee_id','responsible_user_id','project_id','version'].some(k=>fresh[k]!==hint[k]))throw httpError(409,'stale_version');
      this.version(fresh,b.expectedVersion);
    }
    await c.query(`SELECT employee_id FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=ANY($3::uuid[]) ORDER BY employee_id FOR NO KEY UPDATE`,[a.tenantId,p,ids]);
  }
  private async validatePlan(c:PoolClient,a:Actor,p:string,b:Row) {
    const zone=(await c.query(`SELECT ${catalogFields('zones')} FROM project_work_zones WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,b.zoneId])).rows[0];
    const workType=(await c.query(`SELECT ${catalogFields('work-types')} FROM project_work_types WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,b.workTypeId])).rows[0];
    const employee=(await c.query(`SELECT id,user_id,status FROM employees WHERE tenant_id=$1 AND id=$2`,[a.tenantId,b.assigneeEmployeeId])).rows[0];
    const responsible=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,b.responsibleUserId])).rows[0];
    if(!zone || !workType || !employee || !responsible)throw httpError(404,'not_found');
    if(zone.status!=='active' || workType.status!=='active' || employee.status!=='active' || responsible.status!=='active')throw httpError(422,'reference_denied');
    if(responsible.role!=='director' && (responsible.role!=='master' || !(await c.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`,[a.tenantId,p,b.responsibleUserId])).rowCount))throw httpError(422,'responsible_not_ready');
    if(employee.user_id && !(await c.query(`SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'`,[a.tenantId,employee.user_id])).rowCount)throw httpError(422,'employee_not_ready');
    if(workType.requiresRd && !b.rdReference)throw httpError(422,'rd_required');
    const timezone=(await c.query(`SELECT timezone FROM tenants WHERE id=$1 AND timezone IN (SELECT name FROM pg_timezone_names)`,[a.tenantId])).rows[0]?.timezone;
    if(!timezone)throw httpError(422,'invalid_tenant_timezone');
    const dates=(await c.query(`SELECT to_char($1::timestamptz AT TIME ZONE $3,'YYYY-MM-DD') start,to_char($2::timestamptz AT TIME ZONE $3,'YYYY-MM-DD') finish`,[b.plannedStart,b.plannedEnd,timezone])).rows[0];
    if(dates.start!==b.workDate || dates.finish!==b.workDate)throw httpError(400,'invalid_interval');
    return {zone,workType,employee,responsible,timezone};
  }
  writeTask(a:Actor,p:string,input:unknown,id?:string) {
    const b:Row=taskInput(input,!!id);
    return this.command(a,p,`${id?'PUT':'POST'} /projects/${p}/tasks${id?`/${id}`:''}`,b,id?200:201,false,c=>this.planLocks(c,a,p,b,id),async c=>{
      const before=id?(await c.query(`SELECT ${taskFields} FROM daily_tasks t WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0]:null;
      if(before && (before.workflowKind!=='managed02b' || before.status!=='draft'))throw httpError(409,'invalid_task_state');
      const refs=await this.validatePlan(c,a,p,b);
      const key=id??randomUUID();
      const values=[a.tenantId,p,key,b.title,b.workDate,b.plannedQuantity,refs.workType.unit,b.assigneeEmployeeId,b.zoneId,b.workTypeId,b.responsibleUserId,b.rdReference,b.plannedStart,b.plannedEnd];
      let after;
      if(id)after=(await c.query(`UPDATE daily_tasks t SET title=$4,work_date=$5,planned_quantity=$6,unit=$7,assignee_employee_id=$8,zone_id=$9,work_type_id=$10,responsible_user_id=$11,rd_reference=$12,planned_start=$13,planned_end=$14,version=version+1,plan_revision=plan_revision+1 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 RETURNING ${taskFields}`,values)).rows[0];
      else after=(await c.query(`INSERT INTO daily_tasks AS t(tenant_id,project_id,id,title,work_date,planned_quantity,unit,assignee_employee_id,zone_id,work_type_id,responsible_user_id,rd_reference,planned_start,planned_end,workflow_kind,status,plan_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'managed02b','draft',1) RETURNING ${taskFields}`,values)).rows[0];
      await this.audit(c,a,b.requestId,'daily_task',key,before,after);return after;
    });
  }
}
