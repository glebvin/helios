"""One fresh PG17 per GitHub job, inside this runner's private network only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path('/home/runner/ci-db')
DATA = ROOT / 'codex-api/.data/pg-54339'


def command(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=60, **kwargs)


def stop():
    if (DATA / 'postmaster.pid').exists():
        command('/opt/pg-bin/pg_ctl', '-D', str(DATA), '-w', '-m', 'fast', 'stop')


assert os.getuid() == 10001
assert Path('/.dockerenv').is_file()
assert Path('/opt/helios-ci/isolated-runner').is_file()
assert DATA.resolve() == DATA, 'no symlink may redirect the owned cluster'
if sys.argv[1] == 'stop':
    stop()
elif sys.argv[1] == 'start':
    assert os.environ.get('GITHUB_REPOSITORY') == 'glebvin/helios'
    event_path = os.environ.get('GITHUB_EVENT_PATH')
    if event_path:
        event = json.loads(Path(event_path).read_text())
        if event.get('pull_request'):
            assert event['pull_request']['head']['repo']['full_name'] == 'glebvin/helios', 'fork code is not accepted here'
    stop()
    if ROOT.exists():
        shutil.rmtree(ROOT)
    DATA.mkdir(parents=True, mode=0o700)
    password = ROOT / 'password'
    password.write_text('helios\n')  # Public disposable fixture, never a staging credential.
    password.chmod(0o600)
    try:
        command('/opt/pg-bin/initdb', '-D', str(DATA), '--username=helios', f'--pwfile={password}', '--auth=scram-sha-256', '--locale=C', '--encoding=UTF8', stdout=subprocess.DEVNULL)
    finally:
        password.unlink(missing_ok=True)
    command('/opt/pg-bin/pg_ctl', '-D', str(DATA), '-l', str(ROOT / 'postgres.log'), '-w', '-o', '-c listen_addresses=127.0.0.1 -c port=54339 -c shared_buffers=16MB -c max_connections=100', 'start')
    command('/opt/pg-bin/createdb', '-h', '127.0.0.1', '-p', '54339', '-U', 'helios', 'helios', env={**os.environ, 'PGPASSWORD': 'helios'})
    print('Fresh isolated PG17 ready; no host ports, staging storage or Docker socket')
else:
    raise SystemExit('expected start or stop')
