import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyCall,historyOk,historyLogin} from "./admin-history-fixture.js";
import {specialistCopyFixture,copyPreview,copyConfirm,copyFacts} from "./specialist-copy-fixture-155-v1.js";
let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});

test("copy preserves original brand, template, native runtime, capability prices and methods after later brand publication",async()=>{
 const f=await specialistCopyFixture(s),before=await copyFacts(s,f),preview=await copyPreview(s,f),result=await copyConfirm(s,f,preview);
 const copied=(await s.db.control.query("SELECT a.*,v.body,v.template_version_id FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=a.version WHERE a.id=$1",[result.id])).rows[0];
 assert.equal(copied.builtin_default,false);assert.equal(copied.body.brand.version,1);assert.equal(copied.body.brand_version_id,f.fixed.id);
 for(const field of ["kernel","role_key","role_hash","runtime_profile_id","runtime_version","capability_version_ids","skills","template_version_id","template_version","preset_definition_hash"])
  assert.deepEqual(copied.body[field],f.source.body[field],field);
 assert.equal(copied.template_version_id,f.source.template_version_id);
 assert.deepEqual(await copyFacts(s,f),{...before,agents:before.agents+1});
 const audit=(await s.db.control.query("SELECT detail FROM audit_log WHERE target=$1 AND action='agent.copy'",[result.id])).rows[0].detail;
 assert.equal(audit.source_agent_id,f.source.id);assert.equal(audit.source_version,f.source.version);assert.equal(preview.summary.brand.version,1);
 assert.equal(JSON.stringify(preview).includes("gateway_fingerprint"),false);
});

test("one reviewed copy survives concurrent and lost-response retries without creating extra specialists",async()=>{
 const f=await specialistCopyFixture(s),preview=await copyPreview(s,f),before=await copyFacts(s,f);
 const [one,two]=await Promise.all([copyConfirm(s,f,preview),copyConfirm(s,f,preview)]);assert.equal(one.id,two.id);
 assert.equal((await copyFacts(s,f)).agents,before.agents+1);
 await s.db.control.query("UPDATE agents SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",[one.id]);
 const retried=await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true});
 assert.ok([404,410].includes(retried.status),JSON.stringify(retried.data));assert.equal((await copyFacts(s,f)).agents,before.agents+1);
});

test("an edited source, changed proposal or forged preview cannot silently create a different copy",async()=>{
 const f=await specialistCopyFixture(s),preview=await copyPreview(s,f),before=await copyFacts(s,f);
 const altered=await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:{...f.proposal,name:"Different unreviewed copy"},preview_token:preview.preview_token,acknowledged:true});assert.equal(altered.status,409);
 const forged=preview.preview_token.slice(0,-1)+(preview.preview_token.endsWith("0")?"1":"0");assert.equal((await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:forged,acknowledged:true})).status,409);
 await historyOk(s,f.owner,"PATCH",f.base+"/agents/"+f.source.id,{expected_version:f.source.version,name:f.source.name,role_key:f.source.role_key,instructions:f.source.body.instructions+" Revised duties.",tool_ids:f.source.body.tool_ids,brand_id:f.brand.id,brand_version_id:f.fixed.id});
 const stale=await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true});assert.equal(stale.status,409);assert.equal(stale.data.error.code,"COPY_PREVIEW_STALE");
 assert.deepEqual(await copyFacts(s,f),before);
});

test("a disabled method cannot be silently reinstalled or replaced while confirming a copy",async()=>{
 const f=await specialistCopyFixture(s),preview=await copyPreview(s,f),before=await copyFacts(s,f),installation=f.source.body.skills[0].installation_id;
 await s.db.control.query("UPDATE skill_installations SET enabled=false,version=version+1 WHERE id=$1",[installation]);
 const denied=await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true});
 assert.equal(denied.status,409);assert.equal(denied.data.error.code,"SKILL_INSTALLATION_REQUIRED");assert.deepEqual(await copyFacts(s,f),before);
 assert.equal((await s.db.control.query("SELECT enabled FROM skill_installations WHERE id=$1",[installation])).rows[0].enabled,false);
});

