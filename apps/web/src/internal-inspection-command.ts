export type InspectionAction = 'submit' | 'resubmit' | 'responsible' | 'approve' | 'return' | 'partial';
export type InspectionCommand = {path:string;body:{requestId:string;expectedVersion:number;action:InspectionAction;expectedRouteVersion?:number;reason?:string;acceptedQuantity?:string}};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const memory=new Map<string,InspectionCommand>();
export function readInspectionCommand(key:string,storage:()=>Store=()=>sessionStorage):InspectionCommand|null {
 if(memory.has(key))return memory.get(key)!;
 try{
  const row=JSON.parse(storage().getItem(key)??'null') as InspectionCommand|null,b=row?.body;
  if(row&&/^\/projects\/[0-9a-f-]{36}\/accepted-parts\/[0-9a-f-]{36}\/internal-inspection$/i.test(row.path)&&b&&/^[0-9a-f-]{36}$/i.test(b.requestId)&&Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>=0&&['submit','resubmit','responsible','approve','return','partial'].includes(b.action)&&(b.action!=='submit'||Number.isSafeInteger(b.expectedRouteVersion))&&(!['return','resubmit','partial'].includes(b.action)||typeof b.reason==='string')&&(b.action!=='partial'||typeof b.acceptedQuantity==='string'&&/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(b.acceptedQuantity))){memory.set(key,row);return row;}
 }catch{/* Retain a live command in memory if storage is unavailable. */}
 return null;
}
export function keepInspectionCommand(key:string,command:InspectionCommand,storage:()=>Store=()=>sessionStorage){
 const copy=JSON.parse(JSON.stringify(command)) as InspectionCommand;memory.set(key,copy);try{storage().setItem(key,JSON.stringify(copy));}catch{}return copy;
}
export function clearInspectionCommand(key:string,requestId:string,storage:()=>Store=()=>sessionStorage){
 if(readInspectionCommand(key,storage)?.body.requestId!==requestId)return;memory.delete(key);try{storage().removeItem(key);}catch{}
}
