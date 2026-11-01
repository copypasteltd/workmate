#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,zipfile,subprocess,shutil
upload=Path('/home/carzygod/workmate-upload-179/admin-directory-ui-184-v2.zip')
assert hashlib.sha256(upload.read_bytes()).hexdigest()==Path(str(upload)+'.sha256').read_text().strip()
dest=Path('/opt/workmate/overlays/admin-directory-ui-184-v2/admin/dist');assert not dest.exists();dest.mkdir(parents=True)
with zipfile.ZipFile(upload) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==184
 assert set(z.namelist())=={'manifest.json',*[x['path'] for x in m['files']]}
 for row in m['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts
  raw=z.read(row['path']);assert hashlib.sha256(raw).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
proxy=Path('/opt/workmate/nginx/nginx.conf');old=proxy.read_text();previous='root /opt/workmate/overlays/admin-directory-lifecycle-184-v1/admin/dist;';assert old.count(previous)==1
backup=Path('/root/cfg/workmate/admin-directory-ui-184-v2-nginx.conf');assert not backup.exists();shutil.copy2(proxy,backup)
proxy.write_text(old.replace(previous,'root '+str(dest)+';'))
try:
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
except Exception:
 proxy.write_text(old);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False);raise
print(json.dumps({'stage':184,'status':'admin_ui_updated','api_restarted':False,'admin_root':str(dest)}))
PY
