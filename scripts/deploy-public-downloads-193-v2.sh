#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DOWNLOADS_DEPLOY_193'
from pathlib import Path
import hashlib,json,os,shutil,stat,subprocess,time,urllib.request,zipfile
upload=Path('/home/carzygod/workmate-upload-193')
manifest=json.loads((upload/'upload-manifest.json').read_bytes())
expected={'CopyPaste-0.7.4-x64-Setup.exe','CopyPaste-0.7.4-x64-Portable.exe','CopyPaste-Extension-0.5.4.zip','SHA256SUMS.txt','web-downloads-193-v2.zip'}
assert set(manifest['files'])==expected
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
for n,r in manifest['files'].items():
 p=upload/n;assert p.is_file() and not p.is_symlink() and p.stat().st_size==r['bytes'] and digest(p)==r['sha256'],n
config=Path('/opt/workmate/nginx/nginx.conf');original=config.read_bytes()
assert hashlib.sha256(original).hexdigest()=='f7f1f8333733b86b1028a3fa7185c93e108097c48a71bdc0893dc144f4b6ba1d','Proxy changed since reviewed baseline'
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']
def service_state():
 return {u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True).splitlines() for u in units}
before=service_state()
secrets={n:digest(Path('/root/cfg/workmate')/n) for n in ['app.env','migration.env']}
snapshot=Path('/root/cfg/workmate/downloads-193-v2');snapshot.mkdir(mode=0o700)
(snapshot/'nginx.conf.before').write_bytes(original);os.chmod(snapshot/'nginx.conf.before',0o600)
overlay=Path('/opt/workmate/overlays/product-downloads-193-v2');overlay.mkdir()
dist=overlay/'web/dist';dist.mkdir(parents=True)
with zipfile.ZipFile(upload/'web-downloads-193-v2.zip') as z:
 for i in z.infolist():
  p=Path(i.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\' not in i.filename
  assert not stat.S_ISLNK(i.external_attr>>16)
 z.extractall(dist)
assert (dist/'index.html').is_file()
destination=Path('/opt/workmate/downloads/releases/193');destination.mkdir(parents=True)
for name in expected-{'web-downloads-193-v2.zip'}:
 target=destination/name
 assert not target.exists()
 shutil.copyfile(upload/name,target);os.chmod(target,0o644)
 assert digest(target)==manifest['files'][name]['sha256']
for p in overlay.rglob('*'):os.chmod(p,0o755 if p.is_dir() else 0o644)
os.chmod(overlay,0o755)
oldroot='root /opt/workmate/overlays/native-recheck-192-v1/web/dist;'
newroot='root '+str(dist)+';'
text=original.decode();assert text.count(oldroot)==1;text=text.replace(oldroot,newroot,1)
needle='location /downloads/ { alias /opt/workmate/downloads/; autoindex off; }'
assert text.count(needle)==1
locations='''location = /downloads { try_files /index.html =404; add_header Cache-Control "no-cache"; }
    location = /downloads/ { return 301 /downloads; }
    location ^~ /downloads/releases/193/ {
      alias /opt/workmate/downloads/releases/193/;
      autoindex off;
      default_type application/octet-stream;
      add_header Content-Disposition "attachment";
      add_header Cache-Control "public, max-age=31536000, immutable";
      add_header X-Content-Type-Options "nosniff";
      limit_except GET { deny all; }
    }
    '''+needle
text=text.replace(needle,locations,1)
changed=False
try:
 config.write_text(text);changed=True
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True,capture_output=True)
 wanted=(dist/'index.html').read_bytes()
 for attempt in range(40):
  with urllib.request.urlopen('http://127.0.0.1:63070/downloads',timeout=5) as r:actual=r.read()
  if actual==wanted:break
  time.sleep(.25)
 else:raise AssertionError('New static entry did not become visible')
 checks=[]
 for name in sorted(expected-{'web-downloads-193-v2.zip'}):
  url='http://127.0.0.1:63070/downloads/releases/193/'+name
  with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=5) as r:
   assert r.status==200 and int(r.headers['Content-Length'])==manifest['files'][name]['bytes']
   assert r.headers['Content-Disposition']=='attachment'
   checks.append({'name':name,'head_status':r.status,'bytes':int(r.headers['Content-Length'])})
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-15'}),timeout=5) as r:
   chunk=r.read();assert r.status==206 and chunk==(destination/name).read_bytes()[:16]
   checks[-1]['range_status']=r.status
 after=service_state();assert after==before,'Existing service identity/restart state changed'
 assert all(digest(Path('/root/cfg/workmate')/n)==h for n,h in secrets.items())
 for port in [63071,63072]:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=10) as r:assert r.status==200
 result={'stage':193,'status':'deployed_and_locally_verified','web_root':str(dist),'public_directory':str(destination),'files':manifest['files'],'checks':checks,'services_before':before,'services_after':after,'existing_env_unchanged':True,'proxy_before_sha256':hashlib.sha256(original).hexdigest(),'proxy_after_sha256':digest(config)}
 (snapshot/'deployment-receipt.json').write_text(json.dumps(result,indent=2)+'\n');os.chmod(snapshot/'deployment-receipt.json',0o600)
 print(json.dumps(result),flush=True)
except Exception:
 if changed:
  config.write_bytes(original)
  subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(config)],check=True,capture_output=True)
  subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True,capture_output=True)
 raise
WM_DOWNLOADS_DEPLOY_193
