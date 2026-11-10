import {uuid} from './api-input.js';
import {object,text} from './people-input.js';
import {instant,quantity} from './task-input.js';
import {httpError} from './errors.js';
const id=(v:unknown)=>uuid(v).toLowerCase();
type Common={requestId:string;employeeId:string;projectId:string;shiftId:string;expectedVersion:number;occurredAt:string;previousEventId?:string;onBehalfReason?:string};
type Geo={latitude:number;longitude:number;accuracyMeters:number;capturedAt:string};
type Shape=({kind:'shift_start';geo?:Geo}|{kind:'shift_end';geo?:Geo}|{kind:'segment_change';mode:'idle'|'work'|'break'|'downtime';taskId?:string;reasonCode?:string;comment?:string}|{kind:'submit_volume';taskId:string;reportId:string;submittedQuantity:string});
export type ExecutionEvent=Common&Shape&{originalPayload:Record<string,unknown>};
function geo(input:unknown):Geo {
  const b=object(input,['latitude','longitude','accuracyMeters','capturedAt']);
  const number=(v:unknown,min:number,max:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw httpError(400,'invalid_geo');return v;};
  return {latitude:number(b.latitude,-90,90),longitude:number(b.longitude,-180,180),accuracyMeters:number(b.accuracyMeters,0,Number.MAX_VALUE),capturedAt:instant(b.capturedAt)};
}
function event(input:unknown):ExecutionEvent {
  const tag=object(input,['kind','requestId','employeeId','projectId','shiftId','expectedVersion','occurredAt','previousEventId','onBehalfReason','geo','mode','taskId','reasonCode','comment','reportId','submittedQuantity']);
  const commonKeys=['kind','requestId','employeeId','projectId','shiftId','expectedVersion','occurredAt','previousEventId','onBehalfReason'];
  let shape:Shape;
  if(tag.kind==='shift_start'||tag.kind==='shift_end'){
    object(input,[...commonKeys,'geo']);shape={kind:tag.kind,...(tag.geo===undefined?{}:{geo:geo(tag.geo)})};
  }else if(tag.kind==='segment_change'){
    if(!['idle','work','break','downtime'].includes(tag.mode as string))throw httpError(400,'invalid_mode');
    object(input,[...commonKeys,'mode',...(['work','downtime'].includes(tag.mode as string)?['taskId']:[]),...(tag.mode==='downtime'?['reasonCode','comment']:[])]);
    if(tag.mode==='downtime'&&!['materials','equipment','front','safety','weather','other'].includes(tag.reasonCode as string))throw httpError(400,'invalid_reason_code');
    shape={kind:'segment_change',mode:tag.mode as 'idle'|'work'|'break'|'downtime',...(tag.mode==='work'||tag.taskId!==undefined?{taskId:id(tag.taskId)}:{}),...(tag.mode==='downtime'?{reasonCode:tag.reasonCode as string,comment:text(tag.comment,500)}:{})};
  }else if(tag.kind==='submit_volume'){
    object(input,[...commonKeys,'taskId','reportId','submittedQuantity']);shape={kind:'submit_volume',taskId:id(tag.taskId),reportId:id(tag.reportId),submittedQuantity:quantity(tag.submittedQuantity)};
  }else throw httpError(400,'invalid_kind');
  if(!Number.isSafeInteger(tag.expectedVersion)||(tag.expectedVersion as number)<0)throw httpError(400,'invalid_version');
  return {requestId:id(tag.requestId),employeeId:id(tag.employeeId),projectId:id(tag.projectId),shiftId:id(tag.shiftId),expectedVersion:tag.expectedVersion as number,occurredAt:instant(tag.occurredAt),...(tag.previousEventId===undefined?{}:{previousEventId:id(tag.previousEventId)}),...(tag.onBehalfReason===undefined?{}:{onBehalfReason:text(tag.onBehalfReason,500)}),...shape,originalPayload:input as Record<string,unknown>};
}
// Validate every shape and duplicate key before opening any item transaction.
export function executionBatch(input:unknown):ExecutionEvent[] {
  const b=object(input,['events']);if(!Array.isArray(b.events)||b.events.length<1||b.events.length>50)throw httpError(400,'invalid_events');
  const events=b.events.map(event);if(new Set(events.map(e=>e.requestId)).size!==events.length)throw httpError(400,'duplicate_request_id');return events;
}
