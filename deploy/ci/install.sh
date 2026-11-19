#!/bin/bash
# Run only on the existing HELIOS host, after building the reviewed CI image.
set -euo pipefail
test "$(id -u)" = 0
test -d /opt/helios-staging/releases
docker inspect helios-staging-api-1 >/dev/null
docker image inspect helios-ci:runner-20261119 >/dev/null
if docker container inspect helios-ci-runner >/dev/null 2>&1; then
  echo 'Existing CI runner preserved; stop and review replacement explicitly.' >&2
  exit 1
fi
if ! docker network inspect helios-ci >/dev/null 2>&1; then
  docker network create --label helios.ci=true --subnet 172.30.50.0/24 \
    --opt com.docker.network.bridge.name=br-helios-ci helios-ci
fi
python3 /opt/helios-ci/host-control.py prepare
docker create --name helios-ci-runner --label helios.ci=true --init \
  --network helios-ci --dns 1.1.1.1 --dns 8.8.8.8 \
  --sysctl net.ipv6.conf.all.disable_ipv6=1 \
  --cpus 0.5 --memory 896m --memory-swap 896m --shm-size 128m \
  --pids-limit 512 --oom-score-adj 800 --cap-drop ALL \
  --security-opt no-new-privileges:true helios-ci:runner-20261119
install -m 0644 /opt/helios-ci/helios-ci-runner.service /etc/systemd/system/helios-ci-runner.service
systemctl daemon-reload
systemctl enable --now helios-ci-runner
echo 'CI container is waiting for registration. No repository variables changed.'
