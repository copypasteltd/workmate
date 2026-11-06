#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DOWNLOADS_195'
from pathlib import Path
import hashlib,json,shutil,subprocess,urllib.request,time
source=Path('/home/carzygod/workmate-downloads-195-v1');m=json.loads((source/'manifest-v2.json').read_text());assert m['stage']==195
expected={'CopyPaste-0.7.5-x64-Setup.exe','CopyPaste-0.7.5-x64-Portable.exe','CopyPaste-Extension-0.5.5.zip','SHA256SUMS.txt'};assert set(m['files'])==expected
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
dest=Path('/opt/workmate/downloads/releases/195');assert dest.is_dir() and not dest.is_symlink()
for name,r in m['files'].items():
 p=source/name;assert p.is_file() and not p.is_symlink() and p.stat().st_size==r['bytes'] and digest(p)==r['sha256']
 assert (dest/name).is_file() and (dest/name).stat().st_size==r['bytes'] and digest(dest/name)==r['sha256']
config=Path('/opt/workmate/nginx/nginx.conf');before=config.read_bytes();text=before.decode();needle='location ^~ /downloads/releases/193/ {';assert text.count(needle)==1
location='''location ^~ /downloads/releases/195/ {
      alias /opt/workmate/downloads/releases/195/;
      autoindex off;
      default_type application/octet-stream;
      add_header Content-Disposition "attachment";
      add_header Cache-Control "public, max-age=31536000, immutable";
      add_header X-Content-Type-Options "nosniff";
      limit_except GET { deny all; }
    }
    '''
text=text.replace(needle,location+needle,1)
backup=Path('/root/cfg/workmate/integrated-195/downloads-v2');backup.mkdir(mode=0o700);(backup/'nginx.conf.before').write_bytes(before)
try:
 config.write_text(text);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 checks=[]
 for name,r in m['files'].items():
  url='http://127.0.0.1:63070/downloads/releases/195/'+name
  observed=None
  for attempt in range(30):
   with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=5) as response:observed={'status':response.status,'bytes':int(response.headers.get('Content-Length',0)),'disposition':response.headers.get('Content-Disposition')}
   if observed=={'status':200,'bytes':r['bytes'],'disposition':'attachment'}:break
   time.sleep(.2)
  else:raise RuntimeError('Reload readiness mismatch: '+json.dumps(observed))
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=5) as response:assert response.status==206 and response.read()==(dest/name).read_bytes()[:16]
  checks.append({'name':name,'head':200,'range':206,'source_sha256':r['sha256']})
 result={'stage':195,'status':'published','files':m['files'],'checks':checks,'old_releases_preserved':True,'proxy_before_sha256':hashlib.sha256(before).hexdigest(),'proxy_after_sha256':digest(config)};(backup/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
except Exception:
 config.write_bytes(before);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True);raise
WM_DOWNLOADS_195
