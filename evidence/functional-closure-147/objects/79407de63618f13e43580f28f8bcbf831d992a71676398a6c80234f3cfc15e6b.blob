import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { nativeVideoFixture, videoActor, type VideoClient } from "./desktop-video-fixture.js";
import { advanceAgentGroups } from "../src/agent-groups.js";
import { hash } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, calls=0;
const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(Buffer.from(c));const b=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(req.headers.authorization,"Bearer synthetic-native-team");assert.equal(b.model,"team-synthetic");
  if(req.url==="/v1/responses/input_tokens"){res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({input_tokens:10}));return;}
  assert.equal(req.url,"/v1/responses");calls++;
  res.writeHead(200,{"Content-Type":"text/event-stream"});
  const emit=(type:string,data:any)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  const item={type:"message",id:"msg_team_"+calls,role:"assistant",status:"completed",content:[{type:"output_text",text:"Clearly synthetic team output",annotations:[]}]};
  emit("response.created",{response:{id:"resp_team_"+calls,status:"in_progress",output:[]}});
  emit("response.output_item.done",{item});emit("response.completed",{response:{id:"resp_team_"+calls,status:"completed",output:[item],usage:{input_tokens:10,output_tokens:20}}});res.end();
});
before(async()=>{
  await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));isolated=await isolatedTestEnvironment();
  s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",EXTENSION_ID:"a".repeat(32),
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"synthetic-native-team",AI_MODEL:"team-synthetic",AI_VERIFIED:"true",
    AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000",AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SCOPE_TTL_MS:"300000"}),{worker:false});
});
after(async()=>{try{await s?.app.close();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}finally{await isolated?.cleanup();}});
async function call(c:VideoClient,tenant:string,method:string,url:string,body?:unknown,key:string=randomUUID()){
  const raw=await s.app.inject({method:method as any,url,headers:{"x-tenant-id":tenant,"idempotency-key":key,
    ...(c.access_token?{authorization:"Bearer "+c.access_token}:{cookie:c.cookie!,"x-csrf-token":c.csrf!}),
    ...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{payload:JSON.stringify(body)})});
  return {status:raw.statusCode,data:raw.headers["content-type"]?.includes("application/json")?raw.json():raw.rawPayload,raw};
}
async function fixture(){
  const f=await nativeVideoFixture(s),agents=[];
  const ok=async(method:string,url:string,b?:unknown,key?:string)=>{const r=await call(f.c,f.tenant,method,url,b,key);assert.ok(r.status>=200 && r.status<300,JSON.stringify(r.data));return r.data;};
  for(const [i,name] of ["Coordinator","Code author","Copy author","Reviewer"].entries())agents.push(await ok("POST",f.base+"/agents",{
    name,role_key:i===1?"fullstack":"assistant",instructions:"Explicit synthetic native team fixture. Read actual predecessor results using group_results."}));
  const group=await ok("POST","/v1/agent-groups",{project_id:f.project,name:"Local delivery team",coordinator_agent_id:agents[0].id,
    members:agents.slice(1).map(a=>({agent_id:a.id,role_description:"Deliver one approved local assignment"}))});
  const root=`/v1/agent-groups/${group.id}`,url=root+"/native";
  const plan={expected_version:group.version,brief:"Synthetic parallel native work with a dependent review and final coordination",max_parallelism:2,coordinator_budget_micros:100000,
    nodes:agents.slice(1).map((a,i)=>({key:["code","copy","review"][i],agent_id:a.id,title:a.name,prompt:"Deliver the approved synthetic "+a.name,
      depends_on:i===2?["code","copy"]:[],budget_micros:100000}))};
  const preflight=()=>ok("POST",url+"/preflight",{plan,binding:f.fields});
  const approval=(p:any)=>({preflight_id:p.id,expected_version:p.version,definition_hash:p.definition_hash,approved_budget_micros:p.approved_budget_micros,confirm:true,binding:f.fields});
  const create=async()=>ok("POST",url+"/runs",approval(await preflight()));
  const get=async(id:string)=>ok("GET",url+"/runs/"+id);
  const advance=async(id:string)=>{const {run}=await get(id);return ok("POST",url+"/runs/"+id+"/advance",{expected_revision:run.revision,binding:f.fields});};
  return {...f,agents,group,root,url,plan,ok,preflight,approval,create,get,advance};
}
type F=Awaited<ReturnType<typeof fixture>>;
async function finish(f:F,a:any,status="completed"){
  const url=f.base+"/desktop-executions/"+a.task_id;
  const started=await f.ok("POST",url+"/start",a.fields);
  if(status==="completed"){
    const inferred=await s.app.inject({method:"POST",url:"/v1/desktop-inference/v1/responses",headers:{authorization:"Bearer "+started.credential.token},
      payload:{model:"team-synthetic",reasoning:{effort:"max"},stream:true,store:false,input:[{role:"user",content:"Synthetic native team usage fixture"}],tools:[],max_output_tokens:32}});
    assert.equal(inferred.statusCode,200,inferred.body);assert.match(inferred.body,/response.completed/);
  }
  return {started,receipt:await f.ok("POST",url+"/finish",{status,output:status==="completed"?"Exact synthetic "+a.step_key+" output":"",thread_id:"thread_"+a.step_key,turn_id:"turn_"+a.step_key})};
}
test("native review is free, exact-device approval is idempotent, and cloud history remains separate",async()=>{
  const f=await fixture(),p=await f.preflight();assert.equal(p.execution_location,"desktop");assert.equal(p.funds_reserved_micros,0);assert.equal(p.definition.nodes[0].role_key,"fullstack");
  assert.equal((await s.db.control.query("SELECT count(*) AS n FROM tasks WHERE tenant_id=$1",[f.tenant])).rows[0].n,"0");
  assert.equal((await call(f.web,f.tenant,"POST",f.url+"/preflight",{plan:f.plan,binding:f.fields})).status,403);
  assert.equal((await call(f.c,f.tenant,"POST",f.url+"/runs",{...f.approval(p),approved_budget_micros:p.approved_budget_micros+1})).status,409);
  assert.equal((await call(f.c,f.tenant,"POST",f.url+"/runs",{...f.approval(p),binding:{...f.fields,device_id:randomUUID()}})).status,409);
  const key=randomUUID(),a=await f.ok("POST",f.url+"/runs",f.approval(p),key),b=await f.ok("POST",f.url+"/runs",f.approval(p),key);
  assert.equal(a.run.id,b.run.id);assert.equal(a.run.tasks.length,1);assert.equal(a.run.tasks[0].status,"paused");assert.equal(a.run.reserved_micros,100000);
  assert.equal((await call(f.c,f.tenant,"POST",f.base+"/desktop-executions/"+a.run.tasks[0].id+"/start",f.fields)).status,409);
  assert.equal((await call(f.c,f.tenant,"POST",f.url+"/runs",f.approval(p))).status,409);
  assert.equal((await f.ok("GET",f.root+"/runs")).items.length,0);assert.equal((await f.ok("GET",f.url+"/runs")).items.length,1);
  await f.ok("POST",f.url+"/runs/"+a.run.id+"/cancel",{expected_revision:a.run.revision});
});
test("two native members run before their dependent reviewer; local coordinator sees actual results and the complete ZIP extracts all four outputs",async()=>{
  const f=await fixture(),created=await f.create(),id=created.run.id,first=await f.advance(id);
  assert.equal(first.run.state,"running",JSON.stringify(first.run));assert.equal(first.assignments.length,2);assert.deepEqual(new Set(first.assignments.map((a:any)=>a.step_key)),new Set(["code","copy"]));
  assert.equal(new Set(first.assignments.map((a:any)=>a.fields.local_session_id)).size,2);
  assert.ok(first.assignments.every((a:any)=>a.fields.device_id===f.fields.device_id && a.fields.local_session_id!==f.fields.local_session_id));
  await advanceAgentGroups(s.db,s.catalog);assert.equal((await f.get(id)).run.tasks.length,3);
  await finish(f,first.assignments[0]);let next=await f.advance(id);assert.equal(next.assignments.length,1);assert.equal(next.assignments[0].step_key,"copy");
  await finish(f,first.assignments[1]);next=await f.advance(id);assert.equal(next.assignments.length,1);assert.equal(next.assignments[0].step_key,"review");
  const review=await finish(f,next.assignments[0]);assert.ok(review.started.company_tools.some((t:any)=>t.name==="group_results"));
  next=await f.advance(id);assert.equal(next.assignments[0].step_key,"coordinator");assert.equal(next.assignments[0].fields.local_session_id,f.fields.local_session_id);
  const coordinator=next.assignments[0],started=await f.ok("POST",f.base+"/desktop-executions/"+coordinator.task_id+"/start",coordinator.fields);
  const results=await f.ok("POST",f.base+"/desktop-executions/"+coordinator.task_id+"/tools",{tool:"group_results",arguments:{},call_id:"group_results_fixture",thread_id:"native_team_coordinator",turn_id:"native_team_turn"});
  assert.match(JSON.stringify(results),/Exact synthetic code output/);assert.match(JSON.stringify(results),/Exact synthetic review output/);
  const infer=await s.app.inject({method:"POST",url:"/v1/desktop-inference/v1/responses",headers:{authorization:"Bearer "+started.credential.token},payload:{model:"team-synthetic",reasoning:{effort:"max"},stream:true,store:false,input:[{role:"user",content:"Synthetic coordination"}],tools:[],max_output_tokens:32}});assert.equal(infer.statusCode,200);
  await f.ok("POST",f.base+"/desktop-executions/"+coordinator.task_id+"/finish",{status:"completed",output:"Exact synthetic coordinator output",thread_id:"native_team_coordinator",turn_id:"native_team_turn"});
  const done=await f.advance(id);assert.equal(done.run.state,"succeeded");assert.equal(done.run.charged_micros,120);assert.equal(done.run.reserved_micros,0);
  const beforeCalls=calls,delivery=await f.ok("GET",f.url+"/runs/"+id+"/delivery");assert.equal(delivery.file_count,4);assert.equal(delivery.complete_team,true);
  assert.equal((await call(f.c,f.tenant,"GET",f.url+"/runs/"+id+"/download?expected_revision="+done.run.revision+"&expected_delivery_hash="+"f".repeat(64))).status,409);
  const zip=await call(f.c,f.tenant,"GET",f.url+"/runs/"+id+"/download?expected_revision="+done.run.revision+"&expected_delivery_hash="+delivery.delivery_hash);
  assert.equal(zip.status,200,JSON.stringify(zip.data));assert.equal(zip.raw.headers["x-content-sha256"],hash(zip.raw.rawPayload));
  const entries=unzipSync(zip.raw.rawPayload);for(const [step,prefix] of [["code","members/code"],["copy","members/copy"],["review","members/review"],["coordinator","coordinator"]])
    assert.equal(Buffer.from(entries[prefix+"/result.md"]).toString(),"Exact synthetic "+step+" output");
  assert.match(Buffer.from(entries["README.md"]).toString(),/Local team delivery/);assert.equal(calls,beforeCalls);
  const tasks=(await s.db.control.query("SELECT id,execution_location FROM tasks WHERE agent_group_run_id=$1",[id])).rows;
  assert.ok(tasks.every(t=>t.execution_location==="desktop"));
  assert.equal((await s.db.control.query("SELECT count(*) AS n FROM outbox WHERE payload->>'task_id'=ANY($1::text[])",[tasks.map(t=>t.id)])).rows[0].n,"0");
});
test("prepared member credentials cannot migrate to another folder or session and SQL freezes native bindings",async()=>{
  const f=await fixture(),{run}=await f.create(),step=(await f.advance(run.id)).assignments[0];
  assert.equal((await call(f.c,f.tenant,"POST",f.base+"/desktop-executions/"+step.task_id+"/start",{...step.fields,workspace_hash:"d".repeat(64)})).status,409);
  assert.equal((await call(f.c,f.tenant,"POST",f.base+"/desktop-executions/"+step.task_id+"/start",{...step.fields,local_session_id:randomUUID()})).status,409);
  await assert.rejects(s.db.control.query("UPDATE desktop_executions SET workspace_hash=$2 WHERE task_id=$1",[step.task_id,"d".repeat(64)]));
  await assert.rejects(s.db.control.query("UPDATE agent_group_runs SET native_binding=jsonb_set(native_binding,'{device_id}',to_jsonb($2::text)) WHERE id=$1",[run.id,randomUUID()]));
  const current=await f.get(run.id);await f.ok("POST",f.url+"/runs/"+run.id+"/cancel",{expected_revision:current.run.revision});
});
test("private history and execution admission deny another native actor",async()=>{
  const f=await fixture(),{run}=await f.create(),other=await videoActor(s);
  assert.ok([403,404].includes((await call(other.c,f.tenant,"GET",f.url+"/runs/"+run.id)).status));
  assert.ok([403,404].includes((await call(other.c,f.tenant,"POST",f.url+"/runs/"+run.id+"/advance",{expected_revision:run.revision,binding:f.fields})).status));
  await f.ok("POST",f.url+"/runs/"+run.id+"/cancel",{expected_revision:run.revision});
});
test("unknown native result stops descendants and keeps reconciliation, without re-executing a member",async()=>{
  const f=await fixture(),{run}=await f.create(),first=await f.advance(run.id);await finish(f,first.assignments[0],"unknown");
  const next=await f.advance(run.id);assert.equal(next.run.state,"reconciling");assert.equal(next.run.tasks.length,3);
  assert.equal(next.run.nodes.find((n:any)=>n.step_key==="review").task_id,null);assert.equal((await f.advance(run.id)).run.state,"reconciling");
});
test("cancel releases prepared holds exactly once and an original approval replay cannot recreate the run",async()=>{
  const f=await fixture(),p=await f.preflight(),key=randomUUID(),{run}=await f.ok("POST",f.url+"/runs",f.approval(p),key),first=await f.advance(run.id),cancelKey=randomUUID();
  const a=await f.ok("POST",f.url+"/runs/"+run.id+"/cancel",{expected_revision:first.run.revision},cancelKey);
  const b=await f.ok("POST",f.url+"/runs/"+run.id+"/cancel",{expected_revision:first.run.revision},cancelKey);
  assert.equal(a.run.state,"cancelled");assert.equal(b.run.revision,a.run.revision);assert.equal(a.run.reserved_micros,0);assert.equal(a.run.charged_micros,0);
  assert.equal((await f.ok("POST",f.url+"/runs",f.approval(p),key)).run.id,run.id);
  assert.equal((await f.advance(run.id)).assignments,undefined);
});
test("withdrawn native login family is reaped without cloud dispatch or outstanding prepared holds",async()=>{
  const f=await fixture(),{run}=await f.create();await f.advance(run.id);
  await s.db.control.query("UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND client_id='desktop'",[f.c.id]);
  await advanceAgentGroups(s.db,s.catalog);
  const r=(await s.db.control.query("SELECT * FROM agent_group_runs WHERE id=$1",[run.id])).rows[0];assert.equal(r.state,"cancelled");
  assert.equal((await s.db.control.query("SELECT count(*) AS n FROM reservations WHERE task_id IN(SELECT id FROM tasks WHERE agent_group_run_id=$1) AND status='reserved'",[run.id])).rows[0].n,"0");
});
test("cyclic native graph and stale reviewed team version cannot reserve tasks",async()=>{
  const f=await fixture();assert.equal((await call(f.c,f.tenant,"POST",f.url+"/preflight",{plan:{...f.plan,nodes:f.plan.nodes.map(n=>({...n,depends_on:n.key==="code"?["review"]:n.depends_on}))},binding:f.fields})).status,422);
  const p=await f.preflight();await f.ok("PATCH",f.root,{expected_version:f.group.version,name:"Changed local team",coordinator_agent_id:f.agents[0].id,
    members:f.agents.slice(1).map(a=>({agent_id:a.id,role_description:"Updated assignment"})),state:"active"});
  assert.equal((await call(f.c,f.tenant,"POST",f.url+"/runs",f.approval(p))).status,409);
  assert.equal((await s.db.control.query("SELECT count(*) AS n FROM tasks WHERE tenant_id=$1",[f.tenant])).rows[0].n,"0");
});
