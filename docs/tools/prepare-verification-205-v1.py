from pathlib import Path
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';W=R/'dev/copypaste-web';N=R/'dev/copypaste-desktop';L=R/'dev/copypaste-delivery'
fixture=(P/'tests/runtime-feedback-fixture-204-v1.ts').read_text('utf-8')
fixture=fixture.replace('validSecond?: boolean','validSecond?: boolean; repairSecond?: boolean')
fixture=fixture.replace('arguments: JSON.stringify({ title:', 'arguments: JSON.stringify({ ...(options.repairSecond && calls.length>1 ? { _workmate_repair_of: lastReference(body.input) } : {}), title:')
fixture=fixture.replace('export async function fixture(','''function lastReference(input: unknown): string | undefined {
 let found: string | undefined;
 const visit=(value: any)=>{if(typeof value==='string'){try{visit(JSON.parse(value));}catch{}}else if(value&&typeof value==='object'){
  if(typeof value.error?.failure_ref==='string')found=value.error.failure_ref;
  for(const child of Object.values(value))visit(child);
 }};visit(input);return found;
}
export async function fixture(''')
(P/'tests/runtime-feedback-fixture-205-v1.ts').write_text(fixture,'utf-8')
native='''import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CodexRuntimeAdapter} from '../src/runtime.js';
import {parseToolArguments} from '../src/runtime-tool-feedback.js';
import {fixture} from './runtime-feedback-fixture-205-v1.js';
const schema=z.object({title:z.string().refine(s=>!/[0-9]/.test(s),'PRIVATE_VALIDATOR')}).strict();
for(const repairSecond of [false,true])test(`actual pinned Codex ${repairSecond?'explicitly repairs original call':'independent output retains prior failure'} without changing usage`,{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true,toolCount:2,validSecond:true,repairSecond});let writes=0;
 try{f.context.tools[0].run=async args=>{const v=parseToolArguments(schema,args);writes++;return {delivered:v.title};};
  const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(r.status,repairSecond?'completed':'failed');assert.equal(writes,1);assert.equal(r.inputTokens,51);assert.equal(r.outputTokens,15);assert.equal(r.usageKnown,true);
  const failure=f.events.find(e=>e.kind==='runtime.tool.failed')!.body;
  assert.equal(failure.outcome_version,2);assert.equal(failure.failure_ref,failure.call_ref);
  const recovered=f.events.find(e=>e.kind==='runtime.tool.recovered');assert.equal(!!recovered,repairSecond);
  if(recovered)assert.equal(recovered.body.repair_of,failure.failure_ref);
  assert.ok(!JSON.stringify(f.inputs).includes('PRIVATE_VALIDATOR'));
 }finally{await f.close();}
});
test('actual native duplicate unknown operation is rejected before the handler, with known provider usage retained',{timeout:120000},async t=>{
 const f=await fixture(t,{tool:true,toolCount:2});let effects=0;
 try{f.context.tools[0].run=async()=>{effects++;throw Error('PRIVATE_UNKNOWN');};const r=await new CodexRuntimeAdapter(f.config).start(f.context);
  assert.equal(effects,1);assert.equal(r.status,'failed');assert.equal(r.usageKnown,true);assert.equal(r.inputTokens,51);
  assert.ok(f.events.some(e=>e.kind==='runtime.tool.failed'&&e.body.code==='TOOL_RECOVERY_NOT_ALLOWED'));assert.ok(!JSON.stringify(f.inputs).includes('PRIVATE_UNKNOWN'));
 }finally{await f.close();}
});
test('actual native inherits two separate same-tool obligations and cannot clear either with final prose',{timeout:120000},async t=>{
 const f=await fixture(t,{});try{f.context.pendingToolOutcomes=['a','b'].map(c=>({tool:'chart_render',failure_ref:c.repeat(16),call_ref:c.repeat(16),arguments_sha256:c.repeat(64),code:'TOOL_INPUT_INVALID',category:'validation' as const,operation_outcome:'not_performed' as const,can_correct_arguments:true}));
 const r=await new CodexRuntimeAdapter(f.config).start(f.context);assert.equal(r.status,'failed');assert.equal(r.errorCode,'TOOL_DELIVERY_INCOMPLETE');assert.equal(r.usageKnown,true);
 }finally{await f.close();}
});
'''
(P/'tests/runtime-feedback-native-205-v1.test.ts').write_text(native,'utf-8')
unit='''import {test} from 'node:test';import assert from 'node:assert/strict';
import {RuntimeToolLedger,recoveryToolSchema,repairArgument,ToolRecoveryFailure,assertDeliveredToolResult,outcomeFeedback} from '../src/tool-outcome-ledger.js';
import {canonical,hash} from '../src/lib.js';import {safeToolFeedback,ToolInputFailure} from '../src/runtime-tool-feedback.js';
const tool={name:'chart_render',inputSchema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}};
const correctable=safeToolFeedback(new ToolInputFailure([{code:'custom',path:['title'],message:'PRIVATE'}]),tool);
test('two same-tool failures remain distinct; an independent successful output clears neither',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);s.fail('chart_render','b'.repeat(16),'b'.repeat(64),correctable);s.complete('chart_render');assert.equal(s.outstanding.length,2);s.complete('chart_render','a'.repeat(16));assert.deepEqual(s.outstanding.map(p=>p.failure_ref),['b'.repeat(16)]);});
test('correction strips only top-level reserved metadata, preserving the exact business payload and digest',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);const args={title:'Corrected',nested:{[repairArgument]:'customer nested content'}};const p=s.prepare('chart_render',{...args,[repairArgument]:'a'.repeat(16)});assert.deepEqual(p.args,args);assert.equal(p.arguments_sha256,hash(canonical(args)));assert.equal(p.repair,'a'.repeat(16));});
test('failed correction remains one obligation and may become unverified, never automatically replayable',()=>{const s=new RuntimeToolLedger();const root=s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);s.prepare('chart_render',{title:'A',[repairArgument]:root});s.fail('chart_render','b'.repeat(16),hash(canonical({title:'A'})),outcomeFeedback(Error(),tool),root);assert.equal(s.outstanding.length,1);assert.throws(()=>s.prepare('chart_render',{title:'B',[repairArgument]:root}),ToolRecoveryFailure);assert.throws(()=>s.prepare('chart_render',{title:'A'}),ToolRecoveryFailure);});
test('wrong tool, guessed reference, resolved reference and unknown operation never reach a business handler',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);for(const [name,ref] of [['deliver_text','a'.repeat(16)],['chart_render','b'.repeat(16)],['chart_render','bad']])assert.throws(()=>s.prepare(name,{[repairArgument]:ref}),ToolRecoveryFailure);s.complete('chart_render','a'.repeat(16));assert.throws(()=>s.prepare('chart_render',{[repairArgument]:'a'.repeat(16)}),ToolRecoveryFailure);});
test('new native turns retain roots; needs-input waits without marking those roots resolved',()=>{const s=new RuntimeToolLedger();s.fail('chart_render','a'.repeat(16),'a'.repeat(64),correctable);s.complete('request_input');assert.equal(s.unresolvedDelivery,false);assert.equal(s.outstanding.length,1);assert.equal(new RuntimeToolLedger(s.outstanding).unresolvedDelivery,true);});
test('trusted object and union declarations add optional metadata without changing original validators',()=>{const original=structuredClone(tool.inputSchema);const wire:any=recoveryToolSchema(tool.inputSchema);assert.deepEqual(tool.inputSchema,original);assert.ok(wire.properties[repairArgument]);assert.deepEqual(wire.required,['title']);const u:any=recoveryToolSchema({anyOf:[original,original]});assert.ok(u.anyOf.every((n:any)=>n.properties[repairArgument]));assert.throws(()=>recoveryToolSchema({type:'object',properties:{[repairArgument]:{}}}));});
for(const name of ['audio_produce','generated_video_create'])test(`${name} failed, unknown, blocked, pending and empty results cannot be counted as delivered`,()=>{
 const ready:any={state:'completed',delivery_state:'available',usage_state:name==='audio_produce'?'confirmed_company_tariff':'confirmed',kind:'speech',assets:[{kind:'audio'}]};assert.doesNotThrow(()=>assertDeliveredToolResult(name,ready));
 for(const patch of [{state:'failed'},{state:'cancelled'},{state:'unknown'},{delivery_state:'blocked'},{delivery_state:'pending'},{usage_state:'awaiting_confirmation'},{assets:[]},{budget_violation:true}])assert.throws(()=>assertDeliveredToolResult(name,{...ready,...patch}));
});
test('transcription must retain actual transcript and both subtitle formats; raw response is insufficient',()=>{const v={state:'completed',kind:'transcription',delivery_state:'available',usage_state:'confirmed_company_tariff',assets:[{kind:'raw_response'}]};assert.throws(()=>assertDeliveredToolResult('audio_produce',v));assert.doesNotThrow(()=>assertDeliveredToolResult('audio_produce',{...v,assets:['transcript','srt','vtt'].map(kind=>({kind}))}));});
'''
(P/'tests/tool-outcome-ledger-205-v1.test.ts').write_text(unit,'utf-8')
base=(P/'tests/cloud-task-lease-204-v3.test.ts').read_text('utf-8').split("test('worker renews beyond")[0]
base=base.replace("import {Worker,recoverExpiredCloudTaskLeases}","import {readPendingToolOutcomes,publicToolOutcomeSummary} from '../src/tool-outcome-ledger.js';\nimport {Retention} from '../src/retention.js';\nimport {Worker,recoverExpiredCloudTaskLeases}")
# The retention service is exercised by its exact SQL contract; no maintenance of unrelated fixtures.
base=base.replace("import {Retention} from '../src/retention.js';\n",'')
db='''
const body=(ref:string,extra:any={})=>({outcome_version:2,tool:'chart_render',call_ref:ref,arguments_sha256:'d'.repeat(64),failure_ref:ref,code:'TOOL_INPUT_INVALID',category:'validation',operation_outcome:'not_performed',can_correct_arguments:true,...extra});
const emit=(f:any,kind:string,b:any)=>s.db.control.query('INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4)',[f.tenant,f.task.id,kind,b]);
const pending=(f:any)=>s.db.tx(tx=>readPendingToolOutcomes(tx,f.tenant,f.task.id),f.tenant,true,f.c.id);
test('actual PostgreSQL keeps separate calls; only exact linked correction resolves its own obligation',async()=>{const f=await fixture(),a='a'.repeat(16),b='b'.repeat(16);await emit(f,'runtime.tool.failed',body(a));await emit(f,'runtime.tool.failed',body(b));await emit(f,'runtime.tool.completed',body('c'.repeat(16)));assert.equal((await pending(f)).length,2);await emit(f,'runtime.tool.completed',body('e'.repeat(16),{repair_of:a}));assert.deepEqual((await pending(f)).map(p=>p.failure_ref),[b]);});
test('activity pruning cannot erase durable unresolved delivery or its public summary',async()=>{const f=await fixture();await emit(f,'runtime.tool.failed',body('a'.repeat(16)));await s.db.control.query("DELETE FROM task_events WHERE task_id=$1 AND kind='runtime.tool.failed'",[f.task.id]);assert.equal((await pending(f)).length,1);const summary=await s.db.tx(tx=>publicToolOutcomeSummary(tx,f.tenant,f.task.id),f.tenant,true,f.c.id);assert.equal(summary.total,1);assert.equal(summary.items.length,1);assert.ok(!JSON.stringify(summary).includes('arguments_sha256'));});
test('failed corrective call preserves root and unknown outcome cannot later be linked to an alleged success',async()=>{const f=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await emit(f,'runtime.tool.failed',body('b'.repeat(16),{repair_of:root,failure_ref:root,operation_outcome:'unverified',can_correct_arguments:false,code:'TOOL_EXECUTION_FAILED'}));assert.equal((await pending(f)).length,1);await assert.rejects(emit(f,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root})));assert.equal((await pending(f))[0].operation_outcome,'unverified');});
test('another tool and another task cannot claim the pending reference',async()=>{const f=await fixture(),other=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await assert.rejects(emit(f,'runtime.tool.completed',body('b'.repeat(16),{tool:'deliver_text',repair_of:root})));await assert.rejects(emit(other,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root})));assert.equal((await pending(f)).length,1);assert.equal((await pending(other)).length,0);});
test('RLS denies other tenant and task API preserves current authorization and private summary',async()=>{const f=await fixture(),other=await fixture();await emit(f,'runtime.tool.failed',body('a'.repeat(16)));const hidden=await s.db.tx(tx=>readPendingToolOutcomes(tx,f.tenant,f.task.id),other.tenant,true,other.c.id);assert.deepEqual(hidden,[]);const own=await call(f.c,'GET',`/v1/tenants/${f.tenant}/projects/${f.project}/tasks/${f.task.id}`);assert.equal(own.data.tool_outcomes.total,1);const denied=await s.app.inject({method:'GET',url:`/v1/tenants/${f.tenant}/projects/${f.project}/tasks/${f.task.id}`,headers:{cookie:other.c.cookie}});assert.ok([403,404].includes(denied.statusCode));});
test('canonical worker does not turn a failed chart into success when an unrelated chart completes; actual partial file and usage remain',async()=>{const f=await fixture();const runtime=new ControlledRuntime(async ctx=>{assert.deepEqual(ctx.pendingToolOutcomes,[]);await ctx.onEvent('runtime.tool.failed',body('a'.repeat(16)));await ctx.onEvent('runtime.tool.completed',body('b'.repeat(16)));const tool=ctx.tools.find(t=>t.name==='deliver_text');assert.ok(tool);await tool.run({filename:'partial.txt',content:'Actual retained partial result',mime_type:'text/plain'},'205-partial');});await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,f.task.id);const done=await row(f.task.id);assert.equal(done.status,'failed');assert.equal(done.error_code,'TOOL_DELIVERY_INCOMPLETE');assert.equal(Number(done.input_tokens),100);assert.equal(Number(done.output_tokens),50);assert.equal(Number(done.budget_micros),1000000);assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",[f.task.id])).rows[0].n,1);});
'''
(P/'tests/tool-outcome-persistence-205-v1.test.ts').write_text(base+db,'utf-8')
ui='''import {test} from 'node:test';import assert from 'node:assert/strict';import {retainTaskActivity,pendingToolFeedback,toolFeedbackState} from '../src/task-tool-state.js';
const a='a'.repeat(16),b='b'.repeat(16),c='c'.repeat(16);
const fail=(id:number,ref:string)=>({id,kind:'runtime.tool.failed',body:{outcome_version:2,tool:'chart_render',call_ref:ref,failure_ref:ref,code:'TOOL_INPUT_INVALID',category:'validation'}});
const done=(id:number,repair?:string)=>({id,kind:'runtime.tool.completed',body:{outcome_version:2,tool:'chart_render',call_ref:c,...(repair?{repair_of:repair}:{})}});
test('same-tool independent success leaves both specific pending outputs; exact repair clears only its target',()=>{const items=[fail(1,a),fail(2,b),done(3)];assert.equal(pendingToolFeedback(items).length,2);assert.deepEqual(pendingToolFeedback([...items,done(4,a)]).map(f=>f.reference),[b]);});
test('two same-tool failures and their resolving events survive nine hundred streamed deltas',()=>{let items=retainTaskActivity([],[fail(1,a),fail(2,b)]);for(let id=3;id<904;id++)items=retainTaskActivity(items,[{id,kind:'message.appended'}]);assert.equal(pendingToolFeedback(items).length,2);items=retainTaskActivity(items,[done(905,a)]);assert.deepEqual(pendingToolFeedback(items).map(f=>f.reference),[b]);assert.ok(items.length<=528);});
test('authorized summary survives a pruned activity log and excludes stale failed events',()=>{const summary={total:1,as_of_event_id:'100',items:[{tool:'chart_render',failure_ref:b,call_ref:b,code:'TOOL_INPUT_INVALID',category:'validation'}]};assert.deepEqual(toolFeedbackState([fail(1,a)],summary).failures.map(f=>f.reference),[b]);assert.equal(toolFeedbackState([done(101,b)],summary).total,0);});
test('completed plus recovered events count one resolution, preserving hidden pending total',()=>{const summary={total:100,as_of_event_id:'100',items:[]};assert.equal(toolFeedbackState([done(101,a),{...done(102,a),kind:'runtime.tool.recovered'}],summary).total,99);});
test('safe summary contains no raw error or supplied arguments in presentation',()=>{const out=toolFeedbackState([{...fail(1,a),body:{...fail(1,a).body,code:'private customer text',guidance:'PRIVATE',arguments:{key:'SECRET'}}}]);assert.equal(out.failures[0].code,'TOOL_EXECUTION_FAILED');assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('PRIVATE'));});
'''
for repo in [W,N]:(repo/'tests/tool-outcome-state-205-v1.test.ts').write_text(ui,'utf-8')
# Owned native database and packaging use fresh receipts, never alter old runs.
(L/'scripts/owned-native-db-205-v1.mjs').write_text((L/'scripts/owned-native-db-204-v1.mjs').read_text('utf-8').replace('acceptance-204','acceptance-205'),'utf-8')
print('Current unit, actual native Codex, PostgreSQL/worker and client state cases prepared before unified execution.')
