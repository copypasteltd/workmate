import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import {randomUUID} from "node:crypto";
import {unzipSync} from "fflate";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {ErasureService} from "../src/erasure.js";
import {saveAsset} from "../src/storage.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyCall,historyOk,historyUrl,historyAdmin,type HistoryClient} from "./admin-history-fixture.js";
import {workflowHistoryFixture} from "./workflow-history-fixture-153-v1.js";
import {nativeVideoFixture,startNativeVideo,videoOK,videoToolRequest,videoFinish} from "./desktop-video-fixture.js";

let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>,f:Awaited<ReturnType<typeof workflowHistoryFixture>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});f=await workflowHistoryFixture(s);});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
const read=(id=f.shared.id,query="",client=f.operator.client!)=>historyOk(s,client,"GET",historyUrl("workflows",id,query));
const call=(id:string,client=f.operator.client!)=>historyCall(s,client,"GET",`/v1/admin/content/${id}/body`);
const cursor=(value:string)=>"cursor="+encodeURIComponent(value);

test("all 105 retained shared versions have reversible bounded pages and original provenance",async()=>{
 const seen:number[]=[];let page=await read(),first=page;
 assert.equal(page.items.length,50);assert.equal(page.history_scope,"retained_versions");
 for(;;){seen.push(...page.items.map((v:any)=>v.version));if(!page.next_cursor)break;page=await read(f.shared.id,cursor(page.next_cursor));}
 assert.deepEqual(seen,Array.from({length:105},(_,i)=>105-i));assert.equal(new Set(seen).size,105);
 assert.equal((await read(f.shared.id,cursor(page.previous_cursor))).items[0].version,55);
 assert.equal((await read(f.shared.id,"edge=last")).items.at(-1).body.definition.steps[1].message,f.definition(1).steps[1].message);
 assert.equal(first.items[0].origin,"system_snapshot");assert.equal((await read(f.shared.id,"edge=last")).items.at(-1).origin,"customer");
 const old=await call(f.shared.id);assert.equal(old.status,200);assert.equal(old.data.truncated,true);assert.match(old.data.history_url,/workflows/);
});

