import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir,mkdtemp,rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocalAgentController,type LocalAgentIO,type LocalAgentJournal,type LocalRuntimeFactory } from "../src/local-agent.js";
import { localRuntimeLock } from "../src/local-runtime.js";
import { parseTeamReview,parseTeamRun,parseTeamAssignments,localTeamDigest,type LocalTeamState } from "../src/local-team.js";
import { startupFixture,startupTurnFixture } from "./startup-receipt-fixture.js";
import { rendererApiOperation } from "../src/config.js";

const wait=async(predicate:()=>boolean)=>{const deadline=Date.now()+15000;while(!predicate()){assert.ok(Date.now()<deadline,"Bounded local team completion");await new Promise(r=>setTimeout(r,10));}};
async function fixture(){
  const base=path.resolve(".data/local-team-tests");await mkdir(base,{recursive:true});const directory=await mkdtemp(path.join(base,"owned-"));
  const scope={tenant:randomUUID(),project:randomUUID()},actor={actorId:randomUUID(),epoch:randomUUID()},group=randomUUID();
  const member=(key:string,deps:string[]=[])=>({key,agent_id:randomUUID(),agent_version:2,role_key:"assistant",member_name:key,role_hash:"a".repeat(64),
    title:"Approved "+key,prompt:"Approved synthetic "+key,depends_on:deps,budget_micros:100000});
  const definition={execution_location:"desktop",max_parallelism:2,approved_budget_micros:400000,brief:"Synthetic local team state fixture",
    coordinator:member("coordinator",["first","second","review"]),nodes:[member("first"),member("second"),member("review",["first","second"])]};
  const review:any={id:randomUUID(),version:1,definition_hash:localTeamDigest(definition),approved_budget_micros:400000,execution_location:"desktop",confirmation_required:true,funds_reserved_micros:0,definition};
  let journal:LocalAgentJournal|null=null,run:any,binding:any,createLost=false,finishLost=false,consent=true;
  let releaseTurn:(()=>void)|undefined,turnGate:Promise<void>|undefined,turns=0,active=0,maxActive=0,closed=0;
  const requests:any[]=[],tasks=new Map<string,any>(),keys=new Map<string,string>(),starts:string[]=[],turnSteps:string[]=[],hooks:any[]=[];
  const runtime={pinned_version:localRuntimeLock.version,windows_x64_sha256:localRuntimeLock.sha256,role_keys:["assistant"]};
  const publicRun=()=>{const all=[...tasks.values()];return {...structuredClone(run),tasks:all.map(t=>({id:t.task_id,status:t.status,step_key:t.step_key})),
    charged_micros:all.filter(t=>t.status==="succeeded").length,reserved_micros:all.filter(t=>["queued","paused","running"].includes(t.status)).length*100000};};
  const admit=(m:any,session:string)=>{const id=randomUUID();tasks.set(id,{task_id:id,status:m.key==="coordinator"?"paused":"queued",state:"prepared",step_key:m.key,
    ...m,fields:{...binding,local_session_id:session}});return id;};
  const assignments=()=>[...tasks.values()].filter(t=>["queued","running"].includes(t.status)).map(t=>({task_id:t.task_id,step_key:t.step_key,role_key:t.role_key,agent_id:t.agent_id,
    agent_version:t.agent_version,title:t.title,prompt:t.prompt,budget_micros:t.budget_micros,fields:t.fields,status:t.status,state:t.state}));
  const response=(body:any,status=200)=>({status,body:structuredClone(body)});
  const io:LocalAgentIO={read:async()=>structuredClone(journal),write:async j=>{journal=structuredClone(j);},identity:async()=>({...actor}),localEpoch:async()=>actor.epoch,
    chooseWorkspace:async()=>directory,consent:async()=>consent,approval:async()=>"decline",changed:()=>{},stateRoot:directory,companyOrigin:"http://127.0.0.1:4310",
    executable:path.join(directory,"codex.exe"),runtime:localRuntimeLock,
    request:async(url,options)=>{
      const b=options?.body as any;requests.push({url,...options});
      if(url.endsWith("/runtime"))return response(runtime);
      if(url.endsWith("/native/preflight")){binding=b.binding;return response(review);}
      if(url.endsWith("/native/runs") && options?.method==="POST"){
        const k=options.idempotencyKey!;
        if(!run){keys.set(k,randomUUID());run={id:keys.get(k),group_id:group,version:1,revision:1,state:"running",execution_location:"desktop",definition_hash:review.definition_hash,
          approved_budget_micros:400000,max_parallelism:2,definition,nodes:definition.nodes.map(n=>({step_key:n.key,state:"pending",task_id:null}))};
          run.coordinator_task_id=admit(definition.coordinator,binding.local_session_id);}
        assert.ok(keys.has(k),"Admission replay must preserve the original key");
        if(createLost){createLost=false;throw new Error("Synthetic lost admission response");}return response({run:publicRun()});
      }
      if(url.includes("/native/runs/")){
        if(options?.method!=="POST")return response({run:publicRun()});
        if(url.endsWith("/cancel")){
          run.state="cancelled";run.revision++;for(const n of run.nodes)if(n.state!=="succeeded")n.state="cancelled";
          for(const t of tasks.values())if(t.state==="prepared"){t.status="cancelled";t.state="finished";}return response({run:publicRun()});
        }
        assert.ok(url.endsWith("/advance"));assert.equal(b.expected_revision,run.revision);
        if(run.state!=="running")return response({run:publicRun()});
        for(const n of run.nodes)if(n.task_id){const t=tasks.get(n.task_id);if(t.status==="succeeded")n.state="succeeded";
          if(["failed","cancelled","reconciling"].includes(t.status)){run.state=t.status==="reconciling"?"reconciling":"failed";run.revision++;}}
        if(run.state!=="running")return response({run:publicRun()});
        const c=tasks.get(run.coordinator_task_id);
        if(c.status==="succeeded"){run.state="succeeded";run.revision++;return response({run:publicRun()});}
        if(run.nodes.every((n:any)=>n.state==="succeeded")){if(c.status==="paused"){c.status="queued";run.revision++;}}
        else{let slots=2-run.nodes.filter((n:any)=>n.state==="active").length;for(const n of run.nodes)if(slots>0 && n.state==="pending"){
          const m=definition.nodes.find(m=>m.key===n.step_key)!;if(m.depends_on.every(k=>run.nodes.find((n:any)=>n.step_key===k).state==="succeeded")){
            n.task_id=admit(m,randomUUID());n.state="active";run.revision++;slots--;}}}
        return response({run:publicRun(),assignments:assignments()});
      }
      assert.ok(url.includes("/desktop-executions/"),"Team must never create a generic or cloud task");
      const id=url.split("/").at(-2)!,t=tasks.get(id);assert.ok(t,"Known approved native task");
      if(url.endsWith("/start")){
        assert.deepEqual(b && {device_id:b.device_id,local_session_id:b.local_session_id,workspace_hash:b.workspace_hash,runtime_version:b.runtime_version,runtime_sha256:b.runtime_sha256},t.fields);
        starts.push(id);t.state=t.status="running";return response({...startupFixture(t),runtime,inference_path:"/v1/desktop-inference/v1",skills:[],company_tools:[],model:"synthetic-team",effort:"max",role_instructions:"Synthetic local team fixture"});
      }
      if(url.endsWith("/turn-admission"))return startupTurnFixture(t,b);
      if(url.endsWith("/heartbeat"))return response(t);
      if(url.endsWith("/cancel")){t.cancel_requested=true;if(t.state==="prepared"){t.state="finished";t.status="cancelled";}return response(t);}
      if(url.endsWith("/finish")){t.state=b.status==="unknown"?"reconciling":"finished";t.status=b.status==="completed"?"succeeded":b.status==="unknown"?"reconciling":"failed";
        if(finishLost){finishLost=false;throw new Error("Synthetic lost finish response");}return response(t);}
      throw new Error("Unexpected local-team fixture request");
    }};
  const factory:LocalRuntimeFactory=(_p,b,h)=>{
    hooks.push(h);let cancel:((e:Error)=>void)|undefined;
    const stop=async()=>{closed++;cancel?.(new Error("Synthetic native interruption"));};
    return {start:async()=>{await h.authorize();},turn:async(_prompt,signal)=>{
      const saved=journal!.sessions.find(s=>s.id===b.sessionId)!;assert.equal(saved.operation!.phase,"native_running");assert.equal(saved.operation!.startup!.turnKey!==undefined,true);
      const t=tasks.get(saved.operation!.taskId!);turns++;turnSteps.push(t.step_key);active++;maxActive=Math.max(active,maxActive);
      try{if(turnGate)await Promise.race([turnGate,new Promise<never>((_r,reject)=>{cancel=reject;signal!.addEventListener("abort",()=>reject(new Error("Synthetic native interruption")),{once:true});})]);
        await h.authorize();return {status:"completed",text:"Synthetic native output "+t.step_key,threadId:"native_"+b.sessionId,turnId:"turn_"+turns,nativeTokenUsage:null};
      }finally{active--;cancel=undefined;}
    },close:stop,interrupt:stop,revoke:stop};
  };
  let controller=new LocalAgentController(io,factory);
  const prepare=()=>controller.prepareTeam({...scope,group,plan:{fixture:true},mode:"workspace-write"});
  return {scope,actor,group,definition,review,io,factory,prepare,controller:()=>controller,requests,tasks,starts,turnSteps,hooks,
    journal:()=>structuredClone(journal)!,run:()=>publicRun(),turns:()=>turns,maxActive:()=>maxActive,closed:()=>closed,
    loseCreate:()=>{createLost=true;},loseFinish:()=>{finishLost=true;},deny:()=>{consent=false;},
    hold:()=>{turnGate=new Promise<void>(r=>{releaseTurn=r;});},release:()=>{releaseTurn?.();turnGate=undefined;},
    restore:async()=>{await controller.close();controller=new LocalAgentController(io,factory);},
    clean:async()=>{await controller.close();await controller.drainWithdrawn();assert.equal(path.dirname(directory),base);await rm(directory,{recursive:true,force:true});}};
}

