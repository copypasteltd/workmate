#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DOWNLOADS_200'
from pathlib import Path
import hashlib,json,shutil,subprocess,time,urllib.request
source=Path('/home/carzygod/workmate-downloads-200-v2');manifest=json.loads((source/'manifest.json').read_text());assert manifest['stage']==200
expected={'CopyPaste-0.7.13-x64-Setup.exe','CopyPaste-0.7.13-x64-Portable.exe','CopyPaste-Extension-0.5.7.zip','SHA256SUMS.txt'};assert set(manifest['files'])==expected
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
for name,row in manifest['files'].items():
 path=source/name;assert path.is_file() and not path.is_symlink() and path.stat().st_size==row['bytes'] and digest(path)==row['sha256']
dest=Path('/opt/workmate/downloads/releases/20002');assert not dest.exists();dest.mkdir(mode=0o755)
for name,row in manifest['files'].items():
 path=dest/name;shutil.copyfile(source/name,path);path.chmod(0o644);assert path.stat().st_size==row['bytes'] and digest(path)==row['sha256']
config=Path('/opt/workmate/nginx/nginx.conf');before=config.read_bytes();text=before.decode();needle='location ^~ /downloads/releases/200/ {';assert text.count(needle)==1
location='''location ^~ /downloads/releases/20002/ {
      alias /opt/workmate/downloads/releases/20002/;
      autoindex off;
      default_type application/octet-stream;
      add_header Content-Disposition "attachment";
      add_header Cache-Control "public, max-age=31536000, immutable";
      add_header X-Content-Type-Options "nosniff";
      limit_except GET { deny all; }
    }
    '''
backup=Path('/root/cfg/workmate/integrated-200/downloads-v2');backup.parent.mkdir(mode=0o700,exist_ok=True);backup.mkdir(mode=0o700);(backup/'nginx.conf.before').write_bytes(before)
try:
 config.write_text(text.replace(needle,location+needle,1));subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 checks=[]
 for name,row in manifest['files'].items():
  url='http://127.0.0.1:63070/downloads/releases/20002/'+name
  for attempt in range(40):
   with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=5) as response:observed={'status':response.status,'bytes':int(response.headers.get('Content-Length',0)),'disposition':response.headers.get('Content-Disposition')}
   if observed=={'status':200,'bytes':row['bytes'],'disposition':'attachment'}:break
   time.sleep(.2)
  else:raise RuntimeError('Download reload did not serve the verified release')
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=5) as response:
   assert response.status==206
   with (dest/name).open('rb') as f:assert response.read()==f.read(16)
  checks.append({'name':name,'head':200,'range':206,'source_sha256':row['sha256']})
 report={'stage':200,'status':'published','files':manifest['files'],'checks':checks,'old_releases_preserved':True,'proxy_before_sha256':hashlib.sha256(before).hexdigest(),'proxy_after_sha256':digest(config)};(backup/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 config.write_bytes(before);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True);raise
WM_DOWNLOADS_200
