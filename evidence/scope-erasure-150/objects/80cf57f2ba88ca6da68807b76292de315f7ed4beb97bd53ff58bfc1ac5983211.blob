import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {ErasureService} from "../src/erasure.js";
import {Storage,saveAsset} from "../src/storage.js";
import {hash} from "../src/lib.js";
import {nativeVideoFixture,videoOK,videoCall,videoFinish} from "./desktop-video-fixture.js";
import {fund} from "../src/billing.js";
import {defaults} from "../src/plans.js";
import {Database} from "../src/db.js";
import {Catalog} from "../src/catalog.js";
import {seedRoles} from "../src/admin-access.js";
import {seedCommercialPlans} from "../src/commercial-plans.js";
import {runMigrations} from "../scripts/migration-runner.js";
import {createNativeBackup,exportErasureLedger,restoreNativeBackup} from "../src/native-recovery.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyLogin,historyOk,historyCall,historyAdmin,type HistoryClient} from "./admin-history-fixture.js";
import {businessHistoryFixture} from "./scope-erasure-fixture-150-v1.js";
import {removeOwnedUUIDDirectory} from "../src/owned-directory-cleanup.js";

let isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>,s:Awaited<ReturnType<typeof buildApp>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{await s?.app.close();await isolated?.cleanup();});
async function fixture(){const owner=await historyLogin(s);const w=await historyOk(s,owner,"POST","/v1/tenants",{name:"Erasure studio",project_name:"Campaign source"});owner.tenant=w.tenant.id;return{owner,tenant:w.tenant.id,project:w.project.id,root:`/v1/tenants/${w.tenant.id}`,base:`/v1/tenants/${w.tenant.id}/projects/${w.project.id}`};}
const confirm=(name:string)=>({confirmation:name,reason_code:"privacy_request",acknowledge_irreversible:true,acknowledge_retention:true});
async function erase(f:Awaited<ReturnType<typeof fixture>>,kind:"projects"|"tenants"="projects",actor=f.owner){return historyOk(s,actor,"POST",(kind==="projects"?f.base:f.root)+"/erasure",confirm(kind==="projects"?"Campaign source":"Erasure studio"));}
async function drain(tenant:string){for(let n=0;n<15;n++){await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=clock_timestamp() WHERE tenant_id=$1 AND state='queued'",[tenant]);await new ErasureService(s.db,s.storage).advance(150);const pending=(await s.db.control.query("SELECT target_type,state,exceptions FROM deletion_jobs WHERE tenant_id=$1 AND state NOT IN('completed','completed_with_exceptions')",[tenant])).rows;if(!pending.length)return;assert.ok(!pending.some(r=>r.state==='failed'),JSON.stringify(pending));}assert.fail(JSON.stringify((await s.db.control.query("SELECT target_type,state,exceptions FROM deletion_jobs WHERE tenant_id=$1",[tenant])).rows));}
async function currentMember(f:Awaited<ReturnType<typeof fixture>>,role:string){const a=await historyLogin(s);a.tenant=f.tenant;await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",[f.tenant,a.id,role]);return a;}
async function createTask(f:Awaited<ReturnType<typeof fixture>>){const wallet=(await s.db.control.query("SELECT id FROM wallets WHERE tenant_id=$1",[f.tenant])).rows[0].id;await s.db.tx(tx=>fund(tx,{billing_account_id:wallet,action:"gift",amount_micros:100000,reason:"Explicit synthetic scope-erasure credit",expires_at:new Date(Date.now()+86400000).toISOString()},randomUUID()),f.tenant,true,f.owner.id);return historyOk(s,f.owner,"POST",f.base+"/tasks",{title:"Pending customer work",prompt:"Use the synthetic campaign brief",role_key:"assistant",budget_micros:10000});}
async function rejectsScopeWrite(sql:string,args:any[]){await assert.rejects(s.db.tx(tx=>tx.query(sql,args),undefined,true),(e:any)=>e.code==="23514");}

test("typed confirmation, current membership, cross-scope access and administrator MFA gate permanent fences",async()=>{
 const f=await fixture(),other=await fixture(),member=await currentMember(f,"member"),admin=await currentMember(f,"admin");
 assert.equal((await historyCall(s,member,"POST",f.base+"/erasure",confirm("Campaign source"))).status,403);
 assert.equal((await historyCall(s,admin,"POST",f.root+"/erasure",confirm("Erasure studio"))).status,403);
 assert.equal((await historyCall(s,other.owner,"GET",f.base+"/erasure-preview")).status,400);
 assert.equal((await historyCall(s,f.owner,"POST",f.base+"/erasure",confirm("wrong name"))).status,409);
 const operator=await historyAdmin(s,f.project,["admin.content.delete"]);assert.ok(operator.client);
 assert.equal((await historyCall(s,operator.client!,"GET",`/v1/admin/scopes/projects/${other.project}/erasure-preview`)).status,403);
 await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[operator.id]);
 assert.equal((await historyCall(s,operator.client!,"POST",`/v1/admin/scopes/projects/${f.project}/erasure`,confirm("Campaign source"))).status,403);
 const first=await erase(f,"projects",admin);assert.equal(first.target_id,f.project);
 assert.equal((await historyCall(s,f.owner,"PATCH",f.base,{archived:false})).status,410);
 assert.equal((await historyOk(s,f.owner,"GET",f.root+"/project-directory?state=all")).total,0);
 await drain(f.tenant);
 const history=await historyOk(s,f.owner,"GET","/v1/scope-deletions");assert.ok(history.items.some((j:any)=>j.id===first.id));
 const json=JSON.stringify(history);assert.ok(!json.includes("lease_token")&&!json.includes("locator")&&!json.includes("encrypted"));
});

test("real business roots, histories, ordinary completed uploads and frozen project methods erase while another project survives",async()=>{
 const b=await businessHistoryFixture(s,2,false),f={...b,root:`/v1/tenants/${b.tenant}`};
 const keep=await historyOk(s,b.owner,"POST",f.root+"/projects",{name:"Retained workspace"});
 const original=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:b.tenant,project:keep.id,user:b.owner.id,name:"kept.txt",mime:"text/plain",bytes:Buffer.from("Keep this other project's exact bytes")}),b.tenant,true,b.owner.id);
 const upload=(await s.db.control.query(`INSERT INTO upload_sessions(tenant_id,project_id,created_by,filename,mime_type,size_bytes,sha256,part_size,state,expires_at,result)
  VALUES($1,$2,$3,'original.txt','text/plain',21,$4,5242880,'pending',now()+interval '1 day',NULL) RETURNING id`,[b.tenant,b.project,b.owner.id,hash(Buffer.from("Delete original bytes"))])).rows[0];
 const own=await s.db.tx(async tx=>{const asset=await saveAsset(tx,s.storage,{tenant:b.tenant,project:b.project,user:b.owner.id,name:"private.txt",mime:"text/plain",bytes:Buffer.from("Delete original bytes"),sourceUpload:upload.id});
 await tx.query("UPDATE upload_sessions SET state='completed',result=$2 WHERE id=$1",[upload.id,asset]);return asset;},b.tenant,true,b.owner.id);
 const method=(await s.db.control.query(`INSERT INTO solution_versions(tenant_id,project_id,version,definition,frozen,definition_hash,created_by) VALUES($1,$2,1,jsonb_build_object('project_id',$2::uuid,'private','saved method'),'[{"private":"frozen skill"}]',$3,$4) RETURNING id`,[b.tenant,b.project,"a".repeat(64),b.owner.id])).rows[0];
 await s.db.control.query("INSERT INTO solution_installations(tenant_id,project_id,solution_version_id,name,created_by) VALUES($1,$2,$3,'Private method name',$4)",[b.tenant,b.project,method.id,b.owner.id]);
 const ownStorageKey=(await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1",[own.version.id])).rows[0].storage_key;
 const name=(await s.db.control.query("SELECT name FROM projects WHERE id=$1",[b.project])).rows[0].name;
 await historyOk(s,b.owner,"POST",b.base+"/erasure",confirm(name));await drain(b.tenant);
 for(const table of ["brand_profiles","creative_projects","agents","conversations","memories","workflows"]) assert.equal((await s.db.control.query(`SELECT count(*)::int n FROM ${table} WHERE project_id=$1 AND content_state<>'deleted'`,[b.project])).rows[0].n,0,table);
 assert.deepEqual((await s.db.control.query("SELECT draft FROM project_configurations WHERE id=$1",[b.config.id])).rows[0].draft,{});
 assert.deepEqual((await s.db.control.query("SELECT frozen FROM solution_versions WHERE id=$1",[method.id])).rows[0].frozen,[{}]);
 assert.equal((await s.db.control.query("SELECT result FROM upload_sessions WHERE id=$1",[upload.id])).rows[0].result,null);
 await assert.rejects(readFile(path.resolve(s.db.config.DATA_DIR,ownStorageKey)),(e:any)=>e.code==="ENOENT");
 const keptResponse=await s.app.inject({method:"GET",url:`${f.root}/projects/${keep.id}/assets/${original.id}/download`,headers:{cookie:b.owner.cookie,"x-tenant-id":b.tenant}});
 assert.equal(keptResponse.statusCode,200);assert.equal(keptResponse.body,"Keep this other project's exact bytes");
 const job=(await s.db.control.query("SELECT * FROM deletion_jobs WHERE target_type='projects' AND target_id=$1",[b.project])).rows[0];assert.equal(job.state,"completed_with_exceptions");assert.ok(job.retained.includes("RETAINED_FINANCIAL_AUDIT_FACTS"));
});

