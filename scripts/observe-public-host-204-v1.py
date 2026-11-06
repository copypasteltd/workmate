"""Capture the reviewed read-only public file observation without terminal secrets."""
from pathlib import Path
import hashlib,json,subprocess,sys
L=Path(__file__).resolve().parents[1];out=L/'.data/deployment-204-v1'
assert not (out/'public-host-v2.sanitized.json').exists()
r=subprocess.run([sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/qualify-public-download-host-204-v2.sh'],cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
for kind,b in [('stdout',r.stdout),('stderr',r.stderr)]:
 with (out/('public-host-v2.'+kind+'.log')).open('xb') as f:f.write(b)
report=json.loads(r.stdout.decode('utf-8').strip().splitlines()[-1]);assert report['stage']==204
report['observation_exit_code']=r.returncode
report['exact_stdout_sha256']=hashlib.sha256(r.stdout).hexdigest();report['exact_stderr_sha256']=hashlib.sha256(r.stderr).hexdigest()
with (out/'public-host-v2.sanitized.json').open('x',encoding='utf-8') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'status':report['status'],'downloads':len(report['downloads']),'source':'Actual original-TLS public200, server-initiated; not a developer-browser claim'}),flush=True)
assert r.returncode==0 and report['status']=='passed','Preserve partial public evidence; do not change networking'
