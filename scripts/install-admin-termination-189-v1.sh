#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_ADMIN_TERMINATION_189'
from pathlib import Path,PurePosixPath
import hashlib,json,zipfile,subprocess,shutil,urllib.request
archive=Path('/home/carzygod/workmate-upload-189/workmate-admin-termination-189-v1.zip')
digest=Path(str(archive)+'.sha256').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
dest=Path('/opt/workmate/overlays/admin-termination-189-v1/admin/dist');assert not dest.exists();dest.mkdir(parents=True)
with zipfile.ZipFile(archive) as source:
 manifest=json.loads(source.read('manifest.json'));assert manifest['stage']==189
 assert set(source.namelist())=={'manifest.json',*[row['path'] for row in manifest['files']]}
 for row in manifest['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts
  raw=source.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o644)
proxy=Path('/opt/workmate/nginx/nginx.conf');old=proxy.read_text();before='root /opt/workmate/overlays/admin-directory-ui-184-v2/admin/dist;';assert old.count(before)==1
backup=Path('/root/cfg/workmate/live-189-v2/admin-nginx-before.conf');assert not backup.exists();shutil.copy2(proxy,backup);backup.chmod(0o600)
proxy.write_text(old.replace(before,'root '+str(dest)+';'))
try:
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 for port in [63070,63071,63072]:
  with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=5) as response:assert response.status==200
except Exception:
 proxy.write_text(old);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False);raise
report={'stage':189,'status':'deployed','archive_sha256':digest,'admin_root':str(dest),'source_nginx_backup':str(backup),'unrelated_proxy_configuration_unchanged':True}
with (backup.parent/'admin-deployment.sanitized.json').open('x') as output:json.dump(report,output,indent=2)
print(json.dumps(report))
WM_ADMIN_TERMINATION_189
