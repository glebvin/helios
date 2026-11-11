"""Consistent scoped backup of the old staging DB and evidence; verify restoration."""
import datetime,json,os,shutil,subprocess
from pathlib import Path
base=Path('/opt/helios-staging')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=base/'backups'/('before-clean-roles-'+stamp)
backup.mkdir(mode=0o700,parents=True)
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def sql(db,statement):return subprocess.check_output(['docker','exec','helios-staging-db-1','psql','-U','helios_owner','-d',db,'-At','-c',statement],text=True).strip()
tables=['users','memberships','projects','employees','daily_tasks','managed_shifts','managed_execution_reports','private_evidence_files','invitations','time_approval_revisions']
services=['helios-staging-api-1','helios-staging-worker-1']
previous=str((base/'current').resolve())
run(['docker','stop','-t','10',*services],stdout=subprocess.DEVNULL)
try:
    counts={t:int(sql('helios',f'SELECT count(*) FROM {t}')) for t in tables}
    with (backup/'helios.dump').open('wb') as f:
        run(['docker','exec','helios-staging-db-1','pg_dump','-U','helios_owner','-Fc','helios'],stdout=f)
    run(['docker','run','--rm','--user','0','--network','none','-v','helios-staging_evidence:/evidence:ro','-v',str(backup)+':/backup','helios-staging:5e23a34bdb70','sh','-c','tar -czf /backup/evidence.tgz -C /evidence .'])
    for file in ['.env','credentials.json']:
        shutil.copy2(base/file,backup/file)
        os.chmod(backup/file,0o600)
finally:
    run(['docker','start',*services],stdout=subprocess.DEVNULL)
restore='helios_restorecheck_roles_20261111'
if sql('postgres',f"SELECT 1 FROM pg_database WHERE datname='{restore}'"):raise RuntimeError('Restore check database already exists')
run(['docker','exec','helios-staging-db-1','createdb','-U','helios_owner','-O','helios_owner',restore])
with (backup/'helios.dump').open('rb') as f:
    run(['docker','exec','-i','helios-staging-db-1','pg_restore','-U','helios_owner','--no-owner','-d',restore],stdin=f)
restored={t:int(sql(restore,f'SELECT count(*) FROM {t}')) for t in tables}
assert restored==counts,(counts,restored)
run(['docker','run','--rm','--user','0','--network','none','-v','helios-staging_evidence:/evidence:ro','-v',str(backup)+':/backup','helios-staging:5e23a34bdb70','sh','-c',r'mkdir /tmp/restored && tar -xzf /backup/evidence.tgz -C /tmp/restored && cd /evidence && find . -type f -exec sha256sum {} \; | sort > /tmp/source.sha && cd /tmp/restored && find . -type f -exec sha256sum {} \; | sort > /tmp/restored.sha && diff /tmp/source.sha /tmp/restored.sha'])
run(['docker','exec','helios-staging-db-1','dropdb','-U','helios_owner',restore])
report={'backup':str(backup),'previousRelease':previous,'counts':counts,'databaseRestoreVerified':True,'evidenceRestoreShaVerified':True}
(backup/'verification.json').write_text(json.dumps(report,indent=2))
(base/'before-clean-roles-backup.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
