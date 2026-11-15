import type {Pool,PoolClient} from 'pg';
import type {IncomingMessage} from 'node:http';
import type {Actor} from './workforce.service.js';
import {withTenant} from './db.js';
import {httpError} from './errors.js';
import type {Page} from './api-input.js';
import {reserveCommand,replayCommand,completeCommand} from './durable-command.js';
import {evidenceReservation,evidenceAttachment,type EvidenceTarget} from './evidence-input.js';
import {evidenceTimeScope} from './evidence-time-scope.js';
import {readEvidenceRequest,type BlobDeclaration,type EvidenceBlobStore} from './evidence-storage.js';
import {executionScope} from './execution-read.js';
type Row=Record<string,any>;
export class EvidenceService {
 constructor(private readonly pool:Pool,private readonly storage:EvidenceBlobStore){}
 private declaration(f:Row):BlobDeclaration{return {sizeBytes:f.size_bytes,sha256:f.sha256,contentType:f.content_type};}
 private async file(c:PoolClient,a:Actor,p:string,id:string,mutation=false,reason?:string,useReservedReason=true){
  const initial=(await c.query(`SELECT employee_id,on_behalf_reason FROM private_evidence_files WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[a.tenantId,p,id])).rows[0];if(!initial)throw httpError(404,'not_found');
  await evidenceTimeScope(c,a,p,[initial.employee_id],mutation,reason??(useReservedReason?initial.on_behalf_reason:undefined));
  const f=(await c.query(`SELECT * FROM private_evidence_files WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR NO KEY UPDATE`,[a.tenantId,p,id])).rows[0];if(!f)throw httpError(404,'not_found');return f;
 }
 private async metadata(c:PoolClient,f:Row){
  const t=(await c.query(`SELECT * FROM private_evidence_attachments WHERE tenant_id=$1 AND file_id=$2`,[f.tenant_id,f.id])).rows[0];
  return {id:f.id,projectId:f.project_id,employeeId:f.employee_id,filename:f.filename,contentType:f.content_type,sizeBytes:f.size_bytes,sha256:f.sha256,state:f.state,reservedBy:f.reserved_by,reservedAt:f.reserved_at,readyBy:f.ready_by,readyAt:f.ready_at,onBehalfReason:f.on_behalf_reason,attachment:t?{target:t.target_kind==='execution_event'?{kind:t.target_kind,actorUserId:t.event_actor_user_id,requestId:t.event_request_id}:{kind:t.target_kind,reportId:t.report_id},attachedBy:t.attached_by,attachedAt:t.attached_at,onBehalfReason:t.on_behalf_reason}:null};
 }
 private audit(c:PoolClient,a:Actor,action:string,file:string,details:Row){return c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,$3,'private_evidence',$4,'ok',$5)`,[a.tenantId,a.userId,action,file,JSON.stringify(details)]);}
 reserve(a:Actor,p:string,input:unknown){
  const b=evidenceReservation(input);
  return withTenant(this.pool,a.tenantId,a.userId,async c=>{
   const receipt=await reserveCommand(c,a,`POST /projects/${p}/evidence`,b);
   await evidenceTimeScope(c,a,p,[b.employeeId],true,b.onBehalfReason);
   if(!receipt.inserted)return replayCommand(c,a,b.requestId,receipt.hash);
   const inserted=await c.query(`INSERT INTO private_evidence_files(tenant_id,id,project_id,employee_id,filename,content_type,size_bytes,sha256,reserved_by,on_behalf_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *`,[a.tenantId,b.fileId,p,b.employeeId,b.filename,b.contentType,b.sizeBytes,b.sha256,a.userId,b.onBehalfReason??null]);
   const f=inserted.rows[0]??(await c.query(`SELECT * FROM private_evidence_files WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,b.fileId])).rows[0];
   if(!f||f.project_id!==p||f.employee_id!==b.employeeId||f.filename!==b.filename||f.content_type!==b.contentType||f.size_bytes!==b.sizeBytes||f.sha256!==b.sha256)throw httpError(409,'file_metadata_conflict');
   if(inserted.rowCount)await this.audit(c,a,'evidence_reserved',f.id,{requestId:b.requestId});
   return completeCommand(c,a,b.requestId,201,await this.metadata(c,f));
  });
 }
 get(a:Actor,p:string,id:string){return withTenant(this.pool,a.tenantId,a.userId,async c=>this.metadata(c,await this.file(c,a,p,id)));}
 list(a:Actor,p:string,page:Page,employeeId?:string){
  return withTenant(this.pool,a.tenantId,a.userId,async c=>{
   // Lock the project first, then the target employees together before any membership locks.
   if(!(await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,p])).rowCount)throw httpError(404,'not_found');
   const ids=employeeId?[employeeId]:(await c.query(`SELECT e.id FROM employees e WHERE e.tenant_id=$1 AND ((EXISTS(SELECT 1 FROM private_evidence_files f WHERE f.tenant_id=e.tenant_id AND f.project_id=$2 AND f.employee_id=e.id)) OR e.user_id=$3) AND (e.user_id=$3 OR EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=$1 AND m.user_id=$3 AND m.role<>'worker')) ORDER BY e.id`,[a.tenantId,p,a.userId])).rows.map(r=>r.id);
   // Listing other people's files filters through executionScope; an explicit employee filter fails closed.
   await evidenceTimeScope(c,a,p,ids,false);
   const values=[a.tenantId,a.userId,p,employeeId??null],from=`FROM private_evidence_files f JOIN projects p ON p.tenant_id=f.tenant_id AND p.id=f.project_id JOIN employees e ON e.tenant_id=f.tenant_id AND e.id=f.employee_id WHERE ${executionScope} AND ($4::uuid IS NULL OR e.id=$4)`;
   const total=(await c.query(`SELECT count(*)::int n ${from}`,values)).rows[0].n;
   const rows=(await c.query(`SELECT f.* ${from} ORDER BY f.reserved_at,f.id LIMIT $5 OFFSET $6`,[...values,page.limit,page.offset])).rows;
   const items=[];for(const f of rows)items.push(await this.metadata(c,f));return {items,total,...page};
  });
 }
 async upload(a:Actor,p:string,id:string,req:IncomingMessage){
  const initial=await withTenant(this.pool,a.tenantId,a.userId,c=>this.file(c,a,p,id,true));
  const bytes=await readEvidenceRequest(req,this.declaration(initial));
  await this.storage.put(a.tenantId,id,bytes,this.declaration(initial));
  // No project/employee locks during network or disk. A rollback leaves a private, verified orphan for retry.
  return withTenant(this.pool,a.tenantId,a.userId,async c=>{
   const f=await this.file(c,a,p,id,true);
   if(f.state!=='ready'){
    await c.query(`UPDATE private_evidence_files SET state='ready',ready_by=$3,ready_at=now() WHERE tenant_id=$1 AND id=$2`,[a.tenantId,id,a.userId]);
    await this.audit(c,a,'evidence_ready',id,{sha256:f.sha256});
   }
   return this.metadata(c,(await c.query(`SELECT * FROM private_evidence_files WHERE tenant_id=$1 AND id=$2`,[a.tenantId,id])).rows[0]);
  });
 }
 async download(a:Actor,p:string,id:string){
  const f=await withTenant(this.pool,a.tenantId,a.userId,async c=>{const f=await this.file(c,a,p,id);if(f.state!=='ready')throw httpError(409,'evidence_pending');return f;});
  const bytes=await this.storage.get(a.tenantId,id,this.declaration(f));
  await withTenant(this.pool,a.tenantId,a.userId,c=>this.file(c,a,p,id));
  return {bytes,filename:f.filename,contentType:f.content_type};
 }
 private async target(c:PoolClient,a:Actor,p:string,employee:string,t:EvidenceTarget){
  const r=t.kind==='execution_event'?(await c.query(`SELECT shift_id FROM managed_execution_events WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND actor_user_id=$4 AND request_id=$5`,[a.tenantId,p,employee,t.actorUserId,t.requestId])).rows[0]:(await c.query(`SELECT shift_id FROM managed_execution_reports WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND report_id=$4`,[a.tenantId,p,employee,t.reportId])).rows[0];
  if(!r)throw httpError(404,'not_found');return r;
 }
 async attach(a:Actor,p:string,id:string,input:unknown){
  const b=evidenceAttachment(input);
  const initial=await withTenant(this.pool,a.tenantId,a.userId,async c=>{
   const f=await this.file(c,a,p,id,true,b.onBehalfReason,false);if(f.state!=='ready')throw httpError(409,'evidence_pending');return f;
  });
  await this.storage.get(a.tenantId,id,this.declaration(initial));
  return withTenant(this.pool,a.tenantId,a.userId,async c=>{
   const receipt=await reserveCommand(c,a,`POST /projects/${p}/evidence/${id}/attachment`,b);
   const f=await this.file(c,a,p,id,true,b.onBehalfReason,false);
   if(!receipt.inserted)return replayCommand(c,a,b.requestId,receipt.hash);
   if(f.state!=='ready')throw httpError(409,'evidence_pending');
   const target=await this.target(c,a,p,f.employee_id,b.target),t=b.target;
   const existing=(await c.query(`SELECT * FROM private_evidence_attachments WHERE tenant_id=$1 AND file_id=$2`,[a.tenantId,id])).rows[0];
   if(existing)throw httpError(409,'evidence_already_attached');
   await c.query(`INSERT INTO private_evidence_attachments(tenant_id,file_id,project_id,employee_id,target_kind,shift_id,event_actor_user_id,event_request_id,report_id,attached_by,on_behalf_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[a.tenantId,id,p,f.employee_id,t.kind,t.kind==='execution_event'?target.shift_id:null,t.kind==='execution_event'?t.actorUserId:null,t.kind==='execution_event'?t.requestId:null,t.kind==='final_report'?t.reportId:null,a.userId,b.onBehalfReason??null]);
   await this.audit(c,a,'evidence_attached',id,{requestId:b.requestId,target:t});return completeCommand(c,a,b.requestId,201,await this.metadata(c,f));
  });
 }
}
