#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --env-file=/root/cfg/workmate/migration.env --input-type=module <<'NODE'
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.OWNER_DATABASE_URL});
try {
 await pool.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.actor_id',$2,false),set_config('app.data_mode',$3,false)",['dfd0a03e-5648-4b7a-a687-fce8aacd658e','76e77daa-6e41-41fa-b2ea-6c889eb9acd2','configured_services']);
 const events=await pool.query(`SELECT kind,body->>'code' AS code,body->'tool_policy' AS tool_policy,body->>'http_status' AS http_status,body->>'upstream_status' AS upstream_status FROM task_events WHERE task_id=$1 AND (kind LIKE $2 OR kind LIKE $3) ORDER BY seq`,['8db82abc-51e5-4f2a-84ce-6a4ac87118c5','gateway.%','task.finished']);
 const requests=await pool.query(`SELECT id,state,http_status,outcome_code,usage_known,input_tokens,output_tokens FROM ai_gateway_requests WHERE task_id=$1`,['8db82abc-51e5-4f2a-84ce-6a4ac87118c5']);const counts=await pool.query(`SELECT id,state,http_status,outcome_code,usage_known,counted_input_tokens FROM ai_input_count_requests WHERE task_id=$1`,['8db82abc-51e5-4f2a-84ce-6a4ac87118c5']);
 const identity=await pool.query("SELECT current_database() AS database,current_user AS role");const tasks=await pool.query("SELECT id,status,data_mode,execution_location FROM tasks WHERE id=$1",["8db82abc-51e5-4f2a-84ce-6a4ac87118c5"]);console.log(JSON.stringify({identity:identity.rows,tasks:tasks.rows,events:events.rows,requests:requests.rows,counts:counts.rows}));
}finally{await pool.end();}
NODE
