import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {PrivateChatUploads} from "../src/chat-upload.js";

const scope=()=>({actor:randomUUID(),tenant:randomUUID(),project:randomUUID()});
const bytes=Buffer.from("campaign,clicks\nlaunch,42\n"),sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const file={name:"campaign.csv",type:"text/csv",base64:bytes.toString("base64")};
function server(){
  const store=new Map<string,any>(),sessions=new Map<string,any>(),keys=new Map<string,string>(),calls:any[]=[];
  let lose=false,wrongManifest=false,shared=false;
  const io={read:async(key:string)=>structuredClone(store.get(key)),write:async(key:string,value:unknown)=>{store.set(key,structuredClone(value));},
    request:async(s:any,path:string,method="GET",body?:any,key?:string)=>{
      calls.push({path,method,body,key});const suffix=path.split("/uploads")[1];assert.notEqual(suffix,undefined);
      if(!suffix){assert.equal(method,"POST");assert.ok(body.source_task_id);assert.equal(body.conversation_id,undefined);
        let id=keys.get(key!);if(!id){id=randomUUID();keys.set(key!,id);sessions.set(id,{id,body,parts:new Map(),state:"pending"});}else assert.deepEqual(sessions.get(id).body,body);
        if(lose){lose=false;throw new Error("lost task upload acceptance");}return{upload_id:id};}
      const[,id,action,index]=suffix.split("/"),row=sessions.get(id);assert.ok(row);
      if(method==="GET")return{upload_id:id,state:row.state,source_task_id:wrongManifest?randomUUID():row.body.source_task_id,size_bytes:row.body.size_bytes,sha256:row.body.sha256,part_size_bytes:4*1024*1024,
        parts:[...row.parts.values()].map((p:any)=>({part_index:p.index,size_bytes:p.bytes.length,sha256:sha(p.bytes)}))};
      if(action==="parts"){const b=Buffer.from(body.base64,"base64");assert.equal(sha(b),body.sha256);row.parts.set(Number(index),{index:Number(index),bytes:b});return{};}
      assert.equal(action,"complete");assert.deepEqual(Buffer.concat([...row.parts.values()].map((p:any)=>p.bytes)),bytes);row.state="completed";
      row.asset??={id:randomUUID(),tenant_id:s.tenant,project_id:s.project,private_owner:s.actor,version:{id:randomUUID(),sha256:sha(bytes),bytes:bytes.length,metadata:{input_task_id:row.body.source_task_id,input_origin:"customer_selected_upload"}}};
      return{...row.asset,...(shared?{private_owner:null}:{})};
    }};
  return{io,calls,sessions,lose:()=>{lose=true;},wrongManifest:()=>{wrongManifest=true;},returnShared:()=>{shared=true;}};
}

test("a private original task without a conversation uploads selected bytes into its exact task scope",async()=>{
  const f=server(),s=scope(),task=randomUUID(),u=new PrivateChatUploads(f.io),asset=await u.uploadTask(s,task,file,true);
  assert.equal(asset.private_owner,s.actor);assert.equal(asset.version.metadata.input_task_id,task);assert.equal(asset.version.metadata.task_id,undefined);
  assert.equal((await u.uploadTask(s,task,file,true)).id,asset.id);assert.equal(f.sessions.size,1);
  assert.equal(f.calls.filter(c=>c.path.endsWith("/parts/0")).length,1);
});
test("lost acceptance reuses the same task key, while a different original task receives a separate receipt",async()=>{
  const f=server(),s=scope(),task=randomUUID();f.lose();await assert.rejects(new PrivateChatUploads(f.io).uploadTask(s,task,file,true),/lost task/);
  await new PrivateChatUploads(f.io).uploadTask(s,task,file,true);const accepted=f.calls.filter(c=>c.path.endsWith("/uploads"));
  assert.equal(accepted[0].key,accepted[1].key);assert.deepEqual(accepted[0].body,accepted[1].body);
  await new PrivateChatUploads(f.io).uploadTask(s,randomUUID(),file,true);assert.equal(f.sessions.size,2);
});
test("a changed retained task scope stops before sending bytes; a shared response cannot masquerade as private",async()=>{
  const f=server();f.wrongManifest();await assert.rejects(new PrivateChatUploads(f.io).uploadTask(scope(),randomUUID(),file,true),/scope changed/);
  assert.equal(f.calls.some(c=>c.path.includes("/parts/")||c.path.endsWith("/complete")),false);
  const g=server();g.returnShared();await assert.rejects(new PrivateChatUploads(g.io).uploadTask(scope(),randomUUID(),file,true),/ownership/);
});
