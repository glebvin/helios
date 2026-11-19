#!/bin/bash
set -euo pipefail
timeout 60 python3 /opt/helios-ci/postgres-hook.py stop
