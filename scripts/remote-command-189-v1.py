"""Run one reviewed UTF-8 script on the existing host; keep credentials private."""
from pathlib import Path
import base64
import hashlib
import json
import sys
import paramiko

delivery = Path(__file__).resolve().parents[1]
spec = json.loads((delivery / '.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
script_path = Path(sys.argv[1]).resolve()
assert script_path.is_relative_to(delivery / 'scripts') and script_path.suffix == '.sh'
transport = paramiko.Transport((spec['host'], 22))
try:
    transport.start_client(timeout=15)
    fingerprint = base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
    assert fingerprint == 'kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE', 'Application host identity changed'
    transport.auth_password(spec['username'], spec['password'])
    channel = transport.open_session(timeout=15)
    channel.exec_command('sudo -S -p "" bash -s')
    channel.sendall(spec['password'].encode() + b'\n' + script_path.read_bytes().replace(b'\r\n', b'\n'))
    channel.shutdown_write()
    with channel.makefile('rb') as output:
        for line in output:
            print(line.decode('utf8', errors='replace'), end='', flush=True)
    with channel.makefile_stderr('rb') as errors:
        error = errors.read(4096)
    status = channel.recv_exit_status()
    if error:
        print(error.decode('utf8', errors='replace'), file=sys.stderr)
    sys.exit(status)
finally:
    transport.close()
