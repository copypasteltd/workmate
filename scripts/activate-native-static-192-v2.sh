#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STATIC_192'
from pathlib import Path
import hashlib,json,subprocess,urllib.request,time
proxy=Path('/opt/workmate/nginx/nginx.conf');original=proxy.read_bytes()
assert hashlib.sha256(original).hexdigest()=='cf6983d5b98a9afaebe36ce86377e208db7cf8d986a93adb9d2ae0495417fc88'
state=Path('/root/cfg/workmate/native-192/static-v2');state.mkdir(mode=0o700)
backup=state/'nginx.before.conf';backup.write_bytes(original);backup.chmod(0o600)
dest=Path('/opt/workmate/overlays/native-recheck-192-v1');updated=original.decode()
for name,previous in [('web','/opt/workmate/overlays/web-scroll-187-v1/web/dist'),('admin','/opt/workmate/overlays/admin-termination-189-v1/admin/dist')]:
 before='root '+previous+';';assert updated.count(before)==1
 assert (dest/name/'dist/index.html').is_file()
 updated=updated.replace(before,'root '+str(dest/name/'dist')+';')
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','ActiveState'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
try:
 proxy.write_text(updated)
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 for name,port in [('web',63070),('admin',63071)]:
  expected=(dest/name/'dist/index.html').read_bytes()
  for attempt in range(40):
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/?recheck192='+str(attempt),timeout=10) as r:raw=r.read()
   if raw==expected:break
   time.sleep(.25)
  else:raise RuntimeError('New static bundle did not become active: '+name)
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','ActiveState'],text=True)==v
 report={'stage':192,'status':'deployed','web_root':str(dest/'web/dist'),'admin_root':str(dest/'admin/dist'),'nginx_sha256':hashlib.sha256(updated.encode()).hexdigest(),'all_service_main_pids_unchanged':True,'backup':str(backup)}
 with (state/'deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
except Exception:
 proxy.write_bytes(original);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False)
 raise
WM_STATIC_192
