import type {Pool,PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import {reserveCommand,replayCommand,completeCommand} from './durable-command.js';
import {evidenceTimeScope} from './evidence-time-scope.js';
import {timeCommand,totalKeys,type Totals} from './time-input.js';
import {timeSource,canonicalSource,recordedTimePredicate} from './time-source.js';
import {executionClock} from './execution-read.js';
import {TimeXlsx,type TimeExportRow} from './time-xlsx.js';
import type {Page} from './api-input.js';
type Row=Record<string,any>;
export class TimeService {
 constructor(private readonly pool:Pool){}
 private readonly xlsx=new TimeXlsx();
 private async scope(c:PoolClient,a:Actor,p:string,e:string,director=false){const scope=await evidenceTimeScope(c,a,p,[e]);if(director&&scope.role!=='director')throw httpError(403,'role_denied');return scope;}
 private values(a:Actor,p:string,e:string,day:string){return [a.tenantId,p,e,day];}
 private async latest(c:PoolClient,a:Actor,p:string,e:string,day:string){return (await c.query(`SELECT r.* FROM time_approval_heads h JOIN time_approval_revisions r USING(tenant_id,project_id,employee_id,day,version) WHERE h.tenant_id=$1 AND h.project_id=$2 AND h.employee_id=$3 AND h.day=$4`,this.values(a,p,e,day))).rows[0] as Row|undefined;}
 private revision(r:Row){return {version:Number(r.version),previousVersion:r.previous_version===null?null:Number(r.previous_version),state:r.state,source:r.source,sourceHash:r.source_hash,sourceTotals:r.source_totals,confirmedTotals:r.confirmed_totals,overridden:r.overridden,reason:r.reason,acknowledgedSuspicious:r.acknowledged_suspicious,actorUserId:r.actor_user_id,requestId:r.request_id,recordedAt:r.recorded_at.toISOString(),confirmedTaskAllocation:r.overridden?null:r.source.tasks};}
 private result(e:string,p:string,day:string,current:Awaited<ReturnType<typeof timeSource>>,latest?:Row){
 const isCurrent=latest?.state==='approved'&&latest.source_hash===current.sourceHash;
 return {projectId:p,employeeId:e,day,...current,approvalVersion:latest?Number(latest.version):0,latest:latest?this.revision(latest):null,isCurrent,status:!latest?'unapproved':latest.state==='revoked'?'revoked':isCurrent?'current':'stale'};
 }
 day(a:Actor,p:string,e:string,day:string){return withTenant(this.pool,a.tenantId,a.userId,async c=>{await this.scope(c,a,p,e);return this.result(e,p,day,await timeSource(c,a,p,e,day),await this.latest(c,a,p,e,day));});}
 // One page of recorded employee/days. A day without a recorded interval is absent from this list, not an approved absence.
 async days(a:Actor,p:string,range:{from:string;to:string},page:Page,status?:string){
  return withTenant(this.pool,a.tenantId,a.userId,async c=>{
   const member=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
   if(!member||member.status!=='active'||!['director','master','pto','worker'].includes(member.role))throw httpError(403,'role_denied');
   let only:string|null=null;
   if(member.role==='worker'){
    const own=(await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND user_id=$2 AND status='active'`,[a.tenantId,a.userId])).rows[0];
    if(!own)throw httpError(404,'not_found');
    only=own.id;
    await evidenceTimeScope(c,a,p,[own.id]);
   }else await evidenceTimeScope(c,a,p,[],false,undefined,['director','master','pto']);
   const clock=await executionClock(c,a,range.from);
   const recorded=(await c.query(`SELECT DISTINCT s.employee_id,to_char(d.civil_day,'YYYY-MM-DD') AS day FROM managed_segments s CROSS JOIN generate_series($3::date,$4::date,interval '1 day') d(civil_day) WHERE s.tenant_id=$1 AND s.project_id=$2 AND ($7::uuid IS NULL OR s.employee_id=$7) AND ${recordedTimePredicate('d.civil_day::date','$5','$6')} ORDER BY s.employee_id,day LIMIT 10001`,[a.tenantId,p,range.from,range.to,clock.timezone,clock.asOf,only])).rows as {employee_id:string;day:string}[];
   if(recorded.length>10000)throw httpError(422,'time_list_row_limit');
   const cap=status?40:page.limit,items:Row[]=[];
   let index=Math.min(page.offset,recorded.length),scanned=0;
   while(index<recorded.length&&items.length<page.limit&&scanned<cap){
    const row=recorded[index++];scanned++;
    const current=await timeSource(c,a,p,row.employee_id,row.day,clock),latest=await this.latest(c,a,p,row.employee_id,row.day);
    const result=this.result(row.employee_id,p,row.day,current,latest);
    if(status&&result.status!==status)continue;
    items.push({employeeId:row.employee_id,day:row.day,status:result.status,sourceHash:result.sourceHash,approvalVersion:result.approvalVersion,recorded:result.recorded,future:result.future,dayLengthMs:result.dayLengthMs,hasOpenIntervals:current.source.hasOpenIntervals,suspicious:current.source.suspicious,sourceTotals:current.source.totals,confirmedTotals:latest?latest.confirmed_totals:null,overridden:Boolean(latest?.overridden),latestReason:latest?.reason??null});
   }
   const names=new Map((await c.query(`SELECT id,full_name FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[a.tenantId,items.map(item=>item.employeeId)])).rows.map(row=>[row.id,row.full_name]));
   return {items:items.map(item=>{const employeeName=names.get(item.employeeId);if(typeof employeeName!=='string'||!employeeName.trim())throw httpError(404,'not_found');return {...item,employeeName};}),total:recorded.length,...page,nextOffset:index<recorded.length?index:null,truncated:Boolean(status)&&index<recorded.length&&items.length<page.limit,scanned};
  });
 }
 history(a:Actor,p:string,e:string,day:string,page:Page){return withTenant(this.pool,a.tenantId,a.userId,async c=>{await this.scope(c,a,p,e);const v=this.values(a,p,e,day),where='tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND day=$4';const total=(await c.query(`SELECT count(*)::int n FROM time_approval_revisions WHERE ${where}`,v)).rows[0].n;const rows=(await c.query(`SELECT * FROM time_approval_revisions WHERE ${where} ORDER BY version DESC LIMIT $5 OFFSET $6`,[...v,page.limit,page.offset])).rows;return {items:rows.map(r=>this.revision(r)),total,...page};});}
 async export(a:Actor,p:string,range:{from:string;to:string}){
  const snapshot=await withTenant(this.pool,a.tenantId,a.userId,async c=>{
   // Project serialization freezes03a sources before enumeration. All remaining locks
   // follow the same sorted employee -> memberships/grants -> heads order as commands.
   if(!(await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,p])).rowCount)throw httpError(404,'not_found');
   const clock=await executionClock(c,a,range.from);
   const recorded=(await c.query(`SELECT DISTINCT s.employee_id,to_char(d.civil_day,'YYYY-MM-DD') AS "day" FROM managed_segments s CROSS JOIN generate_series($3::date,$4::date,interval '1 day') d(civil_day) WHERE s.tenant_id=$1 AND s.project_id=$2 AND ${recordedTimePredicate('d.civil_day::date','$5','$6')} ORDER BY s.employee_id,"day" LIMIT 10001`,[a.tenantId,p,range.from,range.to,clock.timezone,clock.asOf])).rows;
   const ids=[...new Set(recorded.map(r=>r.employee_id))].sort();
   await evidenceTimeScope(c,a,p,ids,false,undefined,['director','master','pto']);
   if(recorded.length>10000)throw httpError(422,'time_export_row_limit');
   await c.query(`SELECT employee_id,day FROM time_approval_heads WHERE tenant_id=$1 AND project_id=$2 AND employee_id=ANY($3::uuid[]) AND day BETWEEN $4 AND $5 ORDER BY employee_id,day FOR NO KEY UPDATE`,[a.tenantId,p,ids,range.from,range.to]);
   const project=(await c.query(`SELECT name FROM projects WHERE tenant_id=$1 AND id=$2`,[a.tenantId,p])).rows[0];
   const labels=new Map((await c.query(`SELECT id,full_name FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[a.tenantId,ids])).rows.map(e=>[e.id,e.full_name]));
   const rows:TimeExportRow[]=[],invalid:{employeeId:string;day:string;status:string}[]=[];
   for(const r of recorded){
    const current=await timeSource(c,a,p,r.employee_id,r.day,clock),latest=await this.latest(c,a,p,r.employee_id,r.day);
    const result=this.result(r.employee_id,p,r.day,current,latest);
    if(!result.isCurrent){invalid.push({employeeId:r.employee_id,day:r.day,status:result.status});if(invalid.length===20)break;continue;}
    rows.push({employeeId:r.employee_id,employeeName:labels.get(r.employee_id)!,day:r.day,revision:this.revision(latest!)});
   }
   // Bounded actionable identifiers, never omit a recorded employee/day silently.
   if(invalid.length)throw httpError(409,`time_export_incomplete:${JSON.stringify(invalid)}`);
   return {projectId:p,projectName:project.name,timezone:clock.timezone,capturedAt:clock.asOf,...range,rows};
  });
  const bytes=await this.xlsx.render(snapshot); // All snapshot locks are released before ZIP work.
  await withTenant(this.pool,a.tenantId,a.userId,c=>evidenceTimeScope(c,a,p,[],false,undefined,['director','master','pto']));
  // Source changes after capture are allowed: hash/revision/clock attribute these exact bytes.
  return bytes;
 }
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
