import {day,uuid} from './api-input.js';
import {httpError} from './errors.js';
import {object,text,integer,status} from './people-input.js';
const id=(v:unknown)=>uuid(v).toLowerCase();
function boolean(v:unknown):boolean {if(typeof v!=='boolean')throw httpError(400,'invalid_boolean');return v;}
export function catalogInput(input:unknown,kind:'zones'|'work-types',update=false) {
  const b=object(input,['requestId','name',...(kind==='work-types'?['unit','requiresRd','requiresMaterialControl','requiresPredecessorAcceptance','requiresId','hiddenWork']:[]),...(update?['expectedVersion','status']:[])]);
  const hiddenWork=b.hiddenWork===undefined?undefined:boolean(b.hiddenWork);
  return {requestId:id(b.requestId),name:text(b.name),...(kind==='work-types'?{unit:text(b.unit,40),requiresRd:boolean(b.requiresRd),requiresMaterialControl:boolean(b.requiresMaterialControl),requiresPredecessorAcceptance:boolean(b.requiresPredecessorAcceptance),requiresId:boolean(b.requiresId),...(hiddenWork===undefined?{}:{hiddenWork})}:{}),...(update?{expectedVersion:integer(b.expectedVersion),status:status(b.status,'archived')}:{})};
}
export function quantity(v:unknown):string {
  if(typeof v!=='string' || !/^\d{1,11}(?:\.\d{1,3})?$/.test(v) || !/[1-9]/.test(v))throw httpError(400,'invalid_quantity');
  const [whole,frac='']=v.split('.');return `${whole.replace(/^0+(?=\d)/,'')}.${frac.padEnd(3,'0')}`;
}
export function instant(v:unknown):string {
  if(typeof v!=='string')throw httpError(400,'invalid_interval');
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if(!m || +m[2]>23 || +m[3]>59 || +m[4]>59 || (m[8]!=='Z' && (+m[10]>23 || +m[11]>59)))throw httpError(400,'invalid_interval');
  day(m[1]);const d=new Date(v);if(!Number.isFinite(d.valueOf()))throw httpError(400,'invalid_interval');return d.toISOString();
}
export function crewTaskInput(input:unknown) {
  const b=object(input,['requestId','zoneId','workTypeId','title','workDate','plannedQuantity','crewId','responsibleUserId','plannedStart','plannedEnd','rdReference','materialBatchId']);
  if(b.workDate===undefined)throw httpError(400,'invalid_day');
  const plannedStart=instant(b.plannedStart),plannedEnd=instant(b.plannedEnd);
  if(new Date(plannedStart)>=new Date(plannedEnd))throw httpError(400,'invalid_interval');
  return {requestId:id(b.requestId),zoneId:id(b.zoneId),workTypeId:id(b.workTypeId),title:text(b.title),workDate:day(b.workDate)!,plannedQuantity:quantity(b.plannedQuantity),crewId:id(b.crewId),responsibleUserId:id(b.responsibleUserId),plannedStart,plannedEnd,rdReference:b.rdReference===null?null:text(b.rdReference,500),materialBatchId:b.materialBatchId==null?null:id(b.materialBatchId)};
}
export function crewVolumeInput(input:unknown) {
  const b=object(input,['requestId','expectedVersion','quantity']);
  return {requestId:id(b.requestId),expectedVersion:integer(b.expectedVersion),quantity:quantity(b.quantity)};
}
export function taskInput(input:unknown,update=false) {
  const b=object(input,['requestId','zoneId','workTypeId','title','workDate','plannedQuantity','assigneeEmployeeId','responsibleUserId','plannedStart','plannedEnd','rdReference','materialBatchId',...(update?['expectedVersion']:[])]);
  if(b.workDate===undefined)throw httpError(400,'invalid_day');
  const plannedStart=instant(b.plannedStart),plannedEnd=instant(b.plannedEnd);
  if(new Date(plannedStart)>=new Date(plannedEnd))throw httpError(400,'invalid_interval');
  return {requestId:id(b.requestId),zoneId:id(b.zoneId),workTypeId:id(b.workTypeId),title:text(b.title),workDate:day(b.workDate)!,plannedQuantity:quantity(b.plannedQuantity),assigneeEmployeeId:id(b.assigneeEmployeeId),responsibleUserId:id(b.responsibleUserId),plannedStart,plannedEnd,rdReference:b.rdReference===null?null:text(b.rdReference,500),materialBatchId:b.materialBatchId==null?null:id(b.materialBatchId),...(update?{expectedVersion:integer(b.expectedVersion)}:{})};
}
const taskStatuses=['draft','pending_approval','published','cancelled','in_progress','submitted','in_review','accepted','closed','suspended','needs_fix','partially_accepted'];
export function taskStatus(value:unknown) {if(value===undefined)return undefined;if(typeof value!=='string' || !taskStatuses.includes(value))throw httpError(400,'invalid_status');return value;}
export function frontTemplateInput(input:unknown,update=false) {
  const b=object(input,['requestId','title','items',update?'expectedVersion':'code']);
  if(!Array.isArray(b.items) || b.items.length<1 || b.items.length>100)throw httpError(400,'invalid_items');
  const items=b.items.map(v=>{const i=object(v,['id','label','critical']);return {id:text(i.id,80),label:text(i.label,500),critical:boolean(i.critical)};});
  if(new Set(items.map(i=>i.id)).size!==items.length)throw httpError(400,'duplicate_item');
  return {requestId:id(b.requestId),title:text(b.title),items,...(update?{expectedVersion:integer(b.expectedVersion)}:{code:text(b.code,80)})};
}
export function frontCheckInput(input:unknown) {
  const b=object(input,['requestId','expectedVersion','templateVersion','answers']);
  if(!Array.isArray(b.answers) || b.answers.length<1 || b.answers.length>100)throw httpError(400,'invalid_answers');
  const answers=b.answers.map(v=>{const i=object(v,['itemId','value']);return {itemId:text(i.itemId,80),value:boolean(i.value)};});
  if(new Set(answers.map(i=>i.itemId)).size!==answers.length)throw httpError(400,'duplicate_item');
  return {requestId:id(b.requestId),expectedVersion:integer(b.expectedVersion),templateVersion:integer(b.templateVersion),answers};
}
export type TaskAction='submit'|'reject'|'reopen'|'cancel'|'publish';
export function taskActionInput(input:unknown,action:TaskAction) {
  const reason=['reject','reopen','cancel'].includes(action),b=object(input,['requestId','expectedVersion',...(reason?['reason']:[])]);
  return {requestId:id(b.requestId),expectedVersion:integer(b.expectedVersion),...(reason?{reason:text(b.reason,500)}:{})};
}
