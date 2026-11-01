#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/highest-admin-direct-182-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'JS'
import pg from 'pg';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const id='7d32d69d-5680-4199-bd04-1ebe2b1b4813',release='786d90e0-8d36-4f8a-a7d7-93e9b7176015';
 const op=(await c.query('SELECT id,principal_id,action,state,payload_hash,execution_mode,result,created_at FROM admin_operations WHERE id=$1',[id])).rows[0];
 if(op?.state!=='succeeded'||op.execution_mode!=='super_admin_direct')throw new Error('Direct publication did not persist');
 const facts=(await c.query("SELECT id,principal_id,action,target,outcome,detail,created_at FROM audit_log WHERE target=$1 AND action='admin.execution.direct'",[id])).rows;
 if(facts.length!==1||facts[0].principal_id!==op.principal_id||facts[0].detail.execution_mode!=='super_admin_direct')throw new Error('Direct publication audit mismatch');
 const pending=(await c.query('SELECT count(*)::int AS n FROM admin_approval_requests WHERE operation_id=$1',[id])).rows[0].n;if(pending!==0)throw new Error('Direct model publication has a pending review');
 const head=(await c.query("SELECT h.publication_id,h.revision,p.release_id,p.validation_id,p.actor_id FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id WHERE h.profile_key='internal-text-v1' AND h.data_mode='simulated'")).rows[0];
 if(head.release_id!==release||head.actor_id!==op.principal_id)throw new Error('Published model head mismatch');
 const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex'),prior=JSON.parse(await readFile('/root/cfg/workmate/highest-admin-direct-182-v1-backup/preservation-before.json','utf8'));
 const preserved={};for(const [name,sql] of [['model_connections','SELECT * FROM capability_model_connections ORDER BY release_id'],['model_releases','SELECT * FROM capability_releases ORDER BY id'],['uncertain_holds',"SELECT channel,id,state,cost_state,capacity_held,effective_numerator,operation_id,request_hash FROM current_ai_provider_requests WHERE capacity_held ORDER BY id"],['historical_violations','SELECT * FROM ai_request_budget_violations ORDER BY id']]){preserved[name]=hash((await c.query(sql)).rows)===prior[name];if(!preserved[name])throw new Error('Original model/accounting preservation mismatch');}
 const receipt={stage:182,status:'production_direct_publication_verified',at:new Date().toISOString(),schema_version:160,operation:op,audit:facts[0],pending_review_count:pending,model_head:head,preserved,actual_model_calls_added:0};
 await writeFile('/root/cfg/workmate/highest-admin-direct-182-verification.sanitized.json',JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:receipt.status,operation_id:id,audit_id:facts[0].id,pending_review_count:pending,preserved}));
}finally{await c.end();}
JS
