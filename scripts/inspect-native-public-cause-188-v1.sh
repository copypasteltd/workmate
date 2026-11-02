#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v5/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'NODE'
import {Database}from'./dist/src/db.js';import{loadConfig}from'./dist/src/config.js';
const db=new Database(loadConfig(process.env));const task='9c30201e-33a8-467e-902c-501367588fa6';
try{const r=await db.tx(async tx=>({events:(await tx.query("SELECT id,kind,body FROM task_events WHERE task_id=$1 AND kind='gateway.request_rejected' ORDER BY id",[task])).rows,requests:(await tx.query('SELECT id,state,http_status,outcome_code,usage_known FROM ai_gateway_requests WHERE task_id=$1',[task])).rows}),'8f16601b-a9c9-47e9-b299-68256c40e1f7',false,'76e77daa-6e41-41fa-b2ea-6c889eb9acd2');console.log(JSON.stringify(r));}finally{await db.close();}
NODE
