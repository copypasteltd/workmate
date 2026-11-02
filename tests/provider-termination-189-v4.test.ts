import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {s,a,fixture,evidence,registerEvidence,submit,decision,call,ok,root,admin,publish} from './provider-termination-fixture-189-v2.js';
import {providerEvidenceCost} from '../src/provider-admin-reconciliation.js';
import {taskProviderBudgetReceipt} from '../src/provider-budgets.js';

// The source suite established this explicit paid counting policy in an earlier
// test. Establish it independently here through its actual audited publication.
before(async()=>{await publish();});

function termination(r:any){
 const usage=r.channel==='input_count'?{kind:'input_count'}:{kind:r.request_class};
 return {schema_version:1,data_mode:r.data_mode,operation_id:r.operation_id,request_hash:r.request_hash,provider_reference:'Simulated terminal provider response',source_reference:'Owned synthetic request termination observation',source_note:'Explicit simulated termination evidence; no invoice or usage quantity has been established.',observed_at:new Date().toISOString(),terminated:true,currency:'HKD',purpose:'termination_only',billed_micros:null,usage,outcome:'failed'};
}
const command=(r:any,id:string,action='ai.capacity.release')=>({action,channel:r.channel,request_id:r.id,evidence_id:id,reason:'Review explicit termination while retaining every unknown financial fact'});

for(const [name,options] of [['text',{}],['image',{image:true}],['input_count',{countOnly:true}]] as const){
 test(`${name}: termination evidence without an invoice releases capacity only after the actual independent approval`,async()=>{
  const f=await fixture(options),document=termination(f.row),id=await registerEvidence(f,document);
  const stored=ok(await call(a,'GET',root+'/evidence/'+id));
  assert.equal(stored.document.purpose,'termination_only');assert.equal(stored.document.billed_micros,null);
  assert.deepEqual(Object.keys(stored.document.usage),['kind']);
  assert.throws(()=>providerEvidenceCost(f.row,document),(e:any)=>e.code==='PROVIDER_COST_UNKNOWN');
  const cost=await call(a,'POST',root+'/previews',command(f.row,id,'ai.cost.reconcile'));
  assert.equal(cost.status,409);assert.equal(cost.data.error.code,'PROVIDER_COST_UNKNOWN');
  const before=(await s.db.control.query('SELECT ai_budget_used(envelope_id,platform_period_id)::text AS used FROM ai_request_budget_allocations WHERE '+(f.row.channel==='generation'?'provider_request_id':'count_request_id')+'=$1',[f.row.id])).rows[0];
  const op=await submit(command(f.row,id));assert.equal(op.op.state,'pending_approval');
  assert.equal((await decision(op.op,a)).status,403);
  ok(await decision(op.op),202);
  const row=(await s.db.control.query('SELECT * FROM current_ai_provider_requests WHERE channel=$1 AND id=$2',[f.row.channel,f.row.id])).rows[0];
  assert.equal(row.state,'unknown');assert.equal(row.usage_known,false);assert.equal(row.cost_state,'unknown');assert.equal(row.capacity_held,false);
  const after=(await s.db.control.query('SELECT ai_budget_used(envelope_id,platform_period_id)::text AS used FROM ai_request_budget_allocations WHERE '+(f.row.channel==='generation'?'provider_request_id':'count_request_id')+'=$1',[f.row.id])).rows[0];
  assert.equal(after.used,before.used);
  const receipt=await s.db.tx(tx=>taskProviderBudgetReceipt(tx,f.task.id),undefined,true);assert.equal(receipt.uncertain,name!=='input_count');assert.ok(BigInt(after.used)>0n);if(name==='input_count'){assert.equal(receipt.requests,0);assert.equal(receipt.knownChargeMicros,0);}
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,0);
  const actualUsage=name==='image'?{kind:'image',image_units:1}:name==='input_count'?{kind:'input_count',counted_input_tokens:100}:{kind:'text',input_tokens:100,output_tokens:11};
  const costEvidence=await registerEvidence(f,evidence(f.row,actualUsage));
  const confirmation=await submit(command(f.row,costEvidence,'ai.cost.reconcile'));ok(await decision(confirmation.op),202);
  const reconciled=(await s.db.control.query('SELECT state,cost_state,capacity_held FROM current_ai_provider_requests WHERE channel=$1 AND id=$2',[f.row.channel,f.row.id])).rows[0];
  assert.equal(reconciled.state,'unknown');assert.equal(reconciled.cost_state,'manually_confirmed');assert.equal(reconciled.capacity_held,false);
 });
}

test('termination-only proof still rejects changed identity, future observations, invented quantity and zero invoice substitution',async()=>{
 const f=await fixture(),document=termination(f.row);
 for(const patch of [{request_hash:'0'.repeat(64)},{observed_at:new Date(Date.now()+60000).toISOString()},{usage:{kind:'text',input_tokens:0,output_tokens:0}},{billed_micros:'0'}]){
  const result=await call(a,'POST',`${root}/requests/generation/${f.row.id}/evidence`,{document:{...document,...patch},reason:'Reject invalid termination statement'});
  assert.ok([400,422].includes(result.status),JSON.stringify(result.data));
 }
});

test('highest administrator directly releases an evidenced terminated request with immutable audit and unknown cost retained',async()=>{
 const f=await fixture({image:true}),highest=await admin(undefined,'global',null,true),document=termination(f.row);
 const evidenceOp=ok(await call(highest,'POST',`${root}/requests/generation/${f.row.id}/evidence`,{document,reason:'Direct highest-admin termination evidence'}),202);
 const released=await submit(command(f.row,evidenceOp.result_ids[0]),highest);assert.equal(released.op.state,'succeeded');
 const row=(await s.db.control.query('SELECT state,cost_state,capacity_held,termination_confirmation_id FROM current_ai_provider_requests WHERE id=$1',[f.row.id])).rows[0];
 assert.equal(row.state,'unknown');assert.equal(row.cost_state,'unknown');assert.equal(row.capacity_held,false);assert.ok(row.termination_confirmation_id);
 const audit=(await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE target=$1 AND action='admin.ai.capacity.release'",[released.op.id])).rows[0];
 assert.ok(audit.n>=1);
});
