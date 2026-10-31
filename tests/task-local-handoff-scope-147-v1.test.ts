import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {s,fixture,handoff,admission,admitted,completed,asset,returned,ok,call,videoActor} from "./task-local-handoff-fixture-147-v2.js";
import {enqueueTask} from "../src/task-service.js";
import {assertTaskContentSources} from "../src/task-content-sources.js";
import {hash} from "../src/lib.js";
import {Worker} from "../src/worker.js";
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";

type F=Awaited<ReturnType<typeof fixture>>;
const csv=Buffer.from("campaign,clicks\nlaunch,42\n");
async function scoped(f:F,isPrivate=true,source?:any) {
  const u=(await s.db.control.query("SELECT * FROM users WHERE id=$1",[f.web.id])).rows[0];
  const actor={id:u.id,email:u.email,name:u.name,authVersion:u.auth_version,audience:"user" as const,sessionId:"",sessionHash:""};
  const task=await s.db.tx(tx=>enqueueTask(tx,s.db,s.catalog,actor,f.tenant,f.project,{
    title:"Explicit task-bound customer input",prompt:"Read the selected campaign CSV and return a short report.",role_key:"assistant",budget_micros:1000000,
    dependencies:[...(source?[{kind:"file" as const,description:"Previously approved source",resource_ids:[source.version.id]}]:[]),
      {kind:"file" as const,description:"Prepare the campaign-summary.csv in the customer-approved local directory."}],
  },randomUUID(),isPrivate?{context:{} as any}:{}),f.tenant,false,f.web.id);
  const dep=(await ok(s,f.web,"GET",f.base+"/tasks/"+task.id+"/dependencies")).items.find((d:any)=>d.state==="pending");
  return {...f,task,dep,requestURL:f.base+"/tasks/"+task.id+"/local-handoffs"};
}
async function transfer(f:F,extra:Record<string,unknown>={},finish=true) {
  const body={project_id:f.project,source_task_id:f.task.id,filename:"customer-selected.csv",content_type:"text/csv",
    size_bytes:csv.length,sha256:hash(csv),...extra};
  const created=await call(s,f.web,"POST",f.base+"/uploads",body);assert.equal(created.status,201,JSON.stringify(created.data));
  const path=f.base+"/uploads/"+created.data.upload_id;
  await ok(s,f.web,"POST",path+"/parts/0",{sha256:hash(csv),base64:csv.toString("base64")});
  return {path,id:created.data.upload_id,body,asset:finish?await ok(s,f.web,"POST",path+"/complete",{sha256:hash(csv),size_bytes:csv.length}):null};
}
class ActualInputReader extends CodexRuntimeAdapter {
  text="";
  constructor(private assetId:string){super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
    const result=await ctx.tools.find(t=>t.name==="asset_text_read")!.run({asset_id:this.assetId},"explicit-local-upload-read") as any;
    this.text=result.text;
    await ctx.tools.find(t=>t.name==="deliver_text")!.run({filename:"input-read-check.md",mime_type:"text/markdown",content:"Explicit test runtime read: "+this.text},"explicit-local-upload-delivery");
    return {text:"Explicit test runtime; no model or OS execution",inputTokens:10,outputTokens:20,accepted:true,usageKnown:true,status:"completed",thread:"task-scope-test",turn:"1"};
  }
}
test("private input without a conversation stays private and the original Worker reads real selected bytes without a provenance cycle",async()=>{
  const f=await scoped(await fixture()),h=await handoff(f),done=await completed(f,h),u=await transfer(f);
  assert.equal(f.task.conversation_id,null);assert.equal(u.asset.private_owner,f.web.id);
  assert.equal(u.asset.version.metadata.input_task_id,f.task.id);assert.equal(u.asset.version.metadata.task_id,undefined);
  assert.equal(u.asset.version.metadata.conversation_id,undefined);
  const other=await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",[f.tenant,other.web.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",[f.tenant,f.project,other.web.id]);
  assert.equal((await ok(s,other.web,"GET",f.base+"/assets")).items.some((a:any)=>a.id===u.asset.id),false);
  assert.equal((await call(s,other.web,"GET",u.path)).status,404);
  const manifest=await ok(s,f.web,"GET",u.path);assert.equal(manifest.source_task_id,f.task.id);assert.equal(manifest.conversation_id,null);
  const originalReservation=(await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1",[f.task.id])).rows[0];
  await ok(s,f.web,"POST",f.base+"/local-handoffs/"+h.id+"/complete",returned(done.h,[u.asset.version.id]));
  const replay=await ok(s,f.web,"POST",u.path+"/complete",{sha256:hash(csv),size_bytes:csv.length});assert.equal(replay.id,u.asset.id);
  await s.db.tx(tx=>assertTaskContentSources(tx,{id:f.task.id}),f.tenant,false,f.web.id);
  const runtime=new ActualInputReader(u.asset.id);await new Worker(s.db,s.catalog,s.storage,runtime).run(f.tenant,f.task.id);
  assert.equal(runtime.text,csv.toString("utf8"));
  const original=(await s.db.control.query("SELECT status,conversation_id FROM tasks WHERE id=$1",[f.task.id])).rows[0];
  assert.equal(original.status,"succeeded");assert.equal(original.conversation_id,null);
  const settled=(await s.db.control.query("SELECT task_id,amount_micros,created_at FROM reservations WHERE task_id=$1",[f.task.id])).rows[0];
  assert.equal(settled.task_id,originalReservation.task_id);assert.equal(settled.amount_micros,originalReservation.amount_micros);
  assert.equal(settled.created_at.toISOString(),originalReservation.created_at.toISOString());
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM assets WHERE id=$1",[u.asset.id])).rows[0].n,1);
});
test("task scope is derived server-side for private conversations and explicit shared project tasks",async()=>{
  const f=await fixture(),h=await handoff(f);await completed(f,h);
  const u=await transfer(f);assert.equal(u.asset.private_owner,f.web.id);assert.equal(u.asset.version.metadata.conversation_id,f.conversation.id);
  const shared=await scoped(f,false),sh=await handoff(shared);await completed(shared,sh);const su=await transfer(shared);
  assert.equal(su.asset.private_owner,null);assert.equal(su.asset.version.metadata.input_task_id,shared.task.id);
});
test("unfinished, conflicting conversation and existing-asset task uploads cannot allocate an unscoped transfer",async()=>{
  const f=await fixture(),h=await handoff(f),body={project_id:f.project,source_task_id:f.task.id,filename:"input.csv",content_type:"text/csv",size_bytes:csv.length,sha256:hash(csv)};
  assert.equal((await call(s,f.web,"POST",f.base+"/uploads",body)).status,409);
  await completed(f,h);const other=await scoped(f);
  assert.equal((await call(s,f.web,"POST",f.base+"/uploads",{...body,conversation_id:randomUUID()})).status,409);
  assert.equal((await call(s,f.web,"POST",f.base+"/uploads",{...body,source_task_id:other.task.id})).status,409);
  const a=await asset(f);
  assert.equal((await call(s,f.web,"POST",f.base+"/uploads",{...body,asset_id:a.id,expected_version:1})).status,400);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM upload_sessions WHERE source_task_id=$1",[f.task.id])).rows[0].n,0);
});
test("revoked source denies reads, parts, completion and direct handoff access while an unrelated valid inbox entry remains usable",async()=>{
  const initial=await fixture(),a=await asset(initial),f=await scoped(initial,true,a),valid=await scoped(initial),good=await handoff(valid),h=await handoff(f);
  await completed(f,h);const pending=await transfer(f,{},false);
  await s.db.control.query("UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[a.id]);
  for(const [method,path,body] of [["GET",pending.path,undefined],["POST",pending.path+"/parts/0",{sha256:hash(csv),base64:csv.toString("base64")}],
    ["POST",pending.path+"/complete",{sha256:hash(csv),size_bytes:csv.length}],["GET",f.base+"/local-handoffs/"+h.id,undefined]] as const)
    assert.equal((await call(s,f.web,method,path,body)).status,409);
  const inbox=await ok(s,f.c,"GET",f.base+"/local-handoffs?limit=1");assert.equal(inbox.items.length,1);assert.equal(inbox.items[0].id,good.id);
  assert.equal(JSON.stringify(inbox).includes(h.id),false);assert.equal(JSON.stringify(inbox).includes(f.task.id),false);
  assert.equal((await call(s,f.web,"DELETE",pending.path)).status,200);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM asset_versions WHERE upload_session_id=$1",[pending.id])).rows[0].n,0);
});
test("accepted task upload scope is immutable and source deletion cancels retained parts and private input derivatives",async()=>{
  const f=await scoped(await fixture()),h=await handoff(f);await completed(f,h);
  const finished=await transfer(f),pending=await transfer(f,{},false);
  await assert.rejects(s.db.control.query("UPDATE upload_sessions SET source_task_id=NULL WHERE id=$1",[pending.id]),(e:any)=>e.code==="23514");
  await s.db.control.query("UPDATE tasks SET content_state='deleted' WHERE id=$1",[f.task.id]);
  const sessions=(await s.db.control.query("SELECT state,filename,result FROM upload_sessions WHERE source_task_id=$1",[f.task.id])).rows;
  assert.equal(sessions.length,2);assert.ok(sessions.every(r=>r.state==="cancelled"&&r.filename==="[deleted]"&&r.result===null));
  assert.equal((await s.db.control.query("SELECT state FROM assets WHERE id=$1",[finished.asset.id])).rows[0].state,"deleted");
  assert.equal((await call(s,f.web,"GET",pending.path)).status,404);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM deletion_dependencies d JOIN deletion_jobs p ON p.id=d.job_id JOIN deletion_jobs c ON c.id=d.child_job_id WHERE p.target_type='tasks' AND p.target_id=$1 AND c.target_type='assets' AND c.target_id=$2",[f.task.id,finished.asset.id])).rows[0].n,1);
});
test("Starter allows only the validated waiting parent to yield its slot and retains two independent real reservations",async()=>{
  const f=await fixture(),h=await handoff(f);await s.db.control.query("UPDATE entitlements SET ends_at=now()-interval '1 second' WHERE tenant_id=$1",[f.tenant]);
  const n=await admitted(f,h);
  const rows=(await s.db.control.query("SELECT task_id,amount_micros,status FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id",[[f.task.id,n.task_id]])).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.status==="reserved"));
  assert.equal(rows.find(r=>r.task_id===f.task.id).amount_micros,String(f.task.budget_micros));
  assert.equal(rows.find(r=>r.task_id===n.task_id).amount_micros,h.budget_micros);
  const unrelated=await call(s,f.web,"POST",f.base+"/tasks",{title:"Unrelated task",prompt:"Must still respect Starter quota",role_key:"assistant",budget_micros:100000});
  assert.equal(unrelated.status,409);assert.equal(unrelated.data.error.code,"PLAN_TASK_LIMIT");
  assert.equal((await admitted(f,h)).task_id,n.task_id);
});
test("an unrelated needs_input task still blocks Starter native admission and the rejected admission reserves no extra money",async()=>{
  const f=await fixture(),other=await scoped(f),h=await handoff(f);
  await s.db.control.query("UPDATE entitlements SET ends_at=now()-interval '1 second' WHERE tenant_id=$1",[f.tenant]);
  const result=await call(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h));
  assert.equal(result.status,409);assert.equal(result.data.error.code,"PLAN_TASK_LIMIT");
  assert.equal((await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id)).state,"waiting");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE project_id=$1 AND execution_location='desktop'",[f.project])).rows[0].n,0);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM reservations WHERE task_id=ANY($1::uuid[])",[[f.task.id,other.task.id]])).rows[0].n,2);
});
test("microsecond inbox cursors retain both requests created in the same millisecond",async()=>{
  const f=await fixture(),other=await scoped(f),a=await handoff(f),b=await handoff(other),ids:string[]=[];
  for(const [h,at] of [[a,"2027-01-01T00:00:00.123999Z"],[b,"2027-01-01T00:00:00.123998Z"]] as const){
    await ok(s,f.web,"POST",f.base+"/local-handoffs/"+h.id+"/cancel",{expected_revision:h.revision,confirm:true});
    const row=(await s.db.control.query(`INSERT INTO task_local_handoffs(tenant_id,project_id,created_by,source_task_id,dependency_id,dependency_version,
      parent_prompt_hash,description_hash,native_prompt_hash,role_key,role_hash,budget_micros,definition_hash,created_at)
      SELECT tenant_id,project_id,created_by,source_task_id,dependency_id,dependency_version,parent_prompt_hash,description_hash,native_prompt_hash,
      role_key,role_hash,budget_micros,definition_hash,$2::timestamptz FROM task_local_handoffs WHERE id=$1 RETURNING id`,[h.id,at])).rows[0];
    ids.push(row.id);
  }
  const first=await ok(s,f.c,"GET",f.base+"/local-handoffs?limit=1");assert.equal(first.items[0].id,ids[0]);
  assert.match(JSON.parse(Buffer.from(first.next_cursor,"base64url").toString()).at,/\.123999Z$/);
  const next=await ok(s,f.c,"GET",f.base+"/local-handoffs?limit=1&cursor="+encodeURIComponent(first.next_cursor));
  assert.equal(next.items[0].id,ids[1]);assert.notEqual(next.items[0].id,first.items[0].id);
});
async function relogin(f:F) {
  const email=(await s.db.control.query("SELECT email FROM users WHERE id=$1",[f.web.id])).rows[0].email;
  const challenge=await ok(s,undefined,"POST","/v1/auth/challenge",{email});
  const mail=JSON.parse(await readFile(s.db.config.DATA_DIR+"/mailbox/"+challenge.challenge_id+".json","utf8"));
  const signed=await call(s,undefined,"POST","/v1/auth/verify",{challenge_id:challenge.challenge_id,code:mail.text.match(/\b\d{6}\b/)[0]});assert.equal(signed.status,200);
  const web={id:f.web.id,csrf:signed.data.csrf_token,cookie:signed.raw.cookies[0].name+"="+signed.raw.cookies[0].value};
  const verifier=randomBytes(32).toString("base64url"),redirect="http://127.0.0.1:18249/callback";
  const auth=await ok(s,web,"POST","/v1/auth/native/authorize",{client_id:"desktop",redirect_uri:redirect,state:randomBytes(32).toString("hex"),code_challenge:createHash("sha256").update(verifier).digest("base64url")});
  const token=await ok(s,undefined,"POST","/v1/auth/native/token",{client_id:"desktop",redirect_uri:redirect,code:new URL(auth.redirect).searchParams.get("code"),code_verifier:verifier});
  return {web,c:{id:web.id,access_token:token.access_token}};
}
test("a fresh login cannot charge, start or return an original task whose frozen user authorization was revoked",async()=>{
  const f=await fixture(),h=await handoff(f),n=await admitted(f,h);
  await s.db.control.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[f.web.id]);
  const fresh=await relogin(f),current={...f,...fresh};
  const a=await asset(f);
  const checks=[
    await call(s,fresh.web,"GET",f.base+"/local-handoffs/"+h.id),
    await call(s,fresh.web,"POST",f.requestURL,{dependency_id:f.dep.id,expected_dependency_version:f.dep.version,role_key:"fullstack",budget_micros:100000,confirm:true}),
    await call(s,fresh.c,"POST",f.base+"/desktop-executions",admission(current,h)),
    await call(s,fresh.c,"POST",f.base+"/desktop-executions/"+n.task_id+"/start",f.fields),
    await call(s,fresh.web,"POST",f.base+"/local-handoffs/"+h.id+"/complete",returned(h,[a.version.id])),
  ];
  for(const result of checks){assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,"LOCAL_HANDOFF_AUTHORIZATION_CHANGED");}
  assert.equal((await ok(s,fresh.c,"GET",f.base+"/local-handoffs")).items.length,0);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE input_context->>'local_handoff_id'=$1",[h.id])).rows[0].n,1);
  assert.equal((await s.db.control.query("SELECT actor_auth_version FROM tasks WHERE id=$1",[f.task.id])).rows[0].actor_auth_version,1);
});
