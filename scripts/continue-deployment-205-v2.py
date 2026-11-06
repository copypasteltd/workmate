"""Continue from current server evidence, preserving the interrupted attempt."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
L=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/integrated-205-v3/verification.json')['status']=='passed'
assert load(L/'.data/deployment-205-v1/release-metadata-validation.json')['status']=='passed'
prior=L/'.data/deployment-205-v1/deploy-steps-v1/receipt.json';previous=load(prior);assert previous['status']=='running' and [r['name'] for r in previous['steps']]==['upload-downloads']
baseline=load(L/'.data/deployment-205-v1/resume-baseline-v1.sanitized.json');assert baseline['status']=='captured' and baseline['completed_upload_verified'] and not baseline['server_network_writes']
out=L/'.data/deployment-205-v1/deploy-steps-v2';out.mkdir(exist_ok=False)
report={'stage':205,'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'prior_interrupted_receipt_sha256':hashlib.sha256(prior.read_bytes()).hexdigest(),'prior_receipt_preserved':True,'resume_baseline_sha256':hashlib.sha256((L/'.data/deployment-205-v1/resume-baseline-v1.sanitized.json').read_bytes()).hexdigest(),'server_network_writes':False,'steps':[]}
def save():(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8')
try:
 for name,file,remote in [('publish-downloads','activate-downloads-205-v2.sh',True),('upload-complete-package','upload-integrated-205-v1.py',False),('stage-complete-package','stage-integrated-205-v1.sh',True),('activate-application','activate-integrated-205-v1.sh',True),('read-deployment','read-deployment-205-v1.sh',True)]:
  args=[sys.executable,'-B','-X','utf8']+(['scripts/remote-command-189-v1.py','scripts/'+file] if remote else ['scripts/'+file])
  r=subprocess.run(args,cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
   with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(data)
  report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()});save();print(json.dumps({'phase':name,'exit_code':r.returncode}),flush=True)
  assert r.returncode==0,'Application continuation stopped; inspect retained logs without network modification'
 report['status']='deployed_awaiting_online_observations'
except Exception:report['status']='failed';raise
finally:report['finished_at']=datetime.now(timezone.utc).isoformat();save()
