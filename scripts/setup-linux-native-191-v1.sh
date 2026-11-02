#!/usr/bin/env bash
set -euo pipefail
test "$(uname -m)" = x86_64
test -d /sys/fs/cgroup
test -f /sys/fs/cgroup/cgroup.controllers
install -d -m 0700 /root/cfg/workmate/native-191
if ! command -v bwrap >/dev/null; then
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update -qq
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-upgrade --no-install-recommends bubblewrap
fi
runuser -u workmate -- unshare -Ur true
install -d -m 0755 /opt/workmate/toolchains/cloud-native-191
mkdir /sys/fs/cgroup/workmate-native-191 2>/dev/null || test -d /sys/fs/cgroup/workmate-native-191
printf '+cpu +memory +pids\n' > /sys/fs/cgroup/workmate-native-191/cgroup.subtree_control
chown workmate:workmate /sys/fs/cgroup/workmate-native-191
chown workmate:workmate /sys/fs/cgroup/workmate-native-191/cgroup.procs /sys/fs/cgroup/workmate-native-191/cgroup.threads /sys/fs/cgroup/workmate-native-191/cgroup.subtree_control
PLAYWRIGHT_BROWSERS_PATH=/opt/workmate/toolchains/cloud-native-191/browser /opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node /opt/workmate/overlays/real-services-189-v5/backend/node_modules/playwright-core/cli.js install chromium --no-shell
python3 - <<'WM_NATIVE_SETUP_191'
from pathlib import Path
import json,hashlib,subprocess
root=Path('/opt/workmate/toolchains/cloud-native-191/browser')
binaries=list(root.glob('chromium-*/chrome-linux*/chrome'))
assert len(binaries)==1
binary=binaries[0]
ldd=subprocess.run(['ldd',str(binary)],capture_output=True,text=True,check=True)
missing=[line.split()[0] for line in ldd.stdout.splitlines() if 'not found' in line]
print(json.dumps({'stage':191,'browser':str(binary),'browser_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'missing_libraries':missing,'bubblewrap':subprocess.check_output(['/usr/bin/bwrap','--version'],text=True).strip(),'cgroup_root':'/sys/fs/cgroup/workmate-native-191'}),flush=True)
with Path('/root/cfg/workmate/native-191/setup.sanitized.json').open('x') as f:json.dump({'browser':str(binary),'missing_libraries':missing},f)
assert not missing,'Install only the missing native browser libraries before qualification'
WM_NATIVE_SETUP_191
