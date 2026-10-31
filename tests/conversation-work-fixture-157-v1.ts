import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";
import {Worker} from "../src/worker.js";
import {defaults} from "../src/plans.js";
import {historyFixture,historyOk,type System} from "./admin-history-fixture.js";
export const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
export async function workFixture(s:System){
 const f=await historyFixture(s,{versions:1,notes:0,authenticateAdmin:false});
 await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[f.tenant]);
 await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic independent work fixture',$2)",[f.tenant,defaults.business]);
 const agent=await historyOk(s,f.owner,"POST",f.base+"/agents",{name:"Campaign development",role_key:"fullstack"});
 const conversation=await historyOk(s,f.owner,"POST",f.base+"/conversations",{name:"Independent campaign work",agent_id:agent.id});
 return {...f,agent,conversation};
}
export type WorkFixture=Awaited<ReturnType<typeof workFixture>>;
export function workPayload(f:WorkFixture,prompt:string){return {type:"delegation",project_id:f.project,agent_id:f.agent.id,conversation_id:f.conversation.id,mode:"execute",input:{prompt},budget:{currency:"HKD",amount_micros:"1000000"}};}
export async function workCall(s:System,f:WorkFixture,body:any,key=randomUUID()){
 const r=await s.app.inject({method:"POST",url:"/v1/tasks",headers:{origin:s.db.config.WEB_ORIGIN,cookie:f.owner.cookie,"x-csrf-token":f.owner.csrf,"x-tenant-id":f.tenant,"idempotency-key":key},payload:body});
 return {status:r.statusCode,data:r.json()};
}
export async function workStart(s:System,f:WorkFixture,prompt:string,key=randomUUID()){
 const r=await workCall(s,f,workPayload(f,prompt),key);assert.equal(r.status,202,JSON.stringify(r.data));return r.data;
}
export class WorkRuntime extends CodexRuntimeAdapter {
 calls:RuntimeContext[]=[];usageKnown=true;
 constructor(private s:System,private script:(ctx:RuntimeContext,n:number)=>Promise<void> = async()=>{}){super(s.db.config);}
 override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
  this.calls.push(ctx);const n=this.calls.length,thread=ctx.thread??"synthetic-work-"+ctx.taskId,turn="turn-"+n;
  await ctx.onEvent("runtime.thread",{thread_id:thread});await ctx.onEvent("runtime.turn",{turn_id:turn});
  await ctx.onEvent("message.delta",{text:"Draft for "+ctx.taskId});await this.script(ctx,n);
  return {status:"completed",text:"Reviewed independent task "+ctx.taskId,inputTokens:100,outputTokens:50,usageKnown:this.usageKnown,accepted:true,thread,turn};
 }
 run(f:WorkFixture,id:string){return new Worker(this.s.db,this.s.catalog,this.s.storage,this).run(f.tenant,id);}
}
export async function workRow(s:System,f:WorkFixture,id:string){return historyOk(s,f.owner,"GET",f.base+"/tasks/"+id);}
export async function waitFor(check:()=>Promise<boolean>){const until=Date.now()+10000;while(!await check()){assert.ok(Date.now()<until,"Timed out waiting for deterministic work boundary");await new Promise(r=>setTimeout(r,15));}}
