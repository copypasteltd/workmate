#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,hashlib,zipfile,subprocess,os
base=Path('/opt/workmate');cfg=Path('/root/cfg/workmate')
identity=json.loads((cfg/'deployment-owner.json').read_bytes());assert identity['product']=='Workmate' and identity['stage']==176
uploaded=Path('/home/carzygod/workmate-upload-176/workmate-lan-http-176-v2.zip')
expected=Path(str(uploaded)+'.sha256').read_text().split()[0]
assert len(expected)==64 and hashlib.sha256(uploaded.read_bytes()).hexdigest()==expected
target=base/'overlays/lan-http-176-v2';assert not target.exists();target.mkdir(parents=True)
with zipfile.ZipFile(uploaded) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['increment']=='lan-http-176-v2'
 assert set(z.namelist())=={'manifest.json',*(r['path'] for r in manifest['files'])}
 for row in manifest['files']:
  p=target/row['path'];assert p.resolve().is_relative_to(target.resolve())
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
conf=base/'nginx/nginx.conf';old=conf.read_text()
for client in ['web','admin']:assert old.count('/opt/workmate/overlays/lan-http-176-v1/'+client+';')==1
assert old.count('location = /health { proxy_pass http://127.0.0.1:63073/health/ready; }')==2
new=old.replace('/opt/workmate/overlays/lan-http-176-v1/web;',str(target/'web')+';').replace('/opt/workmate/overlays/lan-http-176-v1/admin;',str(target/'admin')+';')
new=new.replace('location = /health { proxy_pass http://127.0.0.1:63073; }','location = /health { proxy_pass http://127.0.0.1:63073/health/ready; }\nlocation /health/ { proxy_pass http://127.0.0.1:63073; }')
backup=cfg/'nginx-before-lan176-v2.conf';fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(old)
conf.write_text(new)
check=subprocess.run(['/usr/sbin/nginx','-t','-p',str(base/'nginx')+'/', '-c',str(conf)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if check.returncode:
 conf.write_text(old);raise RuntimeError('Owned proxy validation failed; previous config restored')
subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
for p in [uploaded,Path(str(uploaded)+'.sha256')]:
 dest=base/'downloads'/p.name;assert not dest.exists();dest.write_bytes(p.read_bytes());dest.chmod(0o644)
safe={'stage':176,'increment':'lan-http-176-v2','base_release':'v0.1.3','sha256':expected,'web_root':str(target/'web'),'admin_root':str(target/'admin'),'reloaded_only':'workmate-lan-proxy.service'}
with (cfg/'http-overlay-v2.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps({'phase':'http_overlay_installed',**safe}))
PY
