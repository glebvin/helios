import {day,uuid} from './api-input.js';
import {httpError} from './errors.js';
import {object,text,integer,status} from './people-input.js';
const id=(v:unknown)=>uuid(v).toLowerCase();
function boolean(v:unknown):boolean {if(typeof v!=='boolean')throw httpError(400,'invalid_boolean');return v;}
export function catalogInput(input:unknown,kind:'zones'|'work-types',update=false) {
  const b=object(input,['requestId','name',...(kind==='work-types'?['unit','requiresRd','requiresMaterialControl','requiresPredecessorAcceptance','requiresId']:[]),...(update?['expectedVersion','status']:[])]);
  return {requestId:id(b.requestId),name:text(b.name),...(kind==='work-types'?{unit:text(b.unit,40),requiresRd:boolean(b.requiresRd),requiresMaterialControl:boolean(b.requiresMaterialControl),requiresPredecessorAcceptance:boolean(b.requiresPredecessorAcceptance),requiresId:boolean(b.requiresId)}:{}),...(update?{expectedVersion:integer(b.expectedVersion),status:status(b.status,'archived')}:{})};
}
export function quantity(v:unknown):string {
  if(typeof v!=='string' || !/^\d{1,11}(?:\.\d{1,3})?$/.test(v) || !/[1-9]/.test(v))throw httpError(400,'invalid_quantity');
  const [whole,frac='']=v.split('.');return `${whole.replace(/^0+(?=\d)/,'')}.${frac.padEnd(3,'0')}`;
}
function instant(v:unknown):string {
  if(typeof v!=='string')throw httpError(400,'invalid_interval');
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if(!m || +m[2]>23 || +m[3]>59 || +m[4]>59 || (m[8]!=='Z' && (+m[10]>23 || +m[11]>59)))throw httpError(400,'invalid_interval');
  day(m[1]);const d=new Date(v);if(!Number.isFinite(d.valueOf()))throw httpError(400,'invalid_interval');return d.toISOString();
}
export function taskInput(input:unknown,update=false) {
  const b=object(input,['requestId','zoneId','workTypeId','title','workDate','plannedQuantity','assigneeEmployeeId','responsibleUserId','plannedStart','plannedEnd','rdReference',...(update?['expectedVersion']:[])]);
  if(b.workDate===undefined)throw httpError(400,'invalid_day');
  const plannedStart=instant(b.plannedStart),plannedEnd=instant(b.plannedEnd);
  if(new Date(plannedStart)>=new Date(plannedEnd))throw httpError(400,'invalid_interval');
  return {requestId:id(b.requestId),zoneId:id(b.zoneId),workTypeId:id(b.workTypeId),title:text(b.title),workDate:day(b.workDate)!,plannedQuantity:quantity(b.plannedQuantity),assigneeEmployeeId:id(b.assigneeEmployeeId),responsibleUserId:id(b.responsibleUserId),plannedStart,plannedEnd,rdReference:b.rdReference===null?null:text(b.rdReference,500),...(update?{expectedVersion:integer(b.expectedVersion)}:{})};
}
const taskStatuses=['draft','pending_approval','published','cancelled','in_progress','submitted','in_review','accepted','closed','suspended','needs_fix','partially_accepted'];
export function taskStatus(value:unknown) {if(value===undefined)return undefined;if(typeof value!=='string' || !taskStatuses.includes(value))throw httpError(400,'invalid_status');return value;}
