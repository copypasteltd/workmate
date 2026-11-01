#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/model-tool-contract-181-v3/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_RECEIPT'
import pg from 'pg';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{
 const id='b8c8c28a-1df1-4ef7-af55-91d9d51b4bcc';
 const v=(await c.query('SELECT id,release_id,state,result,finished_at FROM capability_validations WHERE id=$1',[id])).rows[0];assert.equal(v.state,'passed');
 const requests=(await c.query(`SELECT g.id,g.state,g.usage_known,g.http_status,g.input_tokens,g.output_tokens,g.known_charge_micros,g.request_bytes,a.input_bound_mode,a.input_tokens_bound,a.max_output_tokens,c.counted_input_tokens FROM ai_gateway_requests g JOIN ai_request_budget_allocations a ON a.provider_request_id=g.id JOIN ai_input_count_requests c ON c.id=a.input_count_id WHERE g.validation_id=$1 ORDER BY g.created_at,g.id`,[id])).rows;
 assert.equal(requests.length,2);for(const r of requests){assert.equal(r.state,'completed');assert.equal(r.usage_known,true);assert.equal(r.http_status,200);assert.equal(r.input_bound_mode,'serialized_ceiling');assert.ok(BigInt(r.input_tokens)<=BigInt(r.input_tokens_bound));assert.ok(BigInt(r.output_tokens)<=BigInt(r.max_output_tokens));}
 assert.equal(requests.reduce((n,r)=>n+Number(r.input_tokens),0),v.result.input_tokens);assert.equal(requests.reduce((n,r)=>n+Number(r.output_tokens),0),v.result.output_tokens);
 assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_request_budget_violations x JOIN ai_gateway_requests g ON g.id=x.provider_request_id WHERE g.validation_id=$1',[id])).rows[0].n,0);
 const held=(await c.query("SELECT id,state,cost_state,capacity_held FROM current_ai_provider_requests WHERE id=ANY($1::uuid[]) ORDER BY id",[['ac175832-67a7-4c5f-8c89-5ec3c0beaf85','e8f0473b-4e81-4358-b60d-1472447da917']])).rows;assert.equal(held.length,2);assert.ok(held.every(r=>r.state==='unknown'&&r.cost_state==='unknown'&&r.capacity_held));
 const oldViolation=(await c.query("SELECT x.code,g.input_tokens,g.output_tokens,g.known_charge_micros FROM ai_request_budget_violations x JOIN ai_gateway_requests g ON g.id=x.provider_request_id WHERE g.validation_id='5efb8dc8-7efb-4edb-867a-d7f88def6f5b'")).rows;assert.equal(oldViolation.length,1);assert.equal(oldViolation[0].code,'INPUT_COUNT_MISMATCH');
 const connection=(await c.query('SELECT base_url FROM capability_model_connections WHERE release_id=$1',[v.release_id])).rows[0];assert.equal(connection.base_url,'http://43.160.221.28:9841/v1');
 const receipt={stage:181,status:'real_model_accounting_verified',at:new Date().toISOString(),validation:v,requests,external_upstream:connection.base_url,current_validation_violations:0,historical_unknown_holds:held,historical_count_violation:oldViolation,business_data_context:'simulated',validation_transport:'actual saved external model connection',credentials_printed:false};
 await writeFile('/root/cfg/workmate/model-accounting-181.sanitized.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
}finally{await c.end();}
WM_RECEIPT
