import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyCall, historyOk, type System, type HistoryClient } from "./admin-history-fixture.js";
import { overviewAdmin, overviewBind } from "./admin-overview-fixture-160-v2.js";
import { userResourceFixture, userResourcePermissions } from "./admin-user-resources-fixture-166-v1.js";

let isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>, s:System, f:Awaited<ReturnType<typeof userResourceFixture>>, admin:Awaited<ReturnType<typeof overviewAdmin>>;
const url=(section="content",id=f.first.owner.id)=>`/v1/admin/${section}?user_id=${id}`;
const list=(client:HistoryClient|null,section="content",suffix="")=>historyOk(s,client,"GET",url(section)+suffix);
before(async()=>{
  isolated=await isolatedTestEnvironment();
  s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});
  f=await userResourceFixture(s); admin=await overviewAdmin(s,userResourcePermissions);
});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});

test("requires independent admin identity, current MFA and both directory permissions; rejects malformed or unsupported user filters",async()=>{
  assert.equal((await historyCall(s,null,"GET",url())).status,401);
  assert.equal((await historyCall(s,f.first.owner,"GET",url())).status,401);
  const noUsers=await overviewAdmin(s,["admin.content.read"]),noContent=await overviewAdmin(s,["admin.users.read"]);
  assert.equal((await historyCall(s,noUsers.client,"GET",url())).status,403);
  assert.equal((await historyCall(s,noContent.client,"GET",url())).status,403);
  for(const id of ["", "invalid", "' OR 1=1--"]) assert.equal((await historyCall(s,admin.client,"GET",url("content",encodeURIComponent(id)))).status,400);
  assert.equal((await historyCall(s,admin.client,"GET","/v1/admin/audit?user_id="+f.first.owner.id)).status,400);
  const stale=await overviewAdmin(s,userResourcePermissions);
  await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",[stale.id]);
  assert.equal((await historyCall(s,stale.client,"GET",url())).data.error.code,"MFA_REQUIRED");
});

test("task filter selects the actual initiator across workspaces without including another member's tasks",async()=>{
  const data=await list(admin.client,"execution");
  assert.deepEqual(new Set(data.items.map((r:any)=>r.id)),new Set(f.tasks));
  assert.equal(data.total,3); assert.equal(data.subject.id,f.first.owner.id);
  assert.ok(data.items.every((r:any)=>r.created_by===f.first.owner.id));
});

test("all twenty content branches execute; metadata stays creator-scoped and brand attribution follows the original author",async()=>{
  const data=await list(admin.client), ids=new Set(data.items.map((r:any)=>r.id));
  assert.ok(ids.has(f.asset.id)); assert.ok(ids.has(f.brand));
  assert.ok(!ids.has(f.secondAsset.id)); assert.ok(!ids.has(f.otherTask)); assert.ok(!ids.has(f.legacyBrand));
  assert.ok(f.tasks.every(id=>ids.has(id)));
  for(const row of data.items) for(const key of ["body","prompt","output","text","created_by"]) assert.ok(!(key in row));
  const other=await historyOk(s,admin.client,"GET",url("content",f.second.id));
  assert.ok(other.items.some((r:any)=>r.id===f.secondAsset.id)); assert.ok(!other.items.some((r:any)=>r.id===f.brand));
  const all=await historyOk(s,admin.client,"GET","/v1/admin/content?page_size=100");
  assert.ok(all.items.some((r:any)=>r.id===f.legacyBrand)); assert.equal(all.subject,undefined);
});

test("user visibility and resource visibility intersect per row, including explicit project denies",async()=>{
  const scoped=await overviewAdmin(s,[]);
  await overviewBind(s,scoped.id,["admin.users.read"],"tenant",f.first.tenant);
  await overviewBind(s,scoped.id,["admin.content.read","admin.execution.read"]);
  for(const section of ["content","execution"]) {
    const rows=await list(scoped.client,section); assert.ok(rows.items.length>0);
    assert.ok(rows.items.every((r:any)=>r.tenant_id===f.first.tenant));
  }
  const denied=await overviewAdmin(s,userResourcePermissions);
  await overviewBind(s,denied.id,["admin.content.read","admin.execution.read"],"project",f.outside.project,"deny");
  for(const section of ["content","execution"]) assert.ok((await list(denied.client,section)).items.every((r:any)=>r.project_id!==f.outside.project));
});

test("unknown and unauthorized user targets are indistinguishable and never widen the directory",async()=>{
  const scoped=await overviewAdmin(s,[]);
  await overviewBind(s,scoped.id,userResourcePermissions,"tenant",f.first.tenant);
  for(const id of [randomUUID(),f.outside.owner.id]) {
    const result=await historyCall(s,scoped.client,"GET",url("content",id));
    assert.equal(result.status,404); assert.equal(result.data.error.code,"NOT_FOUND"); assert.equal(result.data.items,undefined);
  }
});

test("stable task pagination and literal search retain exact user scope",async()=>{
  const expected=[...f.tasks].sort().reverse(),actual=[];
  for(let page=1;page<=3;page++) {
    const result=await list(admin.client,"execution","&page_size=1&page="+page);
    assert.equal(result.total,3); assert.equal(result.items.length,1); actual.push(result.items[0].id);
  }
  assert.deepEqual(actual,expected);
  const searched=await list(admin.client,"execution","&search=Harbour%20selected%20task%202");
  assert.deepEqual(searched.items.map((r:any)=>r.id),[f.tasks[1]]);
  assert.equal((await list(admin.client,"execution","&search=Studio%20collaborator")).total,0);
});

test("metadata permission grants no body/download authority and read audit records exact user context with no-store",async()=>{
  const result=await historyCall(s,admin.client,"GET",url());
  assert.equal(result.raw.headers["cache-control"],"no-store");
  for(const suffix of ["body","download"]) assert.equal((await historyCall(s,admin.client,"GET",`/v1/admin/content/${f.asset.id}/${suffix}`)).status,403);
  const audit=(await s.db.control.query("SELECT target,detail FROM audit_log WHERE principal_id=$1 AND action='admin.content.read' AND target=$2 ORDER BY id DESC LIMIT 1",[admin.id,f.first.owner.id])).rows[0];
  assert.ok(audit); assert.equal(audit.detail.user_id,f.first.owner.id); assert.equal(audit.detail.attribution,"created_by");
});

test("live permission revocation refuses the same user-filtered URL",async()=>{
  const changing=await overviewAdmin(s,userResourcePermissions); assert.equal((await list(changing.client)).subject.id,f.first.owner.id);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1",[changing.id]);
  const result=await historyCall(s,changing.client,"GET",url()); assert.equal(result.status,403); assert.equal(result.data.items,undefined);
});
