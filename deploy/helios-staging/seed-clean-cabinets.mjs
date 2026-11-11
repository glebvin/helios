import {readFile} from 'node:fs/promises';
import {createPool, withTenant} from '../../apps/api/src/db.js';
import {hashPassword} from '../../apps/api/src/password.js';

// Explicit operator tool for a newly created empty staging database only.
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const allowed = ['gd','ds','zds-sso','zds-soso','director','master','pto','supply','safety','hr','customer','admin','worker'];
if (input.accounts.length !== allowed.length || new Set(input.accounts.map(a => a.role)).size !== allowed.length ||
    input.accounts.some(a => !allowed.includes(a.role) || a.password.length < 10)) throw new Error('Invalid cabinet manifest');
const pool = createPool();
try {
  if ((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n !== 0) throw new Error('Database is not empty');
  await withTenant(pool,input.tenantId,null,async c => {
    await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[input.tenantId,'HELIOS — тестирование интерфейса']);
    await c.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own',$3)",[input.tenantId,input.organizationId,'Тестовая компания']);
    await c.query('INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,$3)',[input.tenantId,input.projectId,'Тестовый объект']);
    for (const a of input.accounts) {
      await c.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[a.id,a.email,a.name,hashPassword(a.password)]);
      await c.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[input.tenantId,a.id,a.role]);
      await c.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)',[input.tenantId,input.projectId,a.id]);
      if(a.employeeId) {
        await c.query('INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,$5)',[input.tenantId,a.employeeId,input.organizationId,a.id,a.name]);
        await c.query('INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3)',[input.tenantId,input.projectId,a.employeeId]);
      }
    }
  });
  console.log(JSON.stringify({users:input.accounts.length,projects:1,employees:input.accounts.filter(a=>a.employeeId).length,workRecords:0}));
} finally { await pool.end(); }
