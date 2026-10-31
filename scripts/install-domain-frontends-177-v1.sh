#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import zipfile,json,hashlib,shutil,subprocess
from datetime import datetime,timezone
cfg=Path('/root/cfg/workmate');upload=Path('/home/carzygod/workmate-upload-177/workmate-domain-frontends-177.zip')
expected=Path(str(upload)+'.sha256').read_text().split()[0]
assert hashlib.sha256(upload.read_bytes()).hexdigest()==expected
dest=Path('/opt/workmate/overlays/domains-177/frontends');assert not dest.exists();dest.mkdir()
with zipfile.ZipFile(upload) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['stage']==177
 assert set(z.namelist())==set([r['path'] for r in manifest['files']]+['manifest.json'])
 for row in manifest['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
proxy=Path('/opt/workmate/nginx/nginx.conf');old=proxy.read_text()
backup=cfg/'domains-177-backup/nginx-before-frontends.conf';assert not backup.exists();shutil.copy2(proxy,backup)
new=old
for client in ['web','admin']:
 before='/opt/workmate/overlays/lan-http-176-v2/'+client
 assert new.count('root '+before+';')==1
 new=new.replace('root '+before+';','root '+str(dest/client)+';')
try:
 proxy.write_text(new)
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
except Exception:
 proxy.write_text(old);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True);raise
safe={'stage':177,'at':datetime.now(timezone.utc).isoformat(),'frontends':str(dest),'sha256':expected,'files':len(manifest['files']),'proxy_unit_only_reloaded':True}
with (cfg/'domains-177-frontends.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
