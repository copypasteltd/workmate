#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DOWNLOADS_193'
from pathlib import Path
import hashlib,json,re,subprocess,urllib.request
proxy=Path('/opt/workmate/nginx/nginx.conf');raw=proxy.read_bytes()
out={'proxy_sha256':hashlib.sha256(raw).hexdigest(),'web_servers':[], 'services':{},'existing_desktop_artifacts':[]}
text=raw.decode();index=text.find('63070');out['web_server_excerpt']=text[max(0,text.rfind('server',0,index)):index+1800] if index>=0 else ''
for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 out['services'][unit]=subprocess.check_output(['systemctl','show',unit,'-p','MainPID','-p','ActiveState','-p','WorkingDirectory','-p','NRestarts'],text=True).splitlines()
for base in [Path('/opt/workmate'),Path('/home/carzygod/workmate-upload-191'),Path('/tmp')]:
 if not base.exists():continue
 for filename in ['CopyPaste-0.7.4-x64-Setup.exe','CopyPaste-0.7.4-x64-Portable.exe']:
  for p in base.rglob(filename):
   if not p.is_file():continue
   out['existing_desktop_artifacts'].append({'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
for port in [63070,63071,63072]:
 try:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=5) as r:out['health_'+str(port)]=json.load(r)
 except Exception as e:out['health_'+str(port)]={'error':type(e).__name__}
print(json.dumps(out))
WM_DOWNLOADS_193
