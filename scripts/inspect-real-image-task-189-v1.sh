#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v4/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_TASK_189'
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 const id='8e92d03a-8578-4cce-bf41-7f28102b928f';
 const task=(await db.query('SELECT id,status,error_code,charged_micros,input_tokens,output_tokens,data_mode FROM tasks WHERE id=$1',[id])).rows[0];
 const events=(await db.query('SELECT kind,created_at FROM task_events WHERE task_id=$1 ORDER BY created_at DESC LIMIT 10',[id])).rows;
 const requests=(await db.query('SELECT id,operation,model_alias,state,http_status,outcome_code,usage_known FROM ai_gateway_requests WHERE task_id=$1 ORDER BY created_at',[id])).rows;
 console.log(JSON.stringify({stage:189,at:new Date().toISOString(),scope:'Read-only current image QA task inventory',task,events,requests}));
}finally{await db.end();}
WM_IMAGE_TASK_189
