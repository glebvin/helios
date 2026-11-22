#!/usr/bin/env python3
"""Compile on the developer machine; create an explicit secret-free Linux build context."""
import json
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
deploy = root / 'deploy/helios-staging'
out = root / '.data/staging-runtime'
out.mkdir(parents=True, exist_ok=True)
subprocess.run(['node','apps/api/node_modules/typescript/bin/tsc','--project','deploy/helios-staging/tsconfig.json'],cwd=root,check=True)
subprocess.run(['node','apps/web/node_modules/typescript/bin/tsc','--project','apps/web/tsconfig.json','--noEmit'],cwd=root,check=True)
subprocess.run(['node','node_modules/vite/bin/vite.js','build','--configLoader','runner','--emptyOutDir','--outDir',str(out/'web')],cwd=root/'apps/web',check=True)
for name in ['apps','packages']:
    shutil.copytree(root/'.data/staging-build'/name,out/name,dirs_exist_ok=True)
shutil.copytree(root/'apps/api/sql',out/'apps/api/sql',dirs_exist_ok=True)
shutil.copy2(root/'apps/api/openapi.json',out/'apps/api/openapi.json')
(out/'deploy/helios-staging').mkdir(parents=True,exist_ok=True)
for name in ['entry.mjs','seed-staging.mjs','seed-clean-cabinets.mjs']:
    shutil.copy2(deploy/name,out/'deploy/helios-staging'/name)
for name in ['package.json','package-lock.json']:
    shutil.copy2(deploy/('runtime-'+name),out/name)
(out/'packages/domain/package.json').write_text(json.dumps({'name':'@helios/domain','version':'0.1.0','type':'module','exports':{'.':'./src/index.js'}})+'\n')
api_exports=json.loads((root/'apps/api/package.json').read_text())['exports']
assert all(isinstance(value,str) and value.startswith('./src/') and value.endswith('.ts') for value in api_exports.values())
(out/'apps/api/package.json').write_text(json.dumps({'name':'@helios/api','version':'0.1.0','type':'module','exports':{key:value[:-3]+'.js' for key,value in api_exports.items()}})+'\n')
index=out/'web/index.html'
text=index.read_text()
banner='<aside role="note" style="padding:8px 16px;background:#fff4dc;color:#604000;font:13px/1.4 system-ui">HELIOS · тестовый стенд, 13 кабинетов. Офлайн подключён к «Моей смене»; проверка физических телефонов — отдельный этап.</aside>'
recovery='<aside role="status" style="padding:8px 16px;background:#fff4dc;color:#604000;font:13px/1.4 system-ui">Recovery mode: new corrections, partial PTO decisions, PTO policy and price imports are paused. Existing data and receipts are preserved.</aside>'
index.write_text(text.replace('<body>','<body>'+banner+recovery))
shutil.copy2(deploy/'Dockerfile',out/'Dockerfile')
shutil.copy2(deploy/'compose.yaml',out/'compose.yaml')
shutil.copy2(deploy/'gateway.Caddyfile',out/'gateway.Caddyfile')
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
(out/'release.json').write_text(json.dumps({'commit':commit,'kind':'recovery-compatible','baseCommit':'17c49180e3b2e4c885832d98db4f0e572a5d65ee'},indent=2)+'\n')
shutil.copy2(out/'release.json',out/'web/release.json')
assert not list(out.rglob('.env'))
assert not list(out.rglob('node_modules'))
print('Compiled runtime, SQL, OpenAPI and frontend:',out)
