"""Upload the completed verified backend-only correction to the pinned host."""
from pathlib import Path
import base64,hashlib,json,paramiko
root=Path(__file__).resolve().parents[1];spec=json.loads((root/'.data/deployment-189/server-access.private.json').read_text());source=root/'.data/deployment-202-v2';archive=source/'html-integrity-202-v1.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==archive.with_suffix('.zip.sha256').read_text().split()[0]
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE';t.auth_password(spec['username'],spec['password']);s=paramiko.SFTPClient.from_transport(t);target='/home/carzygod/workmate-html-integrity-202-v1';s.mkdir(target)
 for p in [archive,archive.with_suffix('.zip.sha256')]:s.put(str(p),target+'/'+p.name)
 print(json.dumps({'status':'uploaded','files':2}))
finally:t.close()
