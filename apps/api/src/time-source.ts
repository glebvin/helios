import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {executionClock,civilClipStart,civilClipEnd,civilClipMs} from './execution-read.js';
import {totalKeys,type Totals} from './time-input.js';
import {httpError} from './errors.js';
type Row=Record<string,any>;
export function canonicalSource(v:any):string{
 if(Array.isArray(v))return `[${v.map(canonicalSource).join(',')}]`;
 if(v!==null&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonicalSource(v[k])}`).join(',')}}`;
 return JSON.stringify(v);
}
export async function timeSource(c:PoolClient,a:Actor,p:string,e:string,day:string,clock?:Awaited<ReturnType<typeof executionClock>>){
 clock??=await executionClock(c,a,day);
 const bounds=(await c.query(`SELECT ($1::date::timestamp AT TIME ZONE $2) lo,(($1::date+1)::timestamp AT TIME ZONE $2) hi,to_char($3::timestamptz AT TIME ZONE $2,'YYYY-MM-DD') today`,[day,clock.timezone,clock.asOf])).rows[0];
 const lo=+bounds.lo,hi=+bounds.hi,now=+new Date(clock.asOf);
 // Include closed zero-time markers inside the half-open day and just-opened intervals at the captured clock.
 const segments=(await c.query(`SELECT s.*,${civilClipStart} clipped_start,${civilClipEnd} clipped_end,(${civilClipMs})::text ms FROM managed_segments s WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.employee_id=$3 AND s.started_at<=( $6::timestamptz) AND ((${civilClipMs})>0 OR (s.started_at=s.ended_at AND s.started_at>=($4::date::timestamp AT TIME ZONE $5) AND s.started_at<(($4::date+1)::timestamp AT TIME ZONE $5)) OR (s.ended_at IS NULL AND s.started_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND $6::timestamptz>=($4::date::timestamp AT TIME ZONE $5))) ORDER BY s.shift_id,s.started_at,s.id`,[a.tenantId,p,e,day,clock.timezone,clock.asOf])).rows;
 const shiftIds=[...new Set(segments.map(s=>s.shift_id))];
 const events=(await c.query(`SELECT * FROM managed_execution_events WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND shift_id=ANY($4::uuid[]) AND kind<>'submit_volume' ORDER BY version`,[a.tenantId,p,e,shiftIds])).rows;
 // Replay ordered interval lifecycle. Timestamp ties are resolved by numeric employee version,
 // while event identity always includes the actor; requestId alone is not unique.
 const lifecycles:Row[]=[],active=new Map<string,Row>();
 for(const ev of events){
  if(ev.kind!=='shift_start'){const previous=active.get(ev.shift_id);if(previous){previous.close=ev;previous.end=ev.occurred_at;lifecycles.push(previous);active.delete(ev.shift_id);}}
  if(ev.kind!=='shift_end')active.set(ev.shift_id,{shift:ev.shift_id,start:ev.occurred_at,end:null,mode:ev.kind==='shift_start'?'idle':ev.original_payload.mode,task:ev.kind==='shift_start'?null:ev.original_payload.taskId?.toLowerCase()??null,open:ev,close:null});
 }
 lifecycles.push(...active.values());
 const selected=new Map<string,Row>(),markers:Row[]=[];
 const totals=Object.fromEntries(totalKeys.map(k=>[k,'0'])) as Totals;
 let hasOpenIntervals=false;
 const recorded=segments.map(s=>{
  const matching=lifecycles.filter(l=>l.shift===s.shift_id&&+l.start===+s.started_at&&(l.end===null?s.ended_at===null:+l.end===+s.ended_at)&&l.mode===s.mode&&l.task===s.task_id);
  if(!matching.length)throw httpError(409,'time_source_inconsistent');
  for(const lifecycle of matching){
   for(const ev of [lifecycle.open,lifecycle.close].filter(Boolean))selected.set(`${ev.actor_user_id}/${ev.request_id}`,ev);
   if(s.ms==='0')markers.push({segmentId:s.id,openingVersion:String(lifecycle.open.version),closingVersion:lifecycle.close?String(lifecycle.close.version):null});
  }
  const open=s.ended_at===null;hasOpenIntervals ||= open;
  totals.presenceMs=String(BigInt(totals.presenceMs)+BigInt(s.ms));const k=(s.mode+'Ms') as keyof Totals;totals[k]=String(BigInt(totals[k])+BigInt(s.ms));
  return {id:s.id,shiftId:s.shift_id,taskId:s.task_id,mode:s.mode,clippedStart:new Date(Math.max(lo,+s.clipped_start)).toISOString(),clippedEnd:new Date(Math.max(lo,Math.min(hi,now,+s.clipped_end))).toISOString(),ms:s.ms,open};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const intervalEvents=[...selected.values()].sort((a,b)=>Number(a.version)-Number(b.version)).map(ev=>({tenantId:ev.tenant_id,actorUserId:ev.actor_user_id,requestId:ev.request_id,employeeId:ev.employee_id,version:String(ev.version),shiftId:ev.shift_id,kind:ev.kind,clippedOccurredAt:new Date(Math.min(hi,Math.max(lo,+ev.occurred_at))).toISOString(),flags:{delayed:!!ev.review_flags.delayed,future:!!ev.review_flags.future,geoTimeMismatch:!!ev.review_flags.geoTimeMismatch,suspicious:!!ev.review_flags.suspicious}}));
 markers.sort((a,b)=>BigInt(a.openingVersion)<BigInt(b.openingVersion)?-1:BigInt(a.openingVersion)>BigInt(b.openingVersion)?1:a.segmentId.localeCompare(b.segmentId));
 const tasks=[...new Set(recorded.map(s=>s.taskId).filter(Boolean))].sort().map(taskId=>({taskId,workMs:String(recorded.filter(s=>s.taskId===taskId&&s.mode==='work').reduce((n,s)=>n+BigInt(s.ms),0n)),downtimeMs:String(recorded.filter(s=>s.taskId===taskId&&s.mode==='downtime').reduce((n,s)=>n+BigInt(s.ms),0n))}));
 const source={schemaVersion:1,tenantId:a.tenantId,projectId:p,employeeId:e,day,timezone:clock.timezone,civilStart:bounds.lo.toISOString(),civilEnd:bounds.hi.toISOString(),segments:recorded,zeroMarkers:markers,totals,tasks,intervalEvents,hasOpenIntervals,suspicious:intervalEvents.some(ev=>Object.values(ev.flags).some(Boolean))};
 return {source,sourceHash:createHash('sha256').update(canonicalSource(source)).digest('hex'),recorded:recorded.length>0,dayLengthMs:String(hi-lo),future:day>bounds.today,capturedAt:clock.asOf};
}
