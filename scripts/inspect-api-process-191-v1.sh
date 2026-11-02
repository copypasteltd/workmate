#!/usr/bin/env bash
set -euo pipefail
systemctl show workmate-api.service -p ActiveState -p SubState -p Result -p MainPID -p NRestarts
journalctl -u workmate-api.service --since '2026-11-02 19:41:00 UTC' -o cat --no-pager | tail -n 18
