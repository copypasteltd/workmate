import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { businessHistoryFixture } from "./business-history-fixture-144-v1.js";
import { historyAdmin, historyCall, historyOk, historyUrl } from "./admin-history-fixture.js";
import { ErasureService } from "../src/erasure.js";
import { canonical, hash } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, f: Awaited<ReturnType<typeof businessHistoryFixture>>;
before(async () => {isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",WORKER_ENABLED:"false"}),{worker:false}); f=await businessHistoryFixture(s);});
after(async () => {try {await s?.app.close();} finally {await isolated?.cleanup();}});
const q = (cursor:string) => "cursor="+encodeURIComponent(cursor);
const read = (kind:string,id:string,query="",client=f.operator.client) => historyOk(s,client,"GET",historyUrl(kind,id,query));

test("105 actual customer canvas and brand saves are fully paged, preserve provenance and reach the oldest retained version", async () => {
  for (const [kind, project] of [["creative_projects",f.poster],["brand_profiles",f.brand]] as const) {
    let page=await read(kind,project.id), versions:number[]=[]; const first=page;
    for (;;) {assert.ok(page.items.length<=50);for(const item of page.items){versions.push(item.version);assert.equal(item.origin,"customer");assert.equal(item.source_unavailable,false);}
      if(!page.next_cursor)break;page=await read(kind,project.id,q(page.next_cursor));}
    assert.deepEqual(versions,Array.from({length:105},(_,n)=>105-n));
    const second=await read(kind,project.id,q(first.next_cursor));assert.deepEqual((await read(kind,project.id,q(second.previous_cursor))).items,first.items);
    const oldest=await read(kind,project.id,"edge=last");assert.equal(oldest.items.at(-1).version,1);assert.equal(oldest.next_cursor,null);
    const legacy=await historyOk(s,f.operator.client,"GET",`/v1/admin/content/${project.id}/body`);assert.equal(legacy.history_url,historyUrl(kind,project.id));
  }
  assert.equal((await read("creative_projects",f.poster.id)).items[0].body.layers[0].text,"Saved campaign version 105");
  assert.equal((await read("brand_profiles",f.brand.id)).items[0].body.tone,"Approved voice version 105");
});
test("teams, published project briefs and automation schedules expose saved business definitions", async () => {
  for(const [kind,row] of [["agent_groups",f.group],["project_configurations",f.config],["workflow_schedules",f.schedule]] as const){
    const page=await read(kind,row.id);assert.equal(page.items.length,kind==="agent_groups"?2:1);assert.equal(page.items.at(-1).version,1);assert.equal(page.items[0].origin,"customer");assert.ok(page.items[0].body);assert.equal(page.next_cursor,null);
  }
});
test("vector and presentation histories retain original input and renderer profile independently of later saves", async () => {
  for(const project of f.editable){const page=await read("creative_projects",project.id);assert.deepEqual(page.items.map((v:any)=>v.version),[2,1]);
    assert.equal(page.items[0].body.title,"Campaign version 2");assert.deepEqual(page.items[1].body,project.input);assert.ok(page.items[0].renderer_profile);}
  const video=await read("creative_projects",f.video.id);assert.deepEqual(video.items[0].body,f.videoDefinition);assert.ok(video.items[0].renderer_profile);
});
test("matrix pagination keeps equal version numbers in distinct work series, with reversible composite anchors", async () => {
  const first=await read("creative_projects",f.matrix.id),second=await read("creative_projects",f.matrix.id,q(first.next_cursor));
  const identities=[...first.items,...second.items].map((v:any)=>v.series_id+":"+v.version);assert.equal(identities.length,62);assert.equal(new Set(identities).size,62);
  assert.deepEqual((await read("creative_projects",f.matrix.id,q(second.previous_cursor))).items,first.items);
  assert.deepEqual((await read("creative_projects",f.matrix.id,"edge=last")).items,[...first.items,...second.items].slice(-50));
  assert.ok(first.items.every((v:any)=>v.name.includes("campaign-")));
});
test("customer saves and matrix child revision inserts invalidate existing signed pages", async () => {
  const page=await read("creative_projects",f.poster.id);
  await historyOk(s,f.owner,"PUT",f.base+"/creative/"+f.poster.id,{name:f.poster.name,version:105,body:f.posterBody(106)});
  assert.equal((await historyCall(s,f.operator.client,"GET",historyUrl("creative_projects",f.poster.id,q(page.next_cursor)))).data.error.code,"CONTENT_HISTORY_CHANGED");
  const matrixPage=await read("creative_projects",f.matrix.id),input={copy:{headline:"Later matrix amendment"},image:null};
  await s.db.control.query("INSERT INTO creative_matrix_revisions(tenant_id,project_id,unit_id,revision,input,input_hash,actor_id) VALUES($1,$2,$3,32,$4,$5,$6)",[f.tenant,f.project,f.units[0].id,input,hash(canonical(input)),f.owner.id]);
  assert.equal((await historyCall(s,f.operator.client,"GET",historyUrl("creative_projects",f.matrix.id,q(matrixPage.next_cursor)))).data.error.code,"CONTENT_HISTORY_CHANGED");
});
test("history permissions, scoped grants and cursor object/session binding apply equally to all business kinds", async () => {
  const page=await read("brand_profiles",f.brand.id), reader=await historyAdmin(s,f.project,["admin.content.read"]);
  for(const [kind,row] of [["brand_profiles",f.brand],["creative_projects",f.poster],["workflow_schedules",f.schedule]] as const)
    assert.equal((await historyCall(s,reader.client,"GET",historyUrl(kind,row.id))).status,403);
  const other=await historyAdmin(s,randomUUID());
  assert.equal((await historyCall(s,other.client,"GET",historyUrl("brand_profiles",f.brand.id))).status,403);
  assert.equal((await historyCall(s,f.operator.client,"GET",historyUrl("creative_projects",f.poster.id,q(page.next_cursor)))).data.error.code,"CONTENT_HISTORY_CURSOR_INVALID");
  const tampered=JSON.parse(Buffer.from(page.next_cursor,"base64url").toString());tampered.anchor.version=1;
  assert.equal((await historyCall(s,f.operator.client,"GET",historyUrl("brand_profiles",f.brand.id,q(Buffer.from(JSON.stringify(tampered)).toString("base64url"))))).status,400);
});
test("withdrawn brand dependencies redact the exact retained design body and recovery restores access", async () => {
  const bound=await historyOk(s,f.owner,"POST",f.base+"/creative",{name:"Brand-bound canvas",body:{...f.posterBody(1),brand:{id:f.brand.id,version:105,channel:"web",locale:"en-HK"}}});
  assert.ok((await read("creative_projects",bound.id)).items[0].body);
  await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.brand.id]);
  const hidden=(await read("creative_projects",bound.id)).items[0];assert.equal(hidden.source_unavailable,true);assert.equal(hidden.body,null);
  await s.db.control.query("UPDATE brand_profiles SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",[f.brand.id]);
  assert.ok((await read("creative_projects",bound.id)).items[0].body);
});
test("saved ordinary canvas bodies cannot be rewritten in place, including by control-plane SQL", async () => {
  await assert.rejects(s.db.control.query("UPDATE poster_project_versions SET body='{}' WHERE creative_id=$1 AND version=1",[f.poster.id]),/immutable/i);
  await assert.rejects(s.db.control.query("DELETE FROM poster_project_versions WHERE creative_id=$1 AND version=1",[f.poster.id]),/immutable/i);
  await assert.rejects(s.db.control.query("UPDATE creative_projects SET history_revision=1 WHERE id=$1",[f.poster.id]),/managed by saved versions/i);
});
test("permanent canvas erasure removes historical bodies and denies old history cursors", async () => {
  const page=await read("creative_projects",f.poster.id);
  await s.db.control.query("UPDATE creative_projects SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[f.poster.id]);
  await new ErasureService(s.db,s.storage).tick();
  assert.equal((await s.db.control.query("SELECT count(*) FROM poster_project_versions WHERE creative_id=$1",[f.poster.id])).rows[0].count,"0");
  assert.equal((await historyCall(s,f.operator.client,"GET",historyUrl("creative_projects",f.poster.id,q(page.next_cursor)))).status,410);
});
test("bounded history reads create audit metadata without creating model requests, work or charges", async () => {
  const counts=async()=>(await s.db.control.query("SELECT (SELECT count(*) FROM tasks) tasks,(SELECT count(*) FROM reservations) reservations,(SELECT count(*) FROM ledger) ledger,(SELECT count(*) FROM current_ai_provider_requests) requests")).rows[0];
  const before=await counts();await read("brand_profiles",f.brand.id);assert.deepEqual(await counts(),before);
  const audit=(await s.db.control.query("SELECT detail FROM audit_log WHERE target=$1 AND action='admin.content.body.read' ORDER BY created_at DESC LIMIT 1",[f.brand.id])).rows[0];
  assert.ok(audit);assert.ok(!JSON.stringify(audit).includes("Approved voice"));
});
