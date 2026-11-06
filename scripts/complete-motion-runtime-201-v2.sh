#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,subprocess
state=Path('/root/cfg/workmate/integrated-201/media-runtime-v2');state.mkdir(mode=0o700)
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in units}
cfg=Path('/root/cfg/workmate');digests={n:hashlib.sha256((cfg/n).read_bytes()).hexdigest() for n in ['app.env','migration.env']}
installed=False
if not all(shutil.which(x) for x in ['ffmpeg','ffprobe']):
 env={**os.environ,'DEBIAN_FRONTEND':'noninteractive','NEEDRESTART_MODE':'l'}
 candidate=subprocess.check_output(['apt-cache','policy','ffmpeg'],text=True).split('Candidate:',1)[1].splitlines()[0].strip();assert candidate=='7:4.4.2-0ubuntu0.22.04.1'
 for args in [['apt-get','-o','Acquire::ForceIPv4=true','install','--yes','--no-upgrade','--no-install-recommends','ffmpeg='+candidate]]:
  result=subprocess.run(args,env=env,capture_output=True,text=True,timeout=480)
  (state/('apt-update.log' if 'update' in args else 'apt-install.log')).write_text(result.stdout+'\n'+result.stderr)
  if result.returncode:raise RuntimeError('Native media dependency installation failed; inspect root-only log')
 installed=True
report={'stage':201,'status':'running','installed':installed,'binaries':[]}
for name in ['ffmpeg','ffprobe']:
 executable=shutil.which(name);assert executable
 p=subprocess.run(['runuser','-u','workmate','--',executable,'-version'],capture_output=True,text=True,timeout=15);assert p.returncode==0
 report['binaries'].append({'name':name,'path':executable,'sha256':hashlib.sha256(Path(executable).read_bytes()).hexdigest(),'version':p.stdout.splitlines()[0]})
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
backend='/opt/workmate/overlays/integrated-201-v1/backend'
profile=subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',"import {videoRendererProfile} from './dist/src/video-render.js';console.log(JSON.stringify(await videoRendererProfile()));"],cwd=backend,capture_output=True,text=True,timeout=30)
assert profile.returncode==0,profile.stderr[:500]
report['profile']=json.loads(profile.stdout)
assert before=={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in units}
assert digests=={n:hashlib.sha256((cfg/n).read_bytes()).hexdigest() for n in digests}
report.update(status='passed',at=datetime.now(timezone.utc).isoformat(),application_database_proxy_processes_unchanged=True,credentials_unchanged=True)
(state/'receipt.sanitized.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
PY
