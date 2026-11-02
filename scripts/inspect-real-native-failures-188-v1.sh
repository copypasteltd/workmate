#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'NODE'
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.CONTROL_DATABASE_URL});
try {
 const events=await pool.query(`SELECT kind,body->>'code' AS code,body->'tool_policy' AS tool_policy,body->>'http_status' AS http_status,body->>'upstream_status' AS upstream_status FROM task_events WHERE task_id=$1 AND (kind LIKE $2 OR kind LIKE $3) ORDER BY seq`,['8db82abc-51e5-4f2a-84ce-6a4ac87118c5','gateway.%','task.finished']);
 const requests=await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE '%request%' AND (column_name LIKE '%status%' OR column_name LIKE '%error%' OR column_name LIKE '%task%' OR column_name='id') ORDER BY table_name,ordinal_position`);
 console.log(JSON.stringify({events:events.rows,request_schema:requests.rows}));
}finally{await pool.end();}
NODE
