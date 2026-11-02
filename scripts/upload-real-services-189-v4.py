from pathlib import Path
import json
import base64
import hashlib
import paramiko

root = Path(__file__).resolve().parents[1]
directory = root / '.data/deployment-189'
spec = json.loads((directory / 'server-access.private.json').read_text(encoding='utf8'))
transport = paramiko.Transport((spec['host'],22))
try:
    transport.start_client(timeout=15)
    fingerprint = base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
    assert fingerprint == 'kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
    transport.auth_password(spec['username'],spec['password'])
    sftp = paramiko.SFTPClient.from_transport(transport)
    try:
        target = '/home/carzygod/workmate-upload-189'
        try:sftp.stat(target)
        except FileNotFoundError:sftp.mkdir(target,0o700)
        for name in ['workmate-real-services-189-v4.zip','workmate-real-services-189-v4.zip.sha256']:
            raw = (directory / name).read_bytes()
            with sftp.open(target+'/'+name,'wx') as stream:
                stream.write(raw)
            sftp.chmod(target+'/'+name,0o600)
            with sftp.open(target+'/'+name,'rb') as stream:
                assert hashlib.sha256(stream.read()).digest()==hashlib.sha256(raw).digest()
        print(json.dumps({'status':'uploaded_and_hash_verified','directory':target}))
    finally:sftp.close()
finally:transport.close()
