import { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { nativeVideoFixture, videoOK as ok, videoCall as call, videoFinish as finish, videoActor } from "./desktop-video-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, calls=0;
const fixtures: Awaited<ReturnType<typeof nativeVideoFixture>>[]=[];
const provider=createServer((_req,res)=>{calls++;res.writeHead(502).end();});
before(async()=>{
  isolated=await isolatedTestEnvironment();
  await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));
  s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"explicit-handoff-fixture",
    AI_MODEL:"explicit-handoff-fixture",AI_VERIFIED:"true",AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000",
    AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SCOPE_TTL_MS:"300000"}),{worker:false});
});
afterEach(async()=>{
  for(const f of fixtures.splice(0)) {
    const rows=(await s.db.control.query("SELECT id,status FROM tasks WHERE project_id=$1 AND execution_location='desktop'",[f.project])).rows;
    for(const t of rows) {
      const url=f.base+"/desktop-executions/"+t.id;
      if(t.status==="queued") await call(s,f.c,"POST",url+"/cancel",{});
      if(t.status==="running") await call(s,f.c,"POST",url+"/finish",{...finish,status:"failed",output:"API fixture: no local process was started and no provider was called."});
    }
  }
});
after(async()=>{try{assert.equal(calls,0,"Control-plane tests never run the model or prove OS execution");await s?.app.close();}
  finally{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await isolated?.cleanup();}});
async function fixture() {
  const f=await nativeVideoFixture(s);fixtures.push(f);
  const created=await ok(s,f.web,"POST",f.base+"/delegations",{title:"Cloud report waiting for local material",prompt:"Review the explicitly selected campaign input and write a report.",
    mode:"execute",budget_micros:1000000,client_message_id:randomUUID(),dependencies:[{kind:"file",description:"Prepare the campaign-summary.csv from the customer-approved local folder."}]});
  const dep=(await ok(s,f.web,"GET",f.base+"/tasks/"+created.task.id+"/dependencies")).items[0];
  return {...f,task:created.task,conversation:created.conversation,dep,requestURL:f.base+"/tasks/"+created.task.id+"/local-handoffs"};
}
type F=Awaited<ReturnType<typeof fixture>>;
const request=(f:F)=>({dependency_id:f.dep.id,expected_dependency_version:f.dep.version,role_key:"fullstack",budget_micros:100000,confirm:true});
async function handoff(f:F){return ok(s,f.web,"POST",f.requestURL,request(f));}
const admission=(f:F,h:any,extra={})=>({...f.fields,title:"Prepare approved local input",prompt:h.prompt,role_key:h.role_key,budget_micros:Number(h.budget_micros),
  local_handoff:{id:h.id,expected_revision:h.revision,definition_hash:h.definition_hash},...extra});
async function admitted(f:F,h:any){return ok(s,f.c,"POST",f.base+"/desktop-executions",admission(f,h));}
async function completed(f:F,h:any){const t=await admitted(f,h),url=f.base+"/desktop-executions/"+t.task_id;
  await ok(s,f.c,"POST",url+"/start",f.fields);await ok(s,f.c,"POST",url+"/finish",{...finish,output:"Customer machine report in API fixture only; no actual OS process was started."});
  return {native:t,h:await ok(s,f.web,"GET",f.base+"/local-handoffs/"+h.id)};}
async function asset(f:F,privateOwner:string|null=f.web.id,metadata={}) {return s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.web.id,privateOwner:privateOwner ?? undefined,
  name:"approved-campaign.csv",mime:"text/csv",bytes:Buffer.from("campaign,clicks\nlaunch,42"),metadata}),f.tenant,false,f.web.id);}
const returned=(h:any,ids:string[])=>({expected_revision:h.revision,definition_hash:h.definition_hash,asset_version_ids:ids,confirm:true});
export {s,fixture,handoff,request,admission,admitted,completed,asset,returned,ok,call,finish,videoActor};