test("native contracts reject cyclic or tampered graphs, device substitution and forged successful runs",async()=>{
  const f=await fixture();try{
    const p=await f.prepare(),state:LocalTeamState={group:f.group,review:parseTeamReview(p),binding:f.journal().sessions[0].team!.binding,createKey:randomUUID(),phase:"review"};
    assert.throws(()=>parseTeamReview({...p,definition_hash:"b".repeat(64)}));
    const cyclic=structuredClone(p);cyclic.definition.nodes[0].depends_on=["review"];cyclic.definition_hash=localTeamDigest(cyclic.definition);assert.throws(()=>parseTeamReview(cyclic));
    f.hold();await f.controller().startTeam(p!.local_session_id,p!.id);await wait(()=>f.turns()===2);
    const run=parseTeamRun(f.run(),state);state.run=run;assert.throws(()=>parseTeamRun({...run,state:"succeeded"},state));
    const forged={...f.tasks.values().next().value,fields:{...state.binding,local_session_id:randomUUID(),device_id:randomUUID()}};
    assert.throws(()=>parseTeamAssignments([forged],state));await f.controller().cancelTeam(p!.local_session_id);
  }finally{f.release();await f.clean();}
});
test("two actual controller runtimes overlap, reviewer waits for both, coordinator finishes once and no generic task is created",async()=>{
  const f=await fixture();try{
    const p=await f.prepare();assert.equal(f.turns(),0);assert.equal(f.tasks.size,0);assert.ok(p!.workspace);
    f.hold();await f.controller().startTeam(p!.local_session_id,p!.id);await wait(()=>f.turns()===2);assert.equal(f.maxActive(),2);
    assert.deepEqual(new Set(f.turnSteps),new Set(["first","second"]));f.release();await wait(()=>f.run().state==="succeeded");
    await wait(()=>f.journal().sessions[0].team!.phase==="finished");assert.equal(f.turns(),4);assert.equal(f.turnSteps.at(-1),"coordinator");
    assert.equal(new Set(f.starts).size,4);assert.equal(f.journal().sessions.length,4);assert.equal((await f.controller().updateCheckpoint()).safe,true);
    assert.ok(f.requests.every(r=>!r.url.includes("/cloud-") && !(r.url.endsWith("/desktop-executions") && r.method==="POST")));
  }finally{await f.clean();}
});
test("lost admission response resumes only the saved creation key and preserves the approved root session",async()=>{
  const f=await fixture();try{const p=await f.prepare();f.loseCreate();await assert.rejects(f.controller().startTeam(p!.local_session_id,p!.id));assert.equal(f.turns(),0);
    await f.restore();await f.controller().resumeTeam(p!.local_session_id);await wait(()=>f.run().state==="succeeded");
    const admissions=f.requests.filter(r=>r.url.endsWith("/native/runs") && r.method==="POST");assert.equal(admissions.length,2);assert.equal(admissions[0].idempotencyKey,admissions[1].idempotencyKey);assert.equal(f.turns(),4);
  }finally{await f.clean();}});
