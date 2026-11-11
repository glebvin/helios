"""Run on the HELIOS VPS: prepare an isolated candidate; never switches live services."""
import json, os, subprocess, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import quote

base=Path('/opt/helios-staging')
database='helios_clean_20261111'
image='helios-staging:1658687e1422'
manifest=base/'clean-accounts-20261111.json'
accounts=json.loads(manifest.read_text())
env=dict(line.split('=',1) for line in (base/'.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
def run(args, **kw): return subprocess.run(args,check=True,**kw)
def sql(db,statement):
    return subprocess.check_output(['docker','exec','helios-staging-db-1','psql','-U','helios_owner','-d',db,'-At','-c',statement],text=True).strip()
exists=sql('postgres',f"SELECT 1 FROM pg_database WHERE datname='{database}'")
if not exists:
    run(['docker','exec','helios-staging-db-1','createdb','-U','helios_owner','-O','helios_owner',database])
sql('postgres',f'GRANT CREATE ON DATABASE {database} TO helios_app')
owner=f"postgres://helios_owner:{quote(env['OWNER_DB_PASSWORD'],safe='')}@db:5432/{database}"
app=f"postgres://helios_app:{quote(env['APP_DB_PASSWORD'],safe='')}@db:5432/{database}"
ownerfile=base/'clean-owner.env'
apifile=base/'clean-api.env'
ownerfile.write_text(f'ADMIN_DATABASE_URL={owner}\nDATABASE_URL={owner}\n')
apifile.write_text(f'DATABASE_URL={app}\nNODE_ENV=production\nNODE_OPTIONS=--max-old-space-size=256\nHELIOS_EVIDENCE_ROOT=/var/lib/helios/evidence\n')
os.chmod(ownerfile,0o600);os.chmod(apifile,0o600)
common=['docker','run','--rm','--network','helios-staging_backend','--env-file',str(ownerfile)]
run(common+[image,'node','apps/api/src/migrate.js'])
count=int(sql(database,'SELECT count(*) FROM users'))
if count==0:
    run(common+['--user','0','-v',str(manifest)+':/run/clean-accounts.json:ro',image,'node','deploy/helios-staging/seed-clean-cabinets.mjs','/run/clean-accounts.json'])
elif count!=13:
    raise RuntimeError('Candidate users are unexpected')
run(['docker','volume','create','helios-staging_clean_evidence_20261111'],stdout=subprocess.DEVNULL)
present=subprocess.run(['docker','inspect','helios-clean-qa-api'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
if not present:
    run(['docker','run','-d','--name','helios-clean-qa-api','--network','helios-staging_backend',
         '-p','127.0.0.1:4328:4327','--env-file',str(apifile),'--read-only','--tmpfs','/tmp:size=32m',
         '--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m',
         '-v','helios-staging_clean_evidence_20261111:/var/lib/helios/evidence',image],stdout=subprocess.DEVNULL)
origin='http://127.0.0.1:4328'
for attempt in range(30):
    try:
        with urllib.request.urlopen(origin+'/api/health',timeout=1) as r:
            if r.status==200: break
    except Exception: time.sleep(1)
else: raise RuntimeError('Candidate failed health')
def call(path,body=None,headers=None):
    req=urllib.request.Request(origin+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**(headers or {})})
    try:
        with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
results=[]
readonly={'gd','ds','zds-sso','zds-soso','supply','safety','hr','customer','admin'}
for a in accounts['accounts']:
    status,body=call('/api/v1/auth/login',{'email':a['email'],'password':a['password']})
    assert status==201,(a['role'],status)
    membership=body['memberships'][0]
    assert membership['role']==a['role']
    headers={'Authorization':'Bearer '+body['token'],'x-tenant-id':membership['tenant_id']}
    status,desk=call('/api/desk',headers=headers)
    assert status==200 and desk['actor']['role']==a['role']
    assert len(desk['projects'])==1 and not desk['tasks'] and not desk['shifts'] and not desk['reports'] and not desk['files']
    if a['role'] in readonly:
        assert call('/api/sync/events',{'events':[]},headers)[0]==403
        assert call('/api/v1/projects/'+accounts['projectId']+'/tasks',{},headers)[0]==403
    assert call('/api/v1/auth/logout',{},headers)[0]==201
    assert call('/api/desk',headers=headers)[0]==401
    results.append({'login':a['email'],'role':a['role'],'loginAndDesk':True,'writeBlocked':a['role'] in readonly,'logoutRevoked':True})
assert sql(database,'SELECT count(*) FROM sessions')=='0'
report={'database':database,'image':image,'accounts':results,'cleanCounts':{
    t:int(sql(database,f'SELECT count(*) FROM {t}')) for t in ['users','memberships','projects','employees','daily_tasks','managed_shifts','managed_execution_reports','private_evidence_files','invitations','time_approval_revisions']}}
(base/'clean-candidate-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
