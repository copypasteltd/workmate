#!/usr/bin/env bash
set -euo pipefail
backend=$(systemctl show workmate-api.service --property=WorkingDirectory --value)
test "$backend" = /opt/workmate/overlays/native-recheck-192-v1/backend
cd "$backend"
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_ASSESS_194_V2'
import pg from 'pg';
const report={stage:194,at:new Date().toISOString(),scope:'Read-only canonical accounting and execution capacity for three original QA requests; no changes, service restart or model calls.',probe_limitations:['V1 native availability was evaluated in the root SSH process, outside the delegated non-root API service; it does not diagnose service runtime availability.','V1 released_at was a raw accounting field, not canonical execution capacity. Unknown cost must not be described as a held execution slot.']};
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 const ids=['ef9ea47b-b247-40ba-a502-efec956d6c1f','dff247a5-fce8-441d-ab79-4af917d57404','9e62e3a1-571d-42ec-8a92-b4dfc68e3835'];
 report.requests=(await db.query('SELECT r.id,r.state,r.cost_state,r.capacity_held,r.usage_known,t.status task_status,task_occupies_execution_slot(t) occupies_execution_slot FROM current_ai_provider_requests r JOIN tasks t ON t.id=r.task_id WHERE r.id=ANY($1::uuid[]) ORDER BY r.id',[ids])).rows;
 if(report.requests.length!==3)throw Error('Original QA requests not found');
 report.execution_capacity_released=report.requests.every(r=>r.capacity_held===false&&r.occupies_execution_slot===false);
 report.financial_reconciliation_pending=report.requests.some(r=>r.cost_state==='unknown');
 await db.query('ROLLBACK');
}finally{await db.end();}
report.status='collected';console.log(JSON.stringify(report));
WM_ASSESS_194_V2