test("withdrawal from a member stops the entire team immediately and future native tools lose authority",async()=>{
  const f=await fixture();try{const p=await f.prepare();f.hold();await f.controller().startTeam(p!.local_session_id,p!.id);await wait(()=>f.turns()===2);
    const child=f.journal().sessions.find(r=>r.teamMember)!;await f.controller().revoke(child.id);await wait(()=>f.closed()>0);
    assert.ok(f.journal().sessions.every(r=>r.revoked));assert.equal(f.turns(),2);assert.equal(f.run().state,"cancelled");
    await assert.rejects(f.hooks[0].authorize());await assert.rejects(f.controller().resumeTeam(p!.local_session_id));
  }finally{f.release();await f.clean();}});
test("lost completed member receipt is synchronized without rerunning an accepted native turn",async()=>{
  const f=await fixture();try{const p=await f.prepare();f.loseFinish();await f.controller().startTeam(p!.local_session_id,p!.id);
    await wait(()=>f.journal().sessions[0].team!.phase==="interrupted");const before=f.turns();assert.equal(before,2);
    await f.restore();await f.controller().resumeTeam(p!.local_session_id);await wait(()=>f.run().state==="succeeded");assert.equal(f.turns(),4);
    assert.equal(new Set(f.starts).size,4);assert.equal(f.starts.length,4);
  }finally{await f.clean();}});
