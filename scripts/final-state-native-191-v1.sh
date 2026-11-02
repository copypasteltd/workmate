#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_FINAL_NATIVE'
from pathlib import Path
import json,subprocess
unit=Path('/etc/systemd/system/workmate-native-boundary.service')
legacy=Path('/sys/fs/cgroup/workmate-native-191')
report={'stage':191,'scope':'Owned obsolete setup only; no customer process termination'}
if unit.exists():
    text=unit.read_text()
    assert 'ExecStart=/opt/workmate/toolchains/cloud-native-191/prepare-cgroup.sh' in text
    if legacy.exists():
        assert not legacy.joinpath('cgroup.procs').read_text().strip()
        assert 'populated 0' in legacy.joinpath('cgroup.events').read_text()
        assert not any(p.is_dir() for p in legacy.iterdir())
    subprocess.run(['systemctl','disable','--now',unit.name],check=True)
    unit.unlink()
    subprocess.run(['systemctl','daemon-reload'],check=True)
    if legacy.exists():legacy.rmdir()
report['obsolete_owned_global_cgroup_removed']=not unit.exists() and not legacy.exists()
backend=Path('/opt/workmate/overlays/native-repair-191-v3/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(backend)
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
script=r"""
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{await c.query('BEGIN READ ONLY');
const tasks=(await c.query(`SELECT t.id,t.status,t.error_code,t.lease_until,t.budget_micros::text,t.charged_micros::text,t.version,task_occupies_execution_slot(t) occupies_execution_slot,d.state desktop_state,d.finished_at,d.client_report->>'error_code' client_error_code FROM tasks t LEFT JOIN desktop_executions d ON d.task_id=t.id WHERE t.id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a','dddcb494-42f4-4d29-80bd-9c4bd4141176','f6acc29f-0a98-4150-bf8f-0a48b3e52f82') ORDER BY t.id`)).rows;
const requests=(await c.query(`SELECT id,task_id,state,cost_state,capacity_held,usage_known,outcome_code FROM current_ai_provider_requests WHERE id IN ('ef9ea47b-b247-40ba-a502-efec956d6c1f','dff247a5-fce8-441d-ab79-4af917d57404','9e62e3a1-571d-42ec-8a92-b4dfc68e3835') ORDER BY id`)).rows;
if(requests.length!==3||requests.some(r=>r.capacity_held||r.cost_state!=='unknown'||r.usage_known))throw Error('Unknown financial facts must remain unknown, capacity alone released');
for(const id of ['cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a']){const t=tasks.find(t=>t.id===id);if(!t||t.status!=='reconciling'||t.occupies_execution_slot||t.charged_micros!=='0'||t.version!==4)throw Error('Original pending task or fees changed');}
const cloud=tasks.find(t=>t.id==='f6acc29f-0a98-4150-bf8f-0a48b3e52f82');if(cloud?.status!=='succeeded'||cloud.charged_micros!=='126067')throw Error('Actual cloud settlement mismatch');
console.log(JSON.stringify({tasks,requests,schema:(await c.query('SELECT max(version) version FROM schema_migrations')).rows[0].version}));await c.query('ROLLBACK');
}finally{await c.end();}
"""
report['facts']=json.loads(subprocess.check_output([node,'--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',script],cwd=backend,text=True))
cg=Path('/sys/fs/cgroup/system.slice/workmate-api.service/executions')
report['owned_native_jobs_remaining']=[p.name for p in cg.iterdir() if p.is_dir()] if cg.exists() else []
p=Path('/root/cfg/workmate/native-191/final-state.sanitized.json')
assert not p.exists()
p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600)
print(json.dumps(report))
WM_FINAL_NATIVE
