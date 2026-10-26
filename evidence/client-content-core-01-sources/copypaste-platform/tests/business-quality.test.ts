import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";
import { Worker } from "../src/worker.js";
import { defaults } from "../src/plans.js";
import { saveAsset } from "../src/storage.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import contract from "../contracts/business-quality-openapi.json" with { type: "json" };
const ajv=new Ajv2020({allErrors:true,strict:false});createRequire(import.meta.url)("ajv-formats")(ajv);
const definitions=JSON.parse(JSON.stringify(contract.components.schemas).replaceAll("#/components/schemas/","#/$defs/"));
function schema(name:string,value:unknown){const validate=ajv.compile({$defs:definitions,$ref:"#/$defs/"+name});assert.ok(validate(value),JSON.stringify(validate.errors));}
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(c: Client | undefined, method: string, url: string, body?: unknown, key: string | null = randomUUID(), headers: Record<string,string> = {}) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({ method: method as any, url, headers: {
    origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(key ? { "idempotency-key": key } : {}),
    ...(tenant ? { "x-tenant-id": tenant } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
  }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: unknown) {
  const r = await call(c,method,url,body); assert.ok(r.status>=200 && r.status<300,`${r.status}: ${JSON.stringify(r.data)}`); return r.data;
}
async function user(secret?: OTPAuth.Secret, address = `business-quality-${randomUUID()}@example.invalid`): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const challenge = await ok(undefined,"POST",prefix+"/challenge",{ email: address });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,"utf8"));
  const r = await call(undefined,"POST",prefix+"/verify",{ challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret ? { totp: new OTPAuth.TOTP({secret,digits:6,period:30,algorithm:"SHA1"}).generate() } : {}) });
  assert.equal(r.status,200,JSON.stringify(r.data));
  const cookie=r.raw.cookies.find(c=>c.name===(secret?"cp_admin_session":"cp_session"))!;
  return { id:r.data.user?.id??r.data.admin?.id,cookie:cookie.name+"="+cookie.value,csrf:r.data.csrf_token,admin:!!secret };
}
async function fixture() {
  const owner=await user(), w=await ok(owner,"POST","/v1/tenants",{name:"Quality fixture (simulated model)",project_name:"Actual record checks"});
  const tenant=w.tenant.id,project=w.project.id,base=`/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Isolated quality fixture',$2)",[tenant,defaults.business]);
  const agent=await ok(owner,"POST",base+"/agents",{name:"Fixture assistant",role_key:"assistant"});
  return { owner,tenant,project,base,agent };
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
class FixtureRuntime extends CodexRuntimeAdapter {
  constructor(private files=2,private readAsset?:string){super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
    if(this.readAsset) await ctx.tools.find(t=>t.name==="asset_text_read")!.run({asset_id:this.readAsset},"quality-actual-read");
    for(let i=0;i<this.files;i++)await ctx.tools.find(t=>t.name==="deliver_text")!.run({filename:`quality-${i}.md`,content:"Explicit simulated delivery "+i,mime_type:"text/markdown"},"quality-delivery-"+i);
    return {text:"Explicit simulated business result",inputTokens:10,outputTokens:20,accepted:true,usageKnown:true,status:"completed",thread:"fixture",turn:"1"};
  }
}
async function completed(f:Fixture,files=2,readAsset?:string,shared=false) {
  const a=await ok(f.owner,"POST",f.base+"/tasks",{title:"Controlled quality test",prompt:"Write clearly simulated business deliverables.",role_key:"assistant",...(shared?{}:{agent_id:f.agent.id}),budget_micros:1000000});
  await new Worker(s.db,s.catalog,s.storage,new FixtureRuntime(files,readAsset)).run(f.tenant,a.id);
  const q=await ok(f.owner,"GET",f.base+"/tasks/"+a.id+"/quality"); schema("TaskQuality",q);assert.equal(q.technical_status,"succeeded");return q;
}
const review=(f:Fixture,q:any,decision="accepted",artifacts?:string[])=>call(f.owner,"POST",f.base+"/tasks/"+q.task_id+"/reviews",{
  expected_version:q.task_version,expected_delivery_hash:q.delivery_hash,decision,comment:"Actual test customer input",...(artifacts?{artifact_ids:artifacts}:{}),
});
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",WORKER_ENABLED:"false",DEMO_MODE:"false",AI_BASE_URL:"http://127.0.0.1:9/v1",AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"controlled-fixture",AI_MODEL:"controlled-fixture",AI_VERIFIED:"true",AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});

test("current artifact reviews are separate from technical success, partial acceptance, changes and discard",async()=>{
 const f=await fixture(),q=await completed(f),url=f.base+"/tasks/"+q.task_id+"/quality";
 assert.equal(q.review_state,"pending_review");assert.equal(q.delivery.artifacts.length,2);
 for(const invalid of [[],[randomUUID()],[q.delivery.artifacts[0].id,q.delivery.artifacts[0].id]])await assert.rejects(s.db.tx(async tx=>{
  await tx.query("SELECT set_config('app.actor_id',$1,true)",[f.owner.id]);
  await tx.query("INSERT INTO delivery_reviews(tenant_id,project_id,task_id,reviewer_id,task_version,decision,delivery_snapshot,artifact_ids) VALUES($1,$2,$3,$4,$5,'accepted',$6,$7)",[f.tenant,f.project,q.task_id,f.owner.id,q.task_version,q.delivery,invalid]);
 },f.tenant,true),(error:any)=>error.code==='23514');
 let r=await review(f,q,"accepted",[q.delivery.artifacts[0].id]);assert.equal(r.status,201,JSON.stringify(r.data));
 let now=await ok(f.owner,"GET",url);assert.equal(now.review_state,"pending_review");assert.equal(now.technical_status,"succeeded");
 assert.equal((await review(f,now,"changes_requested",[q.delivery.artifacts[1].id])).status,201);
 now=await ok(f.owner,"GET",url);assert.equal(now.review_state,"changes_requested");
 assert.equal((await review(f,now,"discarded",[q.delivery.artifacts[1].id])).status,201);
 now=await ok(f.owner,"GET",url);assert.equal(now.review_state,"discarded");
 assert.equal((await review(f,now)).status,201);now=await ok(f.owner,"GET",url);assert.equal(now.review_state,"accepted");assert.equal(now.reviews.length,4);
 const summary=await ok(f.owner,"GET",f.base+"/quality");schema("QualitySummary",summary);assert.equal(summary.accepted,1);assert.equal(summary.technical_successes,1);assert.equal(summary.revision_requests,1);assert.equal(summary.roi,null);
});
test("review retries commit once, conflicting bodies and stale concurrent versions do not overwrite",async()=>{
 const f=await fixture(),q=await completed(f),url=f.base+"/tasks/"+q.task_id+"/reviews",key=randomUUID(),b={expected_version:q.task_version,expected_delivery_hash:q.delivery_hash,decision:"accepted"};
 const rs=await Promise.all(Array.from({length:4},()=>call(f.owner,"POST",url,b,key)));for(const r of rs){assert.equal(r.status,201,JSON.stringify(r.data));assert.deepEqual(r.data,rs[0].data);}
 assert.equal((await call(f.owner,"POST",url,{...b,decision:"discarded"},key)).status,409);
 assert.equal((await call(f.owner,"POST",url,b)).status,409);assert.equal((await call(f.owner,"POST",url,b,null)).status,400);
 const now=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal(now.reviews.length,1);
 const competing=await Promise.all([review(f,now,"accepted"),review(f,now,"discarded")]);assert.deepEqual(competing.map(x=>x.status).sort(),[201,409]);
 await assert.rejects(s.db.tx(tx=>tx.query("UPDATE delivery_reviews SET decision='discarded' WHERE task_id=$1",[q.task_id]),f.tenant,true));
});
test("canonical review keeps original response contract and refuses unrelated or replaced artifacts",async()=>{
 const f=await fixture(),q=await completed(f),headers={"x-tenant-id":f.tenant},path=`/v1/tasks/${q.task_id}/reviews`;
 const r=await call(f.owner,"POST",path,{artifact_ids:[q.delivery.artifacts[0].id],decision:"accepted"},randomUUID(),headers);
 assert.equal(r.status,201,JSON.stringify(r.data));assert.deepEqual(Object.keys(r.data).sort(),["created_at","decision","id","task_id"]);
 assert.equal((await call(f.owner,"POST",path,{artifact_ids:[randomUUID()],decision:"accepted"},randomUUID(),headers)).status,409);
 const before=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal((await review(f,before)).status,201);
 const id=q.delivery.artifacts[0].id;
 await s.db.tx(async tx=>{await tx.query("SELECT set_config('app.actor_id',$1,true)",[f.owner.id]);await saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,asset:id,expectedVersion:1,name:"quality-0.md",kind:"document",mime:"text/markdown",bytes:Buffer.from("Changed delivery"),metadata:{task_id:q.task_id}});},f.tenant);
 const changed=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal(changed.review_state,"pending_review");assert.ok(changed.reviews.every((r:any)=>!r.current_delivery&&r.comment===null));
 assert.equal((await review(f,{...changed,delivery_hash:before.delivery_hash})).status,409);
 const summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.accepted,0);
});
test("human measurements distinguish unset and zero, retain history, and never invent ROI",async()=>{
 const f=await fixture(),q=await completed(f,0);assert.equal((await review(f,q)).status,201);
 let now=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal(now.measurements,null);
 const path=f.base+"/tasks/"+q.task_id+"/quality/measurements",b={expected_version:now.task_version,baseline_minutes:null,human_minutes:0,manual_revisions:0},key=randomUUID();
 const a=await call(f.owner,"POST",path,b,key);assert.equal(a.status,201,JSON.stringify(a.data));schema("QualityMeasurement",a.data);assert.deepEqual((await call(f.owner,"POST",path,b,key)).data,a.data);
 let summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.human_minutes,"0");assert.equal(summary.baseline_minutes,null);assert.equal(summary.baseline_minutes_coverage,0);assert.equal(summary.human_minutes_coverage,1);assert.equal(summary.roi,null);
 now=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal(now.review_state,"accepted");
 assert.equal((await call(f.owner,"POST",path,{...b,expected_version:now.task_version,baseline_minutes:90,human_minutes:12,manual_revisions:2})).status,201);
 summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.manual_revisions,"2");assert.equal(summary.baseline_minutes,"90");
 assert.equal((await call(f.owner,"POST",path,{...b,human_minutes:-1})).status,400);
 assert.equal((await s.db.control.query("SELECT count(*)::int n FROM task_quality_measurements WHERE task_id=$1",[q.task_id])).rows[0].n,2);
});
test("failed and unknown costs are included and incomplete totals do not claim complete cost per accepted delivery",async()=>{
 const f=await fixture(),a=await completed(f,0),b=await completed(f,0);assert.equal((await review(f,a)).status,201);
 // Explicit cost fixture, not a provider usage or settlement claim.
 await s.db.control.query("UPDATE tasks SET status='failed',charged_micros=123,accrued_micros=123 WHERE id=$1",[b.task_id]);
 let summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.failed,1);assert.equal(summary.failed_cancelled_cost_micros,"123");assert.ok(BigInt(summary.known_cost_micros)>=123n);assert.notEqual(summary.complete_cost_per_accepted_micros,null);
 await s.db.control.query("UPDATE reservations SET status='reconciling' WHERE task_id=$1",[b.task_id]);
 summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.uncertain_cost_tasks,1);assert.equal(summary.complete_cost_per_accepted_micros,null);
 assert.equal((await call(f.owner,"GET",f.base+"/quality?from=2020-01-01T00%3A00%3A00Z&to=2025-01-01T00%3A00%3A00Z")).status,400);
 assert.equal((await call(f.owner,"GET",f.base+"/quality?data_mode=simulated")).data.tasks,0);
});
test("customer and administrator audiences, scopes, explicit denies and revoked membership protect quality",async()=>{
 const f=await fixture(),q=await completed(f),outsider=await user();assert.equal((await call(outsider,"GET",f.base+"/tasks/"+q.task_id+"/quality")).status,404);
 assert.equal((await review(f,q)).status,201);
 const address=`quality-admin-${randomUUID()}@example.invalid`,secret=new OTPAuth.Secret({size:20});
 const p=(await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Quality operator',$2) RETURNING id",[address,seal(s.db.config.MASTER_KEY!,secret.base32)])).rows[0];
 await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Quality read',$2)",["quality_"+p.id.replaceAll("-",""),JSON.stringify(["admin.usage.read"])]);
 const role="quality_"+p.id.replaceAll("-","");await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",[p.id,role,f.tenant]);
 const admin=await user(secret,address);let result=await call(admin,"GET","/v1/admin/quality");assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.tasks,1);assert.equal(JSON.stringify(result.data).includes("Explicit simulated business result"),false);
 assert.equal(result.data.accepted,1);assert.equal(result.data.reviewable,1);assert.equal(result.data.sources_unavailable,0);schema("QualitySummary",result.data);
 assert.equal((await call(admin,"POST",f.base+"/tasks/"+q.task_id+"/reviews",{expected_version:q.task_version,expected_delivery_hash:q.delivery_hash,decision:"accepted"})).status,401);
 assert.equal((await call(f.owner,"GET","/v1/admin/quality")).status,401);
 await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[p.id,role,f.project]);
 result=await call(admin,"GET","/v1/admin/quality");assert.equal(result.status,200);assert.equal(result.data.tasks,0);
 assert.equal(result.data.accepted,0);assert.equal(result.data.known_cost_micros,"0");
 await s.db.control.query("UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.owner.id]);
 assert.equal((await call(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality")).status,404);
});
test("quality comments and snapshot hashes are erased with task content and legacy acceptance uses the same durable records",async()=>{
 const f=await fixture(),q=await completed(f,0),key=randomUUID(),url=f.base+"/tasks/"+q.task_id+"/acceptance",body={version:q.task_version,decision:"discarded",comment:"Erase this private customer feedback"};
 assert.equal((await call(f.owner,"POST",url,body,key)).status,200);assert.equal((await call(f.owner,"POST",url,body,key)).status,200);
 const now=await ok(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality");assert.equal(now.reviews.length,1);assert.equal(now.review_state,"discarded");
 assert.equal((await call(f.owner,"POST",f.base+"/tasks/"+q.task_id+"/quality/measurements",{expected_version:now.task_version,baseline_minutes:20,human_minutes:4,manual_revisions:1})).status,201);
 await s.db.control.query("UPDATE tasks SET content_state='deleted' WHERE id=$1",[q.task_id]);
 const r=(await s.db.control.query("SELECT * FROM delivery_reviews WHERE task_id=$1",[q.task_id])).rows[0];assert.equal(r.comment,"");assert.equal(r.delivery_snapshot,null);assert.ok(r.erased_at);
 const m=(await s.db.control.query("SELECT * FROM task_quality_measurements WHERE task_id=$1",[q.task_id])).rows[0];assert.equal(m.human_minutes,null);assert.ok(m.erased_at);
 assert.equal((await call(f.owner,"GET",f.base+"/tasks/"+q.task_id+"/quality")).status,404);
});
test("reuse counts an actual fixed-version model read once, excludes mere downloads and revoked sources",async()=>{
 const f=await fixture(),source=await completed(f,0);
 const artifact=await s.db.tx(async tx=>{await tx.query("SELECT set_config('app.actor_id',$1,true)",[f.owner.id]);return saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"source-for-reuse.txt",mime:"text/plain",bytes:Buffer.from("Explicit fixture source"),metadata:{task_id:source.task_id}});},f.tenant);
 assert.equal((await ok(f.owner,"GET",f.base+"/quality")).observed_reuse_pairs,0);
 const used=await completed(f,0,artifact.id);assert.equal(used.technical_status,"succeeded");
 let summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.observed_reuse_pairs,1);assert.equal(summary.successful_reuse_pairs,1);
 await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[artifact.id]);
 summary=await ok(f.owner,"GET",f.base+"/quality");assert.equal(summary.observed_reuse_pairs,0);assert.equal(summary.sources_unavailable,1);
 assert.equal((await call(f.owner,"GET",f.base+"/tasks/"+used.task_id+"/quality")).status,409);
});
test("private conversation results stay private and read-only project bindings cannot submit customer acceptance",async()=>{
 const f=await fixture(),other=await user();
 await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[f.tenant,other.id]);
 await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",[f.tenant,f.project,other.id]);
 const shared=await completed(f,0,undefined,true);assert.equal((await call(other,"GET",f.base+"/tasks/"+shared.task_id+"/quality")).status,200);
 assert.equal((await call(other,"POST",f.base+"/tasks/"+shared.task_id+"/reviews",{expected_version:shared.task_version,expected_delivery_hash:shared.delivery_hash,decision:"accepted"})).status,403);
 const conversation=await ok(f.owner,"POST",f.base+"/conversations",{name:"Private feedback fixture",agent_id:f.agent.id});
 const accepted=await call(f.owner,"POST","/v1/tasks",{project_id:f.project,agent_id:f.agent.id,conversation_id:conversation.id,type:"delegation",input:{prompt:"Write an explicitly simulated private result."},budget:{currency:"HKD",amount_micros:"1000000"}},randomUUID(),{"x-tenant-id":f.tenant});
 assert.equal(accepted.status,202,JSON.stringify(accepted.data));await new Worker(s.db,s.catalog,s.storage,new FixtureRuntime(0)).run(f.tenant,accepted.data.task_id);
 const privateUrl=f.base+"/tasks/"+accepted.data.task_id+"/quality";assert.equal((await call(f.owner,"GET",privateUrl)).status,200);assert.equal((await call(other,"GET",privateUrl)).status,404);
 assert.equal((await ok(other,"GET",f.base+"/quality")).tasks,1);
});
test("quality OpenAPI retains the original review shapes and all six running operations",async()=>{
 const original=JSON.parse(await readFile("../../docs/contracts/openapi.json","utf8"));
 assert.deepEqual(contract.components.schemas.ReviewCreate,original.components.schemas.ReviewCreate);assert.deepEqual(contract.components.schemas.Review,original.components.schemas.Review);
 assert.deepEqual(JSON.parse(await readFile("../../docs/contracts/business-quality-openapi.json","utf8")),contract);
 assert.equal(Object.values(contract.paths).reduce((n,route)=>n+Object.keys(route).length,0),6);
 for(const [path,methods]of Object.entries(contract.paths))for(const method of Object.keys(methods))assert.ok(s.app.hasRoute({method:method.toUpperCase() as any,url:path.replace(/\{([^}]+)\}/g,":$1")}));
});
