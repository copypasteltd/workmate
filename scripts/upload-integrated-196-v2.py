"""Upload the verified immutable candidate to the pinned application host."""
from pathlib import Path
import base64,hashlib,json,paramiko
root=Path(__file__).resolve().parents[1]
spec=json.loads((root/'.data/deployment-189/server-access.private.json').read_text(encoding='utf-8'))
source=root/'.data/deployment-196'
archive=source/'integrated-196-v1.zip'
assert archive.is_file() and archive.with_suffix('.zip.sha256').is_file()
assert hashlib.sha256(archive.read_bytes()).hexdigest()==archive.with_suffix('.zip.sha256').read_text().split()[0]
assert json.loads((source/'release-metadata-validation.json').read_text())['status']=='passed'
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15)
 assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);s=paramiko.SFTPClient.from_transport(t)
 target='/home/carzygod/workmate-upload-196-v2'
 try:s.mkdir(target)
 except OSError:raise RuntimeError('Candidate upload directory already exists; preserve original receipt')
 for name in ['integrated-196-v1.zip','integrated-196-v1.zip.sha256']:
  s.put(str(source/name),target+'/'+name)
 print(json.dumps({'status':'uploaded','destination':target,'sha256':hashlib.sha256((source/'integrated-196-v1.zip').read_bytes()).hexdigest()}))
finally:t.close()
