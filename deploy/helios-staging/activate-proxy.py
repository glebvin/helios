#!/usr/bin/env python3
"""Run on the named VPS after private smoke passes; preserve old app and rollback on failure."""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import json
import shutil

root=Path('/opt/progress-interface')
staging=Path('/opt/helios-staging')
assert json.loads((staging/'qa/smoke.json').read_text())['passed'] is True
compose=root/'compose.yaml'
caddy=root/'Caddyfile'
before_compose=compose.read_text()
before_caddy=caddy.read_text()
assert 'helios-test.evegunina.ru' not in before_caddy, 'Already configured: inspect before reapplying'
assert '\nnetworks:' not in before_compose, 'Existing custom networks require a reviewed merge'
assert before_compose.count('  caddy:\n')==1
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=staging/'backups'/('proxy-before-'+stamp)
backup.mkdir(mode=0o700)
shutil.copy2(compose,backup/'compose.yaml')
shutil.copy2(caddy,backup/'Caddyfile')
new_compose=before_compose.replace('  caddy:\n','  caddy:\n    networks: [default, helios_edge]\n')+'\nnetworks:\n  helios_edge:\n    external: true\n    name: helios-staging-edge\n'
candidate=root/'compose.helios-candidate.yaml'
candidate.write_text(new_compose)
def config(path):
    return json.loads(subprocess.check_output(['docker','compose','--env-file',str(root/'backend.env'),'-f',str(path),'config','--format','json'],cwd=root))
before=config(compose)
after=config(candidate)
after['services']['caddy']['networks'].pop('helios_edge')
after['networks'].pop('helios_edge')
assert after==before,'Unexpected change outside the proxy edge network'
site='''
helios-test.evegunina.ru {
    encode zstd gzip
    header Strict-Transport-Security "max-age=2592000"
    header X-Robots-Tag "noindex, nofollow, noarchive"
    reverse_proxy helios-staging-gateway:8080
}
'''
candidate_caddy=staging/'Caddyfile.candidate'
candidate_caddy.write_text(before_caddy+'\n'+site)
subprocess.run(['docker','cp',str(candidate_caddy),'progress-interface-caddy-1:/tmp/helios-candidate.Caddyfile'],check=True)
subprocess.run(['docker','exec','progress-interface-caddy-1','caddy','validate','--config','/tmp/helios-candidate.Caddyfile','--adapter','caddyfile'],check=True)
networks=json.loads(subprocess.check_output(['docker','inspect','progress-interface-caddy-1','--format','{{json .NetworkSettings.Networks}}']))
if 'helios-staging-edge' not in networks:
    subprocess.run(['docker','network','connect','helios-staging-edge','progress-interface-caddy-1'],check=True)
try:
    compose.write_text(new_compose)
    # Preserve the inode of the individual file bind mount.
    caddy.write_text(candidate_caddy.read_text())
    subprocess.run(['docker','exec','progress-interface-caddy-1','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],check=True)
    subprocess.run(['curl','--fail','--silent','--show-error','--max-time','15','--output','/dev/null','https://app.evegunina.ru/api/health'],check=True)
except BaseException:
    compose.write_text(before_compose)
    caddy.write_text(before_caddy)
    subprocess.run(['docker','exec','progress-interface-caddy-1','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],check=False)
    raise
finally:
    candidate.unlink(missing_ok=True)
print('New hostname configured; old application health checked; persistent edge network saved')
print('Proxy configuration backup:',backup)
