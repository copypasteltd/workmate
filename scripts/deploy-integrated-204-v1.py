"""Publish qualified application artifacts only, using established entry points."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess, sys
L=Path(__file__).resolve().parents[1];D=L.parent
load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/integrated-204-v11/verification.json')['status']=='passed'
assert load(L/'.data/acceptance-204/feedback-ui-v3/receipt.json')['status']=='passed'
assert load(D/'copypaste-desktop/.data/deployment-204-v2/packaging-receipt.json')['status']=='passed'
out=L/'.data/deployment-204-v1/deploy-steps';out.mkdir(parents=True,exist_ok=False)
node='D:/Program Files/nodejs/node.exe';env={**os.environ,'PATH':str(Path(node).parent)+os.pathsep+os.environ.get('PATH','')}
report={'stage':204,'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'steps':[],'server_network_writes':False}
def save():(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8')
def step(name,args):
 r=subprocess.run(args,cwd=L,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
  with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(data)
 report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()});save()
 print(json.dumps({'phase':name,'exit_code':r.returncode}),flush=True)
 if r.returncode:raise RuntimeError('Application publication stopped at '+name+'; retained local logs contain the exact failure')
try:
 for name,file in [('prepare-downloads','prepare-public-downloads-204-v1.py'),('finalize-metadata','finalize-release-metadata-204-v1.mjs'),('bundle','bundle-integrated-204-v1.py'),('upload-application','upload-integrated-204-v1.py')]:
  step(name,[node if file.endswith('.mjs') else sys.executable,*([] if file.endswith('.mjs') else ['-B','-X','utf8']),'scripts/'+file])
 step('stage',[sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/stage-integrated-204-v1.sh'])
 step('upload-downloads',[sys.executable,'-B','-X','utf8','scripts/upload-downloads-204-v1.py'])
 for name,file in [('publish-downloads','activate-downloads-204-v1.sh'),('activate-application','activate-integrated-204-v1.sh'),('read-deployment','read-deployment-204-v1.sh')]:
  step(name,[sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/'+file])
 report['status']='deployed_awaiting_online_observations'
except Exception:
 report['status']='failed';raise
finally:
 report['finished_at']=datetime.now(timezone.utc).isoformat();save()
