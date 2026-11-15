import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {dailyRouteUi} from './daily-route-ui.mjs';
export async function dailyRouteCi(browser,base,out){
 assert.equal(process.env.HELIOS_CI_FIXTURE,'disposable');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(base,'http://127.0.0.1:5207');
 const run=operation=>{
  const r=spawnSync(process.execPath,['--import',resolve('apps/api/node_modules/tsx/dist/loader.mjs'),'qa/daily-route-fixture.mjs',operation,'ci'],{env:{...process.env,TSX_TSCONFIG_PATH:'apps/api/tsconfig.json'},encoding:'utf8',timeout:60000});
  assert.equal(r.status,0,r.stdout+r.stderr);
 };
 run('prepare');
 try{return await dailyRouteUi(browser,base,out,JSON.parse(readFileSync('.data/daily-route-ci-fixture.json','utf8')),'ci');}
 finally{run('cleanup');}
}
