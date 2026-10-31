import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture,published,company,advance,ok,call,s} from "./workflow-native-handoff-fixture-145-v1.js";
const definition={input_schema:{fields:[{key:"release",type:"text",required:true},{key:"dry_run",type:"boolean",required:true}]},
  output_schema:{fields:[{key:"report",type:"text",step_index:0,required:true}]},steps:[{kind:"codex",role_key:"fullstack",prompt:"Write the release checklist using the exact named business inputs.",budget_micros:100000}]};
test("native workflow fixes business values before explicit customer approval and creates only local child work",async()=>{
  const f=await fixture(),p=await published(f,definition),a=await company(f,"workflow_run",{workflow_id:p.workflow_id,version:p.version,definition_hash:p.definition_hash,inputs:{release:"October",dry_run:false}}),
    url=f.root.url+"/workflow-runs/"+a.run.id;
  assert.deepEqual(a.run.input_values,{release:"October",dry_run:false});assert.match(a.run.input_hash,/^[a-f0-9]{64}$/);
  const decision={expected_revision:a.run.revision,stage:"launch",decision:"approve",definition_hash:p.definition_hash};
  assert.equal((await call(s,f.c,"POST",url+"/decision",decision)).status,409);
  const accepted=await ok(s,f.c,"POST",url+"/decision",{...decision,input_hash:a.run.input_hash});
  const step=await advance(f,{...a,url,run:accepted.run});assert.equal(step.action,"codex");
  const child=(await s.db.control.query("SELECT * FROM tasks WHERE id=$1",[step.child.task_id])).rows[0];
  assert.equal(child.execution_location,"desktop");assert.equal(child.cloud_workflow_run_id,null);
  assert.deepEqual(child.input_context.workflow_binding.values,{release:"October",dry_run:false});assert.equal(child.input_context.workflow_binding.run_id,a.run.id);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1",[child.id])).rows[0].n,0);
});
test("native workflow required and typed inputs are validated without changing a saved version",async()=>{
  const f=await fixture(),p=await published(f,definition);
  for(const inputs of [{},{release:"October",dry_run:"false"},{release:"October",dry_run:false,extra:"ignored?"}])
    await assert.rejects(company(f,"workflow_run",{workflow_id:p.workflow_id,version:p.version,definition_hash:p.definition_hash,inputs}));
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM workflow_runs WHERE origin_task_id=$1",[f.root.task.task_id])).rows[0].n,0);
});
