#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v5/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'WM_CAPACITY_191'
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});
try{await c.connect();await c.query('BEGIN READ ONLY');
 const tasks=(await c.query(`SELECT t.id,t.tenant_id,t.created_by,t.status,t.attempt,t.error_code,t.lease_until,t.budget_micros::text,t.charged_micros::text,t.version,d.state execution_state,d.finished_at,d.client_report FROM tasks t LEFT JOIN desktop_executions d ON d.task_id=t.id WHERE t.id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a')`)).rows;
 const requests=(await c.query(`SELECT channel,id,task_id,validation_id,tenant_id,project_id,actor_id,request_class,operation,operation_id,request_hash,state,cost_state,capacity_held,http_status,outcome_code,dispatched_at,finished_at,released_at,usage_known FROM current_ai_provider_requests WHERE data_mode='configured_services' AND capacity_held ORDER BY created_at LIMIT 25`)).rows;
 const running=(await c.query("SELECT count(*)::int n FROM tasks WHERE status='running'")).rows[0].n;
 console.log(JSON.stringify({stage:191,scope:'Read-only capacity repair prerequisites',tasks,requests,running}));await c.query('ROLLBACK');
}finally{await c.end();}
WM_CAPACITY_191
