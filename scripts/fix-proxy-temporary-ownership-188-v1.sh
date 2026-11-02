#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,os,pwd,subprocess,urllib.request
cfg=Path('/opt/workmate/nginx/nginx.conf');raw=cfg.read_bytes()
backup=Path('/root/cfg/workmate/proxy-temporary-188-v1');backup.mkdir(mode=0o700)
(backup/'nginx.conf.before').write_bytes(raw)
assert not raw.startswith(b'user ')
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
account=pwd.getpwnam('workmate');directories=[]
for name in ['body','proxy','fastcgi','uwsgi','scgi']:
 p=Path('/var/lib/workmate/run/nginx-'+name)
 assert p.is_dir() and not p.is_symlink() and p.resolve().parent==Path('/var/lib/workmate/run')
 st=p.stat();directories.append({'path':str(p),'before_uid':st.st_uid,'before_mode':oct(st.st_mode&0o777)})
 os.chown(p,account.pw_uid,account.pw_gid);p.chmod(0o700)
 subprocess.run(['runuser','-u','workmate','--','sh','-c','test -w "$1" && test -x "$1"','probe',str(p)],check=True)
cfg.write_bytes(b'user workmate workmate;\n'+raw)
try:
 subprocess.run(['/usr/sbin/nginx','-p','/opt/workmate/nginx/','-c',str(cfg),'-t'],check=True)
 for d in directories:assert Path(d['path']).stat().st_uid==account.pw_uid
 subprocess.run(['/usr/sbin/nginx','-p','/opt/workmate/nginx/','-c',str(cfg),'-s','reload'],check=True)
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','MainPID'],text=True)==v
 with urllib.request.urlopen('http://127.0.0.1:63072/health/ready') as r:health=json.load(r)
 assert health['ok'] and health['ai_ready'] and health['data_mode']=='configured_services'
 report={'stage':188,'status':'repaired','root_cause':'Dedicated non-root Nginx temporary directories belonged to nobody with mode0700. Large native Codex POST bodies failed before reaching the API.','directories':directories,'configured_worker_user':'workmate','mode':'0700','original_config_sha256':hashlib.sha256(raw).hexdigest(),'updated_config_sha256':hashlib.sha256(cfg.read_bytes()).hexdigest(),'master_api_database_pids_preserved':True,'nginx_root_validation_preserves_correct_ownership':True,'health':health}
 (backup/'receipt.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 cfg.write_bytes(raw)
 raise
PY
