"""Upload only public release artifacts, checksums and the built Web catalog."""
from pathlib import Path
import base64,hashlib,json,paramiko
root=Path(__file__).resolve().parents[1];state=root/'.data/deployment-199-v1'
receipt=json.loads((state/'package-receipt.private.json').read_text(encoding='utf-8'))
spec=json.loads((root/'.data/deployment-189/server-access.private.json').read_text(encoding='utf-8'))
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);s=paramiko.SFTPClient.from_transport(t);remote='/home/carzygod/workmate-downloads-199-v1';s.mkdir(remote)
 manifest={'stage':199,'files':{}}
 for name,source in receipt['artifact_sources'].items():
  p=Path(source);raw=p.read_bytes();expected=next(r for r in receipt['public_files'] if r['name']==name);assert len(raw)==expected['bytes'] and hashlib.sha256(raw).hexdigest()==expected['sha256']
  s.put(str(p),remote+'/'+name);manifest['files'][name]=expected
 data=(json.dumps(manifest,indent=2)+'\n').encode();f=s.open(remote+'/manifest.json','wx');f.write(data);f.close()
 (state/'public-upload.sanitized.json').write_bytes(data);print(json.dumps({'status':'uploaded','files':len(manifest['files']),'bytes':sum(r['bytes'] for r in manifest['files'].values())}))
finally:t.close()
