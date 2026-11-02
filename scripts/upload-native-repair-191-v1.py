from pathlib import Path
import json,base64,hashlib,paramiko
delivery=Path(__file__).resolve().parents[1]
spec=json.loads((delivery/'.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15)
 assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);sftp=paramiko.SFTPClient.from_transport(t)
 target='/home/carzygod/workmate-upload-191'
 try:sftp.stat(target)
 except FileNotFoundError:sftp.mkdir(target,0o700)
 for name in ['workmate-native-repair-191-v1.zip','workmate-native-repair-191-v1.zip.sha256']:
  raw=(delivery/'.data/deployment-191'/name).read_bytes()
  with sftp.open(target+'/'+name,'wx') as f:f.write(raw)
  sftp.chmod(target+'/'+name,0o600)
  with sftp.open(target+'/'+name,'rb') as f:assert hashlib.sha256(f.read()).digest()==hashlib.sha256(raw).digest()
 sftp.close();print(json.dumps(dict(status='uploaded_and_hash_verified',target=target)))
finally:t.close()
