#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v5/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'NODE'
import {Database}from'./dist/src/db.js';import{loadConfig}from'./dist/src/config.js';
const db=new Database(loadConfig(process.env));const task='afdf5c14-6233-4958-96c7-f4d605798fd8';
try{const r=await db.tx(async tx=>({events:(await tx.query("SELECT id,kind,body FROM task_events WHERE task_id=$1 AND kind='gateway.request_rejected' ORDER BY id",[task])).rows,requests:(await tx.query('SELECT id,state,http_status,outcome_code,usage_known FROM ai_gateway_requests WHERE task_id=$1',[task])).rows}),'f5b06ebd-ec59-414c-ad1a-04224d202fc0',false,'d81349e4-77fc-4321-a9ba-24dca9714376');console.log(JSON.stringify(r));}finally{await db.close();}
NODE
