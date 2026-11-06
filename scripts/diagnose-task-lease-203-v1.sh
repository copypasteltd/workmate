#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-202-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module - <<'JS'
import pg from './node_modules/pg/lib/index.js';import{execFileSync}from'node:child_process';
const client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');const id='5b2367dc-c80b-4743-8d28-2c2229b0a707';
 const task=(await client.query('SELECT id,status,error_code,version,lease_until,updated_at,runtime_thread,runtime_turn,charged_micros,accrued_micros FROM tasks WHERE id=$1',[id])).rows;
 const tools=(await client.query('SELECT tool_name,created_at,result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 ORDER BY created_at',[id])).rows;
 const operations=(await client.query('SELECT tool_name,state,charge_micros FROM tool_operations WHERE task_id=$1',[id])).rows;
 const reservations=(await client.query('SELECT status,amount_micros FROM reservations WHERE task_id=$1',[id])).rows;
 const columns=(await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_name IN('current_ai_provider_requests','provider_admin_reconciliations') ORDER BY table_name,ordinal_position")).rows;
 const activity=(await client.query("SELECT application_name,state,wait_event_type,wait_event,now()-xact_start age,left(query,150) query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL")).rows;
 console.log(JSON.stringify({stage:203,status:'read_only_diagnosis',task,tools,operations,reservations,columns,activity,api_service:execFileSync('systemctl',['show','workmate-api.service','-p','MainPID','-p','NRestarts','-p','MemoryCurrent','-p','CPUUsageNSec'],{encoding:'utf8'}),logs:execFileSync('journalctl',['-u','workmate-api.service','--since','2026-11-06 12:10:00 UTC','-n','100','--no-pager','-o','cat'],{encoding:'utf8'})}));await client.query('ROLLBACK');
}finally{await client.end();}
JS
