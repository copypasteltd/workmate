#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
from hashlib import sha256
from datetime import datetime,timezone
import json,zipfile,shutil,urllib.request
cfg=Path('/root/cfg/workmate');upload=Path('/home/carzygod/workmate-upload-178/workmate-model-configuration-178.zip')
h=Path(str(upload)+'.sha256').read_text().split()[0];assert sha256(upload.read_bytes()).hexdigest()==h
dest=Path('/opt/workmate/sources/model-connections-178');assert not dest.exists();dest.mkdir()
private_before={name:sha256((cfg/name).read_bytes()).hexdigest() for name in ['app.env','credentials.txt']}
with zipfile.ZipFile(upload) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==178 and not m['credentials_included']
 assert set(z.namelist())==set([r['path'] for r in m['files']]+['manifest.json','HANDOFF.md'])
 for row in m['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and sha256(raw).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 for name in ['manifest.json','HANDOFF.md']:(dest/name).write_bytes(z.read(name))
for p in [upload,Path(str(upload)+'.sha256')]:
 target=Path('/opt/workmate/downloads')/p.name;assert not target.exists();shutil.copyfile(p,target);target.chmod(0o644)
guide=cfg/'DEPLOYMENT-README.md';backup=cfg/'model-connections-178-backup/DEPLOYMENT-README-before-handoff.md';assert not backup.exists();shutil.copy2(guide,backup)
old=guide.read_text();append=(dest/'docs/releases/model-connections-178.md').read_text()
assert '# 每个模型独立配置 API / Per-model API configuration' not in old
guide.write_text(append+'\n\n---\n\n## Previous deployment records / 历史部署记录\n\n'+old);guide.chmod(0o600)
for name,h0 in private_before.items():assert sha256((cfg/name).read_bytes()).hexdigest()==h0
checks=[]
for name in [upload.name,upload.name+'.sha256']:
 u='https://agent.copypaste.hk/downloads/'+name
 with urllib.request.urlopen(urllib.request.Request(u,method='HEAD',headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as r:
  assert r.status==200;checks.append({'file':name,'status':r.status,'bytes':int(r.headers['Content-Length'])})
safe={'stage':178,'status':'handoff_installed','at':datetime.now(timezone.utc).isoformat(),'artifact':upload.name,'sha256':h,'source_directory':str(dest),'download':'https://agent.copypaste.hk/downloads/'+upload.name,'checks':checks,'private_credentials_preserved':True}
with (cfg/'model-connections-178-handoff.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
