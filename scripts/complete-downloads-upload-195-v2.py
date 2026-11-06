"""Complete the public upload manifest without replacing the preserved failed one."""
from pathlib import Path
import base64,hashlib,json,paramiko
root=Path(__file__).resolve().parents[1];state=root/'.data/deployment-195'
r=json.loads((state/'package-receipt.private.json').read_text(encoding='utf-8'));spec=json.loads((root/'.data/deployment-189/server-access.private.json').read_text(encoding='utf-8'))
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);s=paramiko.SFTPClient.from_transport(t);remote='/home/carzygod/workmate-downloads-195-v1'
 assert s.stat(remote+'/manifest.json').st_size==0
 manifest={'stage':195,'files':{}}
 for row in r['public_files']:
  assert s.stat(remote+'/'+row['name']).st_size==row['bytes'];manifest['files'][row['name']]=row
 data=(json.dumps(manifest,indent=2)+'\n').encode()
 with s.open(remote+'/manifest-v2.json','wx') as f:f.write(data)
 (state/'public-upload-v2.sanitized.json').write_bytes(data)
 print(json.dumps({'status':'upload_manifest_completed','files':len(manifest['files']),'original_empty_manifest_preserved':True}))
finally:t.close()
