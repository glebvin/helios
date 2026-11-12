// Creates a fresh synthetic tenant only on the isolated local QA database.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {hashPassword} from '../apps/api/src/password.ts';
const url=new URL(process.env.HELIOS_QA_ADMIN_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='54349'&&url.pathname==='/helios','Only isolated local QA54349');
const out=process.env.HELIOS_PEOPLE_REVIEW_OUTPUT??'.data/people-review';await mkdir(out,{recursive:true});
const tenantId=randomUUID(),organizationId=randomUUID(),projectId=randomUUID(),projectB=randomUUID(),suffix=tenantId.slice(0,6),password=`Local!${randomBytes(7).toString('hex')}`;
const accounts=[['director','Руководитель','rp'],['master','Павел Прораб','master'],['worker','Иван Работник','worker']].map(([role,name,prefix])=>({id:randomUUID(),role,name,email:`${prefix}.${suffix}@people.test`,password,...(role==='director'?{}:{employeeId:randomUUID()})}));
const employeeUnlinked=randomUUID(),db=new pg.Client({connectionString:url.href});await db.connect();
try{await db.query('BEGIN');await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Локальная проверка раздела Люди']);await db.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own',$3)",[tenantId,organizationId,'Тестовая строительная компания']);
 for(const a of accounts){await db.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[a.id,a.email,a.name,hashPassword(a.password)]);await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,a.id,a.role]);if(a.employeeId)await db.query('INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,$5)',[tenantId,a.employeeId,organizationId,a.id,a.name]);}
 await db.query('INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,$4)',[tenantId,employeeUnlinked,organizationId,'Мария — карточка без входа']);
 await db.query('INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,$3),($1,$4,$5)',[tenantId,projectId,'Учебная площадка',projectB,'Вторая площадка']);await db.query('COMMIT');
}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
const manifest={tenantId,organizationId,projectId,projectB,employeeUnlinked,accounts};await writeFile(`${out}/accounts.json`,JSON.stringify(manifest,null,2),{mode:0o600});
await writeFile(`${out}/Доступ и начало проверки.md`,`# Локальная проверка «Люди»\n\nАдрес: http://127.0.0.1:5207\nКомпания: Локальная проверка раздела Люди. Это отдельные синтетические данные, не активный сервер.\n\n${accounts.map(a=>`- ${a.name} (${a.role}): логин **${a.email}**, пароль **${a.password}**.`).join('\n')}\n\nОбъекты: «Учебная площадка» и «Вторая площадка». Начните с руководителя. Полный сценарий находится в docs/PEOPLE-TESTING.md. Учётные данные не публиковать в GitHub.\n`,{mode:0o600});
console.log('Created isolated people review fixture; private access file:',`${out}/Доступ и начало проверки.md`);
