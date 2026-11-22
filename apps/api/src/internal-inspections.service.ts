import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from './workforce.service.js';
import { withTenant } from './db.js';
import { uuid } from './api-input.js';
import { integer, object, text } from './people-input.js';
import { httpError } from './errors.js';
import { executionScope, executionJoin } from './execution-read.js';
import { reserveCommand, replayCommand, completeCommand } from './durable-command.js';

type Action = 'submit' | 'resubmit' | 'responsible' | 'approve' | 'return' | 'partial';
type Row = Record<string, any>;
function input(value: unknown) {
  const action = value && typeof value === 'object' && !Array.isArray(value) ? String((value as {action?: unknown}).action) : '';
  const b = object(value, action === 'partial' ? ['requestId','expectedVersion','action','acceptedQuantity','reason'] : ['requestId','expectedVersion','action','expectedRouteVersion','reason']);
  if (!['submit','resubmit','responsible','approve','return','partial'].includes(action)) throw httpError(400,'invalid_action');
  if (!['return','resubmit','partial'].includes(action) && b.reason !== undefined) throw httpError(400,'invalid_body');
  if (action !== 'submit' && b.expectedRouteVersion !== undefined) throw httpError(400,'invalid_body');
  if (action === 'partial' && (typeof b.acceptedQuantity !== 'string' || !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(b.acceptedQuantity))) throw httpError(400,'invalid_quantity');
  return {requestId: uuid(b.requestId).toLowerCase(), expectedVersion: integer(b.expectedVersion,0), action: action as Action,
    ...(action === 'submit' ? {expectedRouteVersion: integer(b.expectedRouteVersion,0)} : {}),
    ...(action === 'partial' ? {acceptedQuantity: b.acceptedQuantity as string, reason: text(b.reason,500)} : {}),
    ...(['return','resubmit'].includes(action) ? {reason: text(b.reason,500)} : {})};
}
export class InternalInspectionsService {
  constructor(private readonly pool: Pool) {}
  private async source(c: PoolClient,a: Actor,project: string,part: string) {
    if (!['master','director','pto','worker'].includes(a.role)) throw httpError(403,'role_denied');
    const row = (await c.query(`SELECT v.id,s.report_id AS "reportId",s.task_id AS "taskId",t.title,t.unit,v.quantity::text AS quantity
      FROM accepted_volume_parts v JOIN managed_execution_reports s ON s.tenant_id=v.tenant_id AND s.report_id=v.report_id
      ${executionJoin} JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id
      WHERE ${executionScope} AND v.id=$4 AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$5)`,[a.tenantId,a.userId,project,part,a.role])).rows[0];
    if (!row) {
      const zero=(await c.query(`SELECT v.id FROM master_volume_reviews v JOIN managed_execution_reports s ON s.tenant_id=v.tenant_id AND s.report_id=v.report_id ${executionJoin} WHERE ${executionScope} AND v.id=$4 AND v.accepted_quantity=0 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role=$5)`,[a.tenantId,a.userId,project,part,a.role])).rowCount;
      throw httpError(zero?422:404,zero?'positive_part_required':'not_found');
    }
    row.replacedBy=(await c.query(`SELECT id,quantity::text FROM volume_corrections WHERE previous_part_id=$1 UNION ALL SELECT accepted_part_id,accepted_quantity::text FROM internal_inspection_splits WHERE original_part_id=$1 LIMIT 1`,[part])).rows[0]??null;
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
  private async pinnedMembers(c: PoolClient,a: Actor,project: string,snapshot: Row,lock=false) {
    for(const [field,role] of [['preparer','master'],['responsible','director'],['approver','pto']]) {
      if(!await this.member(c,a,project,snapshot[field].userId,role,lock))return false;
    }
    return true;
  }
  private async latest(c: PoolClient,project: string,task: string) {
    return (await c.query(`SELECT id,version,passed,blocks_next AS "blocksNext",created_at AS "createdAt" FROM checklist_runs WHERE project_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1`,[project,task])).rows[0]??null;
  }
  private async requirement(c: PoolClient,project: string,taskId: string) {
    const row=(await c.query(`SELECT COALESCE(wt.hidden_work,false) AS "hiddenWork",COALESCE(o.kind='subcontractor',false) AS subcontract,p.internal_inspection_required AS "projectRequired"
      FROM projects p LEFT JOIN daily_tasks t ON t.tenant_id=p.tenant_id AND t.project_id=p.id AND t.id=$2
      LEFT JOIN project_work_types wt ON wt.tenant_id=t.tenant_id AND wt.id=t.work_type_id
      LEFT JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.assignee_employee_id
      LEFT JOIN organizations o ON o.tenant_id=e.tenant_id AND o.id=e.organization_id
      WHERE p.id=$1`,[project,taskId])).rows[0];
    const hiddenWork=row?.hiddenWork===true,subcontract=row?.subcontract===true,projectRequired=row?.projectRequired!==false;
    const required=hiddenWork||subcontract||projectRequired;
    return {required,projectRequired,hiddenWork,subcontract,reason:hiddenWork?'hidden':subcontract?'subcontract':projectRequired?'project':'none'};
  }
  private async view(c: PoolClient,a: Actor,project: string,part: string,source?: Row) {
    const acceptedPart = source??await this.source(c,a,project,part);
    const requirement=await this.requirement(c,project,acceptedPart.taskId);
    const record = (await c.query(`SELECT id,snapshot,created_at AS "createdAt" FROM internal_inspections WHERE project_id=$1 AND accepted_part_id=$2`,[project,part])).rows[0]??null;
    const history = (await c.query(`SELECT version,action,from_state AS "fromState",to_state AS "toState",actor_user_id AS "actorUserId",actor_name AS "actorName",actor_role AS "actorRole",reason,request_id AS "requestId",created_at AS "createdAt" FROM internal_inspection_events WHERE accepted_part_id=$1 ORDER BY version`,[part])).rows;
    const state = history.at(-1)?.toState??'not_submitted',version=history.at(-1)?.version??0;
    const currentRoute = await this.route(c,a,project);
    const selfControl = await this.latest(c,project,acceptedPart.taskId);
    const passed = selfControl?.passed===true && selfControl.blocksNext===false;
    const attempts = (await c.query(`SELECT start_version AS "startVersion",previous_return_version AS "previousReturnVersion",snapshot,created_at AS "createdAt" FROM internal_inspection_attempts WHERE accepted_part_id=$1 ORDER BY start_version`,[part])).rows;
    const lastReturn=state==='returned'?history.at(-1):null;
    const fresh=!!lastReturn && passed && (await c.query(`SELECT EXISTS(SELECT 1 FROM checklist_runs cr JOIN internal_inspection_events ev ON ev.tenant_id=cr.tenant_id AND ev.accepted_part_id=$2 AND ev.version=$3 AND ev.action IN('return','returned_share') WHERE cr.id=$1 AND cr.created_at>ev.created_at) AS fresh`,[selfControl.id,part,lastReturn.version])).rows[0].fresh;
    const participantsReady=record?await this.pinnedMembers(c,a,project,record.snapshot):false;
    const actor = await this.member(c,a,project,a.userId,a.role);
    const allowedActions: Action[] = [];
    if (actor && a.role==='master' && state==='not_submitted' && currentRoute.ready && currentRoute.preparer.userId===a.userId && passed && requirement.required) allowedActions.push('submit');
    if(actor && a.role==='master' && lastReturn && record.snapshot.preparer.userId===a.userId && fresh && participantsReady)allowedActions.push('resubmit');
    if (actor && a.role==='director' && state==='awaiting_responsibility' && record?.snapshot.responsible.userId===a.userId) allowedActions.push('responsible');
    if (actor && a.role==='pto' && state==='awaiting_pto' && record?.snapshot.approver.userId===a.userId) {if(passed)allowedActions.push('approve','partial');allowedActions.push('return');}
    const split=(await c.query(`SELECT original_part_id AS "originalPartId",accepted_part_id AS "acceptedPartId",returned_part_id AS "returnedPartId",accepted_quantity::text AS "acceptedQuantity",returned_quantity::text AS "returnedQuantity",reason,CASE WHEN original_part_id=$1 THEN 'source' WHEN accepted_part_id=$1 THEN 'accepted' ELSE 'returned' END AS role FROM internal_inspection_splits WHERE original_part_id=$1 OR accepted_part_id=$1 OR returned_part_id=$1`,[part])).rows[0]??null;
    return {acceptedPart,version,state,currentRoute,selfControl,requirement,record,history,split,attempts,attemptNumber:Math.floor((Math.max(version,1)-1)/3)+1,resubmission:lastReturn?{needsFreshSelfControl:!fresh,participantsReady}:null,allowedActions:acceptedPart.replacedBy?[]:allowedActions};
  }
  read(a: Actor,project: string,part: string) {
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      // Writers take this same project lock before tasks and live memberships.
      // A read must not combine the header from before submit with newer events.
      if(!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR SHARE`,[project])).rowCount)throw httpError(404,'not_found');
      return this.view(c,a,project,part);
    });
  }
  readPolicy(a: Actor,project: string) {
    if(!['director','master','pto'].includes(a.role))throw httpError(403,'role_denied');
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const row=(await c.query(`SELECT internal_inspection_required AS required,inspection_policy_version AS version FROM projects p WHERE p.id=$1 AND ($2='director' OR EXISTS(SELECT 1 FROM project_memberships pm WHERE pm.tenant_id=p.tenant_id AND pm.project_id=p.id AND pm.user_id=$3 AND pm.status='active'))`,[project,a.role,a.userId])).rows[0];
      if(!row)throw httpError(404,'not_found');
      return row;
    });
  }
  savePolicy(a: Actor,project: string,value: unknown) {
    const b=object(value,['requestId','expectedVersion','required']);
    if(typeof b.required!=='boolean')throw httpError(400,'invalid_boolean');
    const body={requestId:uuid(b.requestId).toLowerCase(),expectedVersion:integer(b.expectedVersion,0),required:b.required};
    if(a.role!=='director')throw httpError(403,'role_denied');
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const receipt=await reserveCommand(c,a,`POST /projects/${project}/internal-inspection-policy`,body);
      if(!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`,[project])).rowCount)throw httpError(404,'not_found');
      const member=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
      if(!member||member.status!=='active'||member.role!=='director')throw httpError(403,'role_denied');
      if(!receipt.inserted)return replayCommand(c,a,body.requestId,receipt.hash);
      const current=(await c.query(`SELECT inspection_policy_version AS version FROM projects WHERE id=$1`,[project])).rows[0];
      if(Number(current.version)!==body.expectedVersion)throw httpError(409,'stale_version');
      const saved=(await c.query(`UPDATE projects SET internal_inspection_required=$2,inspection_policy_version=inspection_policy_version+1 WHERE id=$1 RETURNING internal_inspection_required AS required,inspection_policy_version AS version`,[project,body.required])).rows[0];
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.internal_inspection_policy','project',$3,'ok',$4)`,[a.tenantId,a.userId,project,JSON.stringify({requestId:body.requestId,required:saved.required,version:saved.version})]);
      return completeCommand(c,a,body.requestId,200,saved);
    });
  }
  act(a: Actor,project: string,part: string,value: unknown) {
    const b=input(value);
    const expectedRole = ['submit','resubmit'].includes(b.action)?'master':b.action==='responsible'?'director':'pto';
    if(a.role!==expectedRole)throw httpError(403,'role_denied');
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const receipt=await reserveCommand(c,a,`POST /projects/${project}/accepted-parts/${part}/internal-inspection`,b);
      if(!(await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`,[project])).rowCount)throw httpError(404,'not_found');
      if(!await this.member(c,a,project,a.userId,expectedRole,true))throw httpError(403,'role_denied');
      const source=await this.source(c,a,project,part);
      await c.query(`SELECT id FROM daily_tasks WHERE project_id=$1 AND id=$2 FOR NO KEY UPDATE`,[project,source.taskId]);
      if(!receipt.inserted)return replayCommand(c,a,b.requestId,receipt.hash);
      if(source.replacedBy)throw httpError(409,'part_superseded');
      const current=await this.view(c,a,project,part,source);
      if(current.version!==b.expectedVersion)throw httpError(409,'stale_version');
      if(b.action==='submit' && !current.requirement.required)throw httpError(422,'inspection_not_required');
      if(current.state==='accepted'||(current.state==='returned'&&b.action!=='resubmit'))throw httpError(409,'inspection_closed');
      let pinnedRoute=current.currentRoute;
      if(b.action==='submit'){
        const route=await this.route(c,a,project,true);
        if(!route.ready)throw httpError(422,'route_not_configured');
        if(route.version!==b.expectedRouteVersion)throw httpError(409,'route_changed');
        if(route.preparer.userId!==a.userId)throw httpError(403,'route_denied');
        pinnedRoute=route;
      }
      if(b.action==='resubmit'){
        if(current.state!=='returned')throw httpError(409,'inspection_not_returned');
        if(current.record.snapshot.preparer.userId!==a.userId)throw httpError(403,'route_denied');
        if(!await this.pinnedMembers(c,a,project,current.record.snapshot,true))throw httpError(422,'pinned_participant_unavailable');
        if(current.resubmission?.needsFreshSelfControl)throw httpError(422,'fresh_self_control_required');
      }
      if(!current.allowedActions.includes(b.action)) {
        if(['submit','approve','partial'].includes(b.action) && (!current.selfControl?.passed||current.selfControl.blocksNext))throw httpError(422,'self_control_required');
        throw httpError(403,'route_denied');
      }
      if(b.action==='partial')return completeCommand(c,a,b.requestId,201,await this.divide(c,a,project,part,source,current,b));
      const next = ['submit','resubmit'].includes(b.action)?'awaiting_responsibility':b.action==='responsible'?'awaiting_pto':b.action==='approve'?'accepted':'returned';
      if(b.action==='submit'){
        const route=pinnedRoute;
        const snapshot={acceptedPart:source,configurationVersion:route.version,preparer:route.preparer,responsible:route.responsible,approver:route.approver,selfControl:current.selfControl};
        await c.query(`INSERT INTO internal_inspections(tenant_id,accepted_part_id,project_id,id,configuration_version,preparer_user_id,responsible_user_id,approver_user_id,checklist_run_id,quantity,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,part,project,randomUUID(),route.version,route.preparer.userId,route.responsible.userId,route.approver.userId,current.selfControl.id,source.quantity,JSON.stringify(snapshot)]);
      }
      if(b.action==='resubmit'){
        const snapshot={...current.record.snapshot,selfControl:current.selfControl,previousReturnVersion:current.version,correctionReason:b.reason};
        await c.query(`INSERT INTO internal_inspection_attempts(tenant_id,accepted_part_id,start_version,previous_return_version,checklist_run_id,actor_user_id,request_id,snapshot)VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[a.tenantId,part,current.version+1,current.version,current.selfControl.id,a.userId,b.requestId,JSON.stringify(snapshot)]);
      }
      const actor=await this.member(c,a,project,a.userId,expectedRole);
      await c.query(`INSERT INTO internal_inspection_events(tenant_id,accepted_part_id,version,action,from_state,to_state,actor_user_id,actor_name,actor_role,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,part,current.version+1,b.action,current.state,next,a.userId,actor.name,expectedRole,b.reason??null,b.requestId]);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.internal_inspection','accepted_part',$3,'ok',$4)`,[a.tenantId,a.userId,part,JSON.stringify({requestId:b.requestId,action:b.action,version:current.version+1,fromState:current.state,toState:next,quantity:source.quantity,selfControl:current.selfControl})]);
      return completeCommand(c,a,b.requestId,201,await this.view(c,a,project,part,source));
    });
  }
  private async divide(c: PoolClient,a: Actor,project: string,part: string,source: Row,current: Row,b: {requestId: string; acceptedQuantity?: string; reason?: string}) {
    const shares=(await c.query(`SELECT ($2::numeric(14,3)>0 AND $2::numeric(14,3)<quantity) AS ok,$2::numeric(14,3)::text AS accepted,(quantity-$2::numeric(14,3))::text AS returned FROM accepted_volume_parts WHERE id=$1`,[part,b.acceptedQuantity])).rows[0];
    if(!shares?.ok)throw httpError(422,'partial_share_required');
    const splitId=randomUUID(),acceptedPartId=randomUUID(),returnedPartId=randomUUID();
    const parent=(await c.query(`SELECT configuration_version,preparer_user_id,responsible_user_id,approver_user_id,checklist_run_id,snapshot FROM internal_inspections WHERE accepted_part_id=$1`,[part])).rows[0];
    if(!parent)throw httpError(409,'inspection_closed');
    await c.query(`INSERT INTO internal_inspection_splits(tenant_id,id,report_id,original_part_id,accepted_part_id,returned_part_id,accepted_quantity,returned_quantity,reason,inspection_version,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[a.tenantId,splitId,source.reportId,part,acceptedPartId,returnedPartId,shares.accepted,shares.returned,b.reason,current.version+1,a.userId,b.requestId]);
    const actor=await this.member(c,a,project,a.userId,'pto');
    if(!actor)throw httpError(403,'route_denied');
    for(const share of [{id:acceptedPartId,quantity:shares.accepted,action:'accepted_share',to:'accepted',reason:null},{id:returnedPartId,quantity:shares.returned,action:'returned_share',to:'returned',reason:b.reason}]){
      const requestId=randomUUID();
      const snapshot={...parent.snapshot,acceptedPart:{...parent.snapshot.acceptedPart,id:share.id,quantity:share.quantity}};
      await c.query(`INSERT INTO internal_inspections(tenant_id,accepted_part_id,project_id,id,configuration_version,preparer_user_id,responsible_user_id,approver_user_id,checklist_run_id,quantity,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,share.id,project,randomUUID(),parent.configuration_version,parent.preparer_user_id,parent.responsible_user_id,parent.approver_user_id,parent.checklist_run_id,share.quantity,JSON.stringify(snapshot)]);
      await c.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash) VALUES($1,$2,$3,'internal-inspection-share',$4)`,[a.tenantId,a.userId,requestId,splitId]);
      await c.query(`INSERT INTO internal_inspection_events(tenant_id,accepted_part_id,version,action,from_state,to_state,actor_user_id,actor_name,actor_role,reason,request_id) VALUES($1,$2,3,$3,'awaiting_pto',$4,$5,$6,'pto',$7,$8)`,[a.tenantId,share.id,share.action,share.to,a.userId,actor.name,share.reason,requestId]);
    }
    await c.query(`INSERT INTO internal_inspection_events(tenant_id,accepted_part_id,version,action,from_state,to_state,actor_user_id,actor_name,actor_role,reason,request_id) VALUES($1,$2,$3,'partial',$4,'split',$5,$6,'pto',$7,$8)`,[a.tenantId,part,current.version+1,current.state,a.userId,actor.name,b.reason,b.requestId]);
    await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'quality.internal_inspection','accepted_part',$3,'ok',$4)`,[a.tenantId,a.userId,part,JSON.stringify({requestId:b.requestId,action:'partial',version:current.version+1,acceptedPartId,returnedPartId,acceptedQuantity:shares.accepted,returnedQuantity:shares.returned})]);
    source.replacedBy={id:acceptedPartId,quantity:shares.accepted};
    return this.view(c,a,project,part,source);
  }
}
