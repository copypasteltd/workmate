#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
from hashlib import sha256
from datetime import datetime,timezone
import json,zipfile,subprocess,shutil,urllib.request

cfg=Path('/root/cfg/workmate');nginx=Path('/opt/workmate/nginx/nginx.conf')
archive=Path('/home/carzygod/workmate-upload-179/web-scroll-187-v1.zip')
assert sha256(archive.read_bytes()).hexdigest()==Path(str(archive)+'.sha256').read_text().strip()
dest=Path('/opt/workmate/overlays/web-scroll-187-v1/web/dist');assert not dest.exists()
protected=[cfg/'app.env',cfg/'migration.env',cfg/'credentials.txt',cfg/'operator-password.txt',Path('/opt/workmate/nginx/operator.htpasswd')]
before={str(p):sha256(p.read_bytes()).hexdigest() for p in protected}
def pid(unit):return subprocess.check_output(['systemctl','show','-p','MainPID','--value',unit],text=True).strip()
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service'];pids={u:pid(u) for u in units}
old=nginx.read_text();needle='root /opt/workmate/overlays/admin-directory-lifecycle-184-v1/web/dist;';assert old.count(needle)==1
backup=cfg/'web-scroll-187-v1';backup.mkdir(mode=0o700);shutil.copyfile(nginx,backup/'nginx.before.conf');(backup/'nginx.before.conf').chmod(0o600)
dest.mkdir(parents=True)
with zipfile.ZipFile(archive) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['stage']==187
 assert set(z.namelist())=={'manifest.json',*[r['path'] for r in manifest['files']]}
 for row in manifest['files']:
  name=PurePosixPath(row['path']);assert not name.is_absolute() and '..' not in name.parts
  raw=z.read(row['path']);assert sha256(raw).hexdigest()==row['sha256'];p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
try:
 nginx.write_text(old.replace(needle,'root '+str(dest)+';'))
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(nginx)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 with urllib.request.urlopen('http://127.0.0.1:63070/',timeout=10) as response:assert sha256(response.read()).hexdigest()==sha256((dest/'index.html').read_bytes()).hexdigest()
 for row in manifest['files']:
  if row['path'].endswith('.css'):
   with urllib.request.urlopen('http://127.0.0.1:63070/'+row['path'],timeout=10) as response:assert sha256(response.read()).hexdigest()==row['sha256']
 for p,h in before.items():assert sha256(Path(p).read_bytes()).hexdigest()==h
 assert all(pid(u)==pids[u] for u in units)
except BaseException:
 nginx.write_text(old);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False);raise
report={'stage':187,'status':'web_ui_deployed','at':datetime.now(timezone.utc).isoformat(),'web_root':str(dest),
 'archive_sha256':sha256(archive.read_bytes()).hexdigest(),'source_hashes':manifest['sources'],'built_file_count':len(manifest['files']),
 'configuration_and_credentials_unchanged':True,'api_database_proxy_main_pids_unchanged':True,'api_restarted':False,'only_service_reload':'workmate-lan-proxy.service',
 'nginx_change':'Only the prior Web static root replaced; administrator root, API routes and protected inbox routes retain exact prior bytes.',
 'rollback_directory':str(backup),'runtime_schema_unchanged':161,'served_index_and_styles_match':True}
with (cfg/'web-scroll-187-deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
PY
