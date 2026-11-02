"""Refresh only the non-live qualification candidate with reviewed native files."""
from pathlib import Path
import base64,hashlib,io,json,paramiko,zipfile
d=Path(__file__).resolve().parents[1];p=d.parent/'copypaste-platform'
spec=json.loads((d/'.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
names=['src/cloud-linux-host.py','scripts/launch-linux-native-service.py','dist/src/cloud-program-executor.js','dist/src/cloud-browser-runtime.js','dist/src/cloud-browser-preview.js','dist/src/cloud-browser-reclamation.js']
out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for name in names:z.writestr(name,(p/name).read_bytes())
raw=out.getvalue();digest=hashlib.sha256(raw).hexdigest()
t=paramiko.Transport((spec['host'],22))
try:
 t.start_client(timeout=15);assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
 t.auth_password(spec['username'],spec['password']);sftp=paramiko.SFTPClient.from_transport(t)
 remote='/home/carzygod/workmate-upload-191/native-candidate-'+digest+'.zip'
 try:
  with sftp.open(remote,'wx') as f:f.write(raw)
 except OSError:
  with sftp.open(remote,'rb') as f:assert f.read()==raw
 sftp.chmod(remote,0o600);sftp.close()
 script=r'''from pathlib import Path
import hashlib,json,subprocess,zipfile
root=Path('/opt/workmate/overlays/native-repair-191-v1/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','--property=WorkingDirectory','--value'],text=True).strip()!=str(root)
archive=Path(ARCHIVE);assert hashlib.sha256(archive.read_bytes()).hexdigest()==DIGEST
with zipfile.ZipFile(archive) as z:
 assert set(z.namelist())==set(NAMES)
 for name in z.namelist():
  f=root/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(z.read(name));f.chmod(0o644)
source=root/'src/cloud-linux-host.py';digest=hashlib.sha256(source.read_bytes()).hexdigest()
for kind in ['program','browser']:
 folder=root/('.data/cloud-'+kind+'-host-linux');host=folder/'cloud-linux-host.py';host.write_bytes(source.read_bytes());host.chmod(0o755)
 manifest=json.loads((folder/'manifest.json').read_text())
 for key in ['sha256','source_sha256','host_sha256','host_source_sha256']:manifest[key]=digest
 (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('NON_LIVE_NATIVE_CANDIDATE_SYNCED')
'''.replace('ARCHIVE',repr(remote)).replace('DIGEST',repr(digest)).replace('NAMES',repr(names))
 c=t.open_session(timeout=15);c.exec_command('sudo -S -p "" python3 -');c.sendall(spec['password'].encode()+b'\n'+script.encode());c.shutdown_write()
 stdout=c.makefile('rb').read();stderr=c.makefile_stderr('rb').read();assert c.recv_exit_status()==0,stderr.decode(errors='replace')
 print(stdout.decode().strip())
finally:t.close()
