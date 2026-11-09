import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {HttpException} from '@nestjs/common';
import type {Actor} from './workforce.service.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {reserveCommand,replayCommand,completeCommand} from './durable-command.js';
import {executionBatch,type ExecutionEvent} from './execution-input.js';
import type {Page} from './api-input.js';
import {executionScope,executionJoin,executionClock,executionTotals} from './execution-read.js';
import {PeopleService} from './people.service.js';
type Row=Record<string,any>;
export function executionReviewFlags(occurredAt:string,receivedAt:Date,capturedAt?:string,abovePlannedQuantity=false){
  const delayed=+receivedAt-+new Date(occurredAt)>86400000,future=+new Date(occurredAt)-+receivedAt>300000;
  const geoTimeMismatch=capturedAt!==undefined&&Math.abs(+new Date(capturedAt)-+new Date(occurredAt))>300000;
  return {delayed,future,suspicious:delayed||future||geoTimeMismatch,geoTimeMismatch,abovePlannedQuantity};
}
export class ExecutionService {
  constructor(private readonly pool:Pool,private readonly people:PeopleService){}
  private async readScope(c:PoolClient,a:Actor,projectId:string,employeeId?:string){
    const visible=(await c.query(`SELECT p.id FROM projects p LEFT JOIN employees e ON e.tenant_id=p.tenant_id WHERE ${executionScope} LIMIT 1`,[a.tenantId,a.userId,projectId])).rows[0];
    if(!visible)throw httpError(404,'not_found');
    if(employeeId&&!(await c.query(`SELECT e.id FROM employees e JOIN projects p ON p.tenant_id=e.tenant_id WHERE ${executionScope} AND e.id=$4`,[a.tenantId,a.userId,projectId,employeeId])).rowCount)throw httpError(404,'not_found');
  }
  shifts(a:Actor,projectId:string,page:Page,employeeId?:string){
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.readScope(c,a,projectId,employeeId);
      const v=[a.tenantId,a.userId,projectId,employeeId??null],from=`FROM managed_shifts s ${executionJoin} JOIN managed_execution_streams st ON st.tenant_id=s.tenant_id AND st.employee_id=s.employee_id WHERE ${executionScope} AND ($4::uuid IS NULL OR e.id=$4)`;
      const total=(await c.query(`SELECT count(*)::int n ${from}`,v)).rows[0].n;
      const items=(await c.query(`SELECT s.id,s.project_id AS "projectId",s.employee_id AS "employeeId",s.started_at AS "startedAt",s.ended_at AS "endedAt",st.version::float8 AS "version",
        (SELECT jsonb_build_object('requestId',ev.request_id,'actorUserId',ev.actor_user_id,'occurredAt',ev.occurred_at,'receivedAt',ev.received_at,'reviewFlags',ev.review_flags) FROM managed_execution_events ev WHERE ev.tenant_id=s.tenant_id AND ev.project_id=s.project_id AND ev.employee_id=s.employee_id AND ev.shift_id=s.id AND ev.kind='shift_start') AS "startEvent",
        (SELECT jsonb_build_object('requestId',ev.request_id,'actorUserId',ev.actor_user_id,'occurredAt',ev.occurred_at,'receivedAt',ev.received_at,'reviewFlags',ev.review_flags) FROM managed_execution_events ev WHERE ev.tenant_id=s.tenant_id AND ev.project_id=s.project_id AND ev.employee_id=s.employee_id AND ev.shift_id=s.id AND ev.kind='shift_end') AS "endEvent"
        ${from} ORDER BY s.started_at,s.id LIMIT $5 OFFSET $6`,[...v,page.limit,page.offset])).rows;
      return {items,total,...page};
    });
  }
  segments(a:Actor,projectId:string,shiftId:string,page:Page){
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.readScope(c,a,projectId);
      if(!(await c.query(`SELECT s.id FROM managed_shifts s ${executionJoin} WHERE ${executionScope} AND s.id=$4`,[a.tenantId,a.userId,projectId,shiftId])).rowCount)throw httpError(404,'not_found');
      const v=[a.tenantId,a.userId,projectId,shiftId],from=`FROM managed_segments s ${executionJoin} WHERE ${executionScope} AND s.shift_id=$4`;
      const total=(await c.query(`SELECT count(*)::int n ${from}`,v)).rows[0].n;
      const items=(await c.query(`SELECT s.id,s.shift_id AS "shiftId",s.employee_id AS "employeeId",s.project_id AS "projectId",s.mode,s.task_id AS "taskId",s.reason_code AS "reasonCode",s.comment,s.started_at AS "startedAt",s.ended_at AS "endedAt" ${from} ORDER BY s.started_at,s.id LIMIT $5 OFFSET $6`,[...v,page.limit,page.offset])).rows;
      return {items,total,...page};
    });
  }
  reports(a:Actor,projectId:string,page:Page,employeeId?:string,taskId?:string,day?:string){
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.readScope(c,a,projectId,employeeId);const clock=await executionClock(c,a,day);
      const v=[a.tenantId,a.userId,projectId,employeeId??null,taskId??null,day??null,clock.timezone];
      const from=`FROM managed_execution_reports s ${executionJoin} JOIN managed_execution_events ev ON ev.tenant_id=s.tenant_id AND ev.actor_user_id=s.actor_user_id AND ev.request_id=s.request_id JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id WHERE ${executionScope} AND ($4::uuid IS NULL OR e.id=$4) AND ($5::uuid IS NULL OR t.id=$5) AND ($6::date IS NULL OR (ev.occurred_at>=($6::date::timestamp AT TIME ZONE $7) AND ev.occurred_at<(($6::date+1)::timestamp AT TIME ZONE $7)))`;
      const total=(await c.query(`SELECT count(*)::int n ${from}`,v)).rows[0].n;
      const items=(await c.query(`SELECT s.report_id AS "reportId",s.project_id AS "projectId",s.employee_id AS "employeeId",s.shift_id AS "shiftId",s.task_id AS "taskId",s.request_id AS "requestId",s.actor_user_id AS "actorUserId",s.submitted_quantity::text AS "submittedQuantity",t.unit,NULL AS "acceptedQuantity",true provisional,ev.occurred_at AS "occurredAt",ev.received_at AS "receivedAt",ev.review_flags AS "reviewFlags",'managed_execution_events.occurred_at' AS source ${from} ORDER BY ev.occurred_at,s.report_id LIMIT $8 OFFSET $9`,[...v,page.limit,page.offset])).rows;
      return {items,total,...page};
    });
  }
  day(a:Actor,projectId:string,employeeId:string,day:string,asOf?:string){
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.readScope(c,a,projectId,employeeId);const clock=await executionClock(c,a,day,asOf);
      const version=Number((await c.query(`SELECT version FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2`,[a.tenantId,employeeId])).rows[0]?.version??0);
      return {employeeId,projectId,...clock,version,...await executionTotals(c,a,projectId,clock,employeeId)};
    });
  }
  async ingest(a:Actor,input:unknown){
    const events=executionBatch(input),results:Row[]=[];
    for(const b of events){
      try{results.push(await this.accept(a,b));}catch(error:any){
        const status=error instanceof HttpException?error.getStatus():error.code==='23505'?409:['23503','23514','22003'].includes(error.code)?422:500;
        const code=error instanceof HttpException?error.message:status===409?'conflict':status===422?'reference_denied':'internal';
        if(status===500)console.error(error);
        results.push({requestId:b.requestId,outcome:'error',status,code,retryable:code==='missing_dependency'||status===500});
      }
    }
    return {results};
  }
  private async prerequisiteLocks(c:PoolClient,a:Actor,b:ExecutionEvent){
    if(!(await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,b.projectId])).rowCount)throw httpError(404,'not_found');
    if(!(await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,b.employeeId])).rowCount)throw httpError(404,'not_found');
    // Current link is read only after the employee wait, never from an earlier visibility snapshot.
    const employee=(await c.query(`SELECT id,user_id,status FROM employees WHERE tenant_id=$1 AND id=$2`,[a.tenantId,b.employeeId])).rows[0];
    const ids=[...new Set([a.userId,employee.user_id].filter(Boolean))].sort();
    // Receipt FKs already hold KEY SHARE. FOR UPDATE here can deadlock concurrent devices.
    await c.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,ids]);
    await c.query(`SELECT user_id FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=ANY($3::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,b.projectId,ids]);
    return employee;
  }
  private async authorize(c:PoolClient,a:Actor,b:ExecutionEvent,e:Row){
    // Guard role and snapshots preceding any lock wait are not authority.
    const member=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
    if(!member||member.status!=='active'||!['director','master','worker'].includes(member.role))throw httpError(403,'role_denied');
    if(member.role!=='director'&&!(await c.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`,[a.tenantId,b.projectId,a.userId])).rowCount)throw httpError(404,'not_found');
    if(member.role==='worker'&&(e.user_id!==a.userId||e.status!=='active'))throw httpError(403,'employee_denied');
    if(member.role!=='worker'&&e.user_id!==a.userId&&!b.onBehalfReason)throw httpError(403,'on_behalf_reason_required');
  }
  private async admission(c:PoolClient,a:Actor,b:ExecutionEvent,e:Row,task?:Row){
    const assignment=(await c.query(`SELECT status,admission_check_id FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 FOR NO KEY UPDATE`,[a.tenantId,b.projectId,b.employeeId])).rows[0];
    if(assignment?.status!=='active')throw httpError(422,'assignment_required');
    if(e.user_id){
      const linked=(await c.query(`SELECT m.role,m.status,pm.status project_status FROM memberships m LEFT JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id AND pm.project_id=$3 WHERE m.tenant_id=$1 AND m.user_id=$2`,[a.tenantId,e.user_id,b.projectId])).rows[0];
      if(!linked||linked.status!=='active'||(linked.role==='worker'&&linked.project_status!=='active'))throw httpError(422,'employee_not_ready');
    }
    if(!(await this.people.eligibility(c,e,b.projectId,assignment.admission_check_id,task?.work_date)).eligible)throw httpError(422,'admission_required');
  }
  private async task(c:PoolClient,a:Actor,b:ExecutionEvent,taskId:string,published:boolean){
    await c.query(`SELECT id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,b.projectId,taskId]);
    const task=(await c.query(`SELECT id,status,workflow_kind,assignee_employee_id,work_date::text,planned_quantity::text FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,b.projectId,taskId])).rows[0];
    if(!task||task.assignee_employee_id!==b.employeeId)throw httpError(422,'task_reference_denied');
    if(published&&(task.workflow_kind!=='managed02b'||task.status!=='published'))throw httpError(422,'published_managed_task_required');
    return task;
  }
  private async accept(a:Actor,b:ExecutionEvent){
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const receipt=await reserveCommand(c,a,'POST /execution/events',b);
      const employee=await this.prerequisiteLocks(c,a,b);await this.authorize(c,a,b,employee);
      if(!receipt.inserted){const original=await replayCommand(c,a,b.requestId,receipt.hash);return {requestId:b.requestId,outcome:'duplicate',status:original.status,result:original.body};}
      if(b.previousEventId&&!(await c.query(`SELECT 1 FROM managed_execution_events WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3 AND employee_id=$4 AND project_id=$5`,[a.tenantId,a.userId,b.previousEventId,b.employeeId,b.projectId])).rowCount)throw httpError(409,'missing_dependency');
      await c.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[a.tenantId,b.employeeId]);
      const stream=(await c.query(`SELECT version::text,last_interval_at FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2 FOR NO KEY UPDATE`,[a.tenantId,b.employeeId])).rows[0];
      if(Number(stream.version)!==b.expectedVersion||b.expectedVersion===Number.MAX_SAFE_INTEGER)throw httpError(409,'stale_version');
      const version=b.expectedVersion+1;
      const shift=(await c.query(`SELECT id,started_at,ended_at FROM managed_shifts WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND id=$4 FOR NO KEY UPDATE`,[a.tenantId,b.projectId,b.employeeId,b.shiftId])).rows[0];
      const segment=shift?(await c.query(`SELECT id,mode,task_id,started_at FROM managed_segments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND shift_id=$4 AND ended_at IS NULL FOR NO KEY UPDATE`,[a.tenantId,b.projectId,b.employeeId,b.shiftId])).rows[0]:null;
      if(b.kind!=='submit_volume'&&stream.last_interval_at&&new Date(b.occurredAt)<stream.last_interval_at)throw httpError(409,'non_chronological_interval');
      let overPlan=false;
      if(b.kind==='shift_start'){
        if(shift||(await c.query(`SELECT 1 FROM managed_shifts WHERE tenant_id=$1 AND employee_id=$2 AND ended_at IS NULL`,[a.tenantId,b.employeeId])).rowCount)throw httpError(409,'shift_already_open');
        await this.admission(c,a,b,employee);
        await c.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at) VALUES($1,$2,$3,$4,$5)`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,b.occurredAt]);
        await this.openSegment(c,a,b,'idle');
      }else{
        if(!shift)throw httpError(422,'shift_reference_denied');
        if(b.kind==='submit_volume'){
          if(!shift.ended_at)throw httpError(409,'final_report_requires_closed_shift');
          if(new Date(b.occurredAt)<shift.ended_at)throw httpError(409,'report_before_shift_end');
          const task=await this.task(c,a,b,b.taskId,true);await this.admission(c,a,b,employee,task);
          if(!(await c.query(`SELECT 1 FROM managed_segments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND shift_id=$4 AND task_id=$5 AND mode='work' AND ended_at>started_at`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,b.taskId])).rowCount)throw httpError(422,'positive_closed_task_work_required');
          if((await c.query(`SELECT 1 FROM managed_execution_reports WHERE tenant_id=$1 AND project_id=$2 AND shift_id=$3 AND task_id=$4`,[a.tenantId,b.projectId,b.shiftId,b.taskId])).rowCount)throw httpError(409,'final_report_already_submitted');
          overPlan=(await c.query(`SELECT $1::numeric>$2::numeric over_plan`,[b.submittedQuantity,task.planned_quantity])).rows[0].over_plan;
        }else{
          if(shift.ended_at||!segment)throw httpError(409,'shift_closed');
          if(b.kind==='segment_change'&&b.taskId){
            const task=await this.task(c,a,b,b.taskId,b.mode==='work');
            if(b.mode==='work')await this.admission(c,a,b,employee,task);
            else if(!(await c.query(`SELECT 1 FROM managed_segments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND shift_id=$4 AND task_id=$5 AND mode='work'`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,b.taskId])).rowCount)throw httpError(422,'downtime_requires_prior_task_work');
          }
          await c.query(`UPDATE managed_segments SET ended_at=$6 WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND shift_id=$4 AND id=$5`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,segment.id,b.occurredAt]);
          if(b.kind==='shift_end')await c.query(`UPDATE managed_shifts SET ended_at=$5 WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND id=$4`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,b.occurredAt]);
          else await this.openSegment(c,a,b,b.mode,b.taskId,b.reasonCode,b.comment);
        }
      }
      await c.query(`UPDATE managed_execution_streams SET version=$3${b.kind==='submit_volume'?'':',last_interval_at=$4'} WHERE tenant_id=$1 AND employee_id=$2`,b.kind==='submit_volume'?[a.tenantId,b.employeeId,version]:[a.tenantId,b.employeeId,version,b.occurredAt]);
      const receivedAt=(await c.query(`SELECT clock_timestamp() received_at`)).rows[0].received_at as Date;
      const flags=executionReviewFlags(b.occurredAt,receivedAt,(b.kind==='shift_start'||b.kind==='shift_end')?b.geo?.capturedAt:undefined,overPlan);
      await c.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[a.tenantId,a.userId,b.requestId,b.employeeId,b.projectId,b.shiftId,b.kind,version,b.occurredAt,receivedAt,JSON.stringify(b.originalPayload),receipt.hash,JSON.stringify(flags)]);
      if(b.kind==='submit_volume')await c.query(`INSERT INTO managed_execution_reports(tenant_id,project_id,employee_id,shift_id,report_id,task_id,actor_user_id,request_id,submitted_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,b.reportId,b.taskId,a.userId,b.requestId,b.submittedQuantity]);
      const body={requestId:b.requestId,employeeId:b.employeeId,projectId:b.projectId,shiftId:b.shiftId,kind:b.kind,version,occurredAt:b.occurredAt,receivedAt:receivedAt.toISOString(),reviewFlags:flags,...(b.kind==='submit_volume'?{reportId:b.reportId,taskId:b.taskId,submittedQuantity:b.submittedQuantity,acceptedQuantity:null,provisional:true}:{})};
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'execution.command','managed_execution_event',$3,'ok',$4)`,[a.tenantId,a.userId,b.requestId,JSON.stringify({requestId:b.requestId,onBehalfReason:b.onBehalfReason??null,after:body})]);
      await completeCommand(c,a,b.requestId,201,body);
      return {requestId:b.requestId,outcome:'success',status:201,result:body};
    });
  }
  private async openSegment(c:PoolClient,a:Actor,b:ExecutionEvent,mode:string,taskId?:string,reasonCode?:string,comment?:string){
    await c.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,reason_code,comment,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[a.tenantId,b.projectId,b.employeeId,b.shiftId,randomUUID(),mode,taskId??null,reasonCode??null,comment??null,b.occurredAt]);
  }
}
