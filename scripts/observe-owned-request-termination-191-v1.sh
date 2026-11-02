#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_OBSERVE'
from pathlib import Path
import json,subprocess,hashlib
backend=Path('/opt/workmate/overlays/native-repair-191-v2/backend');node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
start=subprocess.check_output(['systemctl','show','workmate-api.service','-p','ExecMainStartTimestamp','--value'],text=True).strip()
script=r"""
import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{
const rows=(await c.query(`SELECT r.id,r.task_id,r.operation_id,r.request_hash,r.data_mode,r.request_class,r.state,r.usage_known,r.capacity_held,r.cost_state,r.dispatched_at,r.finished_at,r.http_status,r.outcome_code,t.status task_status,t.lease_until,d.state desktop_state,d.finished_at desktop_finished_at FROM current_ai_provider_requests r JOIN tasks t ON t.id=r.task_id JOIN desktop_executions d ON d.task_id=t.id WHERE r.id IN ('ef9ea47b-b247-40ba-a502-efec956d6c1f','dff247a5-fce8-441d-ab79-4af917d57404','9e62e3a1-571d-42ec-8a92-b4dfc68e3835') ORDER BY r.id`)).rows;
if(rows.length!==3||rows.some(r=>r.state!=='unknown'||r.task_status!=='reconciling'||r.lease_until!==null||!r.desktop_finished_at||r.outcome_code!=='AI_TOOL_CALL_NOT_ALLOWED'))throw Error('Original observed request facts changed');
console.log(JSON.stringify({rows,observed_at:new Date().toISOString()}));
}finally{await c.end();}
"""
facts=json.loads(subprocess.check_output([node,'--env-file=/root/cfg/workmate/app.env','--input-type=module','-e',script],cwd=backend,text=True))
facts.update(stage=191,gateway_process_started_at=start,observation='The original company gateway hosting process has exited; each bound native execution has reported a terminal outcome and its inference credential is fenced. No upstream invoice, usage quantity, remote-provider computation status or zero cost is asserted.')
p=Path('/root/cfg/workmate/native-191/owned-transport-termination.sanitized.json')
with p.open('x') as f:json.dump(facts,f,indent=2);f.write('\n')
p.chmod(0o600);print(json.dumps(facts))
WM_OBSERVE
