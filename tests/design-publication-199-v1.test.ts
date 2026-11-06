import {before, after, test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyLogin, historyOk, type HistoryClient} from "./admin-history-fixture.js";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {saveAsset} from "../src/storage.js";
import {canonical, hash} from "../src/lib.js";
import {editableDesignSchema} from "../src/editable-design-model.js";
import {parseEditableInput} from "../src/editable-project-source.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
async function call(user: HistoryClient, method: string, url: string, body?: unknown, key=randomUUID()) {
  const raw=await s.app.inject({method:method as any,url,headers:{origin:s.db.config.WEB_ORIGIN,cookie:user.cookie,"x-csrf-token":user.csrf,"x-tenant-id":user.tenant!,"idempotency-key":key},...(body===undefined?{}:{payload:body as any})});
  return {status:raw.statusCode,data:raw.json()};
}
async function fixture(kind:"vector"|"presentation"="vector", corrupt=false, manifest=false) {
  const user=await historyLogin(s), w=await historyOk(s,user,"POST","/v1/tenants",{name:"Private design publication",project_name:"Real publication route fixture"});user.tenant=w.tenant.id;
  const scene={width:1200,height:800,background:"#f8f2e8",layers:[{kind:"text",id:"copy",x:100,y:100,w:950,h:300,text:"A published design",font_size:48,color:"#372f2b",weight:700}]};
  const input=parseEditableInput(kind,{title:"Editable delivery",locale:"en-HK",...(kind==="vector"?{purpose:"Review",scene}:{audience:"Team",decision:"Approve",slides:[{id:"first",title:"First",notes:"",scene}]})});
  const bytes=Buffer.from(JSON.stringify(manifest?{schema:"copypaste-review-manifest-1",kind}:{schema:editableDesignSchema,kind,input,input_sha256:corrupt?"0".repeat(64):hash(canonical(input)),data_mode:"simulated"}));
  const source=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:user.tenant!,project:w.project.id,user:user.id,privateOwner:user.id,name:manifest?"manifest.json":kind+".source.json",mime:"application/json",bytes,metadata:{editable_design_schema:editableDesignSchema,design_kind:kind,private_note:"DO_NOT_COPY_TO_SHARED_VERSION"}}),user.tenant!,false,user.id);
  return {user,base:`/v1/tenants/${user.tenant}/projects/${w.project.id}`,source,input,bytes};
}
for(const kind of ["vector","presentation"] as const)test(`${kind}: a private source becomes discoverable and directly editable only through an explicit validated publication`,async()=>{
  const f=await fixture(kind), key=randomUUID(), body={name:"Shared "+kind+".source.json",expected_version:1}, url=f.base+"/assets/"+f.source.id+"/publish";
  assert.equal((await historyOk(s,f.user,"GET",f.base+"/editable-projects/sources")).items.length,0);
  const before=(await s.db.control.query("SELECT count(*)::int n FROM assets WHERE tenant_id=$1",[f.user.tenant])).rows[0].n;
  const published=await call(f.user,"POST",url,body,key);assert.equal(published.status,200,JSON.stringify(published.data));assert.deepEqual(await call(f.user,"POST",url,body,key),published);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM assets WHERE tenant_id=$1",[f.user.tenant])).rows[0].n,before+1);
  assert.equal(published.data.version.sha256,hash(f.bytes));
  const meta=(await s.db.control.query("SELECT metadata FROM asset_versions WHERE id=$1",[published.data.version.id])).rows[0].metadata;
  assert.equal(meta.private_note,undefined);assert.equal(meta.task_id,undefined);assert.equal(meta.conversation_id,undefined);assert.equal(meta.publication_origin_version_id,f.source.version.id);
  const sources=await historyOk(s,f.user,"GET",f.base+"/editable-projects/sources");assert.equal(sources.items.length,1);assert.equal(sources.items[0].kind,kind);
  const p=await historyOk(s,f.user,"POST",f.base+"/editable-projects",{name:"Continue shared design",source_version_id:sources.items[0].source_version_id,sha256:sources.items[0].sha256,confirm_project_sharing:true});
  const detail=await historyOk(s,f.user,"GET",f.base+"/editable-projects/"+p.id);assert.deepEqual(detail.input,f.input);
  const preview=await historyOk(s,f.user,"POST",f.base+"/editable-projects/"+p.id+"/draft-preview",{expected_version:1,source_version:1,input:detail.input});assert.equal(preview.saved,false);assert.equal(preview.provider_calls,0);
  const stranger=await historyLogin(s);stranger.tenant=f.user.tenant;assert.ok([403,404].includes((await call(stranger,"POST",url,body)).status));
  assert.equal((await call(f.user,"POST",url,{...body,expected_version:2})).status,409);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM current_ai_provider_requests WHERE tenant_id=$1",[f.user.tenant])).rows[0].n,0);
});
test("publication rejects a source digest mismatch and does not classify a tagged review manifest as an editable source",async()=>{
  const corrupt=await fixture("vector",true);assert.equal((await call(corrupt.user,"POST",corrupt.base+"/assets/"+corrupt.source.id+"/publish",{name:"Corrupt.source.json",expected_version:1})).status,409);
  assert.equal((await historyOk(s,corrupt.user,"GET",corrupt.base+"/editable-projects/sources")).items.length,0);
  const f=await fixture("vector",false,true);const r=await call(f.user,"POST",f.base+"/assets/"+f.source.id+"/publish",{name:"Shared manifest.json",expected_version:1});assert.equal(r.status,200);
  assert.equal((await historyOk(s,f.user,"GET",f.base+"/editable-projects/sources")).items.length,0);
});
