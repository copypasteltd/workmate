#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import hashlib, json, os, shutil, subprocess, time, urllib.request, zipfile

cfg = Path('/root/cfg/workmate')
backup = cfg / 'domains-177-backup'
backup.mkdir(mode=0o700)
base = Path('/opt/workmate/releases/v0.1.3/backend/copypaste-platform')
overlay = Path('/opt/workmate/overlays/domains-177/backend')
archive = Path('/home/carzygod/workmate-upload-177/workmate-domain-runtime-177.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '677b2a2b31ff17d086dd0a63c66f220b295beff3b86d17a0386b6b9906336fd6'
assert not overlay.exists(), 'Never overwrite an existing overlay'
idle = subprocess.check_output(['/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node', '--env-file='+str(cfg/'app.env'), '--input-type=module', '-e', "import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int AS active FROM tasks WHERE status IN ('queued','running')\");console.log(JSON.stringify(r.rows[0]));}finally{await c.end();}"], cwd=base, text=True)
assert json.loads(idle)['active'] == 0, 'Wait for active customer work before restarting the owned API'
original = json.loads((cfg / 'preservation-before.sanitized.json').read_bytes())
before = {'foreign_cfg': [], 'foreign_services': []}
for row in original['cfg']:
    p = Path(row['path'])
    before['foreign_cfg'].append({'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
for row in original['services']:
    props = dict(x.split('=', 1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'], text=True).splitlines() if '=' in x)
    before['foreign_services'].append({'unit': row['unit'], **props})
with (backup / 'preservation-before.sanitized.json').open('x') as f:
    json.dump(before, f, indent=2)

def write_new(p, text, mode=0o600):
    with p.open('x', encoding='utf-8') as f: f.write(text)
    p.chmod(mode)

with zipfile.ZipFile(archive) as z:
    manifest = json.loads(z.read('manifest.json'))
    assert manifest['stage'] == 177
    assert hashlib.sha256((base/'package-lock.json').read_bytes()).hexdigest() == manifest['dependency_lock_sha256']
    names = [r['path'] for r in manifest['files']]
    assert len(names) == len(set(names))
    assert set(z.namelist()) == set(names + ['manifest.json'])
    overlay.mkdir(parents=True, mode=0o755)
    for row in manifest['files']:
        part = PurePosixPath(row['path'])
        assert not part.is_absolute() and '..' not in part.parts and part.parts[0] in ['dist', 'src']
        raw = z.read(row['path'])
        assert len(raw) == row['bytes'] and hashlib.sha256(raw).hexdigest() == row['sha256']
        dest = overlay / row['path']; dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw); dest.chmod(0o644)
    shutil.copyfile(archive, overlay.parent / archive.name)
    write_new(overlay.parent / 'runtime-manifest.json', json.dumps(manifest, indent=2)+'\n', 0o644)
for p in sorted(base.iterdir()):
    if p.name in ['dist', 'src']: continue
    (overlay / p.name).symlink_to(p.resolve(), target_is_directory=p.is_dir())
assert (overlay/'dist/src/cookie-policy.js').is_file()
assert (overlay/'node_modules').is_dir() and (overlay/'catalog').is_dir()

env_path = cfg/'app.env'
old_env = env_path.read_text()
nginx_path = Path('/opt/workmate/nginx/nginx.conf')
old_nginx = nginx_path.read_text()
shutil.copy2(env_path, backup/'app.env')
shutil.copy2(nginx_path, backup/'nginx.conf')
drop_dir = Path('/etc/systemd/system/workmate-api.service.d')
drop_dir.mkdir(exist_ok=True)
drop_path = drop_dir/'domains-177.conf'
assert not drop_path.exists()
origins = {'WEB_ORIGIN': manifest['origins']['web'], 'ADMIN_ORIGIN': manifest['origins']['admin'], 'API_ORIGIN': manifest['origins']['api']}
lines = old_env.splitlines()
for key, value in origins.items():
    matches = [i for i, line in enumerate(lines) if line.startswith(key+'=')]
    assert len(matches) == 1
    lines[matches[0]] = key+'='+json.dumps(value)
if any(s.startswith('SSO_CALLBACK_ORIGIN=') for s in lines):
    lines = [('SSO_CALLBACK_ORIGIN='+json.dumps(origins['WEB_ORIGIN'])) if s.startswith('SSO_CALLBACK_ORIGIN=') else s for s in lines]
# Keep the authorized mock gateway and native loopback binding unchanged.
assert 'DEMO_MODE="true"' in lines and 'HOST="127.0.0.1"' in lines
new_env = '\n'.join(lines)+'\n'
assert old_nginx.count('proxy_set_header X-Forwarded-Proto http;') == 3
new_nginx = old_nginx.replace('http {\n', '''http {
 map $host $workmate_forwarded_proto {
  default $scheme;
  agent.copypaste.hk https;
  agent-dashboard.copypaste.hk https;
  ai-api.copypaste.hk https;
 }
''', 1).replace('proxy_set_header X-Forwarded-Proto http;', 'proxy_set_header X-Forwarded-Proto $workmate_forwarded_proto;')
for port, host in [(63070,'agent.copypaste.hk'),(63071,'agent-dashboard.copypaste.hk'),(63072,'ai-api.copypaste.hk')]:
    old = f'listen 0.0.0.0:{port}; server_name _;'
    assert new_nginx.count(old) == 1
    new_nginx = new_nginx.replace(old, f'listen 0.0.0.0:{port}; server_name {host} _;')
drop = '[Service]\nWorkingDirectory='+str(overlay)+'\nExecStart=\nExecStart=/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node '+str(overlay/'dist/src/server.js')+'\n'
write_new(backup/'planned-drop-in.conf', drop)

try:
    env_path.write_text(new_env); env_path.chmod(0o600)
    nginx_path.write_text(new_nginx)
    subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(nginx_path)], check=True)
    write_new(drop_path, drop, 0o644)
    subprocess.run(['systemctl','daemon-reload'], check=True)
    subprocess.run(['systemctl','restart','workmate-api.service'], check=True)
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:63073/health/ready', timeout=3) as r:
                health = json.load(r)
                if r.status == 200 and health.get('kernel') == 'codex' and health.get('data_mode') == 'simulated': break
        except Exception: pass
        time.sleep(1)
    else: raise RuntimeError('New backend failed readiness')
    subprocess.run(['systemctl','reload','workmate-lan-proxy.service'], check=True)
except Exception:
    env_path.write_text(old_env); env_path.chmod(0o600)
    nginx_path.write_text(old_nginx)
    if drop_path.exists(): drop_path.unlink()
    subprocess.run(['systemctl','daemon-reload'], check=True)
    subprocess.run(['systemctl','restart','workmate-api.service'], check=True)
    subprocess.run(['systemctl','reload','workmate-lan-proxy.service'], check=True)
    raise

after = {'stage':177,'at':datetime.now(timezone.utc).isoformat(),'origins':manifest['origins'],
         'overlay':str(overlay),'runtime_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
         'foreign_cfg_unchanged':True,'foreign_service_pids_unchanged':True,
         'virtualization_invoked':False,'credentials_rotated':False,'health':health,'files':len(manifest['files'])}
for row in before['foreign_cfg']:
    assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['sha256']
for row in before['foreign_services']:
    props = dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
    assert props == {k:row[k] for k in props}, 'An unrelated service changed; inspect before claiming preservation'
after['foreign_cfg_count']=len(before['foreign_cfg']);after['foreign_service_count']=len(before['foreign_services'])
with (cfg/'domains-177-runtime.sanitized.json').open('x') as f: json.dump(after,f,indent=2)
print(json.dumps(after))
PY
