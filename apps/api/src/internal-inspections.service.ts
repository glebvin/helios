import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { uuid } from './api-input.js';
import { integer, object, text } from './people-input.js';
import { httpError } from './errors.js';
import { executionScope, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

type Action = 'submit' | 'responsible' | 'approve' | 'return';
type Row = Record<string, any>;
function input(value: unknown) {
  const b = object(value, ['requestId','expectedVersion','action','expectedRouteVersion','reason']);
  if (!['submit','responsible','approve','return'].includes(String(b.action))) throw httpError(400,'invalid_action');
  const action = b.action as Action;
  if (action !== 'return' && b.reason !== undefined) throw httpError(400,'invalid_body');
  if (action !== 'submit' && b.expectedRouteVersion !== undefined) throw httpError(400,'invalid_body');
  return {requestId: uuid(b.requestId).toLowerCase(), expectedVersion: integer(b.expectedVersion,0), action,
    ...(action === 'submit' ? {expectedRouteVersion: integer(b.expectedRouteVersion,0)} : {}),
    ...(action === 'return' ? {reason: text(b.reason,500)} : {})};
}
export class InternalInspectionsService {
  constructor(private readonly pool: Pool) {}
  private async source(c: PoolClient,a: Actor,project: string,part: string) {
    if (!['master','director','pto','worker'].includes(a.role)) throw httpError(403,'role_denied');
    const row = (await c.query(`SELECT v.id,s.report_id AS "reportId",s.task_id AS "taskId",t.title,t.unit,v.accepted_quantity::text AS quantity
      FROM master_volume_reviews v JOIN managed_execution_reports s ON s.tenant_id=v.tenant_id AND s.report_id=v.report_id
      ${executionJoin} JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id
      WHERE ${executionScope} AND v.id=$4 AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$5)`,[a.tenantId,a.userId,project,part,a.role])).rows[0];
    if (!row) throw httpError(404,'not_found');
    if (Number(row.quantity) <= 0) throw httpError(422,'positive_part_required');
    return row;
  }
  private async member(c: PoolClient,a: Actor,project: string,id: string|null,role: string,lock=false) {
    if (!id) return null;
    return (await c.query(`SELECT m.user_id AS "userId",m.role,u.name FROM memberships m JOIN users u ON u.id=m.user_id
      JOIN project_memberships pm ON pm.tenant_id=m.tenant_id AND pm.user_id=m.user_id
      WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role=$3 AND m.status='active' AND pm.project_id=$4 AND pm.status='active'${lock?' FOR SHARE OF m,pm':''}`,[a.tenantId,id,role,project])).rows[0]??null;
  }
  private async route(c: PoolClient,a: Actor,project: string,lock=false) {
    const config = (await c.query(`SELECT version,configuration FROM route_config_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1`,[project])).rows[0];
    const route = config?.configuration.routes.find((r: Row) => r.documentType === 'internal-inspection');
    const preparer = await this.member(c,a,project,route?.preparers[0]?.userId??null,'master',lock);
    const responsible = await this.member(c,a,project,route?.responsibles[0]?.userId??null,'director',lock);
    const approver = await this.member(c,a,project,route?.approvers[0]?.userId??null,'pto',lock);
    return {version:config?.version??0, ready:!!preparer&&!!responsible&&!!approver,preparer,responsible,approver};
  }
  private async latest(c: PoolClient,project: string,task: string) {
    return (await c.query(`SELECT id,version,passed,blocks_next AS "blocksNext" FROM checklist_runs WHERE project_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`,[project,task])).rows[0]??null;
  }
  private async view(c: PoolClient,a: Actor,project: string,part: string,source?: Row) {
    const acceptedPart = source??await this.source(c,a,project,part);
    const record = (await c.query(`SELECT id,snapshot,created_at AS "createdAt" FROM internal_inspections WHERE project_id=$1 AND accepted_part_id=$2`,[project,part])).rows[0]??null;
    const history = (await c.query(`SELECT version,action,from_state AS "fromState",to_state AS "toState",actor_user_id AS "actorUserId",actor_name AS "actorName",actor_role AS "actorRole",reason,request_id AS "requestId",created_at AS "createdAt" FROM internal_inspection_events WHERE accepted_part_id=$1 ORDER BY version`,[part])).rows;
    const state = history.at(-1)?.toState??'not_submitted',version=history.at(-1)?.version??0;
    const currentRoute = await this.route(c,a,project);
    const selfControl = await this.latest(c,project,acceptedPart.taskId);
    const passed = selfControl?.passed===true && selfControl.blocksNext===false;
    const actor = await this.member(c,a,project,a.userId,a.role);
    const allowedActions: Action[] = [];
    if (actor && a.role==='master' && state==='not_submitted' && currentRoute.ready && currentRoute.preparer.userId===a.userId && passed) allowedActions.push('submit');
    if (actor && a.role==='director' && state==='awaiting_responsibility' && record?.snapshot.responsible.userId===a.userId) allowedActions.push('responsible');
    if (actor && a.role==='pto' && state==='awaiting_pto' && record?.snapshot.approver.userId===a.userId) {if(passed)allowedActions.push('approve');allowedActions.push('return');}
    return {acceptedPart,version,state,currentRoute,selfControl,record,history,allowedActions};
  }
  read(a: Actor,project: string,part: string) {
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      // Writers take this same project lock before tasks and live memberships.
      // A read must not combine the header from before submit with newer events.
      if(!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR SHARE`,[project])).rowCount)throw httpError(404,'not_found');
      return this.view(c,a,project,part);
    });
  }
  act(a: Actor,project: string,part: string,value: unknown) {
    const b=input(value);
    const expectedRole = b.action==='submit'?'master':b.action==='responsible'?'director':'pto';
    if(a.role!==expectedRole)throw httpError(403,'role_denied');
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const receipt=await reserveCommand(c,a,`POST /projects/${project}/accepted-parts/${part}/internal-inspection`,b);
      if(!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`,[project])).rowCount)throw httpError(404,'not_found');
      if(!await this.member(c,a,project,a.userId,expectedRole,true))throw httpError(403,'role_denied');
      const source=await this.source(c,a,project,part);
      await c.query(`SELECT id FROM daily_tasks WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE`,[project,source.taskId]);
      if(!receipt.inserted)return replayCommand(c,a,b.requestId,receipt.hash);
      const current=await this.view(c,a,project,part,source);
      if(current.version!==b.expectedVersion)throw httpError(409,'stale_version');
      if(['accepted','returned'].includes(current.state))throw httpError(409,'inspection_closed');
      let pinnedRoute=current.currentRoute;
      if(b.action==='submit'){
        const route=await this.route(c,a,project,true);
        if(!route.ready)throw httpError(422,'route_not_configured');
        if(route.version!==b.expectedRouteVersion)throw httpError(409,'route_changed');
        if(route.preparer.userId!==a.userId)throw httpError(403,'route_denied');
        pinnedRoute=route;
      }
      if(!current.allowedActions.includes(b.action)) {
        if(['submit','approve'].includes(b.action) && (!current.selfControl?.passed||current.selfControl.blocksNext))throw httpError(422,'self_control_required');
        throw httpError(403,'route_denied');
      }
      const next = b.action==='submit'?'awaiting_responsibility':b.action==='responsible'?'awaiting_pto':b.action==='approve'?'accepted':'returned';
      if(b.action==='submit'){
        const route=pinnedRoute;
        const snapshot={acceptedPart:source,configurationVersion:route.version,preparer:route.preparer,responsible:route.responsible,approver:route.approver,selfControl:current.selfControl};
        await c.query(`INSERT INTO internal_inspections(tenant_id,accepted_part_id,project_id,id,configuration_version,preparer_user_id,responsible_user_id,approver_user_id,checklist_run_id,quantity,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,part,project,randomUUID(),route.version,route.preparer.userId,route.responsible.userId,route.approver.userId,current.selfControl.id,source.quantity,JSON.stringify(snapshot)]);
      }
      const actor=await this.member(c,a,project,a.userId,expectedRole);
      await c.query(`INSERT INTO internal_inspection_events(tenant_id,accepted_part_id,version,action,from_state,to_state,actor_user_id,actor_name,actor_role,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,part,current.version+1,b.action,current.state,next,a.userId,actor.name,expectedRole,b.reason??null,b.requestId]);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.internal_inspection','accepted_part',$3,'ok',$4)`,[a.tenantId,a.userId,part,JSON.stringify({requestId:b.requestId,action:b.action,version:current.version+1,fromState:current.state,toState:next,quantity:source.quantity,selfControl:current.selfControl})]);
      return completeCommand(c,a,b.requestId,201,await this.view(c,a,project,part,source));
    });
  }
}
