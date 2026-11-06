from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';N=R/'dev/copypaste-desktop'
def change(p,old,new):
 s=p.read_text('utf-8');assert old in s,p;p.write_text(s.replace(old,new),'utf-8')
def fresh(p,s):
 assert not p.exists(),p;p.write_text(s,'utf-8')
for p in [L/'scripts/bundle-integrated-205-v1.py',L/'scripts/upload-integrated-205-v1.py',N/'scripts/package-integrated-205-v1.mjs',L/'scripts/finalize-release-metadata-205-v1.mjs']:
 change(p,'integrated-205-v1/verification.json','integrated-205-v2/verification.json')
change(L/'scripts/finalize-release-metadata-205-v1.mjs',".state,'passed'",".status,'passed'")
change(L/'scripts/finalize-release-metadata-205-v1.mjs','completed final integrated-204 source batch','frozen integrated-205-v2 source batch')
fresh(L/'scripts/qualify-tool-feedback-ui-205-v2.mjs',(L/'scripts/qualify-tool-feedback-ui-205-v1.mjs').read_text('utf-8').replace('acceptance-205/feedback-ui-v1','acceptance-205/feedback-ui-v2').replace('205-v1-tool-feedback','205-v2-tool-feedback').replace("'205-v1'","'205-v2'"))
s=(L/'scripts/qualify-live-marketing-review-204-v3.mjs').read_text('utf-8').replace('.data/deployment-204-v2/release','.data/deployment-205-v1/release').replace('.data/acceptance-204/live-review-','.data/acceptance-205/live-review-').replace('stage:204','stage:205').replace('0.7.17','0.7.18').replace('204-v1-marketing-review-live','205-v1-marketing-review-live').replace('204-v1-specialist-intake-live','205-v1-specialist-intake-live').replace("'204-v1'","'205-v1'")
s=s.replace("report.previous_charge=previous.charged_micros;", "report.previous_charge=previous.charged_micros;assert.ok(previous.tool_outcomes);assert.equal(previous.tool_outcomes.total,0);report.authorized_tool_outcome_summary={task_id:original.task_id,...previous.tool_outcomes};")
fresh(L/'scripts/qualify-live-marketing-review-205-v1.mjs',s)
s=(L/'scripts/company-qa-tunnel-204-v2.py').read_text('utf-8').replace('acceptance-204/transport-v2','acceptance-205/transport-v1').replace("'stage':204","'stage':205")
fresh(L/'scripts/company-qa-tunnel-205-v1.py',s)
s='''#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json
cfg=Path('/root/cfg/workmate/integrated-205')
print(json.dumps({'deployment':json.loads((cfg/'activation-v1/deployment.sanitized.json').read_text())}))
PY
'''
fresh(L/'scripts/read-deployment-205-v1.sh',s)
s='''"""Deploy only the final verified Workmate application through unchanged entries."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
L=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/integrated-205-v2/verification.json')['status']=='passed'
assert load(L/'.data/deployment-205-v1/release-metadata-validation.json')['status']=='passed'
out=L/'.data/deployment-205-v1/deploy-steps-v1';out.mkdir(exist_ok=False)
report={'stage':205,'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'steps':[],'server_network_writes':False}
def save():(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\\n','utf-8')
try:
 for name,file,remote in [('upload-complete-package','upload-integrated-205-v1.py',False),('stage-complete-package','stage-integrated-205-v1.sh',True),('activate-application','activate-integrated-205-v1.sh',True),('read-deployment','read-deployment-205-v1.sh',True)]:
  args=[sys.executable,'-B','-X','utf8']+(['scripts/remote-command-189-v1.py','scripts/'+file] if remote else ['scripts/'+file])
  r=subprocess.run(args,cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
   with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(data)
  report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()});save();print(json.dumps({'phase':name,'exit_code':r.returncode}),flush=True)
  assert r.returncode==0,'Application deployment stopped; inspect retained local logs'
 report['status']='deployed_awaiting_online_observations'
except Exception:report['status']='failed';raise
finally:report['finished_at']=datetime.now(timezone.utc).isoformat();save()
'''
fresh(L/'scripts/deploy-integrated-205-v1.py',s)
print(json.dumps({'status':'prepared','ops_gate':'whole205-v2 passed','server_network_writes':False}))
