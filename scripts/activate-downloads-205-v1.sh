#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DOWNLOADS_200'
from pathlib import Path
import hashlib,json,shutil,subprocess,time,urllib.request
source=Path('/home/carzygod/workmate-downloads-205-v1');manifest=json.loads((source/'manifest.json').read_text());assert manifest['stage']==205
expected={'CopyPaste-0.7.18-x64-Setup.exe','CopyPaste-0.7.18-x64-Portable.exe','CopyPaste-Extension-0.5.7.zip','SHA256SUMS.txt'};assert set(manifest['files'])==expected
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
for name,row in manifest['files'].items():
 path=source/name;assert path.is_file() and not path.is_symlink() and path.stat().st_size==row['bytes'] and digest(path)==row['sha256']
dest=Path('/opt/workmate/downloads/releases/20501');assert not dest.exists();dest.mkdir(mode=0o755)
for name,row in manifest['files'].items():
 path=dest/name;shutil.copyfile(source/name,path);path.chmod(0o644);assert path.stat().st_size==row['bytes'] and digest(path)==row['sha256']
# Existing generic /downloads/ alias already serves this new immutable folder.
# Do not add/reload a location, alter cache policy or change any network setting.
config=Path('/opt/workmate/nginx/nginx.conf');before=config.read_bytes()
assert 'location /downloads/ { alias /opt/workmate/downloads/;' in before.decode()
baseline=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text());assert digest(config)==baseline['files'][str(config)]
state=Path('/root/cfg/workmate/integrated-205/downloads-v1');state.parent.mkdir(mode=0o700,exist_ok=True);state.mkdir(mode=0o700)
checks=[]
for name,row in manifest['files'].items():
 url='http://127.0.0.1:63070/downloads/releases/20501/'+name
 with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=5) as response:
  assert response.status==200 and int(response.headers['Content-Length'])==row['bytes']
  observed={'status':response.status,'bytes':int(response.headers['Content-Length']),'content_type':response.headers.get('Content-Type'),'disposition':response.headers.get('Content-Disposition')}
 with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=5) as response:
  assert response.status==206
  with (dest/name).open('rb') as f:assert response.read()==f.read(16)
 checks.append({'name':name,'head':observed,'range':206,'source_sha256':row['sha256']})
assert config.read_bytes()==before
report={'stage':205,'status':'published','files':manifest['files'],'checks':checks,'old_releases_preserved':True,'proxy_before_sha256':hashlib.sha256(before).hexdigest(),'proxy_after_sha256':digest(config),'network_configuration_unchanged':True,'delivery':'Existing generic download alias; no new location, proxy reload or network-policy change.'}
(state/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
WM_DOWNLOADS_200
