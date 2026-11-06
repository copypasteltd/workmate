#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,os,shutil,stat,subprocess,urllib.request,zipfile
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def service(unit):return subprocess.check_output(['systemctl','show',unit,'-p','MainPID','-p','NRestarts','-p','WorkingDirectory','-p','ActiveState'],text=True)
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service'];before={u:service(u) for u in units}
assert '/opt/workmate/overlays/integrated-202-v2/backend' in before[units[0]] and all('ActiveState=active' in v for v in before.values())
baseline=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text());files={p:sha(Path(p)) for p in baseline['files']};assert files==baseline['files']
credentials={str(p):sha(p) for p in Path('/root/cfg/workmate').glob('*.env')};assert credentials
cfg=Path('/root/cfg/workmate/integrated-203');cfg.mkdir(mode=0o700,exist_ok=True);receipt=cfg/'static-deployment-v1.json';assert not receipt.exists()
live=Path('/opt/workmate/overlays/integrated-201-v1/web/dist');old=Path('/opt/workmate/overlays/integrated-202-v1/web/dist');assert live.is_symlink() and live.resolve()==old
dest=Path('/opt/workmate/overlays/integrated-203-v1/web/dist');assert not dest.exists()
archive=Path('/home/carzygod/workmate-static-203-v1/web-203-v1.zip');assert sha(archive)==archive.with_suffix('.sha256').read_text().strip()
with zipfile.ZipFile(archive) as z:
 manifest=json.loads(z.read('application-manifest-203.json'));assert manifest['stage']==203
 assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())=={'application-manifest-203.json'}|{r['path'] for r in manifest['files']}
 dest.mkdir(parents=True)
 for row in manifest['files']:
  rel=PurePosixPath(row['path']);assert not rel.is_absolute() and '..' not in rel.parts and '\\' not in row['path'] and not stat.S_ISLNK(z.getinfo(row['path']).external_attr>>16)
  data=z.read(row['path']);assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o644)
 (dest/'application-manifest-203.json').write_bytes(z.read('application-manifest-203.json'))
# Preserve hashed assets for existing open pages. Never replace new built bytes.
for sub in ['assets','fonts']:
 for p in (old/sub).rglob('*'):
  if p.is_file():
   target=dest/p.relative_to(old)
   if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target);target.chmod(0o644)
link=live.with_name('.dist-integrated-203-v1');assert not link.exists();link.symlink_to(dest,target_is_directory=True)
swapped=False
try:
 os.replace(link,live);swapped=True
 with urllib.request.urlopen('http://127.0.0.1:63070/',timeout=15) as r:assert r.status==200 and r.read()==(dest/'index.html').read_bytes()
 assert {u:service(u) for u in units}==before
 assert {p:sha(Path(p)) for p in files}==files and {p:sha(Path(p)) for p in credentials}==credentials
 for row in manifest['files']:assert sha(dest/row['path'])==row['sha256']
 report={'stage':203,'status':'deployed','component':'web','files':len(manifest['files']),'static_root':str(dest),'prior_target':str(old),'services_before':before,'services_after':{u:service(u) for u in units},'credentials_preserved':True,'credential_hashes':credentials,'network_files':files,'network_configuration_unchanged':True,'proxy_reloaded':False,'api_restarted':False,'rollback':'Atomically restore the application symlink to prior_target; no service/network change.'}
 receipt.write_text(json.dumps(report,indent=2)+'\n');receipt.chmod(0o600);print(json.dumps(report))
except:
 if swapped:
  restore=live.with_name('.dist-integrated-203-rollback');restore.symlink_to(old,target_is_directory=True);os.replace(restore,live)
 raise
finally:
 if link.is_symlink():link.unlink()
PY
