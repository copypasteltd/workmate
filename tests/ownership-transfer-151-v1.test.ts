import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {randomUUID} from "node:crypto";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {expireOwnershipTransfers} from "../src/ownership-transfers.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyLogin,historyCall,historyOk,historyAdmin,type HistoryClient} from "./admin-history-fixture.js";

let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{await s?.app.close();await isolated?.cleanup();});
async function fixture(){
 const owner=await historyLogin(s),workspace=await historyOk(s,owner,"POST","/v1/tenants",{name:"Harbour handover studio",project_name:"Original customer work"}),recipient=await historyLogin(s),other=await historyLogin(s);
 const tenant=workspace.tenant.id,project=workspace.project.id;
 for(const c of[owner,recipient,other])c.tenant=tenant;
 for(const c of[recipient,other]){
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",[tenant,c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",[tenant,project,c.id]);
 }
 return{owner,recipient,other,tenant,project,base:`/v1/tenants/${tenant}/ownership-transfers`};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const decision={expected_revision:1,acknowledge_responsibility:true};
const request=(f:Fixture)=>({recipient_id:f.recipient.id,confirmation:"Harbour handover studio",acknowledge_responsibility:true});
const start=(f:Fixture)=>historyOk(s,f.owner,"POST",f.base,request(f));
const decide=(f:Fixture,row:any,action:string,c=f.recipient)=>historyCall(s,c,"POST",`${f.base}/${row.id}/${action}`,decision);
const roles=async(f:Fixture)=>(await s.db.control.query("SELECT user_id,role,version,admin_suspended,status FROM memberships WHERE tenant_id=$1 ORDER BY user_id",[f.tenant])).rows;
async function operator(f:Fixture){const a=await historyAdmin(s,f.project,["admin.tenants.members.write"]);await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",[a.id,a.role,f.tenant]);return a;}

test("only a current owner can request an exact-name handover to another current member",async()=>{
 const f=await fixture();assert.equal((await historyCall(s,f.recipient,"POST",f.base,request(f))).status,403);
 assert.equal((await historyCall(s,f.owner,"POST",f.base,{...request(f),confirmation:"Wrong studio"})).status,409);
 assert.equal((await historyCall(s,f.owner,"POST",f.base,{...request(f),recipient_id:f.owner.id})).status,409);
 assert.equal((await historyCall(s,f.owner,"POST",f.base,{...request(f),recipient_id:randomUUID()})).status,409);
 const before=await roles(f),row=await start(f);assert.equal(row.state,"pending");assert.deepEqual(await roles(f),before);
 assert.equal((await historyCall(s,f.owner,"POST",f.base,{...request(f),recipient_id:f.other.id})).status,409);
 assert.equal((await historyOk(s,f.other,"GET",f.base)).total,0);
 assert.equal((await historyOk(s,f.recipient,"GET",f.base+"?direction=incoming")).items[0].id,row.id);
});

test("only the exact recipient accepts once; both roles change atomically and private authorship and wallet stay unchanged",async()=>{
 const f=await fixture(),conversation=await historyOk(s,f.owner,"POST",`/v1/tenants/${f.tenant}/projects/${f.project}/conversations`,{name:"Owner private conversation"});
 const wallet=(await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1",[f.tenant])).rows[0],original=(await s.db.control.query("SELECT created_by,private_owner FROM conversations WHERE id=$1",[conversation.id])).rows[0];
 const before=await roles(f),row=await start(f);
 for(const c of[f.owner,f.other])assert.equal((await decide(f,row,"accept",c)).status,404);
 const accepted=await decide(f,row,"accept");assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.state,"accepted");
 const after=await roles(f);for(const c of[f.owner,f.recipient]){const old=before.find(x=>x.user_id===c.id),now=after.find(x=>x.user_id===c.id);assert.equal(now.role,c===f.owner?"admin":"owner");assert.equal(now.version,old.version+1);}
 assert.deepEqual(after.find(x=>x.user_id===f.other.id),before.find(x=>x.user_id===f.other.id));
 assert.deepEqual((await s.db.control.query("SELECT created_by,private_owner FROM conversations WHERE id=$1",[conversation.id])).rows[0],original);
 assert.deepEqual((await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1",[f.tenant])).rows[0],wallet);
 assert.equal((await historyCall(s,f.recipient,"GET",`/v1/tenants/${f.tenant}/projects/${f.project}/conversations/${conversation.id}`)).status,404);
 assert.equal((await decide(f,row,"accept")).status,200);assert.deepEqual(await roles(f),after);
 assert.equal((await s.db.control.query("SELECT count(*)::int n FROM audit_log WHERE action='ownership.transfer.accepted' AND target=$1",[row.id])).rows[0].n,1);
});

test("decline and source cancellation close intent without changing access; a closed record never accepts later",async()=>{
 for(const action of["decline","cancel"]){const f=await fixture(),before=await roles(f),row=await start(f),actor=action==="cancel"?f.owner:f.recipient;
  assert.equal((await decide(f,row,action,actor)).status,200);assert.equal((await decide(f,row,action,actor)).status,200);
  assert.equal((await decide(f,row,"accept")).status,409);assert.deepEqual(await roles(f),before);
  assert.equal((await start(f)).state,"pending");
 }
});

test("expired intent is persisted as expired before rejecting acceptance and releases the pending slot",async()=>{
 const f=await fixture(),users=await s.db.control.query("SELECT m.user_id,m.version,u.auth_version FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1",[f.tenant]),from=users.rows.find(x=>x.user_id===f.owner.id),to=users.rows.find(x=>x.user_id===f.recipient.id);
 const row=(await s.db.control.query("INSERT INTO ownership_transfers(tenant_id,from_user_id,to_user_id,from_version,to_version,from_auth_version,to_auth_version,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour') RETURNING *",[f.tenant,f.owner.id,f.recipient.id,from.version,to.version,from.auth_version,to.auth_version])).rows[0];
 assert.equal((await decide(f,row,"accept")).status,409);assert.equal((await s.db.control.query("SELECT state FROM ownership_transfers WHERE id=$1",[row.id])).rows[0].state,"expired");assert.equal((await start(f)).state,"pending");
});

test("membership revisions and source account withdrawal invalidate old responsibility consent",async()=>{
 for(const kind of["membership","account"]){const f=await fixture(),row=await start(f);
  if(kind==="membership")await s.db.control.query("UPDATE memberships SET version=version+1 WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.recipient.id]);
  else await s.db.control.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[f.owner.id]);
  assert.equal((await decide(f,row,"accept")).status,409);assert.equal((await s.db.control.query("SELECT state FROM ownership_transfers WHERE id=$1",[row.id])).rows[0].state,"invalidated");assert.equal((await roles(f)).find(x=>x.user_id===f.recipient.id).role,"member");
 }
});

test("source SSO-style account withdrawal holding the physical user row wins before a waiting acceptance",async()=>{
 const f=await fixture(),row=await start(f),lock=await s.db.control.connect();let pending:ReturnType<typeof decide>|undefined;
 try{await lock.query("BEGIN");const pid=(await lock.query("SELECT pg_backend_pid() pid")).rows[0].pid;await lock.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[f.owner.id]);
  pending=decide(f,row,"accept");let blocked=false;const deadline=Date.now()+10000;
  while(!blocked&&Date.now()<deadline){blocked=!!(await s.db.control.query("SELECT 1 FROM pg_locks WHERE NOT granted AND $1=ANY(pg_blocking_pids(pid))",[pid])).rowCount;if(!blocked)await new Promise(r=>setTimeout(r,20));}assert.ok(blocked,"Acceptance must wait for both physical account rows");
  await lock.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1",[f.owner.id]);await lock.query("COMMIT");assert.equal((await pending).status,409);assert.equal((await roles(f)).find(x=>x.user_id===f.recipient.id).role,"member");
 }finally{await lock.query("ROLLBACK");lock.release();if(pending)await pending;}
});

test("acceptance and source cancellation serialize to one terminal decision without losing the last owner",async()=>{
 const f=await fixture(),row=await start(f),results=await Promise.all([decide(f,row,"accept"),decide(f,row,"cancel",f.owner)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);const state=(await s.db.control.query("SELECT state FROM ownership_transfers WHERE id=$1",[row.id])).rows[0].state,after=await roles(f);
 assert.equal(after.filter(x=>x.role==="owner"&&x.status==="active").length,1);assert.equal(after.find(x=>x.user_id===f.recipient.id).role,state==="accepted"?"owner":"member");
});

test("administrator inspection and cancellation require current tenant scope, recent MFA and no overlapping project deny",async()=>{
 const f=await fixture(),row=await start(f),a=await operator(f),url=`/v1/admin/tenants/${f.tenant}/ownership-transfers`,before=await roles(f);
 assert.equal((await historyOk(s,a.client!,"GET",url)).items[0].id,row.id);
 const outsider=await fixture();assert.equal((await historyCall(s,a.client!,"GET",`/v1/admin/tenants/${outsider.tenant}/ownership-transfers`)).status,403);
 await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[a.id,a.role,f.project]);assert.equal((await historyCall(s,a.client!,"POST",url+`/${row.id}/cancel`,decision)).status,403);
 await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1 AND effect='deny'",[a.id]);
 await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[a.id]);assert.equal((await historyCall(s,a.client!,"POST",url+`/${row.id}/cancel`,decision)).status,403);
 await s.db.control.query("UPDATE sessions SET mfa_at=now() WHERE admin_id=$1",[a.id]);assert.equal((await historyCall(s,a.client!,"POST",url+`/${row.id}/accept`,decision)).status,404);
 assert.equal((await historyOk(s,a.client!,"POST",url+`/${row.id}/cancel`,decision)).reason_code,"operator_cancelled");assert.deepEqual(await roles(f),before);
});

test("workspace permanent deletion cancels pending handovers without granting roles, and terminal SQL history is immutable",async()=>{
 const f=await fixture(),row=await start(f),before=await roles(f);
 await historyOk(s,f.owner,"POST",`/v1/tenants/${f.tenant}/erasure`,{confirmation:"Harbour handover studio",reason_code:"workspace_closure",acknowledge_irreversible:true,acknowledge_retention:true});
 assert.equal((await decide(f,row,"accept")).status,404);await expireOwnershipTransfers(s.db);
 assert.equal((await s.db.control.query("SELECT state,reason_code FROM ownership_transfers WHERE id=$1",[row.id])).rows[0].reason_code,"workspace_removed");assert.deepEqual(await roles(f),before);
 await assert.rejects(s.db.control.query("UPDATE ownership_transfers SET state='pending',resolved_at=NULL,reason_code=NULL,revision=revision+1 WHERE id=$1",[row.id]),(e:any)=>e.code==="23514");
});
