import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import type { Actor } from './workforce.service.js';
import type { Page } from './api-input.js';
import {reserveCommand,replayCommand,completeCommand,type CommandResult} from './durable-command.js';
import { DirectorApiService } from './director-api.service.js';
import { employeeInput, qualificationInput, templateInput, checkInput, membershipInput, crewInput } from './people-input.js';

const employeeFields = `id,full_name AS "fullName",phone,organization_id AS "organizationId",user_id AS "userId",version,status`;
const qualificationFields = `id,employee_id AS "employeeId",code,title,document_reference AS "documentReference",valid_until::text AS "validUntil",status,version`;
type Row = Record<string, any>;
export class PeopleService {
  constructor(private readonly pool: Pool, private readonly api: DirectorApiService) {}
  private with<T>(a: Actor, f: (c: PoolClient) => Promise<T>) { return withTenant(this.pool,a.tenantId,a.userId,f); }
  private async director(c: PoolClient,a: Actor) {
    if (a.role !== 'director' || !(await c.query(`SELECT 1 FROM memberships WHERE user_id=$1 AND role='director' AND status='active'`,[a.userId])).rowCount) throw httpError(403,'role_denied');
  }
  // Deliberately local to people commands: reserve before entity locks, complete with audit in the same transaction.
  private async command(a: Actor, operation: string, b: Row, status: number, authorize: (c: PoolClient) => Promise<unknown>, run: (c: PoolClient) => Promise<Row>): Promise<CommandResult> {
    const {requestId}=b;
    try {
      return await this.with(a,async c => {
        await this.director(c,a);
        const {inserted,hash}=await reserveCommand(c,a,operation,b);
        await authorize(c);
        await this.director(c,a);
        if (!inserted) return replayCommand(c,a,requestId,hash);
        const body = await run(c);
        return completeCommand(c,a,requestId,status,body);
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
    const r = (await c.query(`SELECT ${employeeFields} FROM employees WHERE id=$1 FOR NO KEY UPDATE`,[id])).rows[0];
    if (!r) throw httpError(404,'not_found');
    return r;
  }
  private version(row: Row | undefined, expected: number) { if ((row?.version ?? 0) !== expected) throw httpError(409,'stale_version'); }
  private active(row: Row) { if (row.status !== 'active') throw httpError(422,'reference_denied'); }
  private async memberLocks(c: PoolClient, ids: (string | null)[]) {
    if (!ids.some(Boolean)) return [];
    // NO KEY UPDATE serializes edits while remaining compatible with FK KEY SHARE locks.
    // Receipt and child inserts acquire those implicit FK locks before/after this class.
    return (await c.query(`SELECT user_id,role,status FROM memberships WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR NO KEY UPDATE`,[[...new Set(ids.filter(Boolean))]])).rows;
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
    const rows=(await c.query(`SELECT * FROM employee_project_assignments WHERE employee_id=$1 ORDER BY tenant_id,project_id,employee_id FOR NO KEY UPDATE`,[id])).rows;
    for (const row of rows) if (row.status==='active') {
      const after=(await c.query(`UPDATE employee_project_assignments SET status='revoked',version=version+1 WHERE project_id=$1 AND employee_id=$2 RETURNING *`,[row.project_id,id])).rows[0];
      await this.audit(c,a,requestId,'assignment',id,row,after);
    }
    await this.revokeCrew(c,a,id,requestId);
  }
  private async revokeCrew(c: PoolClient,a: Actor,id: string,requestId: string,projectId?: string) {
    const rows=(await c.query(`SELECT * FROM crew_members WHERE employee_id=$1 AND ($2::uuid IS NULL OR project_id=$2) ORDER BY tenant_id,project_id,crew_id,employee_id FOR NO KEY UPDATE`,[id,projectId??null])).rows;
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
  private async projectLock(c:PoolClient,a:Actor,p:string) {
    await this.api.projectExists(c,a,p);
    await c.query(`SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE`,[p]);
  }
  private async latestTemplate(c:PoolClient,p:string) {
    const r=(await c.query(`SELECT v.snapshot FROM admission_templates t JOIN admission_template_versions v USING(tenant_id,project_id,version) WHERE t.project_id=$1`,[p])).rows[0];
    if(!r) throw httpError(404,'not_found');return r.snapshot as Row;
  }
  template(a:Actor,p:string,pg?:Page) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);
      if(!pg)return this.latestTemplate(c,p);
      const total=(await c.query(`SELECT count(*)::int n FROM admission_template_versions WHERE project_id=$1`,[p])).rows[0].n;
      const items=(await c.query(`SELECT snapshot FROM admission_template_versions WHERE project_id=$1 ORDER BY version DESC LIMIT $2 OFFSET $3`,[p,pg.limit,pg.offset])).rows.map(r=>r.snapshot);
      return {items,total,...pg};
    });
  }
  writeTemplate(a:Actor,p:string,input:unknown,update=false) {
    const b:Row=templateInput(input,update);
    return this.command(a,`${update?'PUT':'POST'} /projects/${p}/admission-template`,b,update?200:201,c=>this.api.projectExists(c,a,p),async c=>{
      await this.projectLock(c,a,p);
      const before=(await c.query(`SELECT snapshot FROM admission_template_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1`,[p])).rows[0]?.snapshot;
      this.version(before,update?b.expectedVersion:0);
      const after={projectId:p,code:before?.code??b.code,title:b.title,version:(before?.version??0)+1,items:b.items,requiredQualificationCodes:b.requiredQualificationCodes};
      if(before) await c.query(`UPDATE admission_templates SET version=$2 WHERE project_id=$1`,[p,after.version]);
      else await c.query(`INSERT INTO admission_templates(tenant_id,project_id,code,version) VALUES($1,$2,$3,1)`,[a.tenantId,p,after.code]);
      await c.query(`INSERT INTO admission_template_versions(tenant_id,project_id,code,version,snapshot) VALUES($1,$2,$3,$4,$5)`,[a.tenantId,p,after.code,after.version,JSON.stringify(after)]);
      await this.audit(c,a,b.requestId,'admission_template',p,before??null,after);return after;
    });
  }
  private async civilDate(c:PoolClient) { return (await c.query(`SELECT to_char(clock_timestamp() AT TIME ZONE timezone,'YYYY-MM-DD') AS day FROM tenants`)).rows[0].day as string; }
  private async evidence(c:PoolClient,id:string,codes:string[]) {
    return (await c.query(`SELECT id,code,version,valid_until::text AS "validUntil",status FROM employee_qualifications WHERE employee_id=$1 AND code=ANY($2::text[]) AND status='active' ORDER BY code,id`,[id,codes])).rows;
  }
  private evidenceReasons(t:Row,evidence:Row[],date:string) {
    const reasons:string[]=[];
    for(const code of t.requiredQualificationCodes) {
      const q=evidence.find(q=>q.code===code);
      if(!q) reasons.push(`qualification_missing:${code}`);
      else if(q.status!=='active') reasons.push(`qualification_revoked:${code}`);
      else if(q.validUntil!==null && q.validUntil<date) reasons.push(`qualification_expired:${code}`);
    }
    return reasons;
  }
  writeCheck(a:Actor,e:string,input:unknown) {
    const b=checkInput(input),p=b.projectId;
    return this.command(a,`POST /employees/${e}/admission-checks`,b,201,async c=>{await this.api.projectExists(c,a,p);await this.api.employeeExists(c,a,e);},async c=>{
      await this.projectLock(c,a,p);this.active(await this.employeeLock(c,a,e));
      const t=await this.latestTemplate(c,p);
      if(t.version!==b.templateVersion) throw httpError(409,'template_changed');
      if(b.answers.length!==t.items.length || b.answers.some(answer=>!t.items.some((i:Row)=>i.id===answer.itemId))) throw httpError(400,'invalid_answers');
      const evidence=await this.evidence(c,e,t.requiredQualificationCodes),civilDate=await this.civilDate(c);
      const reasons=this.evidenceReasons(t,evidence,civilDate),warnings:string[]=[];
      for(const item of t.items) if(!b.answers.find(answer=>answer.itemId===item.id)!.value) (item.critical?reasons:warnings).push(`${item.critical?'critical_failed':'noncritical_failed'}:${item.id}`);
      const sequence=(await c.query(`SELECT coalesce(max(sequence),0)+1 AS n FROM employee_admission_checks WHERE employee_id=$1`,[e])).rows[0].n;
      const checkedAt=(await c.query(`SELECT clock_timestamp()::text AS time`)).rows[0].time;
      const after={id:randomUUID(),employeeId:e,projectId:p,templateCode:t.code,templateVersion:t.version,sequence,answers:b.answers,templateSnapshot:t,qualificationEvidence:evidence,checkedBy:a.userId,checkedAt,civilDate,passed:reasons.length===0,reasons,warnings};
      await c.query(`INSERT INTO employee_admission_checks(tenant_id,id,employee_id,project_id,template_version,sequence,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.tenantId,after.id,e,p,t.version,sequence,JSON.stringify(after)]);
      await this.audit(c,a,b.requestId,'admission_check',after.id,null,after);return after;
    });
  }
  checks(a:Actor,e:string,pg:Page,p?:string,id?:string) {
    return this.with(a,async c=>{
      await this.api.employeeExists(c,a,e);if(p)await this.api.projectExists(c,a,p);
      const where=`ch.employee_id=$3 AND ($4::uuid IS NULL OR ch.project_id=$4) AND ($5::uuid IS NULL OR ch.id=$5) AND ${this.api.projectVisibility()}`;
      const from=`FROM employee_admission_checks ch JOIN projects p ON p.tenant_id=ch.tenant_id AND p.id=ch.project_id`;
      const values=[a.role,a.userId,e,p??null,id??null];
      const total=(await c.query(`SELECT count(*)::int n ${from} WHERE ${where}`,values)).rows[0].n;
      const items=(await c.query(`SELECT ch.snapshot ${from} WHERE ${where} ORDER BY ch.sequence DESC LIMIT $6 OFFSET $7`,[...values,pg.limit,pg.offset])).rows.map(r=>r.snapshot);
      if(id){if(!items[0])throw httpError(404,'not_found');return items[0];}
      return {items,total,...pg};
    });
  }
  // Internal same-transaction evaluator. Caller owns project/employee/member locks; no write authority is granted.
  async eligibility(c:PoolClient,e:Row,p:string,checkId:string|null) {
    const reasons:string[]=[];
    const t=(await c.query(`SELECT version,code FROM admission_templates WHERE project_id=$1`,[p])).rows[0];
    const row=checkId?(await c.query(`SELECT snapshot FROM employee_admission_checks WHERE employee_id=$1 AND project_id=$2 AND id=$3`,[e.id,p,checkId])).rows[0]:undefined;
    const check=row?.snapshot;
    if(e.status!=='active')reasons.push('employee_archived');
    if(!check) reasons.push('no_check');
    else {
      if(!check.passed)reasons.push('check_failed');
      const latest=(await c.query(`SELECT id FROM employee_admission_checks WHERE employee_id=$1 AND project_id=$2 ORDER BY sequence DESC LIMIT 1`,[e.id,p])).rows[0];
      if(latest?.id!==check.id)reasons.push('not_latest_check');
      if(!t || t.version!==check.templateVersion || t.code!==check.templateCode)reasons.push('template_changed');
      const evidence=await this.evidence(c,e.id,check.templateSnapshot.requiredQualificationCodes);
      reasons.push(...this.evidenceReasons(check.templateSnapshot,evidence,await this.civilDate(c)));
      for(const code of check.templateSnapshot.requiredQualificationCodes) {
        const current=evidence.find(q=>q.code===code),recorded=check.qualificationEvidence.find((q:Row)=>q.code===code);
        if(!current || !recorded || current.id!==recorded.id || current.version!==recorded.version)reasons.push(`qualification_changed:${code}`);
      }
    }
    return {eligible:reasons.length===0,reasons,checkId:check?.id??null,templateVersion:t?.version??null};
  }
  memberships(a:Actor,p:string,pg:Page) {
    return this.with(a,async c=>{
      await this.director(c,a);await this.api.projectExists(c,a,p);
      const total=(await c.query(`SELECT count(*)::int n FROM project_memberships WHERE project_id=$1`,[p])).rows[0].n;
      const items=(await c.query(`SELECT pm.project_id AS "projectId",pm.user_id AS "userId",m.role,pm.status,pm.version FROM project_memberships pm JOIN memberships m USING(tenant_id,user_id) WHERE pm.project_id=$1 ORDER BY pm.user_id LIMIT $2 OFFSET $3`,[p,pg.limit,pg.offset])).rows;
      return {items,total,...pg};
    });
  }
  writeMembership(a:Actor,p:string,u:string,input:unknown) {
    const b=membershipInput(input);
    return this.command(a,`PUT /projects/${p}/memberships/${u}`,b,200,c=>this.api.projectExists(c,a,p),async c=>{
      await this.projectLock(c,a,p);const m=(await this.memberLocks(c,[u]))[0];
      if(!m || m.status!=='active')throw httpError(422,'reference_denied');
      const before=(await c.query(`SELECT project_id AS "projectId",user_id AS "userId",status,version FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR NO KEY UPDATE`,[p,u])).rows[0];
      this.version(before,b.expectedVersion);
      const after={projectId:p,userId:u,role:m.role,status:b.status,version:(before?.version??0)+1};
      if(before)await c.query(`UPDATE project_memberships SET status=$3,version=version+1 WHERE project_id=$1 AND user_id=$2`,[p,u,b.status]);
      else await c.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id,status) VALUES($1,$2,$3,$4)`,[a.tenantId,p,u,b.status]);
      await this.audit(c,a,b.requestId,'project_membership',u,before?{...before,role:m.role}:null,after);return after;
    });
  }
  private async assignmentRow(c:PoolClient,p:string,e:string,lock=false) {
    return (await c.query(`SELECT project_id AS "projectId",employee_id AS "employeeId",status,version,admission_check_id AS "admissionCheckId" FROM employee_project_assignments WHERE project_id=$1 AND employee_id=$2 ${lock?'FOR NO KEY UPDATE':''}`,[p,e])).rows[0];
  }
  assignments(a:Actor,p:string,pg:Page) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);
      const where=`a.project_id=$4 AND ${this.api.employeeVisible()}`;
      const from=`FROM employee_project_assignments a JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id`;
      const values=[a.role,a.userId,null,p];
      const total=(await c.query(`SELECT count(*)::int n ${from} WHERE ${where}`,values)).rows[0].n;
      const rows=(await c.query(`SELECT a.project_id AS "projectId",a.employee_id AS "employeeId",a.status,a.version,a.admission_check_id AS "admissionCheckId",e.status AS "employeeStatus" ${from} WHERE ${where} ORDER BY a.employee_id LIMIT $5 OFFSET $6`,[...values,pg.limit,pg.offset])).rows;
      const items=[];
      for(const {employeeStatus,...row} of rows)items.push({...row,currentAdmission:await this.eligibility(c,{id:row.employeeId,status:employeeStatus},p,row.admissionCheckId)});
      return {items,total,...pg};
    });
  }
  writeAssignment(a:Actor,p:string,e:string,input:unknown) {
    const b:Row=membershipInput(input,true);
    return this.command(a,`PUT /projects/${p}/assignments/${e}`,b,200,async c=>{await this.api.projectExists(c,a,p);await this.api.employeeExists(c,a,e);},async c=>{
      await this.projectLock(c,a,p);const employee=await this.employeeLock(c,a,e);
      const m=employee.userId?(await this.memberLocks(c,[employee.userId]))[0]:undefined;
      const before=await this.assignmentRow(c,p,e,true);this.version(before,b.expectedVersion);
      if(b.status==='active') {
        this.active(employee);if(employee.userId && (!m || m.status!=='active'))throw httpError(422,'reference_denied');
        const eligible=await this.eligibility(c,employee,p,b.admissionCheckId);if(!eligible.eligible)throw httpError(422,'admission_required');
      }
      const after={projectId:p,employeeId:e,status:b.status,version:(before?.version??0)+1,admissionCheckId:b.status==='active'?b.admissionCheckId:before?.admissionCheckId??null};
      if(before)await c.query(`UPDATE employee_project_assignments SET status=$3,version=version+1,admission_check_id=$4 WHERE project_id=$1 AND employee_id=$2`,[p,e,after.status,after.admissionCheckId]);
      else await c.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id,status,admission_check_id) VALUES($1,$2,$3,$4,$5)`,[a.tenantId,p,e,after.status,after.admissionCheckId]);
      if(b.status==='active' && m?.role==='worker') {
        const prior=(await c.query(`SELECT project_id AS "projectId",user_id AS "userId",status,version FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR NO KEY UPDATE`,[p,employee.userId])).rows[0];
        if(prior?.status!=='active') {
          if(prior)await c.query(`UPDATE project_memberships SET status='active',version=version+1 WHERE project_id=$1 AND user_id=$2`,[p,employee.userId]);
          else await c.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[a.tenantId,p,employee.userId]);
          await this.audit(c,a,b.requestId,'project_membership',employee.userId,prior??null,{projectId:p,userId:employee.userId,status:'active',version:(prior?.version??0)+1,role:'worker'});
        }
      }
      if(b.status==='revoked')await this.revokeCrew(c,a,e,b.requestId,p);
      await this.audit(c,a,b.requestId,'assignment',e,before??null,after);
      return {...after,currentAdmission:await this.eligibility(c,employee,p,after.admissionCheckId)};
    });
  }
  private async crewExists(c:PoolClient,p:string,id:string) {
    const row=(await c.query(`SELECT id,project_id AS "projectId",name,version FROM crews WHERE project_id=$1 AND id=$2`,[p,id])).rows[0];
    if(!row)throw httpError(404,'not_found');return row;
  }
  private async crewMembers(c:PoolClient,a:Actor,p:string,id:string) {
    const rows=(await c.query(`SELECT cm.employee_id AS "employeeId",cm.status,cm.version,e.status AS "employeeStatus",ass.admission_check_id AS "checkId" FROM crew_members cm JOIN employees e ON e.tenant_id=cm.tenant_id AND e.id=cm.employee_id JOIN employee_project_assignments ass ON ass.tenant_id=cm.tenant_id AND ass.project_id=cm.project_id AND ass.employee_id=cm.employee_id WHERE cm.project_id=$4 AND cm.crew_id=$5 AND ${this.api.employeeVisible()} ORDER BY cm.employee_id`,[a.role,a.userId,null,p,id])).rows;
    const members=[];
    for(const {employeeStatus,checkId,...row} of rows)members.push({...row,currentAdmission:await this.eligibility(c,{id:row.employeeId,status:employeeStatus},p,checkId)});
    return members;
  }
  crews(a:Actor,p:string,pg:Page,id?:string) {
    return this.with(a,async c=>{
      await this.api.projectExists(c,a,p);
      if(id)return {...await this.crewExists(c,p,id),members:await this.crewMembers(c,a,p,id)};
      const total=(await c.query(`SELECT count(*)::int n FROM crews WHERE project_id=$1`,[p])).rows[0].n;
      const rows=(await c.query(`SELECT id,project_id AS "projectId",name,version FROM crews WHERE project_id=$1 ORDER BY name,id LIMIT $2 OFFSET $3`,[p,pg.limit,pg.offset])).rows;
      const items=[];for(const row of rows)items.push({...row,members:await this.crewMembers(c,a,p,row.id)});return {items,total,...pg};
    });
  }
  createCrew(a:Actor,p:string,input:unknown) {
    const b=crewInput(input);
    return this.command(a,`POST /projects/${p}/crews`,b,201,c=>this.api.projectExists(c,a,p),async c=>{
      await this.projectLock(c,a,p);
      const after=(await c.query(`INSERT INTO crews(tenant_id,project_id,name) VALUES($1,$2,$3) RETURNING id,project_id AS "projectId",name,version`,[a.tenantId,p,b.name])).rows[0];
      await this.audit(c,a,b.requestId,'crew',after.id,null,after);return after;
    });
  }
  writeCrewMember(a:Actor,p:string,crew:string,e:string,input:unknown) {
    const b=membershipInput(input);
    return this.command(a,`PUT /projects/${p}/crews/${crew}/members/${e}`,b,200,async c=>{await this.api.projectExists(c,a,p);await this.api.employeeExists(c,a,e);await this.crewExists(c,p,crew);},async c=>{
      await this.projectLock(c,a,p);const employee=await this.employeeLock(c,a,e);
      const member=employee.userId?(await this.memberLocks(c,[employee.userId]))[0]:undefined;
      const assignment=await this.assignmentRow(c,p,e,true);
      const before=(await c.query(`SELECT employee_id AS "employeeId",status,version FROM crew_members WHERE crew_id=$1 AND employee_id=$2 FOR NO KEY UPDATE`,[crew,e])).rows[0];
      this.version(before,b.expectedVersion);
      const currentAdmission=await this.eligibility(c,employee,p,assignment?.admissionCheckId??null);
      if(b.status==='active') {
        this.active(employee);if(employee.userId && (!member || member.status!=='active'))throw httpError(422,'reference_denied');
        if(assignment?.status!=='active' || !currentAdmission.eligible)throw httpError(422,'admission_required');
      }
      if(!assignment)throw httpError(422,'reference_denied');
      const after={employeeId:e,status:b.status,version:(before?.version??0)+1};
      if(before)await c.query(`UPDATE crew_members SET status=$3,version=version+1 WHERE crew_id=$1 AND employee_id=$2`,[crew,e,b.status]);
      else await c.query(`INSERT INTO crew_members(tenant_id,project_id,crew_id,employee_id,status) VALUES($1,$2,$3,$4,$5)`,[a.tenantId,p,crew,e,b.status]);
      await this.audit(c,a,b.requestId,'crew_member',e,before??null,{...after,projectId:p,crewId:crew});return {...after,currentAdmission};
    });
  }
}
