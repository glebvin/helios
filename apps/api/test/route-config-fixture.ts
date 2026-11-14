import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {hashPassword} from '../src/password.js';
export async function routeFixture(admin:Pool){
 const url=new URL((admin.options as {connectionString:string}).connectionString);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,process.env.GITHUB_ACTIONS==='true'?'54339':'54551');
 if(process.env.GITHUB_ACTIONS!=='true')assert.equal(realpathSync((await admin.query('SHOW data_directory')).rows[0].data_directory),realpathSync(fileURLToPath(new URL('../../../.data/pg-54551',import.meta.url))));
 const tenantId=randomUUID(),foreignId=randomUUID(),projectId=randomUUID(),otherProjectId=randomUUID();
 const users=['admin','admin','director','master','safety','pto','worker','safety','safety'].map(role=>({id:randomUUID(),role,email:`${randomUUID()}@routes.test`,password:'fixture-routes-2026',name:role==='admin'?'Администратор маршрутов':role==='director'?'Руководитель маршрута':`Участник ${role}`}));
 await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Routes QA'),($2,'Foreign routes QA')",[tenantId,foreignId]);
 await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Учебный объект маршрутов'),($1,$3,'Чужое назначение')",[tenantId,projectId,otherProjectId]);
 for(const u of users){await admin.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[u.id,u.email,u.name,hashPassword(u.password)]);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,u.id,u.role]);await admin.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)',[tenantId,projectId,u.id]);}
 return {tenantId,foreignId,projectId,otherProjectId,users};
}
export async function removeRouteFixture(admin:Pool,f:Awaited<ReturnType<typeof routeFixture>>){
 const tenants=[f.tenantId,f.foreignId],ids=f.users.map(u=>u.id);
 await admin.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[ids]);
 for(const table of ['route_config_versions','people_command_receipts','project_memberships','memberships','projects','audit_log','tenants'])await admin.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=ANY($1::uuid[])`,[tenants]);
 await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);
}
