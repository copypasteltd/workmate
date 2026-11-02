#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-188-v7/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'NODE'
import {Database}from'./dist/src/db.js';import{loadConfig}from'./dist/src/config.js';
const db=new Database(loadConfig(process.env));
const scopes=[['dfd0a03e-5648-4b7a-a687-fce8aacd658e','76e77daa-6e41-41fa-b2ea-6c889eb9acd2'],['8f16601b-a9c9-47e9-b299-68256c40e1f7','76e77daa-6e41-41fa-b2ea-6c889eb9acd2'],['f5b06ebd-ec59-414c-ad1a-04224d202fc0','d81349e4-77fc-4321-a9ba-24dca9714376']];let rows=[];
try{for(const[tenant,actor]of scopes)rows.push(...await db.tx(async tx=>(await tx.query(`SELECT t.id,t.tenant_id,t.status,t.error_code,t.charged_micros::text,t.accrued_micros::text,t.created_at,
 (SELECT json_agg(json_build_object('state',r.state,'http_status',r.http_status,'outcome_code',r.outcome_code,'usage_known',r.usage_known)) FROM ai_gateway_requests r WHERE r.task_id=t.id) AS requests,
 (SELECT json_agg(e.body) FROM task_events e WHERE e.task_id=t.id AND e.kind='gateway.request_rejected') AS gateway_causes
 FROM tasks t WHERE t.created_by=$1 AND t.data_mode='configured_services' AND t.execution_location='desktop' AND t.created_at>='2026-11-02' ORDER BY t.created_at`,[actor])).rows,tenant,false,actor));
 const report={stage:188,scope:'Owned actual Desktop QA tasks only. Unknown supplier usage is retained, never converted into a zero-cost or successful settlement.',tasks:rows};
 const{writeFile}=await import('node:fs/promises');await writeFile('/root/cfg/workmate/native-final-188-v2.sanitized.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));}finally{await db.close();}
NODE
