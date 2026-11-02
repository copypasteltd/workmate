"""Collect public runtime hashes and install the reviewed guardian, without API secrets."""
from pathlib import Path
import base64,hashlib,json,paramiko

delivery=Path(__file__).resolve().parents[1]
platform=delivery.parent/'copypaste-platform'
spec=json.loads((delivery/'.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
source=(platform/'src/cloud-linux-host.py').read_bytes().replace(b'\r\n',b'\n')
compile(source,'cloud-linux-host.py','exec')
digest=hashlib.sha256(source).hexdigest()
transport=paramiko.Transport((spec['host'],22))
try:
    transport.start_client(timeout=15)
    assert base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')=='kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
    transport.auth_password(spec['username'],spec['password'])
    sftp=paramiko.SFTPClient.from_transport(transport)
    remote='/home/carzygod/workmate-linux-host-191-'+digest+'.py'
    try:
        with sftp.open(remote,'wx') as f:f.write(source)
        sftp.chmod(remote,0o600)
    except OSError:
        with sftp.open(remote,'rb') as f:assert f.read()==source
    sftp.close()
    script=r'''from pathlib import Path
import hashlib,json,os,shutil,subprocess
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
browser=Path('/opt/workmate/toolchains/cloud-native-191/browser/chromium-1248/chrome-linux64')
bwrap='/usr/bin/bwrap'
common=dict(platform='linux',architecture='x64',bubblewrap_path=bwrap,bubblewrap_sha256=sha(bwrap))
program=dict(**common,id='node24-linux-native-v1',boundary='linux-userns-seccomp-cgroup-v1',node_version=subprocess.check_output([node,'--version'],text=True).strip(),node_sha256=sha(node))
files=[]
for p in sorted(browser.rglob('*')):
 if p.is_file():
  assert not p.is_symlink() and p.stat().st_nlink==1
  files.append(dict(path=p.relative_to(browser).as_posix(),bytes=p.stat().st_size,sha256=sha(p)))
preview=dict(**common,id='chromium1248-linux-native-v1',boundary='chromium-linux-userns-cgroup-v1',playwright_version='1.64.1',chromium_revision='1248',browser_path=str(browser),executable='chrome',files=files)
source=Path(SOURCE_PATH)
assert sha(source)==SOURCE_SHA
dest=Path('/opt/workmate/toolchains/cloud-native-191/guardian-'+SOURCE_SHA)
dest.mkdir(mode=0o755,exist_ok=True)
for kind,profile in [('program',program),('browser',preview)]:
 folder=dest/kind;folder.mkdir(mode=0o755,exist_ok=True)
 target=folder/'cloud-linux-host.py'
 if target.exists():assert target.read_bytes()==source.read_bytes()
 else:target.write_bytes(source.read_bytes());target.chmod(0o755)
 manifest=dict(kind=kind,boundary=profile['boundary'],sha256=SOURCE_SHA,source_sha256=SOURCE_SHA,host_sha256=SOURCE_SHA,host_source_sha256=SOURCE_SHA,bubblewrap_path=bwrap,bubblewrap_sha256=sha(bwrap))
 (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(dict(program=program,browser=preview,guardian_root=str(dest))))
'''
    script=script.replace('SOURCE_PATH',repr(remote)).replace('SOURCE_SHA',repr(digest))
    channel=transport.open_session(timeout=15)
    channel.exec_command('sudo -S -p "" python3 -')
    channel.sendall(spec['password'].encode()+b'\n'+script.encode());channel.shutdown_write()
    raw=channel.makefile('rb').read();err=channel.makefile_stderr('rb').read()
    assert channel.recv_exit_status()==0,err.decode(errors='replace')
    values=json.loads(raw)
    for kind in ['program','browser']:
        target=platform/('contracts/cloud-'+kind+'-runtime.linux.json')
        assert not target.exists() or json.loads(target.read_text(encoding='utf8'))==values[kind]
        target.write_text(json.dumps(values[kind],indent=2)+'\n',encoding='utf8',newline='\n')
    state=delivery/'.data/deployment-191';state.mkdir(parents=True,exist_ok=True)
    (state/'linux-contracts-v2.sanitized.json').write_text(json.dumps(values,indent=2)+'\n',encoding='utf8')
    print(json.dumps(dict(status='public_hashes_pinned',guardian_root=values['guardian_root'],browser_files=len(values['browser']['files']))))
finally:transport.close()
