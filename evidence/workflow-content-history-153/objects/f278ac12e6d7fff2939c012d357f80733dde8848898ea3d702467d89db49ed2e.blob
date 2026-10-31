import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Worker} from "../src/worker.js";
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";
import {defaults} from "../src/plans.js";
import {historyFixture,historyOk,type System} from "./admin-history-fixture.js";

export async function workflowHistoryFixture(s:System,versions=105,authenticateAdmin=true) {
 const f=await historyFixture(s,{versions:1,notes:1,authenticateAdmin});
 await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[f.tenant]);
 await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic workflow history fixture',$2)",[f.tenant,defaults.business]);
 const ok=(method:string,url:string,body?:any)=>historyOk(s,f.owner,method,url,body);
 const dataset=await ok("POST",f.base+"/analytics/import",{name:"Harbour source figures",source:"meta_ads",currency:"HKD",timezone:"Asia/Hong_Kong",account_id:"synthetic-account",entity_level:"ad",attribution_definition:"7-day-click",conversion_definition:"purchases",
  csv:"date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Harbour,ad-1,1000,20,12,2,40,HKD"});
 const definition=(n:number)=>({steps:[{kind:"analytics.summary",dataset_id:dataset.id},{kind:"approval",message:`Review retained campaign version ${n} · 香港`} ]});
 const shared=await ok("POST",f.base+"/workflows",{name:"Harbour campaign workflow history",definition:definition(1)});
 // Explicit control-plane fixtures exercise retained version pagination. These
 // are not represented as 104 customer UI edits or earlier migration history.
 for(let n=2;n<=versions;n++)await s.db.control.query("UPDATE workflows SET version=$2,definition=$3 WHERE id=$1",[shared.id,n,definition(n)]);
 const agent=await ok("POST",f.base+"/agents",{name:"Private workflow history consultant",role_key:"workflow-consultant"});
 const task=await ok("POST",f.base+"/tasks",{title:"Retain private workflow versions",prompt:"Save explicitly synthetic approval definitions, with no model call",role_key:"workflow-consultant",agent_id:agent.id,budget_micros:1000000});
 let privateWorkflow:any,failure:unknown;
 class FixtureRuntime extends CodexRuntimeAdapter {
  override async start(ctx:RuntimeContext):Promise<RuntimeResult>{
   try{for(let n=1;n<=3;n++)privateWorkflow=await ctx.tools.find(t=>t.name==="workflow_save")!.run({name:"Private cloud campaign workflow",definition:definition(n),
    ...(privateWorkflow?{workflow_id:privateWorkflow.workflow.id,expected_version:privateWorkflow.workflow.version}:{})},randomUUID());}
   catch(e){failure=e;throw e;}
   return{status:"completed",text:"Explicit synthetic control-plane fixture; no model request",inputTokens:0,outputTokens:0,usageKnown:true,accepted:true,thread:"synthetic-workflow-history",turn:randomUUID()};
  }
 }
 await new Worker(s.db,s.catalog,s.storage,new FixtureRuntime(s.db.config)).run(f.tenant,task.id);
 assert.equal(failure,undefined);assert.ok(privateWorkflow?.workflow?.id,JSON.stringify(privateWorkflow));
 return{...f,dataset,shared,definition,privateWorkflow:privateWorkflow.workflow,originTask:task};
}
