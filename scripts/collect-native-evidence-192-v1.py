"""Fetch only explicitly selected non-secret receipts from the pinned application host."""
from pathlib import Path
import base64,hashlib,json,paramiko

delivery=Path(__file__).resolve().parents[1]
dest=delivery/'.data/acceptance-192/server-evidence';dest.mkdir(exist_ok=True)
spec=json.loads((delivery/'.data/deployment-189/server-access.private.json').read_text())
items={
 'backend-deployment.json':'/root/cfg/workmate/native-192/code-only-v1/deployment.sanitized.json',
 'static-deployment.json':'/root/cfg/workmate/native-192/static-v2/deployment.sanitized.json',
 'final-state.json':'/root/cfg/workmate/native-192/final-state.sanitized.json',
 'linux-native.json':'/opt/workmate/overlays/native-recheck-192-v1/backend/.data/native-qualification-192/58a335bd-3455-4b3a-a0b4-058147d2e093/qualification.json'
}

transport=paramiko.Transport((spec['host'],22))
try:
 transport.start_client(timeout=15)
 fingerprint=base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
 assert fingerprint=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 transport.auth_password(spec['username'],spec['password'])
 for name,source in items.items():
  assert not (dest/name).exists()
  ch=transport.open_session(timeout=15)
  ch.exec_command('sudo -S -p "" cat -- '+source)
  ch.sendall(spec['password'].encode()+b'\n');ch.shutdown_write()
  raw=ch.makefile('rb').read();err=ch.makefile_stderr('rb').read();assert ch.recv_exit_status()==0,(name,err.decode(errors='replace'))
  value=json.loads(raw);(dest/name).write_bytes(raw)
  print(json.dumps({'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}),flush=True)
finally:transport.close()
