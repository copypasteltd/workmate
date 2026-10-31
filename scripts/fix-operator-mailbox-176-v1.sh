#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,os,hashlib,subprocess
base=Path('/opt/workmate/nginx');cfg=Path('/root/cfg/workmate')
assert json.loads((cfg/'deployment-owner.json').read_bytes())['stage']==176
conf=base/'nginx.conf';old=conf.read_text();needle='location = /ops/mailbox/ { alias /opt/workmate/nginx/operator.html;'
assert old.count(needle)==1
folder=base/'mailbox';folder.mkdir(mode=0o755);target=folder/'index.html';target.write_bytes((base/'operator.html').read_bytes());target.chmod(0o644)
new=old.replace(needle,'location /ops/mailbox/ { alias /opt/workmate/nginx/mailbox/; index index.html;')
backup=cfg/'nginx-before-mailbox176.conf';fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(old)
conf.write_text(new)
p=subprocess.run(['/usr/sbin/nginx','-t','-p',str(base)+'/', '-c',str(conf)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if p.returncode:conf.write_text(old);raise RuntimeError('Owned proxy validation failed; previous config restored')
subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
safe={'stage':176,'status':'mailbox_route_fixed','only_reloaded':'workmate-lan-proxy.service','config_sha256':hashlib.sha256(conf.read_bytes()).hexdigest()}
with (cfg/'mailbox-fix.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
