"""Read only named sanitized receipts over the pinned SSH connection."""
from pathlib import Path
import base64,hashlib,json,paramiko,shlex,uuid

delivery=Path(__file__).resolve().parents[1]
spec=json.loads((delivery/'.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
target=delivery/'.data/deployment-189'/('server-export-'+str(uuid.uuid4()))
target.mkdir()
remote="""from pathlib import Path
import base64,hashlib,json
root=Path('/root/cfg/workmate')
rows=[]
for name in ['live-189-v1','live-189-v2','live-189-v3','live-189-v4']:
 folder=root/name
 if not folder.is_dir():continue
 for file in sorted(folder.glob('*.sanitized.json')):
  raw=file.read_bytes()
  json.loads(raw)
  rows.append(dict(path=name+'/'+file.name,sha256=hashlib.sha256(raw).hexdigest(),base64=base64.b64encode(raw).decode()))
print(json.dumps(rows))
"""
transport=paramiko.Transport((spec['host'],22))
try:
    transport.start_client(timeout=15)
    fingerprint=base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
    assert fingerprint=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
    transport.auth_password(spec['username'],spec['password'])
    channel=transport.open_session(timeout=15)
    channel.exec_command('sudo -S -p "" python3 -c '+shlex.quote(remote))
    channel.sendall(spec['password'].encode()+b'\n');channel.shutdown_write()
    raw=channel.makefile('rb').read();error=channel.makefile_stderr('rb').read()
    assert channel.recv_exit_status()==0,'Receipt export failed; remote diagnostics withheld'
    rows=json.loads(raw)
    for row in rows:
        name=Path(row['path'])
        assert not name.is_absolute() and '..' not in name.parts and len(name.parts)==2 and name.name.endswith('.sanitized.json')
        value=base64.b64decode(row['base64'],validate=True)
        assert hashlib.sha256(value).hexdigest()==row['sha256']
        file=target/name;file.parent.mkdir(exist_ok=True)
        with file.open('xb') as output:output.write(value)
    manifest=[{k:r[k] for k in ['path','sha256']} for r in rows]
    with (target/'manifest.json').open('x',encoding='utf8') as output:json.dump(manifest,output,indent=2)
    print(json.dumps(dict(status='exported_to_private_review_directory',directory=str(target),files=len(rows))))
finally:transport.close()
