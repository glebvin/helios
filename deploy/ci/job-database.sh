#!/bin/bash
set -euo pipefail
timeout 90 python3 /opt/helios-ci/postgres-hook.py start
