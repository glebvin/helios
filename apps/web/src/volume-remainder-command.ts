export type RemainderCommand={path:string;body:{requestId:string;expectedVersion:number;action:'present'|'review';quantity:string;checklistRunId:string;reason:string|null}};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const memory=new Map<string,RemainderCommand>();
export function readRemainderCommand(key:string,storage:()=>Store=()=>sessionStorage):RemainderCommand|null {
 if(memory.has(key))return memory.get(key)!;
 try{const row=JSON.parse(storage().getItem(key)??'null') as RemainderCommand|null,b=row?.body;
  if(row&&/^\/projects\/[0-9a-f-]{36}\/volume-reviews\/[0-9a-f-]{36}\/remainder$/i.test(row.path)&&b&&/^[0-9a-f-]{36}$/i.test(b.requestId)&&Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>=1&&['present','review'].includes(b.action)&&typeof b.quantity==='string'&&typeof b.checklistRunId==='string'&&(b.reason===null||typeof b.reason==='string')){memory.set(key,row);return row;}
 }catch{}return null;
}
export function keepRemainderCommand(key:string,command:RemainderCommand,storage:()=>Store=()=>sessionStorage){const copy=JSON.parse(JSON.stringify(command)) as RemainderCommand;memory.set(key,copy);try{storage().setItem(key,JSON.stringify(copy));}catch{}return copy;}
export function clearRemainderCommand(key:string,requestId:string,storage:()=>Store=()=>sessionStorage){if(readRemainderCommand(key,storage)?.body.requestId!==requestId)return;memory.delete(key);try{storage().removeItem(key);}catch{}}
