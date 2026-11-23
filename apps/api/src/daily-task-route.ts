import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import type {TaskAction} from './task-input.js';
import {httpError} from './errors.js';
type Row=Record<string,any>;

// Caller holds the project lock before loading this hint. Attempts/configurations are immutable.
export async function dailyRouteHint(c:PoolClient,a:Actor,p:string,id:string){
 const config=(await c.query(`SELECT version,configuration FROM route_config_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1`,[a.tenantId,p])).rows[0]??null;
 const attempt=(await c.query(`SELECT id,attempt,config_version AS "configVersion",plan_revision AS "planRevision",preparer_user_id AS "preparerUserId",responsible_user_id AS "responsibleUserId",approver_user_id AS "approverUserId",snapshot,created_at AS "createdAt" FROM daily_task_route_attempts WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 ORDER BY attempt DESC LIMIT 1`,[a.tenantId,p,id])).rows[0]??null;
 const daily=config?.configuration.routes.find((r:Row)=>r.documentType==='daily-task')??null;
 const configured=!!config||!!attempt;
 const core=daily?[daily.preparers[0]?.userId,daily.responsibles[0]?.userId,daily.approvers[0]?.userId]:[];
 const memberIds=[...new Set([...core,attempt?.preparerUserId,attempt?.responsibleUserId,attempt?.approverUserId].filter((x):x is string=>typeof x==='string'))];
 return {config,daily,attempt,configured,memberIds};
}
export type DailyRouteHint=Awaited<ReturnType<typeof dailyRouteHint>>;
async function routeMember(c:PoolClient,a:Actor,p:string,userId:string,role:string){
 return (await c.query(`SELECT m.user_id AS "userId",m.role,u.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role=$3 AND m.status='active' AND pm.project_id=$4 AND pm.status='active'`,[a.tenantId,userId,role,p])).rows[0]??null;
}
async function actorRole(c:PoolClient,a:Actor,p:string){
 const member=(await c.query(`SELECT m.role FROM memberships m JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND pm.project_id=$3 AND pm.status='active'`,[a.tenantId,a.userId,p])).rows[0];
 if(!member||!['director','master','pto'].includes(member.role))throw httpError(403,'role_denied');return member.role as string;
}
async function permitted(c:PoolClient,a:Actor,p:string,t:Row,h:DailyRouteHint){
 const role=await actorRole(c,a,p),allowed:TaskAction[]=[];
 if(t.status==='draft'){
  if(role==='master'&&h.daily?.preparers[0]?.userId===a.userId)allowed.push('submit');
  if(['master','director'].includes(role))allowed.push('cancel');
 }else if(t.status==='pending_approval'){
  if(role==='director'&&h.attempt?.approverUserId===a.userId)allowed.push('publish','reject');
  if(role==='master'&&(!h.attempt||h.attempt.preparerUserId===a.userId))allowed.push('reopen');
  if((role==='master'&&(!h.attempt||h.attempt.preparerUserId===a.userId))||(role==='director'&&(!h.attempt||[h.attempt.responsibleUserId,h.attempt.approverUserId].includes(a.userId))))allowed.push('cancel');
 }else if(t.status==='published'&&role==='director'&&(!h.attempt||[h.attempt.responsibleUserId,h.attempt.approverUserId].includes(a.userId)))allowed.push('cancel');
 return allowed;
}
// Called only inside TasksService's existing receipt/locks/readiness transaction.
export async function recordDailyTransition(c:PoolClient,a:Actor,p:string,t:Row,action:TaskAction,requestId:string,reason:string|undefined,h:DailyRouteHint){
 if(!h.configured)return;
 if(['publish','reject'].includes(action)&&!h.attempt)throw httpError(409,'route_snapshot_required');
 if(!(await permitted(c,a,p,t,h)).includes(action))throw httpError(403,'role_denied');
 let attempt=h.attempt;
 if(action==='submit'){
  const [preparerId,responsibleId,approverId]=[h.daily?.preparers[0]?.userId,h.daily?.responsibles[0]?.userId,h.daily?.approvers[0]?.userId];
  if(!h.config||![preparerId,responsibleId,approverId].every(x=>typeof x==='string'))throw httpError(422,'route_not_configured');
  const preparer=await routeMember(c,a,p,preparerId,'master');
  const responsible=await routeMember(c,a,p,responsibleId,'director');
  const approver=await routeMember(c,a,p,approverId,'director');
  if(!preparer||!responsible||!approver)throw httpError(422,'route_participant_inactive');
  const snapshot={schemaVersion:1,configurationVersion:h.config.version,route:h.daily,preparer,responsible,approver};
  attempt={id:randomUUID(),attempt:(attempt?.attempt??0)+1,configVersion:h.config.version,planRevision:t.planRevision,preparerUserId:preparerId,responsibleUserId:responsibleId,approverUserId:approverId,snapshot};
  await c.query(`INSERT INTO daily_task_route_attempts(tenant_id,project_id,task_id,id,attempt,config_version,plan_revision,preparer_user_id,responsible_user_id,approver_user_id,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,p,t.id,attempt.id,attempt.attempt,attempt.configVersion,t.planRevision,preparerId,responsibleId,approverId,JSON.stringify(snapshot)]);
 }else if(['publish','reject'].includes(action)){
  if(attempt.planRevision!==t.planRevision)throw httpError(409,'route_plan_changed');
  if(!(await routeMember(c,a,p,attempt.approverUserId,'director')))throw httpError(403,'role_denied');
 }
 const toStatus=action==='submit'?'pending_approval':action==='publish'?'published':action==='cancel'?'cancelled':'draft';
 const actor=(await c.query('SELECT name FROM users WHERE id=$1',[a.userId])).rows[0];
 const role=await actorRole(c,a,p);
 await c.query(`INSERT INTO daily_task_route_events(tenant_id,project_id,task_id,id,attempt_id,task_version,action,from_status,to_status,actor_user_id,actor_name,reason,request_id,actor_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[a.tenantId,p,t.id,randomUUID(),attempt?.id??null,t.version+1,action,t.status,toStatus,a.userId,actor.name,reason??null,requestId,role]);
}
export async function dailyRouteReplayScope(c:PoolClient,a:Actor,p:string,id:string,requestId:string){
 const event=(await c.query('SELECT actor_role FROM daily_task_route_events WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND actor_user_id=$4 AND request_id=$5',[a.tenantId,p,id,a.userId,requestId])).rows[0];
 // Old successful receipts remain historical results; a routed receipt must retain its live scope.
 if(event&&await actorRole(c,a,p)!==event.actor_role)throw httpError(403,'role_denied');
}
async function routeDeadline(c:PoolClient,plannedEnd:string|Date|null){
 if(!plannedEnd)return {dueAt:null,deadlineState:'not-configured'};
 const dueAt=new Date(plannedEnd).toISOString();
 const overdue=(await c.query(`SELECT $1::timestamptz < now() AS overdue`,[plannedEnd])).rows[0].overdue===true;
 return {dueAt,deadlineState:overdue?'overdue':'scheduled'};
}
export async function dailyRouteRead(c:PoolClient,a:Actor,p:string,t:Row){
 const h=await dailyRouteHint(c,a,p,t.id);
 if(!h.configured)return {configured:false,taskVersion:t.version,route:null,allowedActions:null};
 const actions=await permitted(c,a,p,t,h);
 const events=(await c.query(`SELECT id,attempt_id AS "attemptId",task_version AS "taskVersion",action,from_status AS "fromStatus",to_status AS "toStatus",actor_user_id AS "actorUserId",actor_name AS "actorName",reason,created_at AS "createdAt" FROM daily_task_route_events WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 ORDER BY task_version`,[a.tenantId,p,t.id])).rows;
 const holderId=t.status==='pending_approval'?h.attempt?.approverUserId:t.status==='draft'?h.daily?.preparers[0]?.userId:null;
 const holder=holderId?(await c.query('SELECT id AS "userId",name FROM users WHERE id=$1',[holderId])).rows[0]??null:null;
 const deadline=await routeDeadline(c,t.plannedEnd??null);
 return {configured:true,taskVersion:t.version,allowedActions:actions,route:{attempt:h.attempt?{id:h.attempt.id,number:h.attempt.attempt,configurationVersion:h.attempt.configVersion,planRevision:h.attempt.planRevision,snapshot:h.attempt.snapshot}:null,currentConfigurationVersion:h.config?.version??null,holder,...deadline,nextStep:t.status==='pending_approval'?(h.attempt?'approve-or-return':'reopen-and-submit'):t.status==='draft'?'prepare-and-submit':t.status==='published'?'execute':'none',history:events}};
}
