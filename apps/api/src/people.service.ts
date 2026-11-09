import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import type { Actor } from './workforce.service.js';
import type { Page } from './api-input.js';
import { DirectorApiService } from './director-api.service.js';
import { employeeInput, qualificationInput } from './people-input.js';

const employeeFields = `id,full_name AS "fullName",phone,organization_id AS "organizationId",user_id AS "userId",version,status`;
const qualificationFields = `id,employee_id AS "employeeId",code,title,document_reference AS "documentReference",valid_until::text AS "validUntil",status,version`;
type Row = Record<string, any>;
type CommandResult = { status: number; body: Row };
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export class PeopleService {
  constructor(private readonly pool: Pool, private readonly api: DirectorApiService) {}
  private with<T>(a: Actor, f: (c: PoolClient) => Promise<T>) { return withTenant(this.pool,a.tenantId,a.userId,f); }
  private async director(c: PoolClient,a: Actor) {
    if (a.role !== 'director' || !(await c.query(`SELECT 1 FROM memberships WHERE user_id=$1 AND role='director' AND status='active'`,[a.userId])).rowCount) throw httpError(403,'role_denied');
  }
  // Deliberately local to people commands: reserve before entity locks, complete with audit in the same transaction.
  private async command(a: Actor, operation: string, b: Row, status: number, authorize: (c: PoolClient) => Promise<unknown>, run: (c: PoolClient) => Promise<Row>): Promise<CommandResult> {
    const { requestId, ...payload } = b;
    const hash = createHash('sha256').update(canonical({operation,payload})).digest('hex');
    try {
      return await this.with(a,async c => {
        await this.director(c,a);
        const inserted = await c.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING request_id`,[a.tenantId,a.userId,requestId,operation,hash]);
        await authorize(c);
        await this.director(c,a);
        if (!inserted.rowCount) {
          const r = (await c.query(`SELECT command_hash,status,result FROM people_command_receipts WHERE actor_user_id=$1 AND request_id=$2`,[a.userId,requestId])).rows[0];
          if (r.command_hash !== hash) throw httpError(409,'idempotency_payload_mismatch');
          return {status:r.status,body:r.result};
        }
        const body = await run(c);
        await c.query(`UPDATE people_command_receipts SET status=$3,result=$4 WHERE actor_user_id=$1 AND request_id=$2`,[a.userId,requestId,status,JSON.stringify(body)]);
        return {status,body};
      });
    } catch (error: any) {
      if (error.code === '23505') throw httpError(409,error.constraint === 'crew_member_one_active' ? 'crew_conflict' : 'conflict');
      if (['23503','23514'].includes(error.code)) throw httpError(422,'reference_denied');
      throw error;
    }
  }
  private async audit(c: PoolClient,a: Actor,requestId: string,type: string,id: string, before: Row | null,after: Row) {
    await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'people.command',$3,$4,'ok',$5)`,[a.tenantId,a.userId,type,id,JSON.stringify({requestId,before,after})]);
  }
  private async employeeLock(c: PoolClient,a: Actor,id: string) {
    await this.api.employeeExists(c,a,id);
    const r = (await c.query(`SELECT ${employeeFields} FROM employees WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if (!r) throw httpError(404,'not_found');
    return r;
  }
  private version(row: Row | undefined, expected: number) { if ((row?.version ?? 0) !== expected) throw httpError(409,'stale_version'); }
  private active(row: Row) { if (row.status !== 'active') throw httpError(422,'reference_denied'); }
  private async memberLocks(c: PoolClient, ids: (string | null)[]) {
    if (!ids.some(Boolean)) return [];
    return (await c.query(`SELECT user_id,role,status FROM memberships WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE`,[[...new Set(ids.filter(Boolean))]])).rows;
  }
  private async references(c: PoolClient,b: Row,oldUser: string | null = null) {
    const members = await this.memberLocks(c,[oldUser,b.userId]);
    if (b.userId && !members.some(m => m.user_id === b.userId && m.status === 'active')) throw httpError(422,'reference_denied');
    if (!(await c.query(`SELECT 1 FROM organizations WHERE id=$1`,[b.organizationId])).rowCount) throw httpError(422,'reference_denied');
  }
  createEmployee(a: Actor,input: unknown) {
    const b=employeeInput(input);
    return this.command(a,'POST /employees',b,201,async()=>{},async c=>{
      await this.references(c,b);
      const row=(await c.query(`INSERT INTO employees(tenant_id,id,full_name,organization_id,phone,user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${employeeFields}`,[a.tenantId,randomUUID(),b.fullName,b.organizationId,b.phone,b.userId])).rows[0];
      await this.audit(c,a,b.requestId,'employee',row.id,null,row); return row;
    });
  }
  updateEmployee(a: Actor,id: string,input: unknown) {
    const b=employeeInput(input,true);
    return this.command(a,`PUT /employees/${id}`,b,200,c=>this.api.employeeExists(c,a,id),async c=>{
      const before=await this.employeeLock(c,a,id); this.version(before,b.expectedVersion!);
      if (before.status === 'archived') throw httpError(422,'reference_denied');
      await this.references(c,b,before.userId);
      const after=(await c.query(`UPDATE employees SET full_name=$2,organization_id=$3,phone=$4,user_id=$5,status=$6,version=version+1 WHERE id=$1 RETURNING ${employeeFields}`,[id,b.fullName,b.organizationId,b.phone,b.userId,b.status])).rows[0];
      if (b.status==='archived') await this.revokeAssignments(c,a,id,b.requestId);
      await this.audit(c,a,b.requestId,'employee',id,before,after); return after;
    });
  }
  private async revokeAssignments(c: PoolClient,a: Actor,id: string,requestId: string) {
    const rows=(await c.query(`SELECT * FROM employee_project_assignments WHERE employee_id=$1 ORDER BY tenant_id,project_id,employee_id FOR UPDATE`,[id])).rows;
    for (const row of rows) if (row.status==='active') {
      const after=(await c.query(`UPDATE employee_project_assignments SET status='revoked',version=version+1 WHERE project_id=$1 AND employee_id=$2 RETURNING *`,[row.project_id,id])).rows[0];
      await this.audit(c,a,requestId,'assignment',id,row,after);
    }
    // Added with migration004; before that the tracer has no crew records.
    if ((await c.query(`SELECT to_regclass('crew_members') AS name`)).rows[0].name) await this.revokeCrew(c,a,id,requestId);
  }
  private async revokeCrew(c: PoolClient,a: Actor,id: string,requestId: string,projectId?: string) {
    const rows=(await c.query(`SELECT * FROM crew_members WHERE employee_id=$1 AND ($2::uuid IS NULL OR project_id=$2) ORDER BY tenant_id,project_id,crew_id,employee_id FOR UPDATE`,[id,projectId??null])).rows;
    for (const row of rows) if (row.status==='active') {
      const after=(await c.query(`UPDATE crew_members SET status='revoked',version=version+1 WHERE crew_id=$1 AND employee_id=$2 RETURNING *`,[row.crew_id,id])).rows[0];
      await this.audit(c,a,requestId,'crew_member',id,row,after);
    }
  }
  qualifications(a: Actor,id: string,p: Page) {
    return this.with(a,async c=>{
      await this.api.employeeExists(c,a,id);
      const total=(await c.query(`SELECT count(*)::int AS n FROM employee_qualifications WHERE employee_id=$1`,[id])).rows[0].n;
      const items=(await c.query(`SELECT ${qualificationFields} FROM employee_qualifications WHERE employee_id=$1 ORDER BY code,id LIMIT $2 OFFSET $3`,[id,p.limit,p.offset])).rows;
      return {items,total,...p};
    });
  }
  writeQualification(a: Actor,id: string,input: unknown,qid?: string) {
    const b: Row=qualificationInput(input,!!qid);
    return this.command(a,`${qid?'PUT':'POST'} /employees/${id}/qualifications${qid?`/${qid}`:''}`,b,qid?200:201,async c=>{
      await this.api.employeeExists(c,a,id);
      if(qid && !(await c.query(`SELECT 1 FROM employee_qualifications WHERE employee_id=$1 AND id=$2`,[id,qid])).rowCount) throw httpError(404,'not_found');
    },async c=>{
      this.active(await this.employeeLock(c,a,id));
      let before=null,after;
      if(qid) {
        before=(await c.query(`SELECT ${qualificationFields} FROM employee_qualifications WHERE employee_id=$1 AND id=$2 FOR UPDATE`,[id,qid])).rows[0];
        this.version(before,b.expectedVersion!); this.active(before);
        after=(await c.query(`UPDATE employee_qualifications SET title=$2,document_reference=$3,valid_until=$4,status=$5,version=version+1 WHERE id=$1 RETURNING ${qualificationFields}`,[qid,b.title,b.documentReference,b.validUntil,b.status])).rows[0];
      } else after=(await c.query(`INSERT INTO employee_qualifications(tenant_id,employee_id,code,title,document_reference,valid_until) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${qualificationFields}`,[a.tenantId,id,b.code,b.title,b.documentReference,b.validUntil])).rows[0];
      await this.audit(c,a,b.requestId,'qualification',after.id,before,after);return after;
    });
  }
}
