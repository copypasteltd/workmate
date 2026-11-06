"""Capture read-only final app/network observations without exposing configuration."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,sys
L=Path(__file__).resolve().parents[1];out=L/'.data/deployment-205-v1';report={'stage':205,'status':'running','steps':[],'server_network_mutations':False}
target=out/'post-deployment-observations-v1.json';assert not target.exists()
try:
 for name,script,remote in [('network-preserved-v1','verify-network-preserved-205-v1.sh',True),('final-service-state-v1','collect-final-service-state-205-v1.sh',True),('inner-downloads','qualify-inner-downloads-205-v1.py',False)]:
  args=[sys.executable,'-B','-X','utf8']+(['scripts/remote-command-189-v1.py','scripts/'+script] if remote else ['scripts/'+script])
  r=subprocess.run(args,cwd=L,capture_output=True)
  for kind,b in [('stdout',r.stdout),('stderr',r.stderr)]:
   with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(b)
  report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()})
  assert r.returncode==0,'Read-only observation failed; preserve server network environment'
  if remote:
   obj=json.loads(r.stdout.decode('utf-8').strip().splitlines()[-1]);assert obj['stage']==205 and obj['status']=='passed'
   with (out/(name+'.sanitized.json')).open('x',encoding='utf-8') as f:json.dump(obj,f,indent=2);f.write('\n')
  print(json.dumps({'name':name,'status':'passed'}),flush=True)
 report['status']='passed'
except Exception:report['status']='failed';raise
finally:
 report['finished_at']=datetime.now(timezone.utc).isoformat();target.write_text(json.dumps(report,indent=2)+'\n','utf-8')
