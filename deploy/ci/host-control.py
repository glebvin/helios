"""HELIOS host controller. Never mounted into the unprivileged test container."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

CONTAINER = 'helios-ci-runner'
BRIDGE = 'br-helios-ci'
SUBNET = '172.30.50.0/24'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=60, **kwargs)


def available():
    lines = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(lines['MemAvailable'].split()[0]) * 1024


def rule(*args):
    if subprocess.run(['iptables', '-C', *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run('iptables', '-I', *args)


if sys.argv[1] == 'prepare':
    assert available() > 512 * 1024**2, 'insufficient host memory; CI stays stopped'
    assert shutil.disk_usage('/opt').free > 5 * 1024**3, 'insufficient host disk; CI stays stopped'
    network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', 'helios-ci']))[0]
    assert network['IPAM']['Config'][0]['Subnet'] == SUBNET
    assert network['Options']['com.docker.network.bridge.name'] == BRIDGE
    created = subprocess.run(['iptables', '-N', 'HELIOS_CI_EGRESS'], stderr=subprocess.DEVNULL)
    run('iptables', '-F', 'HELIOS_CI_EGRESS')
    for cidr in ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4']:
        run('iptables', '-A', 'HELIOS_CI_EGRESS', '-d', cidr, '-j', 'REJECT')
    run('iptables', '-A', 'HELIOS_CI_EGRESS', '-j', 'RETURN')
    rule('DOCKER-USER', '-i', BRIDGE, '-j', 'HELIOS_CI_EGRESS')
    rule('INPUT', '-i', BRIDGE, '-j', 'REJECT')
elif sys.argv[1] == 'run':
    child = subprocess.Popen(['docker', 'start', '-a', CONTAINER])
    try:
        while child.poll() is None:
            if available() < 160 * 1024**2 or shutil.disk_usage('/opt').free < 4 * 1024**3:
                print('Stopping HELIOS CI to protect host resources', flush=True)
                run('docker', 'stop', '--time', '20', CONTAINER)
                raise SystemExit(75)
            time.sleep(5)
        raise SystemExit(child.returncode)
    finally:
        if child.poll() is None:
            child.terminate()
else:
    raise SystemExit('expected prepare or run')
