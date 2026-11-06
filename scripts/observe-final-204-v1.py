"""Read-only final network and service observations after online journeys."""
from pathlib import Path
import json,subprocess,sys
L=Path(__file__).resolve().parents[1];out=L/'.data/deployment-204-v1'
for name,script in [('network-preserved-v1','verify-network-preserved-204-v1.sh'),('final-service-state-v1','collect-final-service-state-204-v1.sh')]:
 r=subprocess.run([sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/'+script],cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 with (out/(name+'.stdout.log')).open('xb') as f:f.write(r.stdout)
 with (out/(name+'.stderr.log')).open('xb') as f:f.write(r.stderr)
 assert r.returncode==0,(name,'See exact retained local stdout/stderr')
 data=json.loads(r.stdout);assert data['status']=='passed'
 with (out/(name+'.sanitized.json')).open('x',encoding='utf-8') as f:json.dump(data,f,indent=2);f.write('\n')
 print(json.dumps({'phase':name,'status':'passed'}),flush=True)
