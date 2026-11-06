import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {cloudWorkDestination} from "../src/cloud-work-destination.js";
test("Desktop opens the exact cloud conversation and selected task at the company origin",()=>{
 const tenant=randomUUID(),project=randomUUID(),conversation=randomUUID(),task=randomUUID();
 const u=new URL(cloudWorkDestination("https://agent.copypaste.hk",{kind:"work",tenant,project,conversation,task}));
 assert.equal(u.origin,"https://agent.copypaste.hk");assert.equal(u.pathname,"/app/conversations/"+conversation);assert.equal(u.searchParams.get("task"),task);assert.equal(u.searchParams.get("workspace"),tenant);assert.equal(u.searchParams.get("project"),project);
 assert.equal(new URL(cloudWorkDestination(u.origin,{kind:"work",tenant,project,task})).pathname,"/app/tasks/"+task);
});
test("untrusted renderer payloads cannot open arbitrary paths or URLs through cloud-work IPC",()=>{
 const valid={kind:"work",tenant:randomUUID(),project:randomUUID(),task:randomUUID()};
 for(const input of ["https://evil.invalid",[],null,{}, {...valid,url:"https://evil.invalid"},{...valid,task:"../../settings"},{...valid,project:undefined},{...valid,conversation:"javascript:alert(1)"}])assert.throws(()=>cloudWorkDestination("https://agent.copypaste.hk",input));
 for(const root of ["file:///tmp/a","https://secret@agent.copypaste.hk","https://agent.copypaste.hk?x=1"])assert.throws(()=>cloudWorkDestination(root,valid));
});
test("existing cloud/device/geo launch entries retain their destination",()=>{
 const origin="https://agent.copypaste.hk";assert.equal(cloudWorkDestination(origin),origin+"/app");assert.equal(cloudWorkDestination(origin,"devices"),origin+"/app/devices");assert.equal(cloudWorkDestination(origin,"geo"),origin+"/app/analytics?view=geo");
});
