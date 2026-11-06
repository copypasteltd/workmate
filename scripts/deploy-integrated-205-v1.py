"""Deploy only the final verified Workmate application through unchanged entries."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
L=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/integrated-205-v3/verification.json')['status']=='passed'
assert load(L/'.data/deployment-205-v1/release-metadata-validation.json')['status']=='passed'
out=L/'.data/deployment-205-v1/deploy-steps-v1';out.mkdir(exist_ok=False)
report={'stage':205,'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'steps':[],'server_network_writes':False}
def save():(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8')
try:
 # Publish immutable files before the new Web catalog can link to them.
 for name,file,remote in [('upload-downloads','upload-downloads-205-v1.py',False),('publish-downloads','activate-downloads-205-v1.sh',True),('upload-complete-package','upload-integrated-205-v1.py',False),('stage-complete-package','stage-integrated-205-v1.sh',True),('activate-application','activate-integrated-205-v1.sh',True),('read-deployment','read-deployment-205-v1.sh',True)]:
  args=[sys.executable,'-B','-X','utf8']+(['scripts/remote-command-189-v1.py','scripts/'+file] if remote else ['scripts/'+file])
  r=subprocess.run(args,cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
   with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(data)
  report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()});save();print(json.dumps({'phase':name,'exit_code':r.returncode}),flush=True)
  assert r.returncode==0,'Application deployment stopped; inspect retained local logs'
 report['status']='deployed_awaiting_online_observations'
except Exception:report['status']='failed';raise
finally:report['finished_at']=datetime.now(timezone.utc).isoformat();save()
