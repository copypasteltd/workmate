"""Task-scoped SSH transport. Password stays in memory; never shell interpolation."""
from pathlib import Path
from datetime import datetime, timezone
import base64
import getpass
import hashlib
import json
import os
import shlex
import sys
import time
import uuid
import paramiko

ROOT = Path(__file__).resolve().parents[3]
PRIVATE = ROOT / 'dev/copypaste-delivery/.data/deployment-176'
PRIVATE.mkdir(parents=True, exist_ok=True)
HOST, USER = '192.168.31.20', 'carzygod'
password = getpass.getpass('SSH password (memory only): ')
client = paramiko.SSHClient()
# Preserve the user's known_hosts, including unrelated malformed records.
user_known = Path.home() / '.ssh/known_hosts'
if user_known.exists():
    for line in user_known.read_text(encoding='utf-8', errors='replace').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        try:
            entry = paramiko.hostkeys.HostKeyEntry.from_line(line)
        except Exception:
            if line.split()[0] == HOST:
                raise RuntimeError('The existing host key for this server is invalid; no file changed') from None
            continue
        if entry and entry.key:
            for hostname in entry.hostnames:
                client.get_host_keys().add(hostname, entry.key.get_name(), entry.key)

known = PRIVATE / 'known_hosts'
if known.exists():
    client.load_host_keys(str(known))


class TaskHostKey(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, ssh, hostname, key):
        ssh.get_host_keys().add(hostname, key.get_name(), key)
        ssh.save_host_keys(str(known))


client.set_missing_host_key_policy(TaskHostKey())
client.connect(HOST, username=USER, password=password, look_for_keys=False,
               allow_agent=False, timeout=15, auth_timeout=20, banner_timeout=20)
transport = client.get_transport()
transport.set_keepalive(25)
hostkey = transport.get_remote_server_key()
print(json.dumps({'status':'connected','host':HOST,'user':USER,'host_key_sha256':
    base64.b64encode(hashlib.sha256(hostkey.asbytes()).digest()).decode().rstrip('=')}), flush=True)


def run(command, sudo=False, timeout=1800):
    if sudo:
        command = "sudo -S -p '' /bin/bash -c " + shlex.quote(command)
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    if sudo:
        stdin.write(password + '\n'); stdin.flush()
    stdin.channel.shutdown_write()
    channel = stdout.channel
    started = time.monotonic()
    while True:
        for stream, ready in [('stdout', channel.recv_ready), ('stderr', channel.recv_stderr_ready)]:
            while ready():
                block = channel.recv(32768) if stream == 'stdout' else channel.recv_stderr(32768)
                value = block.decode('utf-8', errors='replace').replace(password, '[redacted]')
                print(json.dumps({'stream':stream,'text':value},ensure_ascii=False), flush=True)
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            return channel.recv_exit_status()
        if time.monotonic() - started > timeout:
            channel.close()
            raise TimeoutError('Owned remote command exceeded timeout; inspect remote state before retry')
        time.sleep(0.15)


try:
    for line in sys.stdin:
        request = json.loads(line)
        action = request['action']
        if action == 'close':
            break
        if action == 'exec':
            code = run(request['command'], request.get('sudo',False), request.get('timeout',1800))
            print(json.dumps({'action':action,'exit_code':code}),flush=True)
        elif action == 'run-file':
            local = (ROOT / request['path']).resolve()
            assert local.is_relative_to(ROOT / 'dev'), 'Only dev scripts may run remotely'
            remote = '/tmp/workmate-deploy-176-' + str(uuid.uuid4()) + '.sh'
            with client.open_sftp() as sftp:
                sftp.put(str(local),remote); sftp.chmod(remote,0o700)
            try:
                code=run('/bin/bash '+shlex.quote(remote),request.get('sudo',True),request.get('timeout',3600))
                print(json.dumps({'action':action,'script':local.name,'exit_code':code}),flush=True)
            finally:
                with client.open_sftp() as sftp:
                    sftp.remove(remote)
        elif action == 'upload':
            local=(ROOT / request['path']).resolve()
            assert local.is_relative_to(ROOT / 'dev') and local.is_file()
            remote=request['remote']
            assert remote.startswith('/home/carzygod/workmate-upload-176/') and '..' not in remote.split('/')
            with client.open_sftp() as sftp:
                try:sftp.mkdir('/home/carzygod/workmate-upload-176',0o700)
                except OSError:pass
                try:sftp.stat(remote)
                except FileNotFoundError:pass
                else:raise FileExistsError('Existing remote upload is preserved')
                last=[0.0]
                def progress(sent,total):
                    if time.monotonic()-last[0]>10 or sent==total:
                        print(json.dumps({'phase':'upload','file':local.name,'sent':sent,'total':total}),flush=True);last[0]=time.monotonic()
                sftp.put(str(local),remote,callback=progress)
            print(json.dumps({'action':action,'status':'uploaded','remote':remote}),flush=True)
        elif action in ['download', 'download-private']:
            remote=request['remote']; local=(ROOT/request['path']).resolve()
            assert local.is_relative_to(PRIVATE) and not local.exists()
            if action == 'download':
                assert remote.startswith('/root/cfg/workmate/') and remote.endswith('.sanitized.json')
            else:
                assert remote == '/root/cfg/workmate/qa-login-context.json' and local.name == 'qa-login-context.json'
            content_command='cat -- '+shlex.quote(remote)
            stdin,stdout,stderr=client.exec_command("sudo -S -p '' /bin/bash -c "+shlex.quote(content_command))
            stdin.write(password+'\n');stdin.flush();stdin.channel.shutdown_write()
            data=stdout.read();error=stderr.read();assert stdout.channel.recv_exit_status()==0
            json.loads(data);local.parent.mkdir(parents=True,exist_ok=True);local.write_bytes(data)
            print(json.dumps({'action':action,'status':'downloaded','bytes':len(data)}),flush=True)
        else:
            raise ValueError('Unknown action')
except Exception as e:
    print(json.dumps({'status':'error','error':(type(e).__name__+': '+str(e)).replace(password,'[redacted]')}),flush=True)
finally:
    client.close()
    password=''
