// Run with the existing API tsx loader. Only disposable54339 or this worktree's54553.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPool,adminUrl} from '../apps/api/src/db.ts';
import {dailyRouteFixture,dailyScenario,newReadyDayTask,dailyRequest,removeDailyFixture} from '../apps/api/test/daily-route-fixture.ts';
const [operation,label]=process.argv.slice(2);assert.ok(['prepare','cleanup'].includes(operation));assert.ok(['chromium','webkit','ci'].includes(label));
const ci=label==='ci';assert.equal(process.env.GITHUB_ACTIONS==='true',ci);
const expected=`postgres://helios:helios@127.0.0.1:${ci?'54339':'54553'}/helios`;assert.equal(adminUrl,expected);
const output=resolve('.data',`daily-route-${label}-fixture.json`),admin=createPool(adminUrl);let created;
try{
 const directory=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 if(ci)assert.ok(directory.endsWith('/codex-api/.data/pg-54339'));else assert.equal(realpathSync(directory),realpathSync(resolve('.data/pg-54553')));
 if(operation==='prepare'){
  assert.equal(existsSync(output),false,'Preserve the previous owned fixture until cleanup');created=await dailyRouteFixture(admin);
  const state=await dailyScenario(ci?'http://127.0.0.1:4327':'http://127.0.0.1:4387',created);
  const clock=await dailyRequest(state,'/overview','master');assert.equal(clock.status,200);const day=clock.body.day;
  const task=await newReadyDayTask(state,{title:'Проверка дневного согласования',workDate:day,plannedStart:`${day}T09:00:00+03:00`,plannedEnd:`${day}T10:00:00+03:00`});
  mkdirSync(resolve('.data'),{recursive:true});writeFileSync(output,JSON.stringify({state,task}),{mode:0o600});created=undefined;
 }else if(existsSync(output)){
  const data=JSON.parse(readFileSync(output,'utf8'));assert.equal((await admin.query("SELECT name FROM tenants WHERE id=$1",[data.state.fixture.tenantId])).rows[0]?.name,'Daily route QA');
  await removeDailyFixture(admin,data.state.fixture);unlinkSync(output);
 }
 console.log(JSON.stringify({operation,label,ok:true}));
}finally{if(created)await removeDailyFixture(admin,created);await admin.end();}
