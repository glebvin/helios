import type {Pool,PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {reserveCommand,replayCommand,completeCommand} from './durable-command.js';
import {evidenceTimeScope} from './evidence-time-scope.js';
import {timeCommand,totalKeys,type Totals} from './time-input.js';
import {timeSource,canonicalSource} from './time-source.js';
import type {Page} from './api-input.js';
type Row=Record<string,any>;
export class TimeService {
 constructor(private readonly pool:Pool){}
 private async scope(c:PoolClient,a:Actor,p:string,e:string,director=false){const scope=await evidenceTimeScope(c,a,p,[e]);if(director&&scope.role!=='director')throw httpError(403,'role_denied');return scope;}
 private values(a:Actor,p:string,e:string,day:string){return [a.tenantId,p,e,day];}
 private async latest(c:PoolClient,a:Actor,p:string,e:string,day:string){return (await c.query(`SELECT r.* FROM time_approval_heads h JOIN time_approval_revisions r USING(tenant_id,project_id,employee_id,day,version) WHERE h.tenant_id=$1 AND h.project_id=$2 AND h.employee_id=$3 AND h.day=$4`,this.values(a,p,e,day))).rows[0] as Row|undefined;}
 private revision(r:Row){return {version:Number(r.version),previousVersion:r.previous_version===null?null:Number(r.previous_version),state:r.state,source:r.source,sourceHash:r.source_hash,sourceTotals:r.source_totals,confirmedTotals:r.confirmed_totals,overridden:r.overridden,reason:r.reason,acknowledgedSuspicious:r.acknowledged_suspicious,actorUserId:r.actor_user_id,requestId:r.request_id,recordedAt:r.recorded_at.toISOString(),confirmedTaskAllocation:r.overridden?null:r.source.tasks};}
 private result(e:string,p:string,day:string,current:Awaited<ReturnType<typeof timeSource>>,latest?:Row){
 const isCurrent=latest?.state==='approved'&&latest.source_hash===current.sourceHash;
 return {projectId:p,employeeId:e,day,...current,approvalVersion:latest?Number(latest.version):0,latest:latest?this.revision(latest):null,isCurrent,status:!latest?'unapproved':latest.state==='revoked'?'revoked':isCurrent?'current':'stale'};
 }
 day(a:Actor,p:string,e:string,day:string){return withTenant(this.pool,a.tenantId,a.userId,async c=>{await this.scope(c,a,p,e);return this.result(e,p,day,await timeSource(c,a,p,e,day),await this.latest(c,a,p,e,day));});}
 history(a:Actor,p:string,e:string,day:string,page:Page){return withTenant(this.pool,a.tenantId,a.userId,async c=>{await this.scope(c,a,p,e);const v=this.values(a,p,e,day),where='tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND day=$4';const total=(await c.query(`SELECT count(*)::int n FROM time_approval_revisions WHERE ${where}`,v)).rows[0].n;const rows=(await c.query(`SELECT * FROM time_approval_revisions WHERE ${where} ORDER BY version DESC LIMIT $5 OFFSET $6`,[...v,page.limit,page.offset])).rows;return {items:rows.map(r=>this.revision(r)),total,...page};});}
 command(a:Actor,p:string,e:string,day:string,input:unknown,revoke=false){
 const b=timeCommand(input,revoke);
 return withTenant(this.pool,a.tenantId,a.userId,async c=>{
  // Shared receipt namespace precedes all scope locks; a rejected command rolls back its reservation.
  const payload={...b,projectId:p,employeeId:e,day};
  // Undefined properties are omitted consistently from the durable command payload.
  const receipt=await reserveCommand(c,a,revoke?'POST /time/revoke':'POST /time/approvals',JSON.parse(JSON.stringify(payload)));
  await this.scope(c,a,p,e,true);
  if(!receipt.inserted)return replayCommand(c,a,b.requestId,receipt.hash);
  await c.query(`SELECT version FROM time_approval_heads WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND day=$4 FOR NO KEY UPDATE`,this.values(a,p,e,day));
  const latest=await this.latest(c,a,p,e,day),version=latest?Number(latest.version):0;
  if(version!==b.expectedApprovalVersion)throw httpError(409,'stale_approval_version');
  let source:Row,sourceHash:string,sourceTotals:Totals,confirmedTotals:Totals,overridden:boolean,acknowledged:boolean;
  const current=await timeSource(c,a,p,e,day);
  if(revoke){
   if(!latest||latest.state!=='approved')throw httpError(409,'approval_required');
   source=latest.source;sourceHash=latest.source_hash;sourceTotals=latest.source_totals;confirmedTotals=latest.confirmed_totals;overridden=latest.overridden;acknowledged=latest.acknowledged_suspicious;
  }else{
   if(current.sourceHash!==b.sourceHash)throw httpError(409,'stale_source');
   if(!current.recorded)throw httpError(422,'recorded_time_required');
   if(current.source.hasOpenIntervals)throw httpError(422,'open_intervals');
   if(current.future)throw httpError(422,'future_day');
   if(current.source.suspicious&&!b.acknowledgeSuspicious)throw httpError(422,'suspicious_acknowledgment_required');
   source=current.source;sourceHash=current.sourceHash;sourceTotals=current.source.totals;confirmedTotals=b.confirmedTotals??sourceTotals;
   const sum=['idleMs','workMs','breakMs','downtimeMs'].reduce((n,k)=>n+BigInt(confirmedTotals[k as keyof Totals]),0n);
   if(sum!==BigInt(confirmedTotals.presenceMs)||sum>BigInt(current.dayLengthMs))throw httpError(422,'invalid_confirmed_totals');
   overridden=canonicalSource(sourceTotals)!==canonicalSource(confirmedTotals);acknowledged=b.acknowledgeSuspicious??false;
  }
  const state=revoke?'revoked':'approved',v=this.values(a,p,e,day);
  await c.query(`INSERT INTO time_approval_revisions(tenant_id,project_id,employee_id,day,version,previous_version,state,source,source_hash,source_totals,confirmed_totals,overridden,reason,acknowledged_suspicious,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[...v,version+1,version||null,state,JSON.stringify(source),sourceHash,JSON.stringify(sourceTotals),JSON.stringify(confirmedTotals),overridden,b.reason,acknowledged,a.userId,b.requestId]);
  await c.query(`INSERT INTO time_approval_heads(tenant_id,project_id,employee_id,day,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,project_id,employee_id,day) DO UPDATE SET version=EXCLUDED.version`,[...v,version+1]);
  const body=this.result(e,p,day,current,await this.latest(c,a,p,e,day));
  await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,$3,'time_approval',$4,'ok',$5)`,[a.tenantId,a.userId,revoke?'time_revoked':'time_approved',e,JSON.stringify({day,projectId:p,version:version+1,sourceHash,reason:b.reason,requestId:b.requestId})]);
  return completeCommand(c,a,b.requestId,201,body);
 });
 }
}
