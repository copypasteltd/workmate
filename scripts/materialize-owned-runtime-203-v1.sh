#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,os,shutil,subprocess
root=Path('/opt/workmate/overlays/integrated-202-v2/backend');assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(root)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text());assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service'];before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in units}
state=Path('/root/cfg/workmate/integrated-203/runtime-materialization-v1');state.mkdir(parents=True,mode=0o700);assert not (state/'receipt.json').exists()
# Verify no active model work before replacing owned application runtime links.
js="import pg from './node_modules/pg/lib/index.js';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int count FROM tasks WHERE status IN ('queued','running')\");if(r.rows[0].count)throw Error('Active tasks must finish before application runtime repair');console.log(JSON.stringify(r.rows[0]));}finally{await c.end();}"
subprocess.check_output(['/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node','--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',js],cwd=root,text=True)
swaps=[];evidence=[]
try:
 for name in ['cloud-program-host-linux','cloud-browser-host-linux']:
  live=root/'.data'/name;source=live.resolve();saved=live.with_name(name+'.before-203-v1');candidate=live.with_name(name+'.candidate-203-v1')
  assert live.is_symlink() and source.is_relative_to('/opt/workmate/overlays/native-recheck-192-v1/backend/.data') and source.is_dir()
  assert not saved.exists() and not saved.is_symlink() and not candidate.exists()
  files=[]
  for p in source.rglob('*'):
   assert not p.is_symlink(),'Nested runtime links are not allowed'
   if p.is_file():files.append({'path':p.relative_to(source).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
  assert files and any(r['path']=='manifest.json' for r in files)
  shutil.copytree(source,candidate,copy_function=shutil.copy2)
  for r in files:assert (candidate/r['path']).stat().st_size==r['bytes'] and sha(candidate/r['path'])==r['sha256']
  # The old link and its target are retained; only this owned link is replaced.
  live.rename(saved);swaps.append((live,saved));candidate.rename(live);assert live.is_dir() and not live.is_symlink()
  evidence.append({'name':name,'original_target':str(source),'retained_link':str(saved),'files':files,'exact_bytes_preserved':True,'real_directory':True})
 after={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in units};assert after==before
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
 report={'stage':203,'status':'materialized_owned_runtime','items':evidence,'services_before':before,'services_after':after,'api_restarted':False,'network_configuration_unchanged':True,'boundary_checks_weakened':False,'scope':'Replace only owned application native-runtime symlinks with exact verified original files. Preserve original links/targets, all sandbox/cgroup policies and every server network setting. Real runtime qualification and Codex task evidence follow separately.'}
 (state/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except:
 for live,saved in reversed(swaps):
  if live.exists() and not live.is_symlink():live.rename(live.with_name(live.name+'.failed-203-v1'))
  if saved.is_symlink():saved.rename(live)
 raise
PY
