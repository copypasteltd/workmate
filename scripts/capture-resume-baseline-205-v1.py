from pathlib import Path
import hashlib,json,subprocess,sys
L=Path(__file__).resolve().parents[1];out=L/'.data/deployment-205-v1';target=out/'resume-baseline-v1.sanitized.json';assert not target.exists()
r=subprocess.run([sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/capture-resume-baseline-205-v1.sh'],cwd=L,capture_output=True)
for kind,b in [('stdout',r.stdout),('stderr',r.stderr)]:
 with (out/('resume-baseline-v1.'+kind+'.log')).open('xb') as f:f.write(b)
assert r.returncode==0,'Capture current state; do not restart an interrupted deployment blindly'
obj=json.loads(r.stdout.decode('utf-8').strip().splitlines()[-1]);assert obj['status']=='captured';obj['exact_stdout_sha256']=hashlib.sha256(r.stdout).hexdigest()
target.write_text(json.dumps(obj,indent=2)+'\n','utf-8');print(json.dumps({'status':'captured','server_boot_time':obj['server_boot_time'],'partial_files':len(obj['interrupted_public_files']),'network_files_equal':obj['prior_configuration_files_equal']}))