test("private cloud versions remain readable after the creator expires and the investigated root is quarantined",async()=>{
 let page=await read(f.privateWorkflow.id);assert.deepEqual(page.items.map((v:any)=>v.version),[3,2,1]);assert.ok(page.items[0].body.source_refs.datasets.includes(f.dataset.id));
 await s.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1,retention_expires_at=now()-interval '1 day' WHERE id=$1",[f.originTask.id]);
 await s.db.control.query("UPDATE workflows SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.privateWorkflow.id]);
 page=await read(f.privateWorkflow.id);assert.ok(page.items.every((v:any)=>v.body));assert.equal((await call(f.privateWorkflow.id)).data.source_unavailable,false);
 await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1",[f.project]);assert.ok((await read(f.privateWorkflow.id)).items[0].body);
 await s.db.control.query("UPDATE projects SET archived=false WHERE id=$1",[f.project]);
 await s.db.control.query("UPDATE workflows SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",[f.privateWorkflow.id]);
});

test("source withdrawal redacts shared/private exact bodies and cannot be bypassed through legacy body endpoints",async()=>{
 await s.db.control.query("UPDATE analytics_datasets SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);
 try{for(const w of[f.shared,f.privateWorkflow]){const page=await read(w.id);assert.ok(page.items.every((v:any)=>v.source_unavailable&&v.body===null&&!v.sha256&&!v.role_hashes));
  const old=await call(w.id);assert.equal(old.status,200);assert.equal(old.data.source_unavailable,true);assert.equal(old.data.text,"null");}}
 finally{await s.db.control.query("UPDATE analytics_datasets SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);}
});

test("new saves and publication changes invalidate signed cursors; existing saved definitions cannot be overwritten",async()=>{
 const page=await read();await s.db.control.query("UPDATE workflows SET version=106,definition=$2 WHERE id=$1",[f.shared.id,f.definition(106)]);
 assert.equal((await historyCall(s,f.operator.client!,"GET",historyUrl("workflows",f.shared.id,cursor(page.next_cursor)))).data.error.code,"CONTENT_HISTORY_CHANGED");
 await assert.rejects(s.db.control.query("UPDATE workflow_shared_versions SET definition='{}' WHERE workflow_id=$1 AND version=1",[f.shared.id]),/immutable/);
 await assert.rejects(s.db.control.query("UPDATE workflows SET definition='{}' WHERE id=$1",[f.shared.id]),/new saved version/);
 await assert.rejects(s.db.control.query("UPDATE workflows SET history_revision=1 WHERE id=$1",[f.shared.id]),/managed by saved versions/);
 const a=(await read(f.privateWorkflow.id)).history_revision;
 await s.db.control.query("UPDATE workflow_versions SET published_at=now() WHERE workflow_id=$1 AND version=3",[f.privateWorkflow.id]);
 assert.notEqual((await read(f.privateWorkflow.id)).history_revision,a);
});

test("current body permission, scoped allow/deny, recent MFA, original session and signed cursor bindings apply to both endpoints",async()=>{
 const restricted=await historyAdmin(s,f.project,["admin.content.read"]),outside=await historyAdmin(s,randomUUID()),other=await historyAdmin(s,f.project);
 for(const a of[restricted,outside]){assert.equal((await historyCall(s,a.client!,"GET",historyUrl("workflows",f.shared.id))).status,403);assert.equal((await call(f.shared.id,a.client!)).status,403);}
 const page=await read();assert.equal((await historyCall(s,other.client!,"GET",historyUrl("workflows",f.shared.id,cursor(page.next_cursor)))).status,400);
 await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[other.id]);
 assert.equal((await call(f.shared.id,other.client!)).data.error.code,"MFA_REQUIRED");
 await s.db.control.query("UPDATE sessions SET mfa_at=now() WHERE admin_id=$1",[other.id]);
 await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[other.id,other.role,f.project]);
 assert.equal((await call(f.shared.id,other.client!)).status,403);
 await s.db.control.query("UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",[other.id]);assert.equal((await call(f.shared.id,other.client!)).status,401);
 const cp=await s.db.app.query("SELECT has_function_privilege(current_user,'admin_workflow_source_manifest(uuid,uuid,jsonb,uuid)','EXECUTE') AS permitted");assert.equal(cp.rows[0].permitted,false);
});

test("workspace ZIP includes every available shared definition and filters withdrawn historical/current definition bodies",async()=>{
 async function archive(){const p=await historyOk(s,f.owner,"GET",f.base+"/export-preview");const r=await s.app.inject({method:"GET",url:f.base+"/export-package?"+new URLSearchParams({expected_snapshot:p.snapshot,acknowledge:"true"}),headers:{cookie:f.owner.cookie,"x-tenant-id":f.tenant,origin:s.db.config.WEB_ORIGIN}});assert.equal(r.statusCode,200,r.body);return unzipSync(r.rawPayload);}
 const records=(z:any,name:string)=>Buffer.from(z["data/"+name+".ndjson"]).toString("utf8").trim().split("\n").filter(Boolean).map(v=>JSON.parse(v));
 const before=await archive();assert.equal(records(before,"workflow_shared_versions").filter((r:any)=>r.workflow_id===f.shared.id).length,106);
 await s.db.control.query("UPDATE analytics_datasets SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);
 try{const after=await archive();assert.equal(records(after,"workflow_shared_versions").filter((r:any)=>r.workflow_id===f.shared.id).length,0);assert.equal(records(after,"workflows").find((r:any)=>r.id===f.shared.id).definition,null);}
 finally{await s.db.control.query("UPDATE analytics_datasets SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);}
});

test("legacy run reads withhold cached definitions/results after a fixed output is withdrawn",async()=>{
 const run=(await s.db.control.query("INSERT INTO workflow_runs(tenant_id,project_id,workflow_id,created_by,actor_auth_version,definition,state) VALUES($1,$2,$3,$4,(SELECT auth_version FROM users WHERE id=$4),$5,'succeeded') RETURNING *",[f.tenant,f.project,f.shared.id,f.owner.id,f.definition(1)])).rows[0];
 const output=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"Retained workflow result.txt",mime:"text/plain",bytes:Buffer.from("Original result")}),f.tenant,false,f.owner.id);
 await s.db.control.query("UPDATE workflow_runs SET results=$2 WHERE id=$1",[run.id,JSON.stringify([{kind:"analytics.summary",asset_version_id:output.version.id}])]);
 assert.equal((await call(run.id)).data.source_unavailable,false);
 const visible=await historyOk(s,f.operator.client!,"GET",historyUrl("workflow_runs",run.id));assert.equal(visible.history_scope,"current_snapshot");assert.ok(visible.items[0].body.results);
 await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[output.id]);
 const hidden=(await call(run.id)).data;assert.equal(hidden.source_unavailable,true);assert.equal(JSON.parse(hidden.text).results,null);assert.equal(JSON.parse(hidden.text).definition,null);
 const snapshot=await historyOk(s,f.operator.client!,"GET",historyUrl("workflow_runs",run.id));assert.equal(snapshot.items[0].body,null);assert.equal(snapshot.items[0].source_unavailable,true);
});

test("Desktop private saved versions use the same admin reader without executing a native model",async()=>{
 const n=await nativeVideoFixture(s),root=await startNativeVideo(s,n,{role_key:"workflow-consultant"});
 try{let draft=(await videoOK(s,n.c,"POST",root.url+"/tools",videoToolRequest("workflow_save",{name:"Private native history",definition:{steps:[{kind:"codex",role_key:"fullstack",prompt:"Prepare a local campaign review",budget_micros:100000}]}}))).output;
  const admin=await historyAdmin(s,n.project);const page=await read(draft.workflow_id,"",admin.client!);assert.equal(page.items.length,1);assert.equal(page.items[0].body.execution_location,"desktop");
  const old=await call(draft.workflow_id,admin.client!);assert.equal(JSON.parse(old.data.text).versions.length,1);
  const tool=async(name:string,args:any)=>(await videoOK(s,n.c,"POST",root.url+"/tools",videoToolRequest(name,args))).output;

  draft=await tool("workflow_save",{name:"Private native history",workflow_id:draft.workflow_id,expected_version:draft.version,definition:{steps:[{kind:"codex",role_key:"fullstack",prompt:"Prepare a second local campaign review",budget_micros:100000}]}});
  const saved=(await s.db.control.query("SELECT source_refs FROM workflow_versions WHERE workflow_id=$1 AND version=$2",[draft.workflow_id,draft.version])).rows[0];
  assert.ok(saved.source_refs.workflows.some((w:any)=>w.workflow_id===draft.workflow_id&&w.version===1));
  const published=await tool("workflow_publish",{workflow_id:draft.workflow_id,expected_version:draft.version});
  const requested=await tool("workflow_run",{workflow_id:published.workflow_id,version:published.version,definition_hash:published.definition_hash});
  const url=root.url+"/workflow-runs/"+requested.run.id;
  const approved=await videoOK(s,n.c,"POST",url+"/decision",{expected_revision:requested.run.revision,stage:"launch",decision:"approve",definition_hash:requested.definition_hash});
  await videoOK(s,n.c,"POST",url+"/advance",{expected_revision:approved.run.revision});
  const child=(await s.db.control.query("SELECT * FROM tasks WHERE desktop_workflow_run_id=$1",[requested.run.id])).rows[0];assert.ok(child);
  await s.db.control.query("UPDATE workflow_runs SET results=$2 WHERE id=$1",[requested.run.id,JSON.stringify([{kind:"codex",task_id:child.id,files:[]}])]);
  assert.equal((await call(requested.run.id,admin.client!)).data.source_unavailable,false);
  await s.db.control.query("UPDATE workflow_runs SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[requested.run.id]);
  assert.equal((await call(requested.run.id,admin.client!)).data.source_unavailable,false);
  await s.db.control.query("UPDATE workflows SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[draft.workflow_id]);
  assert.equal((await call(requested.run.id,admin.client!)).data.source_unavailable,false);
  await s.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[child.id]);
  assert.equal((await call(requested.run.id,admin.client!)).data.source_unavailable,true);}
 finally{await videoOK(s,n.c,"POST",root.url+"/finish",{...videoFinish,status:"failed",output:"Explicit control-plane test only; no local process or provider request was started"});}
});

test("permanent workflow erasure removes shared history and denies later history reads or scope re-insertion",async()=>{
 const w=await historyOk(s,f.owner,"POST",f.base+"/workflows",{name:"Erase retained workflow",definition:{steps:[{kind:"approval",message:"Delete this private business text"}]}});
 await s.db.control.query("UPDATE workflows SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[w.id]);await new ErasureService(s.db,s.storage).advance(30);
 assert.equal((await s.db.control.query("SELECT count(*) FROM workflow_shared_versions WHERE workflow_id=$1",[w.id])).rows[0].count,"0");assert.equal((await call(w.id)).status,410);
 await s.db.control.query("UPDATE projects SET archived=true,erasure_requested_at=now() WHERE id=$1",[f.project]);
 await assert.rejects(s.db.control.query("INSERT INTO workflow_shared_versions(workflow_id,version,tenant_id,project_id,name,definition,origin) SELECT id,version,tenant_id,project_id,name,definition,'system_snapshot' FROM workflows WHERE id=$1",[f.shared.id]),/erasure|deleted|closed/i);
});
