import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium,webkit} from 'playwright';
import {dailyRouteUi} from './daily-route-ui.mjs';
const root=resolve('.'),out=resolve('.data/daily-route-browser');mkdirSync(out,{recursive:true});const results=[];
const env={...process.env,TSX_TSCONFIG_PATH:'apps/api/tsconfig.json',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54553/helios',DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54553/helios'};
const child=(operation,label)=>{const r=spawnSync(process.execPath,['--import',resolve('apps/api/node_modules/tsx/dist/loader.mjs'),'qa/daily-route-fixture.mjs',operation,label],{cwd:root,env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);};
// The fixture child checks the exact DB directory before writes; no production target accepted.
for(const [label,engine]of [['chromium',chromium],['webkit',webkit]]){
 child('prepare',label);let browser;
 try{const data=JSON.parse(readFileSync(`.data/daily-route-${label}-fixture.json`));browser=await engine.launch({headless:true});results.push(await dailyRouteUi(browser,'http://127.0.0.1:5254',out,data,label,label==='chromium'?'http://127.0.0.1:5253':undefined));}
 finally{await browser?.close();child('cleanup',label);writeFileSync(resolve(out,'results.json'),JSON.stringify({results},null,2));}
}
console.log(JSON.stringify({results}));
