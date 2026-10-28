import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { PNG } from "pngjs";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, hash } from "../src/lib.js";
import { fund } from "../src/billing.js";
import { saveAsset } from "../src/storage.js";
import { DedicatedCloud } from "../src/dedicated-cloud.js";
import { dedicatedMaximumCost, dedicatedUsageCost } from "../src/dedicated-cloud-model.js";
import { validateDedicatedFrame } from "../src/dedicated-cloud-frame.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";

type Client = {id:string;cookie:string;csrf:string};
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
let customer: Client, colleague: Client, admin: Client, tenant:string, project:string, wallet:string, base:string;
let node:any, instance=randomUUID(), quote:any, session:any, start:any;
const plan={key:"hk-physical-test",name:"Synthetic dedicated computer plan",region:"Hong Kong",cpu_cores:4,memory_mib:8192,disk_mib:32768,
  per_minute_micros:1000,max_minutes:30,terminal:true,visual:true,reason:"Synthetic operator-preprovisioned node qualification"};
async function request(c:Client|undefined,method:string,url:string,body?:unknown,idempotency=randomUUID(),bearer?:string){
  const r=await s.app.inject({method:method as any,url,headers:{origin:url.startsWith("/v1/admin")?s.db.config.ADMIN_ORIGIN:s.db.config.WEB_ORIGIN,
    "idempotency-key":idempotency,...(c?{cookie:c.cookie,"x-csrf-token":c.csrf}:{}),...(bearer?{authorization:"Bearer "+bearer}:{}),
    ...(body===undefined?{}:{"content-type":"application/json"})},payload:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.statusCode,body:r.json(),raw:r};
}
async function login(email:string,isAdmin=false,secret?:OTPAuth.Secret):Promise<Client>{
  const prefix=isAdmin?"/v1/admin/auth":"/v1/auth",ch=await request(undefined,"POST",prefix+"/challenge",{email});assert.equal(ch.status,200,JSON.stringify(ch.body));
  const mail=JSON.parse(await readFile(path.join(s.db.config.DATA_DIR,"mailbox",ch.body.challenge_id+".json"),"utf8"));
  const r=await request(undefined,"POST",prefix+"/verify",{challenge_id:ch.body.challenge_id,code:mail.text.match(/\b\d{6}\b/)[0],
    ...(secret?{totp:new OTPAuth.TOTP({secret,digits:6,period:30,algorithm:"SHA1"}).generate()}: {})});assert.equal(r.status,200,JSON.stringify(r.body));
  const cookie=r.raw.cookies.find(c=>c.name===(isAdmin?"cp_admin_session":"cp_session"))!;
  return {id:r.body.user?.id??r.body.admin?.id,cookie:cookie.name+"="+cookie.value,csrf:r.body.csrf_token};
}
async function poll(current:string|null=null,generation=0){return request(undefined,"POST","/v1/cloud-runtime-nodes/"+node.id+"/poll",{
  machine_fingerprint:hash("synthetic node "+node.id),instance_id:instance,agent_version:"1.0.0",physical_host:true,current_session_id:current,current_generation:generation},randomUUID(),node.enrollment_token);}
async function acknowledge(command:any,outcome:string,cleanup=false,ms=0,result?:string){return request(undefined,"POST","/v1/cloud-runtime-nodes/"+node.id+"/acknowledgements",{
  instance_id:instance,command_id:command.id,session_id:command.session_id,generation:command.generation,outcome,cleanup_verified:cleanup,running_milliseconds:ms,...(result?{result}:{})},randomUUID(),node.enrollment_token);}
before(async()=>{
  isolated=await isolatedTestEnvironment();
  s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});
  customer=await login("computer-owner-"+randomUUID()+"@example.invalid"); colleague=await login("computer-colleague-"+randomUUID()+"@example.invalid");
  const workspace=await request(customer,"POST","/v1/tenants",{name:"Dedicated computer qualification",project_name:"Private campaign"});assert.equal(workspace.status,200,JSON.stringify(workspace.body));
  tenant=workspace.body.tenant.id;project=workspace.body.project.id;base=`/v1/tenants/${tenant}/projects/${project}/cloud-computers`;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')",[tenant,colleague.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",[tenant,project,colleague.id]);
  wallet=(await s.db.control.query("SELECT id FROM wallets WHERE tenant_id=$1",[tenant])).rows[0].id;
  const email="computer-admin-"+randomUUID()+"@example.invalid",secret=new OTPAuth.Secret({size:20});
  const principal=(await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Computer QA',$2) RETURNING id",[email,seal(s.db.config.MASTER_KEY!,secret.base32)])).rows[0];
  const role="cloud_test_"+randomUUID().replaceAll("-","");
  await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Computer test',$2)",[role,JSON.stringify(["admin.cloud_runtime.infrastructure.write","admin.cloud_runtime.sessions.read","admin.cloud_runtime.sessions.stop","admin.cloud_runtime.sessions.reconcile"])]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",[principal.id,role]);
  admin=await login(email,true,secret);
});
after(async()=>{await s?.app.close();await isolated?.cleanup();});

