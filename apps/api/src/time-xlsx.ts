import writeExcelFile,{type Cell,type SheetData} from 'write-excel-file/node';
import {totalKeys,type Totals} from './time-input.js';
export type TimeExportRow={employeeId:string;employeeName:string;day:string;revision:{version:number;state:string;sourceHash:string;sourceTotals:Totals;confirmedTotals:Totals;overridden:boolean;reason:string;actorUserId:string;requestId:string;recordedAt:string}};
export type TimeExportSnapshot={projectId:string;projectName:string;timezone:string;capturedAt:string;from:string;to:string;rows:TimeExportRow[]};
// XML1.0 excludes controls, lone surrogates and FFFE/FFFF. Keep literal formula-like
// labels as explicit String cells, never Formula. XML escaping belongs to the writer.
export function xmlText(value:string){return [...value].filter(c=>{const n=c.codePointAt(0)!;return n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff;}).join('');}
const text=(value:string):Cell=>({type:String,value:xmlText(value)});
// Nonnegative totals: round half up to six decimals using integer arithmetic first.
function hours(ms:string){return Number((BigInt(ms)*1000000n+1800000n)/3600000n)/1000000;}
export class TimeXlsx {
 async render(s:TimeExportSnapshot){
  const columns=['projectId','projectName','employeeId','employeeName','day','timezone','approvalVersion','sourceHash','capturedAt','actorUserId','requestId','approvedAt','overridden','reason',...['source','confirmed'].flatMap(kind=>totalKeys.flatMap(k=>[`${kind}.${k}`,`${kind}.${k.replace('Ms','Hours')}`]))];
  const data:SheetData=[columns.map(text)];
  for(const row of s.rows){const r=row.revision;data.push([text(s.projectId),text(s.projectName),text(row.employeeId),text(row.employeeName),text(row.day),text(s.timezone),{type:Number,value:r.version},text(r.sourceHash),text(s.capturedAt),text(r.actorUserId),text(r.requestId),text(r.recordedAt),{type:Boolean,value:r.overridden},text(r.reason),...[r.sourceTotals,r.confirmedTotals].flatMap(t=>totalKeys.flatMap(k=>[text(t[k]),{type:Number,value:hours(t[k]),format:'0.000000'}]))]);}
  const metadata:SheetData=[['field','value'].map(text),...Object.entries({projectId:s.projectId,projectName:s.projectName,from:s.from,to:s.to,timezone:s.timezone,capturedAt:s.capturedAt,recordedRows:String(s.rows.length),empty:String(!s.rows.length),explanation:s.rows.length?'Only current approved revisions; captured source may change later.':'No recorded employee/day rows in this civil range. Header-only Time sheet.',hoursRounding:'Hours rounded half up to six decimals; raw integer milliseconds are authoritative.',confirmedTaskAllocation:'Manual overrides have no confirmed per-task allocation.'}).map(([k,v])=>[text(k),text(v)])];
  return writeExcelFile([{sheet:'Time',data},{sheet:'Snapshot',data:metadata}]).toBuffer();
 }
}
