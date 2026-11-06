import { zipSync, strToU8 } from "fflate";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, hash } from "../src/lib.js";
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
async function completed(f:Fixture,files=2,readAsset?:string,shared=false,selectedVersion?:string) {
  const a=await ok(f.owner,"POST",f.base+"/tasks",{title:"Controlled quality test",prompt:"Write clearly simulated business deliverables.",role_key:"assistant",...(shared?{}:{agent_id:f.agent.id}),budget_micros:1000000,...(selectedVersion?{dependencies:[{kind:"file",description:"Explicitly selected fixed-version source for reuse",resource_ids:[selectedVersion]}]}:{})});
  await new Worker(s.db,s.catalog,s.storage,new FixtureRuntime(files,readAsset)).run(f.tenant,a.id);
  const q=await ok(f.owner,"GET",f.base+"/tasks/"+a.id+"/quality"); schema("TaskQuality",q);assert.equal(q.technical_status,"succeeded");return q;
}
const review=(f:Fixture,q:any,decision="accepted",artifacts?:string[])=>call(f.owner,"POST",f.base+"/tasks/"+q.task_id+"/reviews",{
  expected_version:q.task_version,expected_delivery_hash:q.delivery_hash,decision,comment:"Actual test customer input",...(artifacts?{artifact_ids:artifacts}:{}),
});
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",WORKER_ENABLED:"false",DEMO_MODE:"false",AI_BASE_URL:"http://127.0.0.1:9/v1",AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"controlled-fixture-key-195",AI_MODEL:"controlled-fixture",AI_VERIFIED:"true",AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});


async function operator(permissions=["admin.catalog.read","admin.catalog.publish"]){
 const address=`round195-${randomUUID()}@example.invalid`,secret=new OTPAuth.Secret({size:20});
 const principal=(await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Round 195 test reviewer',$2) RETURNING id",[address,seal(s.db.config.MASTER_KEY!,secret.base32)])).rows[0];
 const role="test195_"+principal.id.replaceAll("-","");
 await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Round 195 test only',$2)",[role,JSON.stringify(permissions)]);
 await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",[principal.id,role]);
 return {...await user(secret,address),id:principal.id};
}
test("task workspace keeps private task boundaries and immutable file versions",async()=>{
 const f=await fixture(),q=await completed(f),root=f.base+"/tasks/"+q.task_id+"/workspace";
 const view=await ok(f.owner,"GET",root);assert.equal(view.task.id,q.task_id);assert.equal(view.files.length,2);
 const file=view.files[0],preview=await ok(f.owner,"GET",root+"/preview?asset_version_id="+file.version_id);
 assert.equal(preview.state,"ready");assert.match(preview.text,/Explicit simulated delivery/);
 assert.equal((await call(await user(),"GET",root)).status,404);
 assert.equal((await call(f.owner,"GET",root+"/preview?asset_version_id="+randomUUID())).status,404);
 await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1",[file.id]);
 assert.equal((await call(f.owner,"GET",root+"/preview?asset_version_id="+file.version_id)).status,404);
 assert.equal((await ok(f.owner,"GET",root)).files.length,1);
});
test("readiness does not expose credentials or mistake the test inbox for production mail",async()=>{
 const admin=await operator(),body=await ok(admin,"GET","/v1/admin/operational-readiness");
 assert.equal(body.kernel,"codex");assert.equal(body.checks.find((c:any)=>c.key==="mail").state,"test_only");
 assert.equal(body.checks.find((c:any)=>c.key==="production_profile").state,"test_only");
 assert.equal(JSON.stringify(body).includes("controlled-fixture-key-195"),false);
 assert.equal(JSON.stringify(body).includes(s.db.config.MASTER_KEY!),false);
 const limited=await operator(["admin.overview.read"]);assert.equal((await call(limited,"GET","/v1/admin/operational-readiness")).status,403);
});
test("acceptance evidence freezes task/delivery versions, retries once and revokes as an audited batch",async()=>{
 const f=await fixture(),q=await completed(f),admin=await operator(),root="/v1/admin/role-acceptance";
 const catalog=await ok(admin,"GET",root),template=catalog.templates.find((a:any)=>a.role_key==="assistant");assert.ok(template);
 const snapshot=await ok(admin,"GET",root+"/tasks/"+q.task_id+"/snapshot");
 const body={template_version_id:template.template_version_id,task_id:q.task_id,case_kind:"normal",decision:"passed",comment:"Human test review of the controlled delivery fixture.",expected_task_version:snapshot.task_version,expected_delivery_hash:snapshot.delivery_hash};
 assert.equal((await call(admin,"POST",root,body)).status,409,"An unaccepted delivery must not pass");
 const failed={...body,decision:"failed"},key=randomUUID();
 const recorded=await call(admin,"POST",root,failed,key);assert.equal(recorded.status,200,JSON.stringify(recorded.data));
 const retried=await call(admin,"POST",root,failed,key);assert.deepEqual(retried.data,recorded.data);
 assert.equal((await call(admin,"POST",root,failed)).status,409);
 const list=await ok(admin,"GET",root+"?template_version_id="+template.template_version_id);assert.equal(list.items.length,1);
 assert.equal(list.professional_qualification,"manual_acceptance_required");assert.equal(list.items[0].proof.delivery_hash,snapshot.delivery_hash);
 const revoke={ids:[recorded.data.id],reason:"Correct an explicitly controlled test review"};const revokeKey=randomUUID();
 assert.equal((await call(admin,"POST",root+"/revoke",revoke,revokeKey)).status,200);
 assert.equal((await call(admin,"POST",root+"/revoke",revoke,revokeKey)).status,200);
 assert.equal((await ok(admin,"GET",root)).items.find((r:any)=>r.id===recorded.data.id).revoked_at!==null,true);
 await assert.rejects(s.db.control.query("UPDATE role_acceptance_evidence SET comment='Changed' WHERE id=$1",[recorded.data.id]));
 assert.ok((await s.db.control.query("SELECT 1 FROM audit_log WHERE action='role.acceptance.revoke' AND target=$1",[recorded.data.id])).rowCount);
});

// Cover the actual create/part/complete boundary, not a MIME helper mirror.
test("Office conversation inputs retain original bytes and reject non-ZIP declared Office content",async()=>{
 const f=await fixture();
 for(const [extension,suffix,entry] of [["docx","wordprocessingml.document","word/document.xml"],["xlsx","spreadsheetml.sheet","xl/workbook.xml"],["pptx","presentationml.presentation","ppt/presentation.xml"]]){
  const mime="application/vnd.openxmlformats-officedocument."+suffix;
  const original=Buffer.from(zipSync({"[Content_Types].xml":strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),[entry]:strToU8('<document>Controlled source 香港</document>')}));
  for(const valid of [true,false]){
   const bytes=valid?original:Buffer.from("This is not an Office ZIP container");
   const start=await ok(f.owner,"POST",f.base+"/uploads",{project_id:f.project,filename:"source."+extension,content_type:mime,size_bytes:bytes.length,sha256:hash(bytes)});
   await ok(f.owner,"POST",f.base+"/uploads/"+start.upload_id+"/parts/0",{base64:bytes.toString("base64"),sha256:hash(bytes)});
   const end=await call(f.owner,"POST",f.base+"/uploads/"+start.upload_id+"/complete",{size_bytes:bytes.length,sha256:hash(bytes)});
   assert.equal(end.status,valid?200:422,JSON.stringify(end.data));
   if(valid){assert.equal(end.data.version.sha256,hash(bytes));}
   else assert.equal(end.data.error.code,"UPLOAD_TYPE_MISMATCH");
  }
 }
 const bytes=Buffer.from("Controlled source");
 const unsupported=await call(f.owner,"POST",f.base+"/uploads",{project_id:f.project,filename:"source.docm",content_type:"application/vnd.ms-word.document.macroEnabled.12",size_bytes:bytes.length,sha256:hash(bytes)});
 assert.equal(unsupported.status,415);
});

