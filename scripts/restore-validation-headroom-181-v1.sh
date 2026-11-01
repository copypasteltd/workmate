#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/model-tool-contract-181-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_HEADROOM_JS'
import pg from 'pg';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
const receiptPath='/root/cfg/workmate/validation-headroom-181.sanitized.json';
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const heldQuery="SELECT channel,id,state,cost_state,capacity_held,effective_numerator,operation_id,request_hash FROM current_ai_provider_requests WHERE data_mode='simulated' AND capacity_held ORDER BY id";
try {
 await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('ai-gateway:simulated',0))");
 const {rows:[policy]}=await c.query("SELECT p.* FROM ai_gateway_policy_heads h JOIN ai_gateway_policy_versions p ON p.id=h.policy_version_id WHERE h.data_mode='simulated' FOR UPDATE OF h");
 const heads=await c.query("SELECT 1 FROM ai_provider_admin_heads WHERE data_mode='simulated'");
 if(heads.rowCount||policy.version!==1||policy.reason!=='Bootstrap provider request policy'||policy.actor_slots!==2||policy.verification_slots!==2)throw new Error('Only the original, unpublished bootstrap limits may be maintained by this deployment; an administrator policy is never overridden');
 const held=(await c.query(heldQuery)).rows;
 if(held.length!==2||held.some(r=>r.state!=='unknown'||!['ac175832-67a7-4c5f-8c89-5ec3c0beaf85','e8f0473b-4e81-4358-b60d-1472447da917'].includes(r.id)))throw new Error('Original uncertain holds differ; inspect without changing them');
 const budgets=(await c.query("SELECT p.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies p ON p.id=h.policy_id WHERE h.data_mode='simulated'")).rows;
 const keys=Object.keys(policy).filter(k=>!['id','version','created_by','reason','created_at'].includes(k));
 const reason='Stage181 server operator carzygod: retain two historical unknown verification holds; restore two available verification slots after Codex tool-contract repair. Budget ceilings and billing evidence unchanged.';
 const values=keys.map(k=>['actor_slots','verification_slots'].includes(k)?4:policy[k]);
 const next=(await c.query(`INSERT INTO ai_gateway_policy_versions(${keys.join(',')},version,reason) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')},2,$${values.length+1}) RETURNING *`,[...values,reason])).rows[0];
 const changed=await c.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='simulated' AND policy_version_id=$2",[next.id,policy.id]);if(changed.rowCount!==1)throw new Error('Policy head changed');
 const after=(await c.query(heldQuery)).rows;if(digest(after)!==digest(held))throw new Error('Historical holds changed');
 if(digest((await c.query("SELECT p.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies p ON p.id=h.policy_id WHERE h.data_mode='simulated'")).rows)!==digest(budgets))throw new Error('Budget policy changed');
 const receipt={stage:181,status:'bootstrap_headroom_restored',at:new Date().toISOString(),operator:'server_operator/carzygod',scope:'unpublished bootstrap policy in simulated deployment mode',before_policy_id:policy.id,after_policy_id:next.id,before:{actor_slots:2,verification_slots:2},after:{actor_slots:4,verification_slots:4},historical_unknown_holds:2,historical_holds_sha256:digest(held),historical_holds_unchanged:true,budget_policy_unchanged:true,other_limits_unchanged:true,admin_policy_overridden:false,reason};
 // Pre-create the reviewable receipt before committing the bounded head update.
 await writeFile(receiptPath.replace('.sanitized.json','-prepared.sanitized.json'),JSON.stringify({...receipt,status:'prepared'},null,2)+'\n',{flag:'wx',mode:0o600});
 await c.query('COMMIT');await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
}catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
WM_HEADROOM_JS
