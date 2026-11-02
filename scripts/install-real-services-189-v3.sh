#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_INSTALL_189'
from pathlib import Path,PurePosixPath
import hashlib,json,socket,subprocess,time,urllib.request,zipfile

previous=Path('/opt/workmate/overlays/real-services-189-v2/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','--property=WorkingDirectory','--value'],text=True).strip()==str(previous)
dest=Path('/opt/workmate/overlays/real-services-189-v3')
assert not dest.exists()
archive=Path('/home/carzygod/workmate-upload-189/workmate-real-services-189-v3.zip')
digest=Path(str(archive)+'.sha256').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
with socket.socket() as probe:
    assert probe.connect_ex(('127.0.0.1',63079))!=0,'Candidate port is occupied; do not stop another service'
cfg=Path('/root/cfg/workmate')
original=(cfg/'app.env').read_bytes()
state=cfg/'live-189-v3'
state.mkdir(mode=0o700)
candidate=state/'candidate.env'
candidate.write_bytes(original+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n')
candidate.chmod(0o600)
dest.mkdir()
with zipfile.ZipFile(archive) as source:
    manifest=json.loads(source.read('manifest.json'))
    assert manifest['stage']==189 and manifest['schema_version']==161
    assert hashlib.sha256((previous/'package-lock.json').read_bytes()).hexdigest()==manifest['backend_dependency_lock_sha256']
    assert set(source.namelist())=={row['path'] for row in manifest['files']}|{'manifest.json'}
    for row in manifest['files']:
        part=PurePosixPath(row['path'])
        assert not part.is_absolute() and '..' not in part.parts and part.parts[0]=='backend'
        raw=source.read(row['path'])
        assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
        target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o644)
    (dest/'manifest.json').write_bytes(source.read('manifest.json'))
for source in previous.iterdir():
    if source.name in ['src','dist','migrations']:continue
    target=dest/'backend'/source.name
    if not target.exists():target.symlink_to(source.resolve(),target_is_directory=source.is_dir())
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'

def ready(port):
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as response:result=json.load(response)
            if result.get('ok') and result.get('ai_ready') and result.get('data_mode')=='configured_services':return result
        except Exception:pass
        time.sleep(.5)
    raise RuntimeError('Updated backend readiness failed')

before={unit:subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],text=True) for unit in ['workmate-db.service','workmate-lan-proxy.service']}
drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzzzzzzzzzzzzzz-real-services-189-v3.conf')
assert not drop.exists()
activated=False
try:
    subprocess.run(['systemd-run','--unit=workmate-candidate-189-v3','--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest/'backend'),'--property=EnvironmentFile='+str(candidate),node,str(dest/'backend/dist/src/server.js')],check=True)
    candidate_health=ready(63079)
    # Check actual live work before restarting; uncertain completed requests keep
    # their original holds and are never rewritten by this code-only update.
    script="import pg from 'pg';const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();try{const r=await db.query(\"SELECT count(*)::int n FROM tasks WHERE status='running'\");if(r.rows[0].n!==0)process.exitCode=9;}finally{await db.end();}"
    subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',script],cwd=previous,check=True)
    subprocess.run(['systemctl','stop','workmate-candidate-189-v3.service'],check=True)
    drop.write_text('[Service]\nWorkingDirectory='+str(dest/'backend')+'\nExecStart=\nExecStart='+node+' '+str(dest/'backend/dist/src/server.js')+'\n')
    drop.chmod(0o644);activated=True
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','restart','workmate-api.service'],check=True)
    health=ready(63073)
    assert original==(cfg/'app.env').read_bytes()
    for unit,value in before.items():assert subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],text=True)==value
    report=dict(stage=189,status='deployed_for_final_acceptance',archive_sha256=digest,overlay=str(dest/'backend'),health=health,candidate_health=candidate_health,
                database_and_proxy_processes_unchanged=True,credentials_and_configuration_unchanged=True,unknown_requests_and_holds_preserved=True,schema_version=161,full_regression_status='running_separately')
    with (state/'deployment.sanitized.json').open('x') as output:json.dump(report,output,indent=2)
    print(json.dumps(report))
except Exception:
    if activated:
        drop.unlink(missing_ok=True)
        subprocess.run(['systemctl','daemon-reload'],check=False)
        subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
    raise
finally:
    subprocess.run(['systemctl','stop','workmate-candidate-189-v3.service'],check=False)
WM_INSTALL_189
