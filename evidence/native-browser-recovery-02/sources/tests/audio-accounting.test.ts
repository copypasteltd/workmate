import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/audio-accounting-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { audioProviderFixture, withAudioCustomerConfirmation } from "./audio-production-fixture.js";
import { nativeVideoFixture, startNativeVideo, videoOK, videoFinish, type VideoClient } from "./desktop-video-fixture.js";
import { videoAdmin, videoAdminCall } from "./generated-video-admin-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { AudioProduction } from "../src/audio-production.js";
import { CapabilityAudioVerification } from "../src/capability-audio-verification.js";
import { taskProviderBudgetReceipt } from "../src/provider-budgets.js";
import { projectAccess } from "../src/access.js";
import { canonical, hash } from "../src/lib.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { audioAccountingEvidenceDocument } from "../src/audio-accounting-model.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>, provider: Awaited<ReturnType<typeof audioProviderFixture>>,
  s: Awaited<ReturnType<typeof buildApp>>, audio: AudioProduction, worker: CapabilityAudioVerification, owner: pg.Client;
let a: VideoClient, b: VideoClient, oid: any;
const root="/v1/admin/ai", caps="/v1/admin/capability-releases", reason="Independent original audio accounting review";
const prepared={ name:"audio_121_budget",text:"SELECT ai_budget_used($1::uuid,$2::uuid)::text AS used,ai_budget_subject_blocked($1::uuid) AS blocked" };
const spec={kind:"speech" as const,text:"Hello Hong Kong",locale:"en" as const,voice:"alloy",speed:1,
  rights:{authorized:true as const,reference:"Original customer-owned campaign script",purpose:"Explicit synthetic audio accounting acceptance"}};
const ajv=new Ajv2020({allErrors:true}); createRequire(import.meta.url)("ajv-formats")(ajv);
const defs=JSON.parse(JSON.stringify(contract.schemas).replaceAll("#/components/schemas/","#/$defs/"));
const validators=Object.fromEntries(["AudioAccountingPage","AudioAccountingDetail","AudioAccountingEvidence","CapabilityValidation"]
  .map(name=>[name,ajv.compile({$defs:defs,$ref:"#/$defs/"+name})]));
