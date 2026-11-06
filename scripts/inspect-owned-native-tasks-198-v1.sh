#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/integrated-198-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_OWNED_NATIVE_198'
import pg from 'pg';
import {taskProviderBudgetReceipt} from './dist/src/provider-budgets.js';
const pool=new pg.Pool({connectionString:process.env.CONTROL_DATABASE_URL,max:1});
const ids=['50753841-921c-4437-a9f3-69835e8f92c6'];
try{
 const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');
  await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true),set_config('app.data_mode','configured_services',true)",['dfd0a03e-5648-4b7a-a687-fce8aacd658e','76e77daa-6e41-41fa-b2ea-6c889eb9acd2']);
  const tasks=(await c.query('SELECT id,status,version,error_code,execution_location,data_mode,charged_micros FROM tasks WHERE tenant_id=$1 AND project_id=$2 AND id=ANY($3::uuid[]) ORDER BY id',['dfd0a03e-5648-4b7a-a687-fce8aacd658e','30eb572b-52c1-4b99-966d-e3d2239a8b1d',ids])).rows;
  const reservations=(await c.query('SELECT task_id,status,amount_micros FROM reservations WHERE tenant_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY task_id',['dfd0a03e-5648-4b7a-a687-fce8aacd658e',ids])).rows;
  const requests=(await c.query('SELECT id,task_id,state,outcome_code,usage_known,input_tokens,output_tokens,known_charge_micros,released_at IS NOT NULL AS capacity_released FROM ai_gateway_requests WHERE tenant_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY created_at',['dfd0a03e-5648-4b7a-a687-fce8aacd658e',ids])).rows;
  const executions=(await c.query("SELECT task_id,state,client_report->>'status' AS client_status,client_report->>'error_code' AS client_error_code FROM desktop_executions WHERE tenant_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY task_id",['dfd0a03e-5648-4b7a-a687-fce8aacd658e',ids])).rows;
  const receipts=[];for(const id of ids)receipts.push({task_id:id,...await taskProviderBudgetReceipt(c,id)});
  await c.query('COMMIT');console.log(JSON.stringify({stage:198,status:'inspected',scope:'Read-only review of the current explicitly owned Desktop qualification tasks; actual provider usage and capacity only. No task or accounting record is changed.',tasks,reservations,requests,executions,receipts}));
 }finally{c.release();}
}catch(e){console.log(JSON.stringify({stage:198,status:'failed',error:e.code??e.name}));process.exitCode=1;}finally{await pool.end();}
WM_OWNED_NATIVE_198