test("canceling a lost admission after revoking OS access recovers and cancels its original budget without starting Codex",async()=>{
  const f=await fixture();try{const p=await f.prepare();f.loseCreate();await assert.rejects(f.controller().startTeam(p!.local_session_id,p!.id));
    await f.controller().revoke(p!.local_session_id);assert.equal(f.run().state,"cancelled");assert.equal(f.run().reserved_micros,0);assert.equal(f.turns(),0);
  }finally{await f.clean();}});
test("approved team sessions reject arbitrary sends, recurring dispatches and permission changes",async()=>{
  const f=await fixture();try{const p=await f.prepare();await assert.rejects(f.controller().send(p!.local_session_id,"Unapproved work",100000));
    await assert.rejects(f.controller().permission(p!.local_session_id,"full-access"));await assert.rejects(f.controller().dispatch(p!.local_session_id,randomUUID(),"Unapproved work",100000));
    await assert.rejects(f.controller().schedulingContext(p!.local_session_id));assert.equal(f.turns(),0);
  }finally{await f.clean();}});
test("renderer reads private native team history and downloads, while direct admission, dispatch and cloud team routes remain denied",()=>{
  const g=randomUUID(),r=randomUUID();assert.equal(rendererApiOperation(`/v1/agent-groups/${g}/native/runs/${r}/download?expected_revision=2`),true);
  for(const suffix of ["preflight","runs",`runs/${r}/advance`,`runs/${r}/cancel`])assert.equal(rendererApiOperation(`/v1/agent-groups/${g}/native/${suffix}`,"POST"),false);
  assert.equal(rendererApiOperation(`/v1/agent-groups/${g}/runs`,"POST"),false);assert.equal(rendererApiOperation(`/v1/agent-groups/${g}/native/runs`),true);
});