test("source permissions, fixed brand availability and the strict copy scope are rechecked",async()=>{
 const f=await specialistCopyFixture(s),preview=await copyPreview(s,f),outsider=await historyLogin(s);outsider.tenant=f.tenant;
 assert.equal((await historyCall(s,outsider,"POST",f.endpoint+"/copy-previews",f.proposal)).status,404);
 assert.equal((await historyCall(s,outsider,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true})).status,409);
 assert.equal((await historyCall(s,f.owner,"POST",f.endpoint+"/copy-previews",{...f.proposal,credentials:{token:"not-accepted"}})).status,400);
 assert.equal((await historyCall(s,f.owner,"POST",f.endpoint+"/copy-previews",{...f.proposal,tool_ids:["unauthorized.write"]})).status,403);
 await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.brand.id]);
 assert.ok((await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true})).status>=400);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='agent.copy' AND detail->>'source_agent_id'=$1",[f.source.id])).rows[0].n,0);
});

test("copying never changes accepted task bindings or clones private conversations and memories",async()=>{
 const f=await specialistCopyFixture(s),task=await historyOk(s,f.owner,"POST",f.base+"/tasks",{title:"Retained original specialist task",prompt:"Retain original specialist context for this synthetic task.",role_key:f.source.role_key,agent_id:f.source.id,budget_micros:100000});
 const before=(await s.db.control.query("SELECT input_context FROM tasks WHERE id=$1",[task.id])).rows[0].input_context,facts=await copyFacts(s,f),preview=await copyPreview(s,f);
 const result=await copyConfirm(s,f,preview),definition=(await s.db.control.query("SELECT body FROM agent_versions WHERE agent_id=$1",[result.id])).rows[0].body;
 assert.deepEqual((await s.db.control.query("SELECT input_context FROM tasks WHERE id=$1",[task.id])).rows[0].input_context,before);
 assert.deepEqual(await copyFacts(s,f),{...facts,agents:facts.agents+1});
 for(const field of ["conversations","history","memories","assets","credentials","connection_grants","local_permissions"])assert.equal(Object.hasOwn(definition,field),false);
 assert.equal((await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:false})).status,400);
 assert.equal((await historyCall(s,f.owner,"POST",f.base+"/agents/"+randomUUID()+"/copy-previews",f.proposal)).status,404);
});

// Withdraw authority after authentication read, before the configuration transaction.
test("a session withdrawn after authentication cannot commit or recover a specialist copy",async()=>{
 const f=await specialistCopyFixture(s),preview=await copyPreview(s,f),facts=await copyFacts(s,f);
 const session=(await s.db.control.query("SELECT id,token_hash FROM sessions WHERE user_id=$1 AND audience='user' AND revoked_at IS NULL",[f.owner.id])).rows[0];
 const original=s.db.app.query;let withdrawn=false;
 (s.db.app as any).query=async function(...args:any[]){const result=await (original as any).apply(this,args);
  if(!withdrawn&&typeof args[0]==="string"&&args[0].includes("FROM sessions s JOIN users p")&&args[1]?.[0]===session.token_hash){
   withdrawn=true;await s.db.control.query("UPDATE sessions SET revoked_at=now() WHERE id=$1",[session.id]);}
  return result;};
 try{const denied=await historyCall(s,f.owner,"POST",f.endpoint+"/copies",{proposal:f.proposal,preview_token:preview.preview_token,acknowledged:true});
  assert.equal(withdrawn,true);assert.equal(denied.status,401);assert.equal(denied.data.error.code,"SESSION_EXPIRED");assert.deepEqual(await copyFacts(s,f),facts);
 }finally{s.db.app.query=original;}
});
