import {uuid,day,queryInput} from './api-input.js';
import {httpError} from './errors.js';
export const totalKeys=['presenceMs','idleMs','workMs','breakMs','downtimeMs'] as const;
export type Totals=Record<typeof totalKeys[number],string>;
export function strictObject(v:unknown,keys:readonly string[]):Record<string,any>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw httpError(400,'invalid_input');return v as Record<string,any>;
}
export function timeCommand(v:unknown,revoke=false){
 const b=strictObject(v,revoke?['requestId','expectedApprovalVersion','reason']:['requestId','expectedApprovalVersion','sourceHash','reason','acknowledgeSuspicious','confirmedTotals']);
 const requestId=uuid(b.requestId).toLowerCase();
 if(!Number.isSafeInteger(b.expectedApprovalVersion)||b.expectedApprovalVersion<0||b.expectedApprovalVersion===Number.MAX_SAFE_INTEGER)throw httpError(400,'invalid_version');
 if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.trim().length>500)throw httpError(400,'invalid_reason');
 const base={requestId,expectedApprovalVersion:b.expectedApprovalVersion as number,reason:b.reason.trim()};
 if(revoke)return {...base,sourceHash:undefined,acknowledgeSuspicious:undefined,confirmedTotals:undefined};
 if(typeof b.sourceHash!=='string'||! /^[0-9a-f]{64}$/.test(b.sourceHash))throw httpError(400,'invalid_source_hash');
 if(b.acknowledgeSuspicious!==undefined&&typeof b.acknowledgeSuspicious!=='boolean')throw httpError(400,'invalid_acknowledgment');
 let confirmedTotals:Totals|undefined;
 if(b.confirmedTotals!==undefined){const t=strictObject(b.confirmedTotals,totalKeys);for(const k of totalKeys)if(typeof t[k]!=='string'||! /^(0|[1-9][0-9]*)$/.test(t[k]))throw httpError(400,'invalid_totals');confirmedTotals=t as Totals;}
 return {...base,sourceHash:b.sourceHash as string,acknowledgeSuspicious:b.acknowledgeSuspicious as boolean|undefined,confirmedTotals};
}

export function timeRange(q:Record<string,unknown>){
 queryInput(q,['from','to']);const from=day(q.from),to=day(q.to);
 if(!from||!to||from>to||(Date.parse(to)-Date.parse(from))/86400000>=31)throw httpError(400,'invalid_time_range');
 return {from,to};
}
