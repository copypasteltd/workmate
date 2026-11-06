"""Upload only the owned Web build. Network and all service configs stay read-only."""
from pathlib import Path
import base64,hashlib,json,zipfile,paramiko
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.data/deployment-203-v1';OUT.mkdir(parents=True,exist_ok=True)
assert json.loads((ROOT/'.data/integrated-203-v2/verification.json').read_text())['status']=='passed'
assert json.loads((OUT/'release-metadata-validation.json').read_text())['status']=='passed'
web=ROOT.parent/'copypaste-web/dist';archive=OUT/'web-203-v1.zip';rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(web.rglob('*')):
  if not p.is_file():continue
  assert not p.is_symlink();raw=p.read_bytes();name=p.relative_to(web).as_posix();z.writestr(name,raw);rows.append({'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 z.writestr('application-manifest-203.json',json.dumps({'stage':203,'component':'web','files':rows},indent=2)+'\n')
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.sha256').write_text(digest+'\n')
access=json.loads((ROOT/'.data/deployment-189/server-access.private.json').read_text());t=paramiko.Transport((access['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(access['username'],access['password']);s=paramiko.SFTPClient.from_transport(t);target='/home/carzygod/workmate-static-203-v1';s.mkdir(target)
 for p in [archive,archive.with_suffix('.sha256')]:s.put(str(p),target+'/'+p.name)
 (OUT/'static-upload.json').write_text(json.dumps({'status':'uploaded','files':len(rows),'archive_sha256':digest,'destination':target},indent=2)+'\n');print(json.dumps({'status':'uploaded','files':len(rows),'sha256':digest}))
finally:t.close()