test("conversation attachment delegation validates the real wire contract, private versions and replay atomically",async()=>{
 const f=await fixture(),c=await ok(f.owner,"POST",f.base+"/conversations",{name:"Pinned private input",agent_id:f.agent.id});
 const source=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"source.csv",mime:"text/csv",bytes:Buffer.from("spend,conversions\n100,40\n"),conversation:c.id}),f.tenant,false,f.owner.id);
 const root=f.base+"/conversations/"+c.id+"/messages",prompt="Read the explicitly pinned campaign source and preserve its version.";
 const body={client_message_id:randomUUID(),expected_version:c.version,intent:"delegate",body:prompt,mode:"execute",budget_micros:1000000,input:{prompt,asset_version_ids:[source.version.id]}};
 const submitted=await call(f.owner,"POST",root,body);assert.equal(submitted.status,200,JSON.stringify(submitted.data));assert.ok(submitted.data.task.id);
 const repeated=await call(f.owner,"POST",root,body);assert.deepEqual(repeated.data,submitted.data);
 const deps=(await s.db.control.query("SELECT resource_ids,state FROM task_dependencies WHERE task_id=$1",[submitted.data.task.id])).rows;
 assert.equal(deps.length,1);assert.deepEqual(deps[0].resource_ids,[source.version.id]);assert.equal(deps[0].state,"resolved");
 assert.equal((await call(f.owner,"POST",root,{...body,input:{prompt,asset_version_ids:[]}})).status,409);
 for(const input of [{prompt:"A changed prompt",asset_version_ids:[source.version.id]},{prompt,asset_version_ids:[source.version.id,source.version.id]}])assert.equal((await call(f.owner,"POST",root,{...body,client_message_id:randomUUID(),expected_version:2,input})).status,400);
 const forbidden=await call(f.owner,"POST",root,{...body,client_message_id:randomUUID(),expected_version:2,input:{prompt,asset_version_ids:[randomUUID()]}});assert.equal(forbidden.status,404);
 assert.equal((await call(f.owner,"POST",root,{...body,client_message_id:randomUUID(),expected_version:2,intent:"note"})).status,400);
 const count=(await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE conversation_id=$1",[c.id])).rows[0].n;assert.equal(count,1);
 assert.equal((await ok(f.owner,"GET",f.base+"/conversations/"+c.id)).version,2);
});