test("resource arithmetic uses exact microdollars and bounded, fully decoded PNGs",()=>{
  assert.equal(dedicatedMaximumCost(1_000_000_000,1440),"1440000000000");
  assert.equal(dedicatedUsageCost(1000,1,"5000"),"1");assert.equal(dedicatedUsageCost(1000,60_001,"5000"),"1001");
  assert.throws(()=>dedicatedUsageCost(1000,300001,"5000"));assert.throws(()=>validateDedicatedFrame(Buffer.from("89504e470d0a1a0a","hex").toString("base64")));
  const image=new PNG({width:1280,height:720});image.data.fill(230);const bytes=PNG.sync.write(image);assert.deepEqual(validateDedicatedFrame(bytes.toString("base64")),bytes);
  assert.throws(()=>validateDedicatedFrame(Buffer.concat([bytes,Buffer.from("trailing")]).toString("base64")));
});
test("only a current MFA administrator can publish a versioned price; stale concurrent publication cannot overwrite it",async()=>{
  assert.equal((await request(customer,"POST","/v1/admin/cloud-computers/plans",{plan,enabled:true,expected_version:0})).status,401);
  const replies=await Promise.all([1,2].map(()=>request(admin,"POST","/v1/admin/cloud-computers/plans",{plan,enabled:true,expected_version:0})));
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_plans WHERE key=$1",[plan.key])).rows[0].n,1);
});
test("enrollment returns a node credential once and unauthenticated polling cannot run maintenance",async()=>{
  const key=randomUUID(),body={name:"Synthetic physical node protocol fixture",plan_key:plan.key,machine_fingerprint:hash("synthetic pending fingerprint"),reason:plan.reason};
  const r=await request(admin,"POST","/v1/admin/cloud-computers/nodes",body,key);assert.equal(r.status,200,JSON.stringify(r.body));node=r.body;assert.match(node.enrollment_token,/^[A-Za-z0-9_-]{43}$/);
  // The synthetic enrolled identity is fixed before its first authenticated poll.
  await s.db.control.query("UPDATE cloud_runtime_nodes SET machine_fingerprint=$2 WHERE id=$1",[node.id,hash("synthetic node "+node.id)]);
  const retry=await request(admin,"POST","/v1/admin/cloud-computers/nodes",body,key);assert.equal(retry.status,200);assert.equal(retry.body.enrollment_token,undefined);
  const saved=(await s.db.control.query("SELECT token_hash FROM cloud_runtime_nodes WHERE id=$1",[node.id])).rows[0];assert.equal(saved.token_hash,hash(node.enrollment_token));
  const wrong=await request(undefined,"POST","/v1/cloud-runtime-nodes/"+node.id+"/poll",{machine_fingerprint:hash("synthetic node "+node.id),instance_id:instance,
    agent_version:"1.0.0",physical_host:true,current_session_id:null,current_generation:0},randomUUID(),"x".repeat(43));assert.equal(wrong.status,401);
  const ready=await poll();assert.equal(ready.status,200,JSON.stringify(ready.body));assert.equal(ready.body.stop_all,false);
});
test("reviewing resource cost does not reserve funds, and altered or omitted confirmation cannot activate a computer",async()=>{
  const before=(await s.db.control.query("SELECT balance_micros,reserved_micros FROM wallets WHERE id=$1",[wallet])).rows[0];
  const r=await request(customer,"POST",base+"/quotes",{plan_key:plan.key,minutes:5,billing_account_id:wallet,
    scope:{terminal:true,visual:true,selected_asset_versions:[],purpose:"Synthetic campaign review and terminal qualification"}});assert.equal(r.status,200,JSON.stringify(r.body));quote=r.body;
  assert.equal(quote.maximum_cost_micros,"5000");assert.equal(quote.customer_confirmation_required,true);
  assert.deepEqual((await s.db.control.query("SELECT balance_micros,reserved_micros FROM wallets WHERE id=$1",[wallet])).rows[0],before);
  const confirm={quote_id:quote.id,specification_hash:quote.specification_hash,maximum_cost_micros:quote.maximum_cost_micros};
  assert.equal((await request(customer,"POST",base+"/sessions",confirm)).status,400);
  assert.equal((await request(customer,"POST",base+"/sessions",{...confirm,confirm_cost_and_scope:true,maximum_cost_micros:"5001"})).status,409);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_holds")).rows[0].n,0);
});
test("concurrent exact customer confirmation allocates one generation and one original-payer hold",async()=>{
  const key=randomUUID(),b={quote_id:quote.id,specification_hash:quote.specification_hash,maximum_cost_micros:quote.maximum_cost_micros,confirm_cost_and_scope:true};
  const unfunded=await request(customer,"POST",base+"/sessions",b);assert.equal(unfunded.status,402);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_holds")).rows[0].n,0);
  // Synthetic funding goes through the real funding-lot and journal controller;
  // no wallet balances, reservations or financial constraints are bypassed.
  await s.db.tx(tx=>fund(tx,{billing_account_id:wallet,action:"gift",amount_micros:100000,
    reason:"Synthetic dedicated-computer qualification credit",expires_at:new Date(Date.now()+86_400_000).toISOString()},randomUUID()),tenant,true,customer.id);
  const replies=await Promise.all([1,2].map(()=>request(customer,"POST",base+"/sessions",b,key)));
  for(const r of replies)assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(replies[0].body.id,replies[1].body.id);session=replies[0].body;
  const hold=(await s.db.control.query("SELECT * FROM cloud_runtime_holds WHERE session_id=$1",[session.id])).rows[0];assert.equal(hold.amount_micros,"5000");assert.equal(hold.private_owner,customer.id);assert.equal(hold.billing_account_id,wallet);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_sessions")).rows[0].n,1);
  assert.equal((await request(colleague,"GET",base+"/sessions/"+session.id)).status,404);
  const p=await poll();assert.equal(p.status,200,JSON.stringify(p.body));assert.equal(p.body.commands.length,1);start=p.body.commands[0];assert.equal(start.kind,"start");
  assert.equal(start.body.specification.kernel,"codex");assert.equal(start.body.specification.ai_routing,"company_only");
  const deadline=(await s.db.control.query("SELECT expires_at=$2::timestamptz AS exact FROM cloud_runtime_sessions WHERE id=$1",[session.id,start.body.deadline])).rows[0];assert.equal(deadline.exact,true);
  const ready=await acknowledge(start,"ready");assert.equal(ready.status,200,JSON.stringify(ready.body));assert.equal(ready.body.state,"running");
  const versionBefore=(await s.db.control.query("SELECT s.version AS session_version,n.version AS node_version FROM cloud_runtime_sessions s JOIN cloud_runtime_nodes n ON n.id=s.node_id WHERE s.id=$1",[session.id])).rows[0];
  assert.equal((await poll(session.id,start.generation)).status,200);
  assert.deepEqual((await s.db.control.query("SELECT s.version AS session_version,n.version AS node_version FROM cloud_runtime_sessions s JOIN cloud_runtime_nodes n ON n.id=s.node_id WHERE s.id=$1",[session.id])).rows[0],versionBefore,"Heartbeat and fair-sweep bookkeeping must not invalidate a customer's or administrator's reviewed state");
});
test("only the private owner sees the live view; commands stay bounded and exact replay never creates another operation",async()=>{
  const view=base+"/sessions/"+session.id+"/view";assert.equal((await request(colleague,"GET",view)).status,404);assert.equal((await request(customer,"GET",view)).status,200);
  const key=randomUUID(),body={kind:"terminal",command:"Write-Output 'synthetic protocol fixture'"};
  const r=await request(customer,"POST",base+"/sessions/"+session.id+"/inputs",body,key);assert.equal(r.status,200,JSON.stringify(r.body));
  const duplicate=await request(customer,"POST",base+"/sessions/"+session.id+"/inputs",body,key);assert.equal(duplicate.body.command_id,r.body.command_id);
  assert.equal((await request(customer,"POST",base+"/sessions/"+session.id+"/inputs",body)).status,409);
  const p=await poll(session.id,start.generation),command=p.body.commands[0];assert.equal(command.id,r.body.command_id);
  const ack=await acknowledge(command,"completed",false,0,"Synthetic node protocol response");assert.equal(ack.status,200,JSON.stringify(ack.body));
  assert.equal((await acknowledge(command,"completed",false,0,"Synthetic node protocol response")).status,200);
  assert.equal((await acknowledge(command,"completed",false,0,"Changed receipt")).status,409);
});
test("frames require exact generation and pixels and are private to the authorized session owner",async()=>{
  const image=new PNG({width:1280,height:720});image.data.fill(205);const png=PNG.sync.write(image).toString("base64"),body={instance_id:instance,session_id:session.id,generation:start.generation,sequence:1,png_base64:png};
  const url="/v1/cloud-runtime-nodes/"+node.id+"/frames";
  assert.equal((await request(undefined,"POST",url,{...body,generation:start.generation+1},randomUUID(),node.enrollment_token)).status,409);
  assert.equal((await request(undefined,"POST",url,body,randomUUID(),node.enrollment_token)).status,200);
  assert.equal((await request(undefined,"POST",url,body,randomUUID(),node.enrollment_token)).status,409);
  const view=await request(customer,"GET",base+"/sessions/"+session.id+"/view");assert.equal(view.body.frame.png_base64,png);
});
test("stop retains uncertain funds and exclusive ownership until a verified bounded receipt settles exactly once",async()=>{
  const stop=await request(customer,"POST",base+"/sessions/"+session.id+"/stop",{});assert.equal(stop.status,200);assert.equal(stop.body.state,"stop_requested");
  const before=(await s.db.control.query("SELECT * FROM wallets WHERE id=$1",[wallet])).rows[0];assert.equal(before.reserved_micros,"5000");
  assert.equal((await request(customer,"GET",base+"/sessions/"+session.id+"/view")).status,404);
  const p=await poll(session.id,start.generation),command=p.body.commands[0];assert.equal(command.kind,"stop");
  assert.equal((await acknowledge(command,"stopped",false,1)).status,409);
  assert.equal((await acknowledge(command,"stopped",true,300001)).status,409);
  assert.equal((await s.db.control.query("SELECT state FROM cloud_runtime_holds WHERE session_id=$1",[session.id])).rows[0].state,"reserved");
  const r=await acknowledge(command,"stopped",true,1);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.state,"stopped");
  assert.equal((await acknowledge(command,"stopped",true,1)).status,200);
  const after=(await s.db.control.query("SELECT * FROM wallets WHERE id=$1",[wallet])).rows[0];assert.equal(after.reserved_micros,"0");assert.equal(BigInt(before.balance_micros)-BigInt(after.balance_micros),1n);
  const charges=(await s.db.control.query("SELECT * FROM ledger WHERE cloud_runtime_session_id=$1",[session.id])).rows;assert.equal(charges.length,1);assert.equal(charges[0].amount_micros,"-1");assert.equal(charges[0].user_id,customer.id);
  assert.equal((await s.db.control.query("SELECT state FROM cloud_runtime_nodes WHERE id=$1",[node.id])).rows[0].state,"available");
});
test("credential rotation is one-time, immediately rejects the old credential and never stores plaintext in saved responses",async()=>{
  const row=(await s.db.control.query("SELECT version FROM cloud_runtime_nodes WHERE id=$1",[node.id])).rows[0],old=node.enrollment_token;
  const key=randomUUID(),body={expected_version:row.version,reason:"Rotate the synthetic preprovisioned node credential"},url="/v1/admin/cloud-computers/nodes/"+node.id+"/rotate-credential";
  const r=await request(admin,"POST",url,body,key);assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.enrollment_token,/^[A-Za-z0-9_-]{43}$/);
  node.enrollment_token=r.body.enrollment_token;instance=randomUUID();
  const retry=await request(admin,"POST",url,body,key);assert.equal(retry.status,200);assert.equal(retry.body.enrollment_token,undefined);
  const saved=await s.db.control.query("SELECT 1 FROM request_replays WHERE response::text LIKE $1 OR response::text LIKE $2",["%"+old+"%","%"+node.enrollment_token+"%"]);assert.equal(saved.rowCount,0);
  const b={machine_fingerprint:hash("synthetic node "+node.id),instance_id:instance,agent_version:"1.0.0",physical_host:true,current_session_id:null,current_generation:0};
  assert.equal((await request(undefined,"POST","/v1/cloud-runtime-nodes/"+node.id+"/poll",b,randomUUID(),old)).status,401);
  assert.equal((await poll()).status,200);
});
async function fresh(versions:string[]=[]){
  const q=await request(customer,"POST",base+"/quotes",{plan_key:plan.key,minutes:5,billing_account_id:wallet,
    scope:{terminal:true,visual:true,selected_asset_versions:versions,purpose:"Synthetic lifecycle and exact selected source qualification"}});assert.equal(q.status,200,JSON.stringify(q.body));
  const r=await request(customer,"POST",base+"/sessions",{quote_id:q.body.id,specification_hash:q.body.specification_hash,maximum_cost_micros:q.body.maximum_cost_micros,confirm_cost_and_scope:true});assert.equal(r.status,200,JSON.stringify(r.body));
  const p=await poll(),command=p.body.commands[0];assert.equal(command.kind,"start");
  const ack=await acknowledge(command,"ready");assert.equal(ack.status,200,JSON.stringify(ack.body));return {session:r.body,command};
}
async function closeCurrent(id:string,generation:number){
  const stop=await request(customer,"POST",base+"/sessions/"+id+"/stop",{});assert.equal(stop.status,200,JSON.stringify(stop.body));
  const p=await poll(id,generation),c=p.body.commands[0];assert.equal(c.kind,"stop");const ack=await acknowledge(c,"stopped",true,0);assert.equal(ack.status,200,JSON.stringify(ack.body));
}
test("only exact selected private file versions reach the enrolled computer and withdrawal fences the next read",async()=>{
  const a=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant,project,user:customer.id,privateOwner:customer.id,name:"private-campaign.txt",mime:"text/plain",bytes:Buffer.from("Synthetic selected customer file")}),tenant,true,customer.id);
  const v=(await s.db.control.query("SELECT id FROM asset_versions WHERE asset_id=$1",[a.id])).rows[0];
  const x=await fresh([v.id]),url=`/v1/cloud-runtime-nodes/${node.id}/sessions/${x.session.id}/files/${v.id}?generation=${x.command.generation}&instance_id=${instance}`;
  const file=await request(undefined,"GET",url,undefined,randomUUID(),node.enrollment_token);assert.equal(file.status,200,JSON.stringify(file.body));assert.equal(Buffer.from(file.body.base64,"base64").toString(),"Synthetic selected customer file");
  assert.equal((await request(colleague,"POST",base+"/quotes",{plan_key:plan.key,minutes:5,billing_account_id:wallet,scope:{terminal:true,visual:true,selected_asset_versions:[v.id],purpose:"Attempt another owner's private selected file"}})).status>=400,true);
  const other=url.replace(v.id,randomUUID());assert.equal((await request(undefined,"GET",other,undefined,randomUUID(),node.enrollment_token)).status,404);
  await s.db.control.query("UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[a.id]);
  assert.equal((await request(undefined,"GET",url,undefined,randomUUID(),node.enrollment_token)).status,404);
  assert.equal((await request(customer,"GET",base+"/sessions/"+x.session.id+"/view")).status,404);
  const redacted=await request(customer,"GET",base+"/sessions/"+x.session.id);assert.equal(redacted.body.specification,undefined);assert.equal(redacted.body.specification_unavailable,true);
  await closeCurrent(x.session.id,x.command.generation);
});
test("administrators stop or request reconciliation with reasons and current scoped permission while holds remain protected",async()=>{
  const x=await fresh(),current=await request(customer,"GET",base+"/sessions/"+x.session.id),url="/v1/admin/cloud-computers/sessions/"+x.session.id+"/reconciliation";
  const result=await request(admin,"POST",url,{expected_version:current.body.version,reason:"Investigate synthetic uncertain process cleanup"});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state,"reconciling");assert.equal(result.body.hold_state,"reconciling");
  const row=(await s.db.control.query("SELECT version FROM cloud_runtime_nodes WHERE id=$1",[node.id])).rows[0];
  assert.equal((await request(admin,"POST","/v1/admin/cloud-computers/nodes/"+node.id+"/rotate-credential",{expected_version:row.version,reason:"Attempt credential rotation before cleanup is verified"})).status,409);
  const list=await request(admin,"GET","/v1/admin/cloud-computers/sessions?limit=1");assert.equal(list.status,200);assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].specification,undefined);assert.equal(list.body.items[0].purpose,undefined);
  await closeCurrent(x.session.id,x.command.generation);
});
test("offline maintenance retains uncertain usage and does not assign the owned computer to another quote",async()=>{
  const x=await fresh();await s.db.control.query("UPDATE cloud_runtime_nodes SET last_heartbeat_at=clock_timestamp()-interval '65 seconds' WHERE id=$1",[node.id]);
  await new DedicatedCloud(s.db).maintain();
  const row=(await s.db.control.query("SELECT state,last_error FROM cloud_runtime_sessions WHERE id=$1",[x.session.id])).rows[0];assert.equal(row.state,"reconciling");assert.equal(row.last_error,"CLEANUP_AND_USAGE_UNCONFIRMED");
  assert.equal((await s.db.control.query("SELECT state FROM cloud_runtime_holds WHERE session_id=$1",[x.session.id])).rows[0].state,"reconciling");
  const r=await request(customer,"POST",base+"/quotes",{plan_key:plan.key,minutes:5,billing_account_id:wallet,scope:{terminal:true,visual:false,selected_asset_versions:[],purpose:"Another synthetic lease while first cleanup is unknown"}});assert.equal(r.status,200);
  assert.equal((await request(customer,"POST",base+"/sessions",{quote_id:r.body.id,specification_hash:r.body.specification_hash,maximum_cost_micros:r.body.maximum_cost_micros,confirm_cost_and_scope:true})).status,409);
  await closeCurrent(x.session.id,x.command.generation);
});

