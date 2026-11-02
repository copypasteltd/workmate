#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'WM_CAPACITY_191'
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});
try{await c.connect();await c.query('BEGIN READ ONLY');await c.query("SELECT set_config('app.data_mode','configured_services',true)");
 const tasks=(await c.query(`SELECT t.id,t.tenant_id,t.status,t.execution_location,t.attempt,t.lease_until,
 public.task_occupies_execution_slot(t) occupied,
 EXISTS(SELECT 1 FROM desktop_executions d WHERE d.task_id=t.id AND d.state IN ('finished','reconciling') AND d.finished_at IS NOT NULL) terminal,
 (SELECT count(*) FROM current_ai_provider_requests r WHERE r.task_id=t.id AND r.capacity_held) requests,
 (SELECT count(*) FROM ai_video_jobs v WHERE v.task_id=t.id AND (NOT v.usage_known OR v.state NOT IN ('completed','failed','cancelled'))) video,
 (SELECT count(*) FROM current_audio_accounting_requests a WHERE a.task_id=t.id AND a.capacity_held) audio,
 (SELECT json_agg(json_build_object('id',o.id,'state',o.state)) FROM tool_operations o WHERE o.task_id=t.id AND o.state IN ('accepted','reconciling') AND NOT EXISTS(SELECT 1 FROM current_ai_provider_requests r WHERE r.task_id=t.id AND r.channel='generation' AND r.operation_id=o.id::text AND NOT r.capacity_held)) tools,
 (SELECT count(*) FROM device_commands d WHERE d.task_id=t.id AND d.state IN ('pending','claimed')) devices
 FROM tasks t WHERE id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a')`)).rows;
 const requests=(await c.query(`SELECT channel,id,task_id,validation_id,tenant_id,project_id,actor_id,request_class,operation,operation_id,request_hash,state,cost_state,capacity_held,http_status,outcome_code,dispatched_at,finished_at,released_at,usage_known FROM current_ai_provider_requests WHERE data_mode='configured_services' AND capacity_held ORDER BY created_at LIMIT 25`)).rows;
 const running=(await c.query("SELECT count(*)::int n FROM tasks WHERE status='running'")).rows[0].n;
 console.log(JSON.stringify({stage:191,scope:'Read-only capacity repair prerequisites',tasks,requests,running}));await c.query('ROLLBACK');
}finally{await c.end();}
WM_CAPACITY_191
