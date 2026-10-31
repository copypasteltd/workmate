import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {buildApp} from "../src/server.js";
import {loadConfig} from "../src/config.js";
import {isolatedTestEnvironment} from "./native-test-environment.js";
import {historyCall,historyOk,historyLogin} from "./admin-history-fixture.js";
import {conversationDirectoryFixture,directoryOracle} from "./conversation-directory-fixture-156-v1.js";
import {canonical,hmac} from "../src/lib.js";
let s:Awaited<ReturnType<typeof buildApp>>,isolated:Awaited<ReturnType<typeof isolatedTestEnvironment>>;
before(async()=>{isolated=await isolatedTestEnvironment();s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false"}),{worker:false});});
after(async()=>{try{await s?.app.close();}finally{await isolated?.cleanup();}});
const payload=(cursor:string)=>JSON.parse(Buffer.from(cursor.split(".")[0],"base64url").toString("utf8"));
async function walk(f:any,base:string,params:Record<string,string>){const found:string[]=[];let cursor:string|null=null,pages=0;
 do{const q=new URLSearchParams({...params,...(cursor?{cursor}:{})}),r=await historyCall(s,f.owner,"GET",base+"?"+q);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.raw.headers["cache-control"],"no-store");
  found.push(...r.data.items.map((x:any)=>x.id));cursor=r.data.next_cursor;assert.ok(++pages<100);
  if(cursor)assert.match(payload(cursor).at,/\.\d{6}Z$/);
 }while(cursor);assert.equal(new Set(found).size,found.length);return found;}

test("all private conversations beyond200 remain reachable in exact pinned/microsecond/id order",async()=>{
 const f=await conversationDirectoryFixture(s),expected=await directoryOracle(s,f),first=await historyOk(s,f.owner,"GET",f.base+"/conversations");
 assert.equal(expected.length,236);assert.equal(first.items.length,200);assert.ok(first.next_cursor);
 assert.deepEqual(await walk(f,f.base+"/conversations",{limit:"37"}),expected);
 assert.equal(first.items.some((x:any)=>Object.hasOwn(x,"cursor_at")),false);
});
test("archived and same-name search paginate beyond200 with literal case-insensitive matching",async()=>{
 const f=await conversationDirectoryFixture(s);assert.deepEqual(await walk(f,f.base+"/conversations",{limit:"31",archived:"true",q:"cAMpaign"}),await directoryOracle(s,f,true,"campaign"));
 assert.equal((await historyOk(s,f.owner,"GET",f.base+"/conversations?q="+encodeURIComponent("%_"))).items.length,0);
 for(const q of ["limit=0","limit=201","limit=1.5","archived=unknown"])
  assert.equal((await historyCall(s,f.owner,"GET",f.base+"/conversations?"+q)).status,400);
});
test("cursor signatures bind current actor, session, project, filters, page size and expiry",async()=>{
 const f=await conversationDirectoryFixture(s),first=await historyOk(s,f.owner,"GET",f.base+"/conversations?limit=30"),cursor=first.next_cursor;
 for(const tail of ["&archived=true","&q=Campaign","&limit=31"]){const q=tail.includes("limit")?tail.slice(1):"limit=30"+tail;
  assert.equal((await historyCall(s,f.owner,"GET",f.base+"/conversations?"+q+"&cursor="+encodeURIComponent(cursor))).status,400);}
 const forged=cursor.slice(0,-1)+(cursor.endsWith("0")?"1":"0");assert.equal((await historyCall(s,f.owner,"GET",f.base+"/conversations?limit=30&cursor="+forged)).status,400);
 const otherSession=await historyLogin(s,f.owner.email);otherSession.tenant=f.tenant;
 assert.equal((await historyCall(s,otherSession,"GET",f.base+"/conversations?limit=30&cursor="+cursor)).status,400);
 const expired={...payload(cursor),expires:Date.now()-1},encoded=Buffer.from(canonical(expired)).toString("base64url"),signed=encoded+"."+hmac(s.db.config.MASTER_KEY!,"conversation-directory-v1:"+encoded);
 assert.equal((await historyCall(s,f.owner,"GET",f.base+"/conversations?limit=30&cursor="+signed)).status,409);
 assert.equal((await historyCall(s,f.owner,"GET",f.base.replace(f.project,randomUUID())+"/conversations?limit=30&cursor="+cursor)).status,404);
});
test("pinning, archiving and content withdrawal affect the current directory without modifying conversation history",async()=>{
 const f=await conversationDirectoryFixture(s),id=(await directoryOracle(s,f)).at(-1)!;
 await historyOk(s,f.owner,"PATCH",f.base+"/conversations/"+id,{expected_version:1,pinned:true});
 assert.equal((await historyOk(s,f.owner,"GET",f.base+"/conversations?limit=1")).items[0].id,id);
 await historyOk(s,f.owner,"PATCH",f.base+"/conversations/"+id,{expected_version:2,archived:true});
 assert.equal((await walk(f,f.base+"/conversations",{limit:"40"})).includes(id),false);
 assert.equal((await walk(f,f.base+"/conversations",{limit:"40",archived:"true"})).includes(id),true);
 await s.db.control.query("UPDATE conversations SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[id]);
 assert.equal((await walk(f,f.base+"/conversations",{limit:"40",archived:"true"})).includes(id),false);
 assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id=$1",[f.conversation.id])).rows[0].n,0);
});
test("canonical optional-project listing matches its frozen response contract and excludes other users and unauthorized projects",async()=>{
 const f=await conversationDirectoryFixture(s),other=await historyLogin(s);other.tenant=f.tenant;
 await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",[f.tenant,other.id]);
 await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'reader')",[f.tenant,f.project,other.id]);
 const secondary=(await s.db.control.query("INSERT INTO projects(tenant_id,name) VALUES($1,'Other private project') RETURNING id",[f.tenant])).rows[0].id;
 const agent=await historyOk(s,f.owner,"POST",`/v1/tenants/${f.tenant}/projects/${secondary}/agents`,{name:"Other helper",role_key:"assistant"});
 const c=await historyOk(s,f.owner,"POST",`/v1/tenants/${f.tenant}/projects/${secondary}/conversations`,{name:"Other private chat",agent_id:agent.id});
 const all=await walk(f,"/v1/conversations",{limit:"50"}),scoped=await walk(f,"/v1/conversations",{limit:"50",project_id:f.project});
 assert.equal(all.length,237);assert.ok(all.includes(c.id));assert.deepEqual(scoped,await directoryOracle(s,f));
 const response=await historyOk(s,f.owner,"GET","/v1/conversations?limit=1");assert.deepEqual(Object.keys(response).sort(),["items","next_cursor"]);
 assert.deepEqual(Object.keys(response.items[0]).sort(),["id","project_id","agent_id","title","version","created_at","pinned","archived","last_activity_at"].sort());
 assert.deepEqual((await historyOk(s,other,"GET","/v1/conversations")).items,[]);
 assert.equal((await historyCall(s,other,"GET","/v1/conversations?project_id="+secondary)).status,404);
 assert.equal((await historyCall(s,other,"GET","/v1/conversations?limit=1&cursor="+response.next_cursor)).status,400);
 assert.equal((await historyCall(s,f.owner,"GET","/v1/conversations?limit=101")).status,400);
});
test("a session withdrawn after authentication cannot read a private directory page",async()=>{
 const f=await conversationDirectoryFixture(s),session=(await s.db.control.query("SELECT id,token_hash FROM sessions WHERE user_id=$1 AND audience='user' AND revoked_at IS NULL",[f.owner.id])).rows[0];
 const original=s.db.app.query;let withdrawn=false;
 (s.db.app as any).query=async function(...args:any[]){const result=await (original as any).apply(this,args);
  if(!withdrawn&&typeof args[0]==="string"&&args[0].includes("FROM sessions s JOIN users p")&&args[1]?.[0]===session.token_hash){withdrawn=true;await s.db.control.query("UPDATE sessions SET revoked_at=now() WHERE id=$1",[session.id]);}return result;};
 try{const denied=await historyCall(s,f.owner,"GET",f.base+"/conversations");assert.equal(withdrawn,true);assert.equal(denied.status,401);}finally{s.db.app.query=original;}
});
test("the Extension uses the actual paged API while preserving the chat and discarding old-scope replies",async()=>{
 const f=await conversationDirectoryFixture(s),{ConversationState}=await import(pathToFileURL(path.resolve("../copypaste-extension/src/conversation.ts")).href);
 const io:any={request:(_scope:any,p:string,m="GET",body?:any)=>historyOk(s,f.owner,m,p,body),read:async()=>null,write:async()=>{},changed:()=>{},upload:async()=>{throw new Error("No upload in directory checks");}};
 const state=new ConversationState(io);await state.open({actor:f.owner.id,tenant:f.tenant,project:f.project});assert.equal(state.history.length,200);assert.ok(state.historyNext);
 state.conversation=await historyOk(s,f.owner,"GET",f.base+"/conversations/"+f.conversation.id);state.draft="Unsent customer draft";const originalChat=state.conversation;state.pending={key:randomUUID(),synthetic:true};const receipt=state.pending;
 await state.browseHistory({direction:"next"});assert.equal(state.history.length,36);assert.equal(state.conversation,originalChat);assert.equal(state.draft,"Unsent customer draft");assert.equal(state.pending,receipt);
 await state.browseHistory({q:"campaign",archived:true});assert.equal(state.history.length,200);assert.equal(state.historyPages.length,1);state.pending=undefined;
 async function delayed(reset:boolean){let ready!:()=>void,release!:()=>void;const observed=new Promise<void>(resolve=>ready=resolve),gate=new Promise<void>(resolve=>release=resolve),original=io.request;
  io.request=async(...args:any[])=>{const result=await original(...args);ready();await gate;return result;};
  const work=state.browseHistory({refresh:true});await observed;if(reset)state.reset();else await state.select("");release();await work;io.request=original;
  assert.equal(state.historyLoading,false);if(reset){assert.equal(state.scope,undefined);assert.deepEqual(state.history,[]);}else{assert.equal(state.conversation,null);assert.equal(state.history.length,200);}}
 await delayed(false);await delayed(true);
});
