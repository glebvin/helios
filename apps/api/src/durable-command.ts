import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {httpError} from './errors.js';
import type {Actor} from './workforce.service.js';
export type CommandResult = {status:number;body:Record<string,any>};
function canonical(value:any):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
// Shared namespace and unchanged canonical people command hash. Authorization stays with each service.
export async function reserveCommand(c:PoolClient,a:Actor,operation:string,b:Record<string,any>) {
  const {requestId,...payload}=b;
  const hash=createHash('sha256').update(canonical({operation,payload})).digest('hex');
  const r=await c.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING request_id`,[a.tenantId,a.userId,requestId,operation,hash]);
  // Recovery keeps current readers and security fixes, but freezes new release writers.
  // Throw inside the caller's transaction so no reservation survives the refusal.
  if(r.rowCount && process.env.HELIOS_RELEASE_RECOVERY==='1' && (
    operation.endsWith('/corrections') && operation.includes('/volume-reviews/') ||
    operation.endsWith('/internal-inspection-policy') ||
    operation.endsWith('/contract-prices/imports') ||
    operation.endsWith('/internal-inspection') && b.action==='partial'
  ))throw httpError(503,'release_write_paused');
  return {inserted:!!r.rowCount,hash};
}
export async function replayCommand(c:PoolClient,a:Actor,requestId:string,hash:string):Promise<CommandResult> {
  const r=(await c.query(`SELECT command_hash,status,result FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[a.tenantId,a.userId,requestId])).rows[0];
  if(!r || r.command_hash!==hash)throw httpError(409,'idempotency_payload_mismatch');
  return {status:r.status,body:r.result};
}
export async function completeCommand(c:PoolClient,a:Actor,requestId:string,status:number,body:Record<string,any>) {
  await c.query(`UPDATE people_command_receipts SET status=$4,result=$5 WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[a.tenantId,a.userId,requestId,status,JSON.stringify(body)]);
  return {status,body};
}
