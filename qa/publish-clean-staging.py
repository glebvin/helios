"""Switch only HELIOS to the verified candidate, preserving the prior database as a closed archive."""
import json,os,subprocess,time,urllib.request
from pathlib import Path
base=Path('/opt/helios-staging')
release=base/'releases/1658687e1422'
archive='helios_archive_before_roles_20261111'
candidate='helios_clean_20261111'
backup=json.loads((base/'before-clean-roles-backup.json').read_text())
qa=json.loads((base/'clean-candidate-qa.json').read_text())
assert backup['databaseRestoreVerified'] and backup['evidenceRestoreShaVerified']
assert len(qa['accounts'])==13 and qa['cleanCounts']['users']==13
assert str((base/'current').resolve())==backup['previousRelease']
accounts=json.loads((base/'clean-accounts-20261111.json').read_text())
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def sql(statement):return subprocess.check_output(['docker','exec','helios-staging-db-1','psql','-U','helios_owner','-d','postgres','-At','-c',statement],text=True).strip()
assert not sql(f"SELECT 1 FROM pg_database WHERE datname='{archive}'")
run(['docker','stop','-t','10','helios-clean-qa-api','helios-staging-api-1','helios-staging-worker-1'],stdout=subprocess.DEVNULL)
oldenv=(base/'.env').read_text()
oldcredentials=(base/'credentials.json').read_bytes()
renamed=False
try:
    sql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('helios','{candidate}') AND pid<>pg_backend_pid()")
    sql(f'ALTER DATABASE helios RENAME TO {archive}')
    sql(f'ALTER DATABASE {candidate} RENAME TO helios')
    renamed=True
    sql(f'ALTER DATABASE {archive} ALLOW_CONNECTIONS false')
    values=dict(line.split('=',1) for line in oldenv.splitlines() if line and not line.startswith('#') and '=' in line)
    values.update(RELEASE_ID='1658687e1422',EVIDENCE_VOLUME='helios-staging_clean_evidence_20261111')
    (base/'.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()));os.chmod(base/'.env',0o600)
    rows=sorted(accounts['accounts'],key=lambda a: {'director':0,'master':1,'worker':2}.get(a['role'],3))
    (base/'credentials.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));os.chmod(base/'credentials.json',0o600)
    temp=base/'current.next';temp.symlink_to(release);os.replace(temp,base/'current')
    compose=['docker','compose','--project-name','helios-staging','--env-file',str(base/'.env'),'-f',str(release/'compose.yaml')]
    run(compose+['config','--quiet'])
    run(compose+['up','-d','--no-deps','api','worker','gateway'])
    for attempt in range(30):
        try:
            with urllib.request.urlopen('https://helios-test.evegunina.ru/api/health',timeout=2) as r:
                if r.status==200:break
        except Exception:time.sleep(1)
    else:raise RuntimeError('Published HELIOS health failed')
    with urllib.request.urlopen('https://app.evegunina.ru/api/health',timeout=8) as r:assert r.status==200
except Exception:
    run(['docker','stop','-t','5','helios-staging-api-1','helios-staging-worker-1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if renamed:
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='helios' AND pid<>pg_backend_pid()")
        sql(f'ALTER DATABASE helios RENAME TO {candidate}')
        sql(f'ALTER DATABASE {archive} ALLOW_CONNECTIONS true')
        sql(f'ALTER DATABASE {archive} RENAME TO helios')
    (base/'.env').write_text(oldenv);os.chmod(base/'.env',0o600)
    (base/'credentials.json').write_bytes(oldcredentials);os.chmod(base/'credentials.json',0o600)
    temp=base/'current.rollback';temp.symlink_to(backup['previousRelease']);os.replace(temp,base/'current')
    run(['docker','compose','--project-name','helios-staging','--env-file',str(base/'.env'),'-f',str(base/'current/compose.yaml'),'up','-d','--no-deps','api','worker','gateway'])
    raise
print(json.dumps({'release':str(release),'activeDatabase':'helios','closedArchive':archive,'backup':backup['backup'],'users':13,'otherSiteHealthy':True}))
