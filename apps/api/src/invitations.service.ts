import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from './db.js';
import { httpError } from './errors.js';
import { hashPasswordCurrent, hashToken, newToken } from './password.js';
import { uuid } from './api-input.js';
import type { Actor } from './workforce.service.js';

function input(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw httpError(400,'invalid_input');
  return value as Record<string, any>;
}
function codeValue(value: string) {
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(value)) throw httpError(404,'invitation_not_found');
  return value;
}
function freshCode() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(12)].map(b=>alphabet[b & 31]).join('');
}
function live(row: any) {
  if (row.consumed_at) throw httpError(410,'invitation_used');
  if (row.revoked_at) throw httpError(410,'invitation_revoked');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw httpError(410,'invitation_expired');
}
function view(row: any) {
  const status=row.consumed_at?'used':row.revoked_at?'revoked':new Date(row.expires_at).getTime()<=Date.now()?'expired':'active';
  return {id:row.id,role:row.role,projectId:row.project_id,code:status==='active'?row.code:null,status,createdAt:row.created_at,expiresAt:row.expires_at,acceptedName:row.accepted_name??null};
}

export class InvitationsService {
  constructor(private readonly pool: Pool) {}
  // Recheck current authority inside the same transaction and hold it until commit.
  private async authority(c: PoolClient, userId: string, projectId: string, role?: string) {
    const member=(await c.query(`SELECT role FROM memberships WHERE user_id=$1 AND status='active' FOR SHARE`,[userId])).rows[0];
    if (!member || !['director','master'].includes(member.role) || (role==='master' && member.role!=='director')) throw httpError(403,'role_denied');
    if (!(await c.query(`SELECT 1 FROM projects WHERE id=$1`,[projectId])).rowCount) throw httpError(404,'not_found');
    if (member.role==='master' && !(await c.query(`SELECT 1 FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,[projectId,userId])).rowCount) throw httpError(403,'project_denied');
    return member.role as string;
  }
  private async audit(c: PoolClient, tenant: string, actor: string, action: string, invite: string) {
    await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result) VALUES($1,$2,$3,'invitation',$4,'ok')`,[tenant,actor,action,invite]);
  }
  private async insert(c: PoolClient, a: Actor, b: {role:string;projectId:string;organizationId:string;requestId:string}) {
    const row=(await c.query(`INSERT INTO invitations(tenant_id,project_id,organization_id,role,code,issued_by,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[a.tenantId,b.projectId,b.organizationId,b.role,freshCode(),a.userId,b.requestId])).rows[0];
    await c.query(`INSERT INTO invitation_locator(code_hash,tenant_id,invitation_id) VALUES($1,$2,$3)`,[hashToken(row.code),a.tenantId,row.id]);
    await this.audit(c,a.tenantId,a.userId,'invitation.created',row.id);
    return row;
  }
  create(a: Actor, value: unknown) {
    const b=input(value,['role','projectId','organizationId','requestId']);
    if (!['worker','master'].includes(b.role)) throw httpError(400,'invalid_role');
    const projectId=uuid(b.projectId).toLowerCase(), organizationId=uuid(b.organizationId).toLowerCase(), requestId=uuid(b.requestId).toLowerCase();
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      await this.authority(c,a.userId,projectId,b.role);
      // Serializes lost-response retries without issuing multiple active invitations.
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${a.tenantId}:${a.userId}:${requestId}`]);
      const old=(await c.query(`SELECT * FROM invitations WHERE issued_by=$1 AND request_id=$2`,[a.userId,requestId])).rows[0];
      if(old) {
        if(old.project_id!==projectId || old.organization_id!==organizationId || old.role!==b.role) throw httpError(409,'request_conflict');
        return view(old);
      }
      if(!(await c.query(`SELECT 1 FROM organizations WHERE id=$1 AND kind='own'`,[organizationId])).rowCount) throw httpError(422,'organization_denied');
      return view(await this.insert(c,a,{role:b.role,projectId,organizationId,requestId}));
    });
  }
  list(a: Actor, projectId: string) {
    uuid(projectId);
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      const role=await this.authority(c,a.userId,projectId);
      const rows=(await c.query(`SELECT i.*,u.name AS accepted_name FROM invitations i LEFT JOIN users u ON u.id=i.consumed_by WHERE i.project_id=$1 AND ($2='director' OR i.role='worker') ORDER BY i.created_at DESC,i.id LIMIT 100`,[projectId,role])).rows;
      const members=(await c.query(`SELECT e.id,e.full_name AS name,m.role FROM employees e JOIN memberships m ON m.tenant_id=e.tenant_id AND m.user_id=e.user_id JOIN project_memberships pm ON pm.tenant_id=e.tenant_id AND pm.user_id=e.user_id WHERE pm.project_id=$1 AND pm.status='active' AND m.status='active' AND e.status='active' AND m.role IN ('worker','master') ORDER BY e.full_name`,[projectId])).rows;
      return {items:rows.map(view),members};
    });
  }
  refresh(a: Actor, id: string, value: unknown) {
    uuid(id);const b=input(value,['requestId']);const requestId=uuid(b.requestId);
    return withTenant(this.pool,a.tenantId,a.userId,async c=>{
      // Lock before checking consumed status: redemption and rotation are mutually exclusive.
      const old=(await c.query(`SELECT * FROM invitations WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if(!old)throw httpError(404,'invitation_not_found');
      await this.authority(c,a.userId,old.project_id,old.role);
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${a.tenantId}:${a.userId}:${requestId}`]);
      const retry=(await c.query(`SELECT * FROM invitations WHERE issued_by=$1 AND request_id=$2`,[a.userId,requestId])).rows[0];
      if(retry) {
        // The audit links this idempotent command to exactly this old invitation.
        const audit=await c.query(`SELECT 1 FROM audit_log WHERE action='invitation.rotated' AND object_id=$1 AND details->>'replacementId'=$2`,[id,retry.id]);
        if(!audit.rowCount)throw httpError(409,'request_conflict');
        return view(retry);
      }
      if(old.consumed_at)throw httpError(410,'invitation_used');
      if(old.revoked_at)throw httpError(410,'invitation_revoked');
      const next=await this.insert(c,a,{role:old.role,projectId:old.project_id,organizationId:old.organization_id,requestId});
      await c.query(`UPDATE invitations SET revoked_at=now() WHERE id=$1`,[id]);
      await c.query(`INSERT INTO audit_log(tenant_id,actor_user_id,action,object_type,object_id,result,details) VALUES($1,$2,'invitation.rotated','invitation',$3,'ok',$4)`,[a.tenantId,a.userId,id,JSON.stringify({replacementId:next.id})]);
      return view(next);
    });
  }
  private async locate(code: string) {
    codeValue(code);
    const tenant=(await this.pool.query(`SELECT invitation_tenant($1) AS tenant`,[hashToken(code)])).rows[0]?.tenant;
    if(!tenant)throw httpError(404,'invitation_not_found');
    return tenant as string;
  }
  async inspect(code: string) {
    const tenant=await this.locate(code);
    return withTenant(this.pool,tenant,null,async c=>{
      const row=(await c.query(`SELECT i.*,p.name AS project_name FROM invitations i JOIN projects p ON p.tenant_id=i.tenant_id AND p.id=i.project_id WHERE i.code=$1`,[code])).rows[0];
      if(!row)throw httpError(404,'invitation_not_found');live(row);
      await this.authority(c,row.issued_by,row.project_id,row.role);
      return {role:row.role,projectName:row.project_name,expiresAt:row.expires_at};
    });
  }
  async accept(code: string, value: unknown) {
    const b=input(value,['name','email','password']);
    if(typeof b.name!=='string' || !b.name.trim() || b.name.trim().length>120 || /[\u0000-\u001f]/.test(b.name))throw httpError(400,'invalid_name');
    if(typeof b.email!=='string' || b.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()))throw httpError(400,'invalid_email');
    if(typeof b.password!=='string' || b.password.length<10 || b.password.length>128 || !b.password.trim())throw httpError(400,'invalid_password');
    const tenant=await this.locate(code);
    const email=b.email.trim().toLowerCase(), name=b.name.trim();
    try {
      return await withTenant(this.pool,tenant,null,async c=>{
        const row=(await c.query(`SELECT * FROM invitations WHERE code=$1 FOR UPDATE`,[code])).rows[0];
        if(!row)throw httpError(404,'invitation_not_found');live(row);
        await this.authority(c,row.issued_by,row.project_id,row.role);
        if((await c.query(`SELECT 1 FROM users WHERE lower(email)=$1`,[email])).rowCount)throw httpError(409,'email_registered');
        const userId=randomUUID(), employeeId=randomUUID(), token=newToken();
        const passwordHash = await hashPasswordCurrent(b.password);
        await c.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`,[userId,email,name,passwordHash]);
        await c.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,userId,row.role]);
        await c.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,$5)`,[tenant,employeeId,row.organization_id,userId,name]);
        await c.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[tenant,row.project_id,userId]);
        // Registration grants an account, never an admission or permission to start work.
        await c.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[userId,hashToken(token)]);
        await c.query(`UPDATE invitations SET consumed_at=now(),consumed_by=$2 WHERE id=$1`,[row.id,userId]);
        await this.audit(c,tenant,userId,'invitation.accepted',row.id);
        return {token,user:{id:userId,email,name},memberships:[{tenant_id:tenant,role:row.role,status:'active'}]};
      });
    }catch(error:any){if(error.code==='23505')throw httpError(409,'email_registered');throw error;}
  }
}
