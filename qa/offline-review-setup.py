#!/usr/bin/env python3
"""Own local QA only: fresh synthetic tenants, no reset/seed of shared staging."""
import json,os,secrets,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse
root=Path(__file__).resolve().parents[1];os.chdir(root)
out=root/'.data/release-r23-r25';out.mkdir(parents=True,exist_ok=True);config=out/'qa-config.json';mode=sys.argv[1] if len(sys.argv)>1 else 'fixtures'
assert mode in ('init','fixtures','api')
if mode=='init':
    assert not config.exists(),'Already initialized: use fixtures or api; never reset.'
    binary=Path(os.environ['HELIOS_QA_PG_BIN']).resolve();password=secrets.token_hex(18)
    pw=out/'init-password';pw.write_text(password);pw.chmod(0o600)
    subprocess.run([str(binary/'initdb'),'-D',str(out/'pg'),'-U','helios','--auth=password','--pwfile='+str(pw),'--encoding=UTF8','--locale=C'],check=True)
    pw.unlink();subprocess.run([str(binary/'pg_ctl'),'-D',str(out/'pg'),'-l',str(out/'postgres.log'),'-o','-h 127.0.0.1 -p 54360','-w','start'],check=True)
    config.write_text(json.dumps({'admin':f'postgres://helios:{password}@127.0.0.1:54360/helios','app':f'postgres://helios_app:{password}@127.0.0.1:54360/helios'}));config.chmod(0o600)
c=json.loads(config.read_text())
for value in c.values():
    u=urlparse(value);assert u.hostname=='127.0.0.1' and u.port==54360 and u.path=='/helios'
env=os.environ.copy();env.update(ADMIN_DATABASE_URL=c['admin'],DATABASE_URL=c['app'],API_PORT='4369',HELIOS_EVIDENCE_ROOT=str(out/'evidence'),TSX_TSCONFIG_PATH='apps/api/tsconfig.json')
def node(*args):subprocess.run(['node',*args],env=env,check=True)
if mode=='init':
    sql="""import pg from './apps/api/node_modules/pg/lib/index.js';import{readFile}from'node:fs/promises';const c=JSON.parse(await readFile('.data/release-r23-r25/qa-config.json'));const u=new URL(c.admin);u.pathname='/postgres';const db=new pg.Client({connectionString:u.href});await db.connect();await db.query('CREATE DATABASE helios');await db.query(\"CREATE ROLE helios_app LOGIN PASSWORD '\"+new URL(c.app).password+\"'\");await db.query('GRANT CREATE ON DATABASE helios TO helios_app');await db.end();"""
    subprocess.run(['node','--input-type=module','-'],input=sql,text=True,env=env,check=True)
    node('--import','./apps/api/node_modules/tsx/dist/loader.mjs','apps/api/src/migrate.ts')
    print('Database ready. Start api in another terminal, then run fixtures.');sys.exit(0)
if mode=='api':node('--import','./apps/api/node_modules/tsx/dist/loader.mjs','apps/api/src/main.ts');sys.exit(0)
# API4369 must be started separately before preparing source-backed scenarios.
for name in ('fixture','events-chromium','events-webkit','update-chromium','update-webkit'):
    env.update(HELIOS_QA_ADMIN_DATABASE_URL=c['admin'],HELIOS_SHIFT_REVIEW_OUTPUT=str(out/name))
    node('--import','./apps/api/node_modules/tsx/dist/loader.mjs','qa/create-offline-review.mjs')
    node('qa/prepare-offline-scenario.mjs')
    if name=='fixture':node('qa/prepare-offline-evidence.mjs')
