import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {loadConfig} from "../src/config.js";
import {startScopedInferenceGateway} from "../src/internal-ai-gateway.js";

test("a model-bound Codex gateway works without global credentials and rechecks its binding on every request", async () => {
  const key=randomUUID(), taskId=randomUUID(), versionId=randomUUID(), identities:any[]=[], requests:any[]=[];
  const provider=createServer(async(req,res)=>{
    let text="";for await(const chunk of req)text+=chunk;
    requests.push({authorization:req.headers.authorization,body:JSON.parse(text)});
    res.writeHead(200,{"Content-Type":"text/event-stream"}).end('event: response.completed\ndata: '+JSON.stringify({type:"response.completed",response:{status:"completed",usage:{input_tokens:2,output_tokens:3}}})+'\n\n');
  });
  await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));
  const config=loadConfig({NODE_ENV:"test",AI_VERIFIED:"true",AI_MODEL:"gpt-6-luna"});
  delete config.AI_BASE_URL;delete config.AI_API_KEY;
  let available=true, scope:Awaited<ReturnType<typeof startScopedInferenceGateway>>|undefined;
  config.MODEL_CONNECTION_RESOLVER=async(identity)=>{
    identities.push(identity);
    if(!available)throw new Error("Model binding revoked");
    return {id:randomUUID(),baseURL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,apiKey:key,allowPrivateNetwork:true};
  };
  try{
    scope=await startScopedInferenceGateway(config,{model:"gpt-6-luna",reasoningEffort:"max",tools:[],authority:{taskId,capabilityVersionId:versionId,authorize:async()=>{}},signal:AbortSignal.timeout(15000)});
    const call=()=>fetch(scope!.baseURL+"/responses",{method:"POST",headers:{Authorization:"Bearer "+scope!.credential,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-6-luna",reasoning:{effort:"max"},stream:true,input:[{role:"user",content:"Verify bound model"}],tools:[]})});
    const response=await call();assert.equal(response.status,200);assert.match(await response.text(),/response.completed/);
    assert.equal(requests.length,1);assert.equal(requests[0].authorization,"Bearer "+key);
    assert.ok(identities.length>=2);assert.ok(identities.every(i=>i.taskId===taskId&&i.capabilityVersionId===versionId&&i.model==="gpt-6-luna"&&i.operation==="responses"));
    available=false;const denied=await call();assert.ok(denied.status>=400);await denied.text();assert.equal(requests.length,1);
    assert.equal(config.AI_API_KEY,undefined);assert.equal(config.AI_BASE_URL,undefined);
  }finally{await scope?.close();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}
});
