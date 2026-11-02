#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_CONFIG_191'
from pathlib import Path
import subprocess
browser=Path('/opt/workmate/toolchains/cloud-native-191/browser/chromium-1248/chrome-linux64')
for f in browser.rglob('*'):
 assert not f.is_symlink()
 f.chmod(f.stat().st_mode | (0o555 if f.is_dir() else 0o444))
script=Path('/opt/workmate/toolchains/cloud-native-191/prepare-cgroup.sh')
assert not script.exists()
script.write_text('''#!/bin/sh
set -eu
mkdir /sys/fs/cgroup/workmate-native-191 2>/dev/null || test -d /sys/fs/cgroup/workmate-native-191
printf '+cpu +memory +pids\\n' > /sys/fs/cgroup/workmate-native-191/cgroup.subtree_control
chown workmate:workmate /sys/fs/cgroup/workmate-native-191 /sys/fs/cgroup/workmate-native-191/cgroup.procs /sys/fs/cgroup/workmate-native-191/cgroup.threads /sys/fs/cgroup/workmate-native-191/cgroup.subtree_control
''');script.chmod(0o755)
unit=Path('/etc/systemd/system/workmate-native-boundary.service');assert not unit.exists()
unit.write_text('[Unit]\nDescription=Workmate native execution cgroup delegation\nAfter=local-fs.target\nBefore=workmate-api.service\n[Service]\nType=oneshot\nExecStart='+str(script)+'\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','workmate-native-boundary.service'],check=True)
print('NATIVE_CGROUP_PERSISTENCE_AND_PUBLIC_RUNTIME_PERMISSIONS_CONFIGURED')
WM_CONFIG_191
