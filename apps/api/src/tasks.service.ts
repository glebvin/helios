import {dailyRouteHint,dailyRouteRead,recordDailyTransition,dailyRouteReplayScope} from './daily-task-route.js';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import type {Page} from './api-input.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {DirectorApiService,crewView,taskFields} from './director-api.service.js';
import {catalogInput,crewTaskInput,crewVolumeInput,taskInput,frontTemplateInput,frontCheckInput,taskActionInput,type TaskAction} from './task-input.js';
import {reserveCommand,replayCommand,completeCommand,type CommandResult} from './durable-command.js';
import {PeopleService} from './people.service.js';
type Row=Record<string,any>;
type Catalog='zones'|'work-types';
const catalogs={zones:'project_work_zones','work-types':'project_work_types'} as const;
function catalogFields(kind:Catalog) {return `id,project_id AS "projectId",name,version,status${kind==='work-types'?`,unit,requires_rd AS "requiresRd",requires_material_control AS "requiresMaterialControl",requires_predecessor_acceptance AS "requiresPredecessorAcceptance",requires_id AS "requiresId",hidden_work AS "hiddenWork"`:''}`;}
export class TasksService {
  constructor(private readonly pool:Pool,private readonly api:DirectorApiService,private readonly people:PeopleService) {}
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
  private async command(a:Actor,p:string,operation:string,b:Row,status:number,directorOnly:boolean,lock:(c:PoolClient)=>Promise<unknown>,run:(c:PoolClient)=>Promise<Row>,replayAuthorize?:(c:PoolClient)=>Promise<void>):Promise<CommandResult> {
    try{return await this.with(a,async c=>{
      const receipt=await reserveCommand(c,a,operation,b);
      await this.projectLock(c,a,p);
      if(!receipt.inserted){
        // Replay never takes employee/task locks after memberships. Business invalidation must not replace the original result.
        await this.memberLocks(c,a,p,[a.userId]);await this.authorize(c,a,p,true,directorOnly);
        await replayAuthorize?.(c);
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
      const cols=kind==='work-types'?['unit','requires_rd','requires_material_control','requires_predecessor_acceptance','requires_id','hidden_work']:[];
      const data=kind==='work-types'?[b.unit,b.requiresRd,b.requiresMaterialControl,b.requiresPredecessorAcceptance,b.requiresId,b.hiddenWork??before?.hiddenWork??false]:[];
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
  private async planLocks(c:PoolClient,a:Actor,p:string,b:Row,id?:string,extraMembers:string[]=[]) {
    const hint=id?(await c.query(`SELECT id,project_id,assignee_employee_id,responsible_user_id,version FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0]:null;
    if(id && !hint)throw httpError(404,'not_found');
    const ids=[...new Set([hint?.assignee_employee_id,b.assigneeEmployeeId].filter(Boolean))].sort();
    await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,[a.tenantId,ids]);
    const employees=(await c.query(`SELECT id,user_id,status FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[a.tenantId,ids])).rows;
    await this.memberLocks(c,a,p,[a.userId,hint?.responsible_user_id,b.responsibleUserId,...employees.map(e=>e.user_id),...extraMembers]);
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
    if(b.materialBatchId && !(await this.acceptedMaterial(c,p,{materialBatchId:b.materialBatchId,zoneId:b.zoneId,workTypeId:b.workTypeId})))throw httpError(409,'material_not_accepted');
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
      const values=[a.tenantId,p,key,b.title,b.workDate,b.plannedQuantity,refs.workType.unit,b.assigneeEmployeeId,b.zoneId,b.workTypeId,b.responsibleUserId,b.rdReference,b.plannedStart,b.plannedEnd,b.materialBatchId??null];
      let after;
      if(id)after=(await c.query(`UPDATE daily_tasks t SET title=$4,work_date=$5,planned_quantity=$6,unit=$7,assignee_employee_id=$8,zone_id=$9,work_type_id=$10,responsible_user_id=$11,rd_reference=$12,planned_start=$13,planned_end=$14,material_batch_id=$15,version=version+1,plan_revision=plan_revision+1 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 RETURNING ${taskFields}`,values)).rows[0];
      else after=(await c.query(`INSERT INTO daily_tasks AS t(tenant_id,project_id,id,title,work_date,planned_quantity,unit,assignee_employee_id,zone_id,work_type_id,responsible_user_id,rd_reference,planned_start,planned_end,material_batch_id,workflow_kind,status,plan_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'managed02b','draft',1) RETURNING ${taskFields}`,values)).rows[0];
      await this.audit(c,a,b.requestId,'daily_task',key,before,after);return after;
    });
  }
  private async crewRows(c:PoolClient,a:Actor,p:string,crewId:string) {
    const crew=(await c.query(`SELECT id,name FROM crews WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,p,crewId])).rows[0];
    if(!crew)throw httpError(404,'not_found');
    await c.query(`SELECT employee_id FROM crew_members WHERE tenant_id=$1 AND project_id=$2 AND crew_id=$3 AND status='active' ORDER BY employee_id FOR NO KEY UPDATE`,[a.tenantId,p,crewId]);
    const members=(await c.query(`SELECT cm.employee_id AS "employeeId",e.full_name AS "fullName",e.organization_id AS "organizationId" FROM crew_members cm JOIN employees e ON e.tenant_id=cm.tenant_id AND e.id=cm.employee_id WHERE cm.tenant_id=$1 AND cm.project_id=$2 AND cm.crew_id=$3 AND cm.status='active' AND e.status='active' ORDER BY cm.employee_id`,[a.tenantId,p,crewId])).rows;
    return {crew,members};
  }
  writeCrewTask(a:Actor,p:string,input:unknown) {
    const b:Row=crewTaskInput(input);
    return this.command(a,p,`POST /projects/${p}/crew-tasks`,b,201,false,async c=>{
      const {members}=await this.crewRows(c,a,p,b.crewId);
      if(members.length)await this.planLocks(c,a,p,{...b,assigneeEmployeeId:members[0].employeeId});
      else await this.memberLocks(c,a,p,[a.userId,b.responsibleUserId]);
    },async c=>{
      const {crew,members}=await this.crewRows(c,a,p,b.crewId);
      if(!members.length)throw httpError(422,'crew_empty');
      const organizations=[...new Set(members.map(member=>member.organizationId))];
      if(organizations.length!==1)throw httpError(422,'mixed_employer');
      const snapshot={schemaVersion:1,crewId:b.crewId,name:crew.name,organizationId:organizations[0],members:members.map(member=>({employeeId:member.employeeId,fullName:member.fullName}))};
      const plan={...b,assigneeEmployeeId:members[0].employeeId};
      const refs=await this.validatePlan(c,a,p,plan);
      const key=randomUUID();
      const values=[a.tenantId,p,key,b.title,b.workDate,b.plannedQuantity,refs.workType.unit,plan.assigneeEmployeeId,b.zoneId,b.workTypeId,b.responsibleUserId,b.rdReference,b.plannedStart,b.plannedEnd,b.materialBatchId??null,b.crewId,JSON.stringify(snapshot)];
      const after=(await c.query(`INSERT INTO daily_tasks AS t(tenant_id,project_id,id,title,work_date,planned_quantity,unit,assignee_employee_id,zone_id,work_type_id,responsible_user_id,rd_reference,planned_start,planned_end,material_batch_id,crew_id,crew_snapshot,workflow_kind,status,plan_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,'managed02b','draft',1) RETURNING ${taskFields}`,values)).rows[0];
      const body={...after,crew:crewView(snapshot,null)};
      await this.audit(c,a,b.requestId,'daily_task',key,null,body);return body;
    });
  }
  writeCrewVolume(a:Actor,p:string,taskId:string,input:unknown) {
    const b:Row=crewVolumeInput(input);
    return this.command(a,p,`POST /projects/${p}/tasks/${taskId}/crew-volume`,b,201,false,async c=>{
      if(!(await c.query(`SELECT id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,p,taskId])).rowCount)throw httpError(404,'not_found');
    },async c=>{
      const task=(await c.query(`SELECT version,crew_id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,taskId])).rows[0];
      if(!task)throw httpError(404,'not_found');
      if(!task.crew_id)throw httpError(422,'not_crew_task');
      this.version(task,b.expectedVersion);
      if((await c.query(`SELECT 1 FROM crew_volume_submissions WHERE tenant_id=$1 AND task_id=$2`,[a.tenantId,taskId])).rowCount)throw httpError(409,'already_submitted');
      const recorded=(await c.query(`INSERT INTO crew_volume_submissions(tenant_id,project_id,task_id,quantity,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING recorded_at AS "recordedAt"`,[a.tenantId,p,taskId,b.quantity,a.userId,b.requestId])).rows[0];
      const body={taskId,quantity:b.quantity,recordedAt:new Date(recorded.recordedAt).toISOString()};
      await this.audit(c,a,b.requestId,'crew_volume',taskId,null,body);return body;
    });
  }
  private async taskRow(c:PoolClient,a:Actor,p:string,id:string) {
    const t=(await c.query(`SELECT ${taskFields} FROM daily_tasks t WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0];
    if(!t)throw httpError(404,'not_found');
    if(t.workflowKind!=='managed02b')throw httpError(409,'workflow_not_supported');
    return t;
  }
  private planOf(t:Row) {return {zoneId:t.zoneId,workTypeId:t.workTypeId,title:t.title,workDate:t.workDate,plannedQuantity:t.plannedQuantity,assigneeEmployeeId:t.assigneeEmployeeId,responsibleUserId:t.responsibleUserId,plannedStart:t.plannedStart,plannedEnd:t.plannedEnd,rdReference:t.rdReference,materialBatchId:t.materialBatchId};}
  private async acceptedMaterial(c:PoolClient,p:string,t:{materialBatchId?:string|null;zoneId?:string|null;workTypeId?:string|null}) {
    if(!t.materialBatchId || !t.zoneId || !t.workTypeId)return false;
    return Boolean((await c.query(`SELECT 1 FROM material_controls mc JOIN material_control_steps s ON s.control_id=mc.id AND s.version=(SELECT max(version) FROM material_control_steps WHERE control_id=mc.id) WHERE mc.project_id=$1 AND mc.batch_id=$2 AND mc.zone_id=$3 AND mc.work_type_id=$4 AND s.verdict='accepted' AND (SELECT batch_version FROM material_control_steps WHERE control_id=mc.id AND action='prepare' ORDER BY version DESC LIMIT 1)=(SELECT max(version) FROM material_batch_revisions WHERE batch_id=mc.batch_id)`,[p,t.materialBatchId,t.zoneId,t.workTypeId])).rowCount);
  }
  private async frontPreparer(c:PoolClient,a:Actor,p:string) {
    const stored=(await c.query(`SELECT configuration FROM route_config_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`,[a.tenantId,p])).rows[0];
    const route=stored?.configuration?.routes?.find((item:{documentType?:string})=>item.documentType==='front-readiness');
    const userId=route?.preparers?.[0]?.userId;
    return typeof userId==='string'?userId:null;
  }
  private async latestFrontTemplate(c:PoolClient,a:Actor,p:string) {
    const row=(await c.query(`SELECT snapshot FROM front_template_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`,[a.tenantId,p])).rows[0];
    return row?.snapshot;
  }
  frontTemplate(a:Actor,p:string,pg?:Page) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);await this.authorize(c,a,p);
      if(!pg){const t=await this.latestFrontTemplate(c,a,p);if(!t)throw httpError(404,'not_found');return t;}
      const total=(await c.query(`SELECT count(*)::int n FROM front_template_versions WHERE tenant_id=$1 AND project_id=$2`,[a.tenantId,p])).rows[0].n;
      const items=(await c.query(`SELECT snapshot FROM front_template_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT $3 OFFSET $4`,[a.tenantId,p,pg.limit,pg.offset])).rows.map(r=>r.snapshot);
      return {items,total,...pg};
    });
  }
  writeFrontTemplate(a:Actor,p:string,input:unknown,update=false) {
    const b:Row=frontTemplateInput(input,update);
    return this.command(a,p,`${update?'PUT':'POST'} /projects/${p}/front-template`,b,update?200:201,true,c=>this.memberLocks(c,a,p,[a.userId]),async c=>{
      const before=await this.latestFrontTemplate(c,a,p);
      if(update){if(!before)throw httpError(404,'not_found');this.version(before,b.expectedVersion);}else if(before)throw httpError(409,'template_exists');
      const after={projectId:p,code:before?.code??b.code,title:b.title,version:(before?.version??0)+1,items:b.items};
      if(before)await c.query(`UPDATE front_templates SET version=$3 WHERE tenant_id=$1 AND project_id=$2`,[a.tenantId,p,after.version]);
      else await c.query(`INSERT INTO front_templates(tenant_id,project_id,code,version) VALUES($1,$2,$3,1)`,[a.tenantId,p,after.code]);
      await c.query(`INSERT INTO front_template_versions(tenant_id,project_id,code,version,snapshot) VALUES($1,$2,$3,$4,$5)`,[a.tenantId,p,after.code,after.version,JSON.stringify(after)]);
      await this.audit(c,a,b.requestId,'front_template',p,before??null,after);return after;
    });
  }
  frontChecks(a:Actor,p:string,id:string,pg:Page,checkId?:string) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);await this.authorize(c,a,p);await this.taskRow(c,a,p,id);
      const values=[a.tenantId,p,id,checkId??null];
      const total=(await c.query(`SELECT count(*)::int n FROM task_front_checks WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND ($4::uuid IS NULL OR id=$4)`,values)).rows[0].n;
      const items=(await c.query(`SELECT snapshot FROM task_front_checks WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND ($4::uuid IS NULL OR id=$4) ORDER BY sequence DESC LIMIT $5 OFFSET $6`,[...values,pg.limit,pg.offset])).rows.map(r=>r.snapshot);
      if(checkId){if(!items[0])throw httpError(404,'not_found');return items[0];}
      return {items,total,...pg};
    });
  }
  writeFrontCheck(a:Actor,p:string,id:string,input:unknown) {
    const b:Row=frontCheckInput(input);
    return this.command(a,p,`POST /projects/${p}/tasks/${id}/front-checks`,b,201,false,c=>this.planLocks(c,a,p,b,id),async c=>{
      const preparer=await this.frontPreparer(c,a,p);
      if(preparer && preparer!==a.userId) throw httpError(403,'route_denied');
      const t=await this.taskRow(c,a,p,id);
      if(!['draft','pending_approval'].includes(t.status))throw httpError(409,'invalid_task_state');
      const template=await this.latestFrontTemplate(c,a,p);if(!template)throw httpError(422,'front_template_required');
      if(template.version!==b.templateVersion)throw httpError(409,'template_changed');
      if(template.items.length!==b.answers.length || b.answers.some((answer:Row)=>!template.items.some((i:Row)=>i.id===answer.itemId)))throw httpError(400,'invalid_answers');
      const refs=await this.validatePlan(c,a,p,this.planOf(t));
      const reasons:string[]=[],warnings:string[]=[];
      for(const item of template.items)if(!b.answers.find((answer:Row)=>answer.itemId===item.id).value)(item.critical?reasons:warnings).push(`${item.critical?'critical_failed':'noncritical_failed'}:${item.id}`);
      const sequence=(await c.query(`SELECT coalesce(max(sequence),0)+1 n FROM task_front_checks WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3`,[a.tenantId,p,id])).rows[0].n;
      const checkedAt=(await c.query(`SELECT clock_timestamp()::text time`)).rows[0].time;
      const after={id:randomUUID(),sequence,taskId:id,projectId:p,planRevision:t.planRevision,templateCode:template.code,templateVersion:template.version,templateSnapshot:template,zoneVersion:refs.zone.version,workTypeVersion:refs.workType.version,answers:b.answers,passed:reasons.length===0,reasons,warnings,checkedBy:a.userId,checkedAt};
      await c.query(`INSERT INTO task_front_checks(tenant_id,project_id,task_id,id,template_version,sequence,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.tenantId,p,id,after.id,template.version,sequence,JSON.stringify(after)]);
      await c.query(`UPDATE daily_tasks SET version=version+1 WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id]);
      await this.audit(c,a,b.requestId,'task_front_check',after.id,null,after);return after;
    });
  }
  // Caller supplies the same client and holds project -> employee -> memberships -> task/assignment.
  // Ordinary GETs deliberately do not acquire this lock set and are informational only.
  private async readiness(c:PoolClient,a:Actor,p:string,t:Row) {
    const reasons:string[]=[],warnings:string[]=[];
    // Publication evidence lists the accepted employee columns.
    const employee=(await c.query(`SELECT tenant_id,id,organization_id,full_name,phone,document_number,user_id,status,version FROM employees WHERE tenant_id=$1 AND id=$2`,[a.tenantId,t.assigneeEmployeeId])).rows[0];
    const assignment=(await c.query(`SELECT employee_id AS "employeeId",status,version,admission_check_id AS "admissionCheckId" FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[a.tenantId,p,t.assigneeEmployeeId])).rows[0];
    if(!assignment || assignment.status!=='active')reasons.push('assignment_inactive');
    if(!employee || employee.status!=='active')reasons.push('employee_archived');
    if(!employee?.user_id)reasons.push('employee_unlinked');
    let linkedMembership=null,employeeProjectMembership=null;
    if(employee?.user_id){
      const m=(await c.query(`SELECT role,status,version FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,employee.user_id])).rows[0];
      linkedMembership=m??null;
      employeeProjectMembership=(await c.query(`SELECT status,version FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[a.tenantId,p,employee.user_id])).rows[0]??null;
      if(!m || m.status!=='active')reasons.push('employee_member_inactive');
      if(m?.role==='worker' && employeeProjectMembership?.status!=='active')reasons.push('employee_project_inactive');
    }
    const responsible=(await c.query(`SELECT role,status,version FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,t.responsibleUserId])).rows[0];
    if(!responsible || responsible.status!=='active' || (responsible.role!=='director' && (responsible.role!=='master' || !(await c.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`,[a.tenantId,p,t.responsibleUserId])).rowCount)))reasons.push('responsible_inactive');
    const admission=await this.people.eligibility(c,employee??{id:t.assigneeEmployeeId,status:'archived'},p,assignment?.admissionCheckId??null);
    reasons.push(...admission.reasons.map(r=>`admission:${r}`));
    const admissionCheck=admission.checkId?(await c.query(`SELECT snapshot FROM employee_admission_checks WHERE tenant_id=$1 AND employee_id=$2 AND project_id=$3 AND id=$4`,[a.tenantId,t.assigneeEmployeeId,p,admission.checkId])).rows[0]?.snapshot:null;
    // Exact evidence identity/version is already checked by PeopleService. Add inclusive future civil workDate validity.
    for(const q of admissionCheck?.qualificationEvidence??[])if(q.validUntil!==null && q.validUntil<t.workDate)reasons.push(`qualification_expired_on_work_date:${q.code}`);
    const zone=(await c.query(`SELECT ${catalogFields('zones')} FROM project_work_zones WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,t.zoneId])).rows[0];
    const workType=(await c.query(`SELECT ${catalogFields('work-types')} FROM project_work_types WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,t.workTypeId])).rows[0];
    if(zone?.status!=='active')reasons.push('zone_inactive');
    if(workType?.status!=='active')reasons.push('work_type_inactive');
    if(workType?.unit!==t.unit)reasons.push('work_type_unit_changed');
    if(workType?.requiresRd && !t.rdReference)reasons.push('rd_required');
    for(const [flag,code] of [['requiresPredecessorAcceptance','predecessor_acceptance_unsupported'],['requiresId','id_unsupported']])if(workType?.[flag])reasons.push(code);
    if(workType?.requiresMaterialControl && !(await this.acceptedMaterial(c,p,t)))reasons.push('material_not_accepted');
    const template=await this.latestFrontTemplate(c,a,p);
    const front=(await c.query(`SELECT snapshot FROM task_front_checks WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 ORDER BY sequence DESC LIMIT 1`,[a.tenantId,p,t.id])).rows[0]?.snapshot;
    if(!front)reasons.push('front_missing');
    else {
      if(!front.passed)reasons.push('front_failed');
      if(!template || front.templateVersion!==template.version || front.templateCode!==template.code)reasons.push('front_template_changed');
      if(front.planRevision!==t.planRevision)reasons.push('front_plan_changed');
      if(front.zoneVersion!==zone?.version || front.workTypeVersion!==workType?.version)reasons.push('front_catalog_changed');
      warnings.push(...front.warnings);
    }
    const timezone=(await c.query(`SELECT timezone FROM tenants WHERE id=$1 AND timezone IN (SELECT name FROM pg_timezone_names)`,[a.tenantId])).rows[0]?.timezone;
    if(!timezone)reasons.push('invalid_tenant_timezone');
    else {
      const civil=(await c.query(`SELECT to_char($1::timestamptz AT TIME ZONE $3,'YYYY-MM-DD') start,to_char($2::timestamptz AT TIME ZONE $3,'YYYY-MM-DD') finish`,[t.plannedStart,t.plannedEnd,timezone])).rows[0];
      if(civil.start!==t.workDate || civil.finish!==t.workDate)reasons.push('invalid_interval');
    }
    const responsibleProjectMembership=(await c.query(`SELECT status,version FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[a.tenantId,p,t.responsibleUserId])).rows[0]??null;
    return {ready:reasons.length===0,reasons,warnings,employee,assignment,admission,admissionCheck,front,zone,workType,timezone,responsible,linkedMembership,employeeProjectMembership,responsibleProjectMembership};
  }
  taskReadiness(a:Actor,p:string,id:string) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);await this.authorize(c,a,p);
      const r=await this.readiness(c,a,p,await this.taskRow(c,a,p,id));
      return {ready:r.ready,reasons:r.reasons,warnings:r.warnings};
    });
  }
  taskRoute(a:Actor,p:string,id:string) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);await this.authorize(c,a,p);
      return dailyRouteRead(c,a,p,await this.taskRow(c,a,p,id));
    });
  }
  action(a:Actor,p:string,id:string,input:unknown,action:TaskAction) {
    const b:Row=taskActionInput(input,action);
    let route:Awaited<ReturnType<typeof dailyRouteHint>>;
    return this.command(a,p,`POST /projects/${p}/tasks/${id}/${action}`,b,200,['reject','publish'].includes(action),async c=>{route=await dailyRouteHint(c,a,p,id);await this.planLocks(c,a,p,b,id,route.memberIds);},async c=>{
      const before=await this.taskRow(c,a,p,id),role=await this.authorize(c,a,p,true);
      const allowed:Record<TaskAction,string[]>={submit:['draft'],reject:['pending_approval'],reopen:['pending_approval'],cancel:role==='director'?['draft','pending_approval','published']:['draft','pending_approval'],publish:['pending_approval']};
      if(!allowed[action].includes(before.status))throw httpError(409,'invalid_task_state');
      await recordDailyTransition(c,a,p,before,action,b.requestId,b.reason,route);
      let snapshotId=before.publicationSnapshotId,readiness;
      if(action==='submit')await this.validatePlan(c,a,p,this.planOf(before));
      if(action==='publish'){
        const r=await this.readiness(c,a,p,before);
        if(r.reasons.includes('front_template_changed'))throw httpError(409,'template_changed');
        if(!r.ready)throw httpError(422,'task_not_ready');
        // Employee lock serializes this cross-project predicate without taking any second project/task lock.
        if((await c.query(`SELECT 1 FROM daily_tasks WHERE tenant_id=$1 AND assignee_employee_id=$2 AND crew_id IS NULL AND workflow_kind='managed02b' AND status='published' AND id<>$3 AND planned_start<$5::timestamptz AND planned_end>$4::timestamptz LIMIT 1`,[a.tenantId,before.assigneeEmployeeId,id,before.plannedStart,before.plannedEnd])).rowCount)throw httpError(409,'assignment_overlap');
        snapshotId=randomUUID();const publishedAt=(await c.query(`SELECT clock_timestamp()::text time`)).rows[0].time;
        const actorMembership=(await c.query(`SELECT role,status,version FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
        const snapshot={id:snapshotId,taskId:id,projectId:p,plan:{...before,version:before.version+1,status:'published',publicationSnapshotId:snapshotId},tenantTimezone:r.timezone,employee:r.employee,linkedUserId:r.employee.user_id,linkedMembership:r.linkedMembership,employeeProjectMembership:r.employeeProjectMembership,assignment:r.assignment,admission:r.admission,admissionCheck:r.admissionCheck,front:r.front,zone:r.zone,workType:r.workType,responsible:r.responsible,responsibleProjectMembership:r.responsibleProjectMembership,actorMembership,publishedBy:a.userId,publishedAt,...(route.attempt?{routeAttemptId:route.attempt.id,routeConfigurationVersion:route.attempt.configVersion}:{})};
        await c.query(`INSERT INTO task_publication_snapshots(tenant_id,project_id,task_id,id,front_check_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)`,[a.tenantId,p,id,snapshotId,r.front.id,JSON.stringify(snapshot)]);
        readiness={ready:true,reasons:[],warnings:r.warnings};
      }
      const status=action==='submit'?'pending_approval':action==='publish'?'published':action==='cancel'?'cancelled':'draft';
      const after=(await c.query(`UPDATE daily_tasks t SET status=$4,version=version+1,publication_snapshot_id=$5 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 RETURNING ${taskFields}`,[a.tenantId,p,id,status,snapshotId])).rows[0];
      await this.audit(c,a,b.requestId,'daily_task',id,before,{...after,...(b.reason?{reason:b.reason}:{}),action});
      return {...after,...(readiness?{readiness}:{})};
    },c=>dailyRouteReplayScope(c,a,p,id,b.requestId));
  }
}