test("the paged file picker returns metadata for current authorized versions and rejects another owner's cursor",async()=>{
  async function asset(owner:string|null,name:string) {
    const a=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant,project,user:owner??customer.id,privateOwner:owner??undefined,
      name,mime:"text/plain",bytes:Buffer.from("Synthetic picker content")}),tenant,true,owner??customer.id);
    return (await s.db.control.query("SELECT id FROM asset_versions WHERE asset_id=$1",[a.id])).rows[0].id as string;
  }
  const own=await asset(customer.id,"owner-only-picker.txt"),shared=await asset(null,"shared-picker.txt"),other=await asset(colleague.id,"other-private-picker.txt");
  const seen=new Set<string>();let cursor:string|undefined;
  do {
    const page=await request(customer,"GET",base+"/source-files?limit=1"+(cursor?"&cursor="+cursor:""));
    assert.equal(page.status,200,JSON.stringify(page.body));assert.equal(page.body.items.length<=1,true);
    for(const row of page.body.items){assert.equal(seen.has(row.id),false);seen.add(row.id);assert.equal(row.base64,undefined);assert.equal(row.storage_key,undefined);}
    cursor=page.body.next_cursor??undefined;
  }while(cursor);
  assert.equal(seen.has(own),true);assert.equal(seen.has(shared),true);assert.equal(seen.has(other),false);
  assert.equal((await request(customer,"GET",base+"/source-files?cursor="+other)).status,404);
  const peer=await request(colleague,"GET",base+"/source-files");assert.equal(peer.status,200);
  assert.equal(peer.body.items.some((r:any)=>r.id===own),false);assert.equal(peer.body.items.some((r:any)=>r.id===other),true);
});

