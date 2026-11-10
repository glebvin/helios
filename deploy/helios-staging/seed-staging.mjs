import {readFile} from 'node:fs/promises';
import {createPool, withTenant} from '../../apps/api/src/db.js';
import {hashPassword} from '../../apps/api/src/password.js';
import {TENANT_A,ORG_A,USER_DIRECTOR,USER_MASTER,USER_WORKER,EMPLOYEE_A,PROJECT_A} from '@helios/domain';

// Only explicit private credentials supplied by the operator; never the dev seed.
const credentials=JSON.parse(await readFile('/run/helios-credentials.json','utf8'));
if(credentials.length!==3 || credentials.some(x=>!x.password||x.password.length<20))throw new Error('Three unique staging credentials required');
const pool=createPool();
try {
  for(const [index, id] of [USER_DIRECTOR,USER_MASTER,USER_WORKER].entries()) {
    const credential=credentials[index];
    const exists=await pool.query('SELECT 1 FROM users WHERE id=$1',[id]);
    if(exists.rowCount)throw new Error('Staging already initialised: no automatic reset');
    await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,credential.email,credential.name,hashPassword(credential.password)]);
  }
  await withTenant(pool,TENANT_A,USER_DIRECTOR,async c=>{
    await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[TENANT_A,'HELIOS — тестовый кабинет']);
    await c.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own',$3)",[TENANT_A,ORG_A,'Учебная компания']);
    for(const [index,id] of [USER_DIRECTOR,USER_MASTER,USER_WORKER].entries()) await c.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[TENANT_A,id,['director','master','worker'][index]]);
    await c.query('INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,$5)',[TENANT_A,EMPLOYEE_A,ORG_A,USER_WORKER,'Иван — учебный работник']);
    await c.query('INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,$3)',[TENANT_A,PROJECT_A,'Учебный объект HELIOS']);
  });
  console.log('Staging initialised with synthetic records; credentials not logged');
} finally {await pool.end();}