before(async()=>{
  assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);
  owned=await isolatedTestEnvironment({throughVersion:121});
  owner=new pg.Client({connectionString:owned.env.OWNER_DATABASE_URL}); await owner.connect();
  oid=(await owner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked,'ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure::oid AS capacity,'task_ai_budget_receipt(uuid)'::regprocedure::oid AS receipt")).rows[0];
  assert.deepEqual((await owner.query({...prepared,values:[null,null]})).rows[0],{used:"0",blocked:false});
  await runMigrations(owner,"Forward-only SQL122 audio accounting qualification",{throughVersion:122});
  assert.equal((await owner.query("SELECT max(version) AS n FROM schema_migrations")).rows[0].n,122);
  assert.deepEqual((await owner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked,'ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure::oid AS capacity,'task_ai_budget_receipt(uuid)'::regprocedure::oid AS receipt")).rows[0],oid);
  assert.deepEqual((await owner.query({...prepared,values:[null,null]})).rows[0],{used:"0",blocked:false});
  await runMigrations(owner,"Forward-only audio accounting through current schema");
  provider=await audioProviderFixture(owned.directory,{allowPlatformVerification:true});
  s=await buildApp(loadConfig({...owned.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",
    CODEX_BIN:process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!,AI_BASE_URL:provider.origin,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"synthetic-video-provider-fixture",
    AI_MODEL:"synthetic-audio-reasoning",AI_VERIFIED:"true",AI_INPUT_HKD_MICROS_PER_MILLION:"100",AI_OUTPUT_HKD_MICROS_PER_MILLION:"100",
    AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SPEECH_MODEL:"synthetic-speech-v1",AI_SPEECH_VERIFIED:"true",
    AI_SPEECH_VOICES:"alloy",AI_SPEECH_LOCALES:"en",AI_SPEECH_HKD_MICROS_PER_CHARACTER:"100",
    AI_VERIFICATION_PER_RUN_BUDGET_MICROS:"1000000",AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS:"1000000000000"}),{worker:false});
  audio=new AudioProduction(s.db,s.catalog,s.storage); worker=new CapabilityAudioVerification(s.db,s.catalog);
  a=await videoAdmin(s); b=await videoAdmin(s);
});
beforeEach(async()=>{
  Object.assign(provider.state,{drop:false,corrupt:false,status:200,timestamps:true,beforeReply:undefined});
  const row=(await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
    global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,audio_slots,verification_slots,
    global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm)
    SELECT 'configured_services',coalesce(max(version),0)+1,'Isolated accounting capacity',
      1000,1000,1000,1000,1000,1000,1000,1000,100000,100000,100000,100000,100000,100000,100000,100000
    FROM ai_gateway_policy_versions WHERE data_mode='configured_services' RETURNING id`)).rows[0];
  await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'",[row.id]);
  await s.db.control.query("UPDATE execution_capacity_policy SET agent_slots=100 WHERE data_mode='configured_services'");
});
after(async()=>{try{await s?.app.close();await provider?.close();await owner?.end();}finally{await owned?.cleanup();}
  assert.deepEqual(provider?.errors??[],[]); assert.deepEqual(provider?.text.errors??[],[]);});
async function call(who:VideoClient|undefined,method:string,path:string,body?:unknown,key?:string){
  const r=await videoAdminCall(s,who,method,path,body,key);
  const schema=r.status===200 ? (path.startsWith(root+"/audio-accounting?")?"AudioAccountingPage":path.startsWith(root+"/audio-accounting/")?"AudioAccountingDetail":path.startsWith(root+"/audio-evidence/")?"AudioAccountingEvidence":r.data.audio_suite?"CapabilityValidation":null):null;
  if(schema) assert.ok(validators[schema]!(r.data),schema+": "+JSON.stringify(validators[schema]!.errors)); return r;
}
function ok(r:any,status=200){assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
async function customer(){
  const f=await nativeVideoFixture(s),start=await startNativeVideo(s,f),task=(await s.db.control.query("SELECT * FROM tasks WHERE id=$1",[start.task.task_id])).rows[0];
  const u=(await s.db.control.query("SELECT * FROM users WHERE id=$1",[f.c.id])).rows[0],actor={id:u.id,email:u.email,name:u.name,authVersion:u.auth_version,audience:"user" as const,sessionId:"",sessionHash:""};
  const authorize=async(tx:any)=>{await projectAccess(tx,actor,f.tenant,f.project,"write");
    const t=(await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE",[task.id])).rows[0];assert.equal(t.fencing_token,task.fencing_token);assert.equal(t.status,"running");};
  const job=await withAudioCustomerConfirmation(s,f.web,f.base,task.id,()=>audio.prepare(task,task.fencing_token,spec,"accounting_"+randomUUID(),authorize),hash(canonical(spec)));
  provider.state.drop=true; const lost=await audio.execute(task,job.id,authorize); provider.state.drop=false;assert.equal(lost.state,"unknown");
  await videoOK(s,f.c,"POST",start.url+"/finish",videoFinish);
  const r=ok(await call(a,"GET",`${root}/audio-accounting/audio_customer/${job.id}`));
  return {...f,...start,task,actor,job,r};
}
async function validation(){
  const d={kernel:"codex",gateway_policy:"company_internal_only",profile_key:"internal-speech-v1",model_alias:"synthetic-accounting-model",reasoning_effort:null,rates:[100],voices:["alloy"],locales:["en"]};
  const op=ok(await call(a,"POST",caps+"/drafts",{document:d,reason}),202),release=ok(await call(a,"GET",caps+"/"+op.result_ids[0]));
  const key=randomUUID(),body={expected_version:release.version,reason},v=ok(await call(a,"POST",`${caps}/${release.id}/validations`,body,key),202);
  provider.state.drop=true; await worker.advance(undefined,v.id); provider.state.drop=false;
  const read=ok(await call(a,"GET",`${caps}/validations/${v.id}`));assert.equal(read.state,"reconciling");assert.equal(read.audio_suite.cases.length,1);
  const r=ok(await call(a,"GET",`${root}/audio-accounting/audio_validation/${read.audio_suite.cases[0].id}`));
  return {r,release,v:read,key,body};
}
function document(r:any,patch:any={}){const units=Number(r.cost.quoted_units);return audioAccountingEvidenceDocument.parse({schema_version:1,channel:r.channel,request_id:r.id,
  data_mode:r.data_mode,operation_id:r.operation_id,request_hash:r.request_hash,model_alias:r.model_alias,gateway_fingerprint:r.gateway_fingerprint,
  source_sha256:r.source_sha256,provider_reference:"Original synthetic provider final invoice",source_reference:"Explicit external fixture evidence",
  source_note:"Human-submitted synthetic final evidence, never a provider-authenticated response",observed_at:new Date().toISOString(),terminated:true,
  outcome:"failed",currency:"HKD",billed_micros:(BigInt(units)*BigInt(r.cost.rate_micros)).toString(),usage:{kind:r.kind,pricing_unit:r.pricing_unit,billable_units:units},...patch});}
async function evidence(r:any,d=document(r),who=a,key?:string){const op=ok(await call(who,"POST",`${root}/audio-accounting/${r.channel}/${r.id}/evidence`,{document:d,reason},key),202);return op.result_ids[0];}
const command=(r:any,e:string,action="ai.cost.reconcile")=>({action,channel:r.channel,request_id:r.id,evidence_id:e,reason});
async function submit(c:any,who=a){const p=ok(await call(who,"POST",root+"/previews",c));
  return ok(await call(who,"POST",root+"/operations",{command:c,preview_id:p.preview_id}),202);}
async function decide(op:any,who=b,key?:string){const review=ok(await call(who,"GET",`/v1/admin/operations/${op.id}/approval`));
  return call(who,"POST",`/v1/admin/approvals/${review.id}/decisions`,{expected_version:review.version,payload_hash:review.payload_hash,decision:"approve",reason},key);}
const detail=(r:any)=>call(a,"GET",`${root}/audio-accounting/${r.channel}/${r.id}`).then(ok);
const receipt=(task:any)=>s.db.tx(tx=>taskProviderBudgetReceipt(tx,task.id),task.tenant_id,true,task.created_by);

test("SQL122 preserves budget/capacity/receipt function OIDs and prepared SQL121 callers",async()=>{
  assert.deepEqual((await owner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked,'ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure::oid AS capacity,'task_ai_budget_receipt(uuid)'::regprocedure::oid AS receipt")).rows[0],oid);
  assert.deepEqual((await owner.query({...prepared,values:[null,null]})).rows[0],{used:"0",blocked:false});
});
test("a real dropped customer POST accepts independently approved cost, retains capacity and never invents media",async()=>{
  const f=await customer(),r=f.r,id=await evidence(r),op=await submit(command(r,id));
  assert.equal((await decide(op,a)).status,403); ok(await decide(op),202);
  const current=await detail(r);assert.equal(current.cost.state,"manually_confirmed");assert.equal(current.cost.amount_micros,r.cost.quoted_micros);
  assert.equal(current.capacity_held,true);assert.equal(current.usage_known,false);assert.equal(current.state,"unknown");assert.equal(current.cost.accounting_resolved,false);
  assert.equal((await receipt(f.task)).uncertain,false);
  const customerView=await audio.read(f.actor,f.tenant,f.project,r.id);assert.equal(customerView.accounting.cost_source,"human_evidence");assert.equal(customerView.actual_micros,null);assert.deepEqual(customerView.assets,[]);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,0);
  await audio.recover();assert.equal(provider.calls.filter(c=>c.operation===r.operation_id).length,1);
  ok(await decide(await submit(command(r,id,"ai.capacity.release"))),202);
  const complete=await detail(r);assert.equal(complete.capacity_held,false);assert.equal(complete.cost.accounting_resolved,true);
});
test("platform validation requires both approvals before a new explicit run; original verification and POST remain unchanged",async()=>{
  const f=await validation(),id=await evidence(f.r),held=ok(await call(a,"POST",`${caps}/${f.release.id}/validations`,f.body,f.key),202);assert.equal(held.id,f.v.id);
  assert.equal((await call(a,"POST",`${caps}/${f.release.id}/validations`,f.body)).data.error.code,"AUDIO_RECONCILIATION_REQUIRED");
  ok(await decide(await submit(command(f.r,id))),202);
  assert.equal((await call(a,"POST",`${caps}/${f.release.id}/validations`,f.body)).status,409);
  ok(await decide(await submit(command(f.r,id,"ai.capacity.release"))),202);
  const old=ok(await call(a,"GET",`${caps}/validations/${f.v.id}`));assert.equal(old.state,"reconciling");assert.equal(old.audio_suite.verified_cases,0);
  assert.equal(old.audio_suite.accounting.resolved,true);assert.equal(old.audio_suite.cases[0].verified,false);
  assert.equal(await worker.advance(undefined,f.v.id),null);assert.equal(provider.calls.filter(c=>c.operation===f.r.operation_id).length,1);
  const next=ok(await call(a,"POST",`${caps}/${f.release.id}/validations`,f.body),202);assert.notEqual(next.id,f.v.id);
  ok(await call(a,"POST",`${caps}/validations/${next.id}/audio-cancellations`,f.body),202);await worker.advance(undefined,next.id);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE id=$1",[f.v.id])).rows[0].n,0);
});
test("termination-only evidence can release capacity with a price discrepancy while cost stays unknown",async()=>{
  const f=await validation(),id=await evidence(f.r,document(f.r,{billed_micros:"1"}));
  assert.equal((await call(a,"POST",root+"/previews",command(f.r,id))).status,409);
  ok(await decide(await submit(command(f.r,id,"ai.capacity.release"))),202);
  const now=await detail(f.r);assert.equal(now.capacity_held,false);assert.equal(now.cost.state,"unknown");assert.equal(now.cost.amount_micros,null);
  assert.equal(now.cost.accounting_resolved,false);
});
test("immutable evidence is exactly idempotent, deduplicated and bound to original model/source/hash/time",async()=>{
  const f=await validation(),d=document(f.r),key=randomUUID(),id=await evidence(f.r,d,a,key);
  assert.equal(await evidence(f.r,d,a,key),id);assert.equal(await evidence(f.r,d),id);
  assert.equal((await call(a,"POST",`${root}/audio-accounting/${f.r.channel}/${f.r.id}/evidence`,{document:{...d,source_note:"A different immutable observation"},reason},key)).status,409);
  for(const patch of [{operation_id:randomUUID()},{request_hash:"0".repeat(64)},{gateway_fingerprint:"0".repeat(64)},{source_sha256:"0".repeat(64)},
    {model_alias:"another-model"},{data_mode:"simulated"},{observed_at:"2000-01-01T00:00:00Z"},{observed_at:"2100-01-01T00:00:00Z"},
    {outcome:"not_executed"}]) assert.equal((await call(a,"POST",`${root}/audio-accounting/${f.r.channel}/${f.r.id}/evidence`,{document:{...d,...patch},reason})).status,400,JSON.stringify(patch));
  const saved=ok(await call(a,"GET",root+"/audio-evidence/"+id));assert.deepEqual(saved.document,d);assert.equal(saved.provider_authenticated,false);
  await assert.rejects(s.db.control.query("UPDATE ai_audio_evidence SET reason='overwrite' WHERE id=$1",[id]));
  await assert.rejects(s.db.control.query("DELETE FROM ai_audio_evidence WHERE id=$1",[id]));
});
test("evidence authors cannot approve consequences requested by a different administrator",async()=>{
  const f=await validation(),id=await evidence(f.r),op=await submit(command(f.r,id),b);
  assert.equal((await decide(op,a)).status,403);const c=await videoAdmin(s);ok(await decide(op,c),202);
});
test("cost and evidence access is scoped; requests-only readers never receive amounts or evidence",async()=>{
  const f=await customer(),p=await videoAdmin(s,["admin.ai.requests.read"],"project",f.project),id=await evidence(f.r);
  const read=ok(await call(p,"GET",`${root}/audio-accounting/audio_customer/${f.r.id}`));assert.equal(read.cost,undefined);assert.equal(read.evidence,undefined);
  const page=ok(await call(p,"GET",root+"/audio-accounting?channel=audio_customer&limit=100"));assert.ok(page.items.length>0);assert.ok(page.items.every((r:any)=>r.project_id===f.project&&r.cost===undefined));
  assert.equal((await call(p,"GET",root+"/audio-evidence/"+id)).status,403);
  const platform=await validation();assert.equal((await call(p,"GET",`${root}/audio-accounting/audio_validation/${platform.r.id}`)).status,403);
  const hidden=ok(await call(p,"GET",root+"/audio-accounting?channel=audio_customer&cost_state=unknown"));assert.deepEqual(hidden.items,[]);
  assert.equal((await call(undefined,"GET",root+"/audio-accounting")).status,401);
});
test("project explicit deny and expired MFA block every audio write and sensitive read",async()=>{
  const f=await customer(),who=await videoAdmin(s),role="audio-deny-"+randomUUID();
  await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",[role,JSON.stringify(["admin.ai.cost.read","admin.ai.evidence.write"])]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[who.id,role,f.project]);
  assert.equal((await call(who,"POST",`${root}/audio-accounting/audio_customer/${f.r.id}/evidence`,{document:document(f.r),reason})).status,403);
  const read=ok(await call(who,"GET",`${root}/audio-accounting/audio_customer/${f.r.id}`));assert.equal(read.cost,undefined);
  const expired=await videoAdmin(s);await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '20 minutes' WHERE admin_id=$1",[expired.id]);
  assert.equal((await call(expired,"GET",root+"/audio-accounting")).status,403);
});
test("visible confirmations invalidate signed cursors and filters cannot be swapped",async()=>{
  await validation();const f=await validation();
  const page=ok(await call(a,"GET",root+"/audio-accounting?channel=audio_validation&limit=1"));assert.ok(page.next_cursor);
  const url=root+"/audio-accounting?channel=audio_validation&limit=1&cursor="+encodeURIComponent(page.next_cursor);
  ok(await call(a,"GET",url));assert.equal((await call(a,"GET",url.replace("audio_validation","audio_customer"))).status,400);
  const id=await evidence(f.r);ok(await decide(await submit(command(f.r,id))),202);
  assert.equal((await call(a,"GET",url)).status,400);
});
test("cost facts settle one original customer task exactly once and retain a failed business outcome",async()=>{
  const f=await customer(),id=await evidence(f.r);ok(await decide(await submit(command(f.r,id))),202);
  const facts=ok(await call(a,"GET",`${root}/tasks/${f.task.id}/settlement`));assert.equal((await receipt(f.task)).uncertain,false);
  const c={action:"ai.tasks.settle",task_id:f.task.id,expected_task_version:facts.task.version,acknowledge_violation_ids:[],reason};
  ok(await decide(await submit(c)),202);
  const t=(await s.db.control.query("SELECT status,charged_micros FROM tasks WHERE id=$1",[f.task.id])).rows[0];
  assert.equal(t.status,"failed");assert.equal(String(t.charged_micros),f.r.cost.quoted_micros);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,1);
  assert.equal((await call(a,"POST",root+"/previews",c)).status,409);assert.equal((await detail(f.r)).capacity_held,true);
});
test("external overquote is recorded as a violation without silently expanding the original customer reservation",async()=>{
  const f=await customer(),units=1000000,amount=(BigInt(units)*BigInt(f.r.cost.rate_micros)).toString(),d=document(f.r,{billed_micros:amount,usage:{kind:"speech",pricing_unit:"unicode_scalar",billable_units:units}});
  const id=await evidence(f.r,d);ok(await decide(await submit(command(f.r,id))),202);
  const r=await detail(f.r);assert.equal(r.cost.allocation_exceeded,true);assert.equal(r.cost.amount_micros,amount);
  const reserve=(await s.db.control.query("SELECT amount_micros FROM reservations WHERE task_id=$1",[f.task.id])).rows[0];assert.ok(BigInt(amount)>BigInt(reserve.amount_micros));
  const facts=await call(a,"GET",`${root}/tasks/${f.task.id}/settlement`);assert.equal(facts.status,200);
  assert.deepEqual(facts.data.violations.map((v:any)=>v.code),["AUDIO_ALLOCATION_EXCEEDED"]);
  const c={action:"ai.tasks.settle",task_id:f.task.id,expected_task_version:facts.data.task.version,acknowledge_violation_ids:facts.data.violations.map((v:any)=>v.id),reason};
  const denied=await call(a,"POST",root+"/previews",c);assert.equal(denied.status,409);assert.equal(denied.data.error.code,"RESERVATION_EXCEEDED");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[f.task.id])).rows[0].n,0);
});
test("confirmation race produces one immutable fact and database roles cannot forge accounting",async()=>{
  const f=await validation(),id=await evidence(f.r),c=command(f.r,id),left=await submit(c),right=await submit(c);
  const results=await Promise.all([decide(left),decide(right)]);assert.equal(results.filter(r=>r.status===202).length,1);
  const row=(await s.db.control.query("SELECT * FROM ai_audio_cost_confirmations WHERE audio_probe_id=$1",[f.r.id])).rows;assert.equal(row.length,1);
  await assert.rejects(s.db.control.query("UPDATE ai_audio_cost_confirmations SET billable_units=0 WHERE id=$1",[row[0].id]));
  await assert.rejects(s.db.control.query("INSERT INTO ai_audio_termination_confirmations(audio_probe_id,evidence_id,data_mode,operation_id,actor_id,reviewer_id) VALUES($1,$2,'configured_services',$3,$4,$5)",[f.r.id,id,left.id,a.id,b.id]));
  for(const table of ["ai_audio_evidence","ai_audio_cost_confirmations","ai_audio_termination_confirmations","current_audio_accounting_requests","accounted_audio_jobs","capacity_audio_probes"])
    await assert.rejects(s.db.app.query("SELECT * FROM "+table+" LIMIT 1"));
});
