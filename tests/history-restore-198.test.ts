import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {ConversationState,type ChatScope,type ChatIO} from "../src/conversation.js";
const scope=():ChatScope=>({actor:randomUUID(),tenant:randomUUID(),project:randomUUID()});
function fixture(s:ChatScope){const id=randomUUID(),task=randomUUID(),agent=randomUUID(),key=`chat:${s.actor}:${s.tenant}:${s.project}`,store=new Map<string,any>(),calls:any[]=[];let rejectCursor=false,rejectList=false;
 const conversation={id,agent_id:agent,name:"Saved conversation",tasks:[{id:task,status:"succeeded"}],messages:[]};
 const io:ChatIO={read:async k=>structuredClone(store.get(k)),write:async(k,v)=>{store.set(k,structuredClone(v));},changed:()=>{},upload:async()=>{throw Error("No upload in history read");},request:async(sc,path,method="GET")=>{
  calls.push({scope:sc,path,method});assert.equal(method,"GET");const u=new URL(path,"https://company.invalid");
  if(u.pathname.endsWith("/agents"))return {items:[{id:agent,enabled:true,content_state:"active"}]};
  if(u.pathname.endsWith("/project-configuration"))return {published:null};
  if(u.pathname.endsWith("/conversations")){if(rejectList)throw Error("directory disconnected");if(rejectCursor&&u.searchParams.has("cursor"))throw Object.assign(Error("expired"),{code:"CONVERSATION_CURSOR_EXPIRED",status:409});return {items:[conversation],next_cursor:u.searchParams.has("cursor")?null:"next.signature"};}
  if(u.pathname.endsWith("/conversations/"+id))return structuredClone(conversation);
  throw Error("Unexpected request "+path);
 }};
 return {io,store,key,calls,id,task,agent,expire:()=>{rejectCursor=true;},disconnect:()=>{rejectList=true;}};
}
test("reopening the side panel re-reads its private searched page and selected task without replaying writes",async()=>{
 const s=scope(),f=fixture(s);f.store.set(f.key,{conversationId:f.id,selectedTaskId:f.task,history:{q:"Campaign",archived:true,pages:["","old.signature"]}});
 const state=new ConversationState(f.io);await state.open(s);assert.equal(state.conversation.id,f.id);assert.equal(state.selectedTaskId,f.task);assert.equal(state.historyQuery,"Campaign");assert.equal(state.historyArchived,true);assert.equal(state.historyPages.length,2);
 const q=new URL(f.calls.find(c=>c.path.includes("cursor=")).path,"https://company.invalid").searchParams;assert.equal(q.get("q"),"Campaign");assert.equal(q.get("archived"),"true");assert.equal(q.get("cursor"),"old.signature");assert.ok(f.calls.every(c=>c.method==="GET"));
});
test("an expired history cursor resets only the list page and keeps pending message receipts intact",async()=>{
 const s=scope(),f=fixture(s),pending={key:randomUUID(),createKey:randomUUID(),name:"Pending",agentId:f.agent,prompt:"Retained original request",budget:"20000000",versionIds:[],conversationId:f.id,boundAgentId:f.agent};
 f.store.set(f.key,{conversationId:f.id,pending,history:{q:"Campaign",archived:true,pages:["","expired.signature"]}});f.expire();
 const state=new ConversationState(f.io);await state.open(s);assert.deepEqual(state.pending,pending);assert.equal(state.conversation.id,f.id);assert.equal(state.unavailable,false);assert.deepEqual(state.historyPages,[""]);assert.match(state.historyNotice,/expired/);assert.equal(state.historyQuery,"Campaign");assert.ok(f.calls.every(c=>c.method==="GET"));
});
test("a failed list read does not discard the current conversation, brief, pending request or private task selection",async()=>{
 const s=scope(),f=fixture(s);f.store.set(f.key,{conversationId:f.id,selectedTaskId:f.task});f.disconnect();const state=new ConversationState(f.io);await state.open(s);
 assert.equal(state.unavailable,false);assert.equal(state.conversation.id,f.id);assert.equal(state.selectedTaskId,f.task);assert.equal(state.projectConfiguration,null);assert.match(state.historyNotice,/unavailable/);
});
test("history page writes persist in the original scope and a different account cannot restore that page",async()=>{
 const s=scope(),f=fixture(s),state=new ConversationState(f.io);await state.open(s);await state.browseHistory({q:"Campaign",archived:true});await state.browseHistory({direction:"next"});
 assert.deepEqual(f.store.get(f.key).history,{q:"Campaign",archived:true,pages:["","next.signature"]});
 const next={...s,actor:randomUUID()};await state.open(next);assert.equal(state.historyQuery,"");assert.equal(state.historyArchived,false);assert.deepEqual(state.historyPages,[""]);assert.equal(state.conversation,null);
});
