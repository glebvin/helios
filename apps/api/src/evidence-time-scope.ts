import type {PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {httpError} from './errors.js';
// Same-client current authority; order matches 03a and people administration. No I/O in this transaction.
// Receipt (caller) -> project -> sorted employees -> sorted memberships -> grants -> worker assignment -> file/head (caller).
export async function evidenceTimeScope(c:PoolClient,a:Actor,projectId:string,employeeIds:string[]=[],mutation=false,onBehalfReason?:string,allowedRoles?:readonly string[]){
 if(!(await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[a.tenantId,projectId])).rowCount)throw httpError(404,'not_found');
 const employees=(await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,[a.tenantId,[...new Set(employeeIds)].sort()])).rows;
 if(employees.length!==new Set(employeeIds).size)throw httpError(404,'not_found');
 // Re-read links after employee waits, then lock all affected members in one stable order.
 const current=(await c.query(`SELECT id,user_id,status FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[a.tenantId,employeeIds])).rows;
 const ids=[...new Set([a.userId,...current.map(e=>e.user_id)].filter(Boolean))].sort();
 await c.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,ids]);
 await c.query(`SELECT user_id FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=ANY($3::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[a.tenantId,projectId,ids]);
 const m=(await c.query(`SELECT role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[a.tenantId,a.userId])).rows[0];
 if(!m||m.status!=='active'||!['director','master','pto','worker'].includes(m.role)||mutation&&m.role==='pto')throw httpError(403,'role_denied');
 if(allowedRoles&&!allowedRoles.includes(m.role))throw httpError(403,'role_denied');
 if(m.role!=='director'&&!(await c.query(`SELECT 1 FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND status='active'`,[a.tenantId,projectId,a.userId])).rowCount)throw httpError(404,'not_found');
 if(m.role==='worker'){
  if(!current.length)throw httpError(404,'not_found');
  await c.query(`SELECT employee_id FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=ANY($3::uuid[]) ORDER BY employee_id FOR NO KEY UPDATE`,[a.tenantId,projectId,employeeIds]);
  for(const e of current)if(e.user_id!==a.userId||e.status!=='active'||!(await c.query(`SELECT 1 FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND status='active'`,[a.tenantId,projectId,e.id])).rowCount)throw httpError(404,'not_found');
 }
 if(mutation&&m.role==='master'&&current.some(e=>e.user_id!==a.userId)&&!onBehalfReason)throw httpError(403,'on_behalf_reason_required');
 return {role:m.role as string,employees:current};
}
