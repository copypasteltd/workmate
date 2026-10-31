import {randomUUID} from "node:crypto";
import {CodexRuntimeAdapter,type RuntimeContext,type RuntimeResult} from "../src/runtime.js";
import {Worker} from "../src/worker.js";
import {defaults} from "../src/plans.js";
import {historyFixture,historyOk,type System} from "./admin-history-fixture.js";

export async function taskPauseFixture(s:System,authenticateAdmin=false) {
  const f=await historyFixture(s,{versions:1,notes:1,authenticateAdmin});
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[f.tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic pause fixture',$2)",[f.tenant,defaults.business]);
  const agent=await historyOk(s,f.owner,"POST",f.base+"/agents",{name:"Campaign development specialist",role_key:"fullstack"});
  const conversation=await historyOk(s,f.owner,"POST",f.base+"/conversations",{name:"Campaign release review",agent_id:agent.id});
  const task=await historyOk(s,f.owner,"POST",f.base+"/tasks",{title:"Harbour campaign release review",prompt:"Write and review one campaign release checklist. Explicit synthetic fixture, no real model request.",role_key:"fullstack",agent_id:agent.id,conversation_id:conversation.id,budget_micros:1000000});
  return {...f,agent,conversation,task};
}
export type PauseFixture=Awaited<ReturnType<typeof taskPauseFixture>>;
export const pauseRow=(s:System,f:PauseFixture)=>historyOk(s,f.owner,"GET",f.base+"/tasks/"+f.task.id);
export async function pauseControl(s:System,f:PauseFixture,action:"pause"|"resume") {
  const row=await pauseRow(s,f);
  return historyOk(s,f.owner,"POST",f.base+"/tasks/"+f.task.id+"/controls",{action,expected_version:row.version});
}
export class PauseFixtureRuntime extends CodexRuntimeAdapter {
  calls:RuntimeContext[]=[];thread="synthetic-pause-"+randomUUID();
  usageKnown=true;status="completed";
  constructor(private s:System,private script:(ctx:RuntimeContext,n:number)=>Promise<void>) {super(s.db.config);}
  override async start(ctx:RuntimeContext):Promise<RuntimeResult> {
    this.calls.push(ctx);const n=this.calls.length,turn="turn-"+n;
    await ctx.onEvent("runtime.thread",{thread_id:this.thread});
    await ctx.onEvent("runtime.turn",{turn_id:turn});
    await this.script(ctx,n);
    return {status:this.status,text:n===1?"Campaign checklist retained. Ready to continue from this point.":"Campaign release checklist reviewed.",
      inputTokens:100,outputTokens:50,usageKnown:this.usageKnown,accepted:true,thread:this.thread,turn};
  }
  run(f:PauseFixture) {return new Worker(this.s.db,this.s.catalog,this.s.storage,this).run(f.tenant,f.task.id);}
}
export const retainedChecklist={filename:"campaign-release-checklist.txt",mime_type:"text/plain",content:"Review copy, dimensions, budget and approval before the campaign release."};
