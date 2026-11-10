import {uuid} from './api-input.js';
import {object,text} from './people-input.js';
import {httpError} from './errors.js';
export const MAX_EVIDENCE_BYTES=8*1024*1024;
export type EvidenceType='image/jpeg'|'image/png'|'application/pdf';
export type EvidenceTarget={kind:'execution_event';actorUserId:string;requestId:string}|{kind:'final_report';reportId:string};
const normalized=(v:unknown)=>uuid(v).toLowerCase();
const reason=(v:unknown)=>v===undefined?{}:{onBehalfReason:text(v,500)};
export function evidenceReservation(input:unknown){
 const b=object(input,['requestId','fileId','employeeId','filename','contentType','sizeBytes','sha256','onBehalfReason']);
 if(!Number.isSafeInteger(b.sizeBytes)||Number(b.sizeBytes)<1||Number(b.sizeBytes)>MAX_EVIDENCE_BYTES)throw httpError(400,'invalid_size');
 if(typeof b.sha256!=='string'||!/^[0-9a-f]{64}$/.test(b.sha256))throw httpError(400,'invalid_sha256');
 if(!['image/jpeg','image/png','application/pdf'].includes(String(b.contentType)))throw httpError(400,'invalid_content_type');
 const filename=text(b.filename,255);if(/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(filename))throw httpError(400,'invalid_filename');
 return {requestId:normalized(b.requestId),fileId:normalized(b.fileId),employeeId:normalized(b.employeeId),filename,contentType:b.contentType as EvidenceType,sizeBytes:b.sizeBytes as number,sha256:b.sha256,...reason(b.onBehalfReason)};
}
export function evidenceAttachment(input:unknown){
 const b=object(input,['requestId','target','onBehalfReason']);const t=object(b.target,['kind','actorUserId','requestId','reportId']);let target:EvidenceTarget;
 if(t.kind==='execution_event'){object(t,['kind','actorUserId','requestId']);target={kind:t.kind,actorUserId:normalized(t.actorUserId),requestId:normalized(t.requestId)};}
 else if(t.kind==='final_report'){object(t,['kind','reportId']);target={kind:t.kind,reportId:normalized(t.reportId)};}
 else throw httpError(400,'invalid_target');
 return {requestId:normalized(b.requestId),target,...reason(b.onBehalfReason)};
}
export function evidenceDisposition(filename:string){
 const ascii=filename.replace(/[^a-zA-Z0-9. _-]/g,'_');
 return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
