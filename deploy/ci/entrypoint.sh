#!/bin/bash
set -euo pipefail
while [ ! -f /home/runner/.helios-configured ]; do sleep 2; done
exec /opt/actions-runner/run.sh