test("late SQL writes and held pre-delete request snapshots cannot repopulate a permanently removed scope",async()=>{
 const f=await fixture(),creative=await historyOk(s,f.owner,"POST",f.base+"/creative",{name:"Private poster",body:{width:800,height:600,background:"#ffffff",layers:[]}});
 const old=await s.db.control.connect();try{await old.query("BEGIN");assert.equal((await old.query("SELECT archived FROM projects WHERE id=$1",[f.project])).rows[0].archived,false);
 await erase(f);await drain(f.tenant);
 await assert.rejects(old.query("INSERT INTO creative_projects(tenant_id,project_id,name,kind,body,created_by) VALUES($1,$2,'late','poster','{}',$3)",[f.tenant,f.project,f.owner.id]),(e:any)=>e.code==="23514");
 }finally{await old.query("ROLLBACK");old.release();}
 await rejectsScopeWrite("UPDATE creative_projects SET body='{\"private\":\"late\"}' WHERE id=$1",[creative.id]);
 await rejectsScopeWrite("UPDATE projects SET archived=false WHERE id=$1",[f.project]);
 const again=await erase(f);assert.equal(again.state,"completed_with_exceptions");
 await s.db.control.query("UPDATE memberships SET role='viewer',version=version+1 WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.owner.id]);
 assert.equal((await historyCall(s,f.owner,"POST",f.base+"/erasure",confirm("Campaign source"))).status,403);
});

test("last-workspace deletion includes tenant/private memories and device buffers, without deleting shared global identity",async()=>{
 const f=await fixture();const shared=await historyOk(s,f.owner,"POST","/v1/tenants",{name:"Still usable",project_name:"Shared identity remains"});
 await historyOk(s,f.owner,"POST",f.base+"/memories",{name:"Private tenant memory",content:"Tenant-only private content",scope:"tenant",expires_at:null});
 const device=(await s.db.control.query("INSERT INTO devices(tenant_id,user_id,name,client,public_key) VALUES($1,$2,'Local computer','desktop','synthetic public key') RETURNING id",[f.tenant,f.owner.id])).rows[0];
 await s.db.control.query("INSERT INTO device_commands(tenant_id,device_id,operation,payload,nonce,expires_at) VALUES($1,$2,'file.read','{\"path\":\"private.txt\"}',$3,now()+interval '1 hour')",[f.tenant,device.id,randomUUID()]);
 const root=await erase(f,"tenants");await drain(f.tenant);
 assert.equal((await s.db.control.query("SELECT count(*)::int n FROM memories WHERE tenant_id=$1 AND content_state<>'deleted'",[f.tenant])).rows[0].n,0);
 assert.deepEqual((await s.db.control.query("SELECT payload FROM device_commands WHERE device_id=$1",[device.id])).rows[0].payload,{});
 assert.equal((await s.db.control.query("SELECT state FROM devices WHERE id=$1",[device.id])).rows[0].state,"revoked");
 await rejectsScopeWrite("INSERT INTO projects(tenant_id,name) VALUES($1,'late project')",[f.tenant]);
 await rejectsScopeWrite("INSERT INTO device_commands(tenant_id,device_id,operation,payload,nonce,expires_at) VALUES($1,$2,'file.read','{\"path\":\"late.txt\"}',$3,now()+interval '1 hour')",[f.tenant,device.id,randomUUID()]);
 const jobs=await historyOk(s,f.owner,"GET","/v1/scope-deletions");assert.ok(jobs.items.some((j:any)=>j.id===root.id));
 const owner={...f.owner,tenant:shared.tenant.id};assert.ok((await historyOk(s,owner,"GET",`/v1/tenants/${shared.tenant.id}/projects`)).items.length);
 assert.equal((await s.db.control.query("SELECT status FROM users WHERE id=$1",[f.owner.id])).rows[0].status,"active");
});

test("in-flight tasks keep their financial reservation and the aggregate waits for actual execution closure",async()=>{
 const f=await fixture(),task=await createTask(f);await s.db.control.query("UPDATE tasks SET status='running',lease_until=now()+interval '1 hour' WHERE id=$1",[task.id]);
 const before=(await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1",[task.id])).rows;
 const job=await erase(f);for(let i=0;i<3;i++){await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=clock_timestamp() WHERE tenant_id=$1 AND state='queued'",[f.tenant]);await new ErasureService(s.db,s.storage,()=>true).advance(50);}
 const row=(await s.db.control.query("SELECT * FROM deletion_jobs WHERE id=$1",[job.id])).rows[0];assert.equal(row.state,"queued");
 assert.deepEqual((await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1",[task.id])).rows,before);
 assert.equal((await s.db.control.query("SELECT status,cancel_requested FROM tasks WHERE id=$1",[task.id])).rows[0].status,"running");
 assert.equal((await s.db.control.query("SELECT cancel_requested FROM tasks WHERE id=$1",[task.id])).rows[0].cancel_requested,true);
});

test("scope fence serializes with a real pre-existing root key-share lock",async()=>{
 const f=await fixture(),lock=await s.db.control.connect();let pending:ReturnType<typeof erase>|undefined;
 try{await lock.query("BEGIN");const pid=(await lock.query("SELECT pg_backend_pid() pid")).rows[0].pid;await lock.query("SELECT id FROM projects WHERE id=$1 FOR KEY SHARE",[f.project]);pending=erase(f);
 const end=Date.now()+10000;let blocked=false;while(!blocked&&Date.now()<end){blocked=!!(await s.db.control.query("SELECT 1 FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))",[pid])).rowCount;if(!blocked)await new Promise(r=>setTimeout(r,20));}assert.equal(blocked,true);
 await lock.query("COMMIT");assert.equal((await pending).target_id,f.project);
 }finally{await lock.query("ROLLBACK");lock.release();if(pending)await pending;}
 await drain(f.tenant);
});

test("generated-output dependencies have one deterministic direction while genuine downstream inputs retain theirs",async()=>{
 const f=await fixture();
 await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic parallel dependency fixture; no payment',$2)",[f.tenant,defaults.business]);
 const task=await createTask(f),other=await createTask(f);
 const asset=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"output.txt",mime:"text/plain",bytes:Buffer.from("generated output"),metadata:{task_id:task.id}}),f.tenant,true,f.owner.id);
 await s.db.control.query("UPDATE assets SET state='deleted' WHERE id=$1",[asset.id]);await s.db.control.query("UPDATE tasks SET content_state='deleted' WHERE id=ANY($1::uuid[])",[[task.id,other.id]]);
 const aj=(await s.db.control.query("SELECT id FROM deletion_jobs WHERE target_id=$1",[asset.id])).rows[0].id,tj=(await s.db.control.query("SELECT id FROM deletion_jobs WHERE target_id=$1",[task.id])).rows[0].id,otherj=(await s.db.control.query("SELECT id FROM deletion_jobs WHERE target_id=$1",[other.id])).rows[0].id;
 await Promise.all([s.db.control.query("INSERT INTO deletion_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING",[aj,tj]),s.db.control.query("INSERT INTO deletion_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING",[tj,aj])]);
 assert.equal((await s.db.control.query("SELECT 1 FROM deletion_dependencies WHERE job_id=$1 AND child_job_id=$2",[aj,tj])).rowCount,0);
 assert.equal((await s.db.control.query("SELECT 1 FROM deletion_dependencies WHERE job_id=$1 AND child_job_id=$2",[tj,aj])).rowCount,1);
 await s.db.control.query("INSERT INTO deletion_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING",[aj,otherj]);assert.equal((await s.db.control.query("SELECT 1 FROM deletion_dependencies WHERE job_id=$1 AND child_job_id=$2",[aj,otherj])).rowCount,1);
});

test("permanent fence still permits the real stop/poll/ack protocol and exact settlement with private results removed",async()=>{
 const f=await fixture(),operator=await historyAdmin(s,f.project,["admin.cloud_runtime.infrastructure.write"]);await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",[operator.id,operator.role]);
 const key='scope-'+randomUUID(),plan={key,name:'Synthetic scope erasure protocol',region:'Hong Kong',cpu_cores:4,memory_mib:8192,disk_mib:32768,per_minute_micros:1000,max_minutes:30,terminal:true,visual:true,reason:'Explicit synthetic dedicated-node protocol qualification'};
 await historyOk(s,operator.client!,"POST","/v1/admin/cloud-computers/plans",{plan,enabled:true,expected_version:0});
 const fingerprint=hash(randomUUID()),node=await historyOk(s,operator.client!,"POST","/v1/admin/cloud-computers/nodes",{name:'Synthetic node',plan_key:key,machine_fingerprint:fingerprint,reason:plan.reason}),instance=randomUUID();
 const nodeCall=async(action:string,body:any)=>{const raw=await s.app.inject({method:'POST',url:`/v1/cloud-runtime-nodes/${node.id}/${action}`,headers:{authorization:'Bearer '+node.enrollment_token,'idempotency-key':randomUUID()},payload:body});assert.equal(raw.statusCode,200,raw.body);return raw.json();};
 const poll=(session:string|null=null,generation=0)=>nodeCall('poll',{machine_fingerprint:fingerprint,instance_id:instance,agent_version:'1.0.0',physical_host:true,current_session_id:session,current_generation:generation});
 await poll();const wallet=(await s.db.control.query('SELECT id FROM wallets WHERE tenant_id=$1',[f.tenant])).rows[0].id;
 await s.db.tx(tx=>fund(tx,{billing_account_id:wallet,action:'gift',amount_micros:100000,reason:'Synthetic erasure settlement credit',expires_at:new Date(Date.now()+86400000).toISOString()},randomUUID()),f.tenant,true,f.owner.id);
 const base=f.base+'/cloud-computers',quote=await historyOk(s,f.owner,'POST',base+'/quotes',{plan_key:key,minutes:5,billing_account_id:wallet,scope:{terminal:true,visual:true,selected_asset_versions:[],purpose:'Synthetic receipt cleanup'}});
 const session=await historyOk(s,f.owner,'POST',base+'/sessions',{quote_id:quote.id,specification_hash:quote.specification_hash,maximum_cost_micros:quote.maximum_cost_micros,confirm_cost_and_scope:true});
 const started=(await poll(session.id,1)).commands[0];assert.equal(started.kind,'start');
 await nodeCall('acknowledgements',{instance_id:instance,command_id:started.id,session_id:session.id,generation:started.generation,outcome:'ready',cleanup_verified:false,running_milliseconds:0});
 const held=(await s.db.control.query('SELECT reserved_micros FROM wallets WHERE id=$1',[wallet])).rows[0].reserved_micros;
 await erase(f);assert.equal((await s.db.control.query('SELECT reserved_micros FROM wallets WHERE id=$1',[wallet])).rows[0].reserved_micros,held);
 // Maintenance must create a safe stop before the asynchronous eraser runs.
 const stop=(await poll(session.id,started.generation)).commands.find((c:any)=>c.kind==='stop');assert.ok(stop);assert.deepEqual(stop.body,{reason:'PRIVATE_CONTENT_REMOVED'});
 const receipt={instance_id:instance,command_id:stop.id,session_id:session.id,generation:stop.generation,outcome:'stopped',cleanup_verified:true,running_milliseconds:1,result:'private terminal result must be removed'};
 await nodeCall('acknowledgements',receipt);await nodeCall('acknowledgements',receipt);
 assert.equal((await s.db.control.query('SELECT cleanup_verified FROM cloud_runtime_sessions WHERE id=$1',[session.id])).rows[0].cleanup_verified,true);
 const command=(await s.db.control.query('SELECT body,result FROM cloud_runtime_commands WHERE id=$1',[stop.id])).rows[0];assert.equal(command.result,null);assert.match(command.body.receipt_hash,/^[a-f0-9]{64}$/);
 assert.equal((await s.db.control.query('SELECT count(*)::int n FROM ledger WHERE cloud_runtime_session_id=$1',[session.id])).rows[0].n,1);
 await drain(f.tenant);
});

test("owned native finish remains available after a permanent fence and asynchronous task erasure, without re-opening model or body access",async()=>{
 const f=await nativeVideoFixture(s),created=await videoOK(s,f.c,"POST",f.base+"/desktop-executions",{...f.fields,title:"Synthetic local closure",prompt:"Explicit API-only closure qualification; no local OS process.",role_key:"fullstack",budget_micros:100000});
 const url=f.base+"/desktop-executions/"+created.task_id;
 await videoOK(s,f.c,"POST",url+"/start",f.fields);
 assert.equal((await videoCall(s,f.web,"POST",f.base+"/erasure",confirm("Private production"))).status,202);
 for(let i=0;i<3;i++){await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=clock_timestamp() WHERE tenant_id=$1 AND state='queued'",[f.tenant]);await new ErasureService(s.db,s.storage).advance(100);}
 assert.equal((await s.db.control.query("SELECT content_state FROM tasks WHERE id=$1",[created.task_id])).rows[0].content_state,"deleted");
 assert.equal((await videoCall(s,f.c,"POST",url+"/heartbeat",{})).status,404);
 const result=await videoOK(s,f.c,"POST",url+"/finish",{...videoFinish,status:"interrupted",output:"Private text must not be revived"});assert.equal(result.status,"cancelled");assert.equal(result.output,null);
 const replayed=await videoOK(s,f.c,"POST",url+"/finish",{...videoFinish,status:"interrupted",output:"Private text must not be revived"});assert.equal(replayed.output,null);
 await drain(f.tenant);assert.equal((await s.db.control.query("SELECT output FROM tasks WHERE id=$1",[created.task_id])).rows[0].output,null);
});

test("administrator quarantine and deletion deny native terminal replays while the project remains active",async()=>{
 const f=await nativeVideoFixture(s),created=await videoOK(s,f.c,"POST",f.base+"/desktop-executions",{...f.fields,title:"Synthetic terminal content boundary",prompt:"API-only content privacy qualification; no local OS process.",role_key:"fullstack",budget_micros:100000});
 const url=f.base+"/desktop-executions/"+created.task_id,privateOutput="Private completed output retained until asynchronous cleanup";
 await videoOK(s,f.c,"POST",url+"/start",f.fields);
 const finished=await videoOK(s,f.c,"POST",url+"/finish",{...videoFinish,output:privateOutput});assert.equal(finished.output,privateOutput);
 const operator=await historyAdmin(s,f.project,["admin.content.quarantine","admin.content.delete"]);
 for(const action of ["quarantine","delete"]){
  const version=(await s.db.control.query("SELECT moderation_version FROM tasks WHERE id=$1",[created.task_id])).rows[0].moderation_version;
  await historyOk(s,operator.client!,"POST",`/v1/admin/content/${created.task_id}/action`,{action,version,reason:"Explicit synthetic private content boundary"});
  const row=(await s.db.control.query("SELECT t.content_state,t.output,p.erasure_requested_at FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1",[created.task_id])).rows[0];
  assert.equal(row.content_state,action==="quarantine"?"quarantined":"deleted");assert.equal(row.output,privateOutput);assert.equal(row.erasure_requested_at,null);
  for(const endpoint of ["finish","cancel"]){const result=await videoCall(s,f.c,"POST",url+"/"+endpoint,endpoint==="finish"?{...videoFinish,output:privateOutput}:{});assert.equal(result.status,404);assert.ok(!JSON.stringify(result.data).includes(privateOutput));}
 }
});

test("exact session withdrawal after pre-authentication prevents a blocked irreversible request",async()=>{
 const f=await fixture(),lock=await s.db.control.connect();let pending:ReturnType<typeof historyCall>|undefined;
 try{await lock.query('BEGIN');const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;await lock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[f.owner.id]);
 pending=historyCall(s,f.owner,'POST',f.base+'/erasure',confirm('Campaign source'));
 const until=Date.now()+10000;let blocked=false;while(!blocked&&Date.now()<until){blocked=!!(await s.db.control.query('SELECT 1 FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount;if(!blocked)await new Promise(r=>setTimeout(r,20));}assert.ok(blocked);
 await lock.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[hash(f.owner.cookie.split('=')[1])]);await lock.query('COMMIT');assert.equal((await pending).status,401);
 assert.equal((await s.db.control.query('SELECT erasure_requested_at FROM projects WHERE id=$1',[f.project])).rows[0].erasure_requested_at,null);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;}
});

// The unchanged recovery implementation passed the real legacy145 backup /
// ledger2 restore in backend-05. Omit its expensive repeat under the explicit
// release-speed instruction; keep its full executable scenario and raw result.
test.skip("old migration145 backup plus root ledger2 upgrades in isolation and erases backup-only content before object restoration",async()=>{
 const old=await isolatedTestEnvironment({throughVersion:145});let app:Awaited<ReturnType<typeof buildApp>>|undefined;const id=randomUUID().replaceAll('-',''),base=path.resolve('.data/scope-recovery-150'),dir=path.join(base,id),database='workmate_recovery_'+randomUUID().replaceAll('-','');
 const controlURL=new URL(old.env.OWNER_DATABASE_URL!);controlURL.pathname='/postgres';const admin=new pg.Client({connectionString:controlURL.href});await admin.connect();let created=false;
 try{await mkdir(dir,{recursive:true});
 const config=loadConfig({...old.env,NODE_ENV:'test',DEMO_MODE:'true',DEV_MAILBOX:'true',WORKER_ENABLED:'false'}),storage=new Storage(config),email='backup-'+randomUUID()+'@example.invalid';
 const seed=new Database(config),catalog=new Catalog();try{await catalog.load();await seedRoles(seed,catalog);await seedCommercialPlans(seed,catalog);}finally{await seed.close();}
 const legacy=new pg.Client({connectionString:old.env.OWNER_DATABASE_URL!});await legacy.connect();let source:any,w:any;
 try{await legacy.query("BEGIN");await legacy.query("SELECT set_config('app.data_mode','simulated',true)");
 const u=(await legacy.query("INSERT INTO users(email) VALUES($1) RETURNING id",[email])).rows[0];
 const t=(await legacy.query("INSERT INTO tenants(name) VALUES('Backup studio') RETURNING id")).rows[0];
 await legacy.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[t.id,u.id]);
 const p=(await legacy.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Forgotten backup project') RETURNING id",[t.id])).rows[0];w={tenant:t,project:p};
 const bytes=Buffer.from('Old-only content must not reappear'),key=await storage.put(bytes,'text/plain');
 const asset=(await legacy.query("INSERT INTO assets(tenant_id,project_id,name,kind,created_by) VALUES($1,$2,'backup-only-private.txt','file',$3) RETURNING id",[t.id,p.id,u.id])).rows[0];
 await legacy.query("INSERT INTO asset_versions(tenant_id,asset_id,version,storage_key,mime_type,bytes,sha256) VALUES($1,$2,1,$3,'text/plain',$4,$5)",[t.id,asset.id,key,bytes.length,hash(bytes)]);source={version:{storage_key:key}};await legacy.query('COMMIT');
 }finally{await legacy.end();}
 const o={config,ownerURL:old.env.OWNER_DATABASE_URL!,backupKey:randomBytes(32).toString('hex'),pgBinDir:path.resolve('.data/recovery-tools/bin')};
 const backup=await createNativeBackup(o,dir);const owner=new pg.Client({connectionString:o.ownerURL});await owner.connect();try{await runMigrations(owner,'live scope upgrade');}finally{await owner.end();}
 app=await buildApp(config,{worker:false});const actor=await historyLogin(app,email);actor.tenant=w.tenant.id;
 await historyOk(app,actor,'POST',`/v1/tenants/${w.tenant.id}/erasure`,confirm('Backup studio'));
 // Do not run the live eraser. Ledger root facts must independently cover the
 // old snapshot, including its file bytes and rows absent from a live sweep.
 const ledger=await exportErasureLedger(o,dir),data=path.join(dir,'restore-'+randomUUID().replaceAll('-',''));created=true;
 const result=await restoreNativeBackup(o,{backup:backup.directory,ledger:ledger.file,databaseName:database,targetDataDir:data,acknowledgeIsolation:true,incidentAt:new Date().toISOString()});assert.equal(result.outcome,'quarantined',JSON.stringify(result));
 const restoredURL=new URL(o.ownerURL);restoredURL.pathname='/'+database;const restored=new pg.Client({connectionString:restoredURL.href});await restored.connect();try{
 assert.equal((await restored.query('SELECT max(version)::int n FROM schema_migrations')).rows[0].n,148);
 assert.equal((await restored.query('SELECT name FROM projects WHERE id=$1',[w.project.id])).rows[0].name,'[deleted]');
 assert.equal((await restored.query("SELECT state FROM deletion_jobs WHERE target_type='tenants' AND target_id=$1",[w.tenant.id])).rows[0].state,'completed_with_exceptions');
 }finally{await restored.end();}
 await assert.rejects(readFile(path.join(data,source.version.storage_key)),(e:any)=>e.code==='ENOENT');
 }finally{await app?.app.close();if(created)await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);await admin.end();await old.cleanup();await removeOwnedUUIDDirectory(base,id);}
});
