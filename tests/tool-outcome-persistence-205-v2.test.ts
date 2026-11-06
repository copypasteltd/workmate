import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {isolatedTestEnvironment} from './native-test-environment.js';
import {buildApp} from '../src/server.js';
import {loadConfig} from '../src/config.js';
import {readUnresolvedDeliveryToolNames} from '../src/runtime-tool-feedback.js';
import {readPendingToolOutcomes,publicToolOutcomeSummary} from '../src/tool-outcome-ledger.js';
import {Worker,recoverExpiredCloudTaskLeases} from '../src/worker.js';
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from '../src/runtime.js';
let isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>,s:Awaited<ReturnType<typeof buildApp>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:'test',DEMO_MODE:'true',WORKER_ENABLED:'false',DEV_MAILBOX:'true'}),{worker:false});},{timeout:900000});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
async function call(c:any,method:string,url:string,body?:unknown){
 const r=await s.app.inject({method:method as any,url,headers:{origin:s.db.config.WEB_ORIGIN,'idempotency-key':randomUUID(),...(c?{cookie:c.cookie,'x-csrf-token':c.csrf}:{}),...(body===undefined?{}:{'content-type':'application/json'})},payload:body===undefined?undefined:JSON.stringify(body)});
 assert.ok([200,201,202].includes(r.statusCode),r.body);return {data:r.json(),r};
}
async function fixture(){
 const a=(await call(null,'POST','/v1/auth/challenge',{email:`lease-${randomUUID()}@example.invalid`})).data;
 const mail=JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${a.challenge_id}.json`,'utf8'));
 const v=await call(null,'POST','/v1/auth/verify',{challenge_id:a.challenge_id,code:mail.text.match(/\b\d{6}\b/)[0]});
 const c={id:v.data.user.id,cookie:v.r.cookies[0].name+'='+v.r.cookies[0].value,csrf:v.data.csrf_token};
 const w=(await call(c,'POST','/v1/tenants',{name:'Independent lease fixture',project_name:'Controlled work'})).data;
 await s.db.control.query('UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1',[w.tenant.id]);
 const task=(await call(c,'POST',`/v1/tenants/${w.tenant.id}/projects/${w.project.id}/delegations`,{title:'Lease boundary',prompt:'Produce a controlled retained text file.',mode:'execute',budget_micros:1000000,client_message_id:randomUUID()})).data.task;
 return {c,tenant:w.tenant.id,project:w.project.id,task};
}
const row=async(id:string)=>(await s.db.control.query('SELECT t.*,public.task_live_lease_until(t)>clock_timestamp() AS live FROM tasks t WHERE id=$1',[id])).rows[0];
class ControlledRuntime extends CodexRuntimeAdapter {
 constructor(private runCase:(ctx:RuntimeContext)=>Promise<void>){super(s.db.config);}
 override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
  await ctx.onEvent('runtime.thread',{thread_id:'lease-'+ctx.taskId});await ctx.onEvent('runtime.turn',{turn_id:'turn-'+ctx.taskId});
  await this.runCase(ctx);return {text:'Controlled lease fixture',inputTokens:100,outputTokens:50,usageKnown:true,accepted:true,thread:'lease-'+ctx.taskId,turn:'turn-'+ctx.taskId,status:'completed'};
 }
}

const body=(ref:string,extra:any={})=>({outcome_version:2,tool:'chart_render',call_ref:ref,arguments_sha256:'d'.repeat(64),failure_ref:ref,code:'TOOL_INPUT_INVALID',category:'validation',operation_outcome:'not_performed',can_correct_arguments:true,...extra});
const emit=(f:any,kind:string,b:any)=>s.db.control.query('INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,$3,$4)',[f.tenant,f.task.id,kind,b]);
const pending=(f:any)=>s.db.tx(tx=>readPendingToolOutcomes(tx,f.tenant,f.task.id),f.tenant,false,f.c.id);
test('actual PostgreSQL keeps separate calls; only exact linked correction resolves its own obligation',async()=>{const f=await fixture(),a='a'.repeat(16),b='b'.repeat(16);await emit(f,'runtime.tool.failed',body(a));await emit(f,'runtime.tool.failed',body(b));await emit(f,'runtime.tool.completed',body('c'.repeat(16)));assert.equal((await pending(f)).length,2);await emit(f,'runtime.tool.completed',body('e'.repeat(16),{repair_of:a}));assert.deepEqual((await pending(f)).map(p=>p.failure_ref),[b]);});
test('activity pruning cannot erase durable unresolved delivery or its public summary',async()=>{const f=await fixture();await emit(f,'runtime.tool.failed',body('a'.repeat(16)));await s.db.control.query("DELETE FROM task_events WHERE task_id=$1 AND kind='runtime.tool.failed'",[f.task.id]);assert.equal((await pending(f)).length,1);const summary=await s.db.tx(tx=>publicToolOutcomeSummary(tx,f.tenant,f.task.id),f.tenant,false,f.c.id);assert.equal(summary.total,1);assert.equal(summary.items.length,1);assert.ok(!JSON.stringify(summary).includes('arguments_sha256'));});
test('failed corrective call preserves root and unknown outcome cannot later be linked to an alleged success',async()=>{const f=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await emit(f,'runtime.tool.failed',body('b'.repeat(16),{repair_of:root,failure_ref:root,operation_outcome:'unverified',can_correct_arguments:false,code:'TOOL_EXECUTION_FAILED'}));assert.equal((await pending(f)).length,1);await assert.rejects(emit(f,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root})));assert.equal((await pending(f))[0].operation_outcome,'unverified');});
test('another tool and another task cannot claim the pending reference',async()=>{const f=await fixture(),other=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await assert.rejects(emit(f,'runtime.tool.completed',body('b'.repeat(16),{tool:'deliver_text',repair_of:root})));await assert.rejects(emit(other,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root})));assert.equal((await pending(f)).length,1);assert.equal((await pending(other)).length,0);});
test('RLS denies other tenant and task API preserves current authorization and private summary',async()=>{const f=await fixture(),other=await fixture();await emit(f,'runtime.tool.failed',body('a'.repeat(16)));const hidden=await s.db.tx(tx=>readPendingToolOutcomes(tx,f.tenant,f.task.id),other.tenant,false,other.c.id);assert.deepEqual(hidden,[]);const own=await call(f.c,'GET',`/v1/tenants/${f.tenant}/projects/${f.project}/tasks/${f.task.id}`);assert.equal(own.data.tool_outcomes.total,1);const denied=await s.app.inject({method:'GET',url:`/v1/tenants/${f.tenant}/projects/${f.project}/tasks/${f.task.id}`,headers:{cookie:other.c.cookie}});assert.ok([403,404].includes(denied.statusCode));});
test('canonical worker does not turn a failed chart into success when an unrelated chart completes; actual partial file and usage remain',async()=>{const f=await fixture();const runtime=new ControlledRuntime(async ctx=>{assert.deepEqual(ctx.pendingToolOutcomes,[]);await ctx.onEvent('runtime.tool.failed',body('a'.repeat(16)));await ctx.onEvent('runtime.tool.completed',body('b'.repeat(16)));const tool=ctx.tools.find(t=>t.name==='deliver_text');assert.ok(tool);await tool.run({filename:'partial.txt',content:'Actual retained partial result',mime_type:'text/plain'},'205-partial');});await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,f.task.id);const done=await row(f.task.id);assert.equal(done.status,'failed');assert.equal(done.error_code,'TOOL_DELIVERY_INCOMPLETE');assert.equal(Number(done.input_tokens),100);assert.equal(Number(done.output_tokens),50);assert.equal(Number(done.budget_micros),1000000);assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",[f.task.id])).rows[0].n,1);});

test('rejected correction diagnostics do not create extra output obligations in PostgreSQL',async()=>{const f=await fixture(),root='a'.repeat(16);await emit(f,'runtime.tool.failed',body(root));await emit(f,'runtime.tool.repair_rejected',{...body('b'.repeat(16)),code:'TOOL_RECOVERY_NOT_ALLOWED'});assert.deepEqual((await pending(f)).map(p=>p.failure_ref),[root]);await emit(f,'runtime.tool.completed',body('c'.repeat(16),{repair_of:root}));assert.equal((await pending(f)).length,0);});
