#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v4/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_CAPACITY_189'
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await db.connect();
try{
 const id='8e92d03a-8578-4cce-bf41-7f28102b928f';
 const task=(await db.query('SELECT id,tenant_id,created_by,status,capacity_wait_reason FROM tasks WHERE id=$1',[id])).rows[0];
 const event=(await db.query("SELECT body->>'reason' AS reason,created_at FROM task_events WHERE task_id=$1 AND kind='task.capacity_wait' ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
 const active=(await db.query("SELECT id,status,execution_location,role_key FROM tasks WHERE tenant_id=$1 AND status IN ('running','paused','reconciling','awaiting_approval','needs_input')",[task.tenant_id])).rows;
 console.log(JSON.stringify({stage:189,at:new Date().toISOString(),scope:'Read-only owned image acceptance capacity reason and active task identities',task,event,active}));
}finally{await db.end();}
WM_IMAGE_CAPACITY_189