test("database boundaries prohibit private command forgery, closed receipt rewriting and financial changes during content erasure",async()=>{
  const own=await s.db.tx(tx=>tx.query("SELECT id FROM cloud_runtime_quotes"),tenant,false,customer.id);
  assert.equal(own.rowCount!>0,true);
  const peer=await s.db.tx(tx=>tx.query("SELECT id FROM cloud_runtime_quotes"),tenant,false,colleague.id);assert.equal(peer.rowCount,0);
  await assert.rejects(s.db.tx(tx=>tx.query("SELECT * FROM cloud_runtime_frames"),tenant,false,customer.id),(e:any)=>e.code==="42501");
  await assert.rejects(s.db.tx(tx=>tx.query("UPDATE cloud_runtime_plans SET body=body"),tenant,false,customer.id),(e:any)=>e.code==="42501");
  await assert.rejects(s.db.tx(async tx=>{
    await tx.query(`INSERT INTO cloud_runtime_commands(tenant_id,project_id,private_owner,session_id,node_id,generation,kind,body)
      VALUES($1,$2,$3,$4,$5,$6,'input','{"kind":"terminal","command":"Get-Date"}')`,[tenant,project,colleague.id,session.id,node.id,start.generation]);
  },tenant,true,customer.id),(e:any)=>e.code==="23514");
  await assert.rejects(s.db.tx(async tx=>{
    await tx.query("SELECT set_config('app.erasing_content','true',true)");
    await tx.query("UPDATE cloud_runtime_quotes SET body='{}',content_state='deleted',maximum_cost_micros=maximum_cost_micros+1 WHERE id=$1",[quote.id]);
  },tenant,true,customer.id),(e:any)=>e.code==="23514");
  await assert.rejects(s.db.tx(tx=>tx.query("UPDATE cloud_runtime_commands SET result='forged later result' WHERE id=$1",[start.id]),tenant,true,customer.id),(e:any)=>e.code==="23514");
  assert.equal((await s.db.control.query("SELECT maximum_cost_micros,content_state FROM cloud_runtime_quotes WHERE id=$1",[quote.id])).rows[0].maximum_cost_micros,"5000");
});
