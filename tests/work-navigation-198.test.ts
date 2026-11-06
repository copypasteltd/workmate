import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {emptyDirectory,directoryView,readDirectory,updateNavigation,scopedWorkPath,routeScope,pageForward} from "../src/work-navigation-state.ts";
test("returning from a task restores the original private filters and pages only for its account/session/project",()=>{
 const view={...emptyDirectory(),q:"Customer campaign",status:"succeeded",location:"desktop",mode:"ask",pages:["","opaque.signature"]};
 const saved=updateNavigation({foreignRouterState:42},"account/session/project","tasks",view);
 assert.deepEqual(readDirectory(saved,"account/session/project","tasks"),view);assert.equal((saved as Record<string,unknown>).foreignRouterState,42);
 for(const scope of ["other/session/project","account/new-session/project","account/session/other"]){assert.deepEqual(readDirectory(saved,scope,"tasks"),emptyDirectory());}
 const restored=readDirectory(saved,"account/session/project","tasks");restored.pages.push("changed.signature");assert.equal(view.pages.length,2);
});
test("task/conversation/file/native links retain the correct workspace, project and selected task without exposing searches",()=>{
 const tenant=randomUUID(),project=randomUUID(),task=randomUUID(),chat=randomUUID();
 for(const path of ["/app/tasks/"+task,"/app/conversations/"+chat+"?task="+task,"/app/files?conversation="+chat,"/app?native_task="+task]){
  const target=scopedWorkPath(path,tenant,project),u=new URL(target,"https://example.invalid");
  assert.deepEqual(routeScope(u.pathname,u.search),{tenant,project});assert.equal(u.searchParams.has("q"),false);
  if(path.includes("?task="))assert.equal(u.searchParams.get("task"),task);
 }
});
test("external destinations, incomplete or duplicate scopes cannot become trusted work links",()=>{
 const tenant=randomUUID(),project=randomUUID();
 for(const path of ["https://evil.invalid/app/tasks","//evil.invalid/app/tasks","javascript:alert(1)","/app/settings","/app/tasks#hidden"]){assert.throws(()=>scopedWorkPath(path,tenant,project));}
 for(const search of ["?workspace="+tenant,"?workspace="+tenant+"&project=bad","?workspace="+tenant+"&workspace="+tenant+"&project="+project])assert.equal(routeScope("/app/tasks",search),"invalid");
 assert.equal(routeScope("/app/tasks",""),null);
});
test("invalid history shapes fail closed and bounded pagination never drops the current page",()=>{
 for(const value of [null,{...emptyDirectory(),q:"x".repeat(161)},{...emptyDirectory(),status:"any"},{...emptyDirectory(),pages:["forged"]},{...emptyDirectory(),pages:["","https://evil.invalid"]}])assert.equal(directoryView(value),null);
 const full={...emptyDirectory(),pages:["",...Array(511).fill("opaque.signature")]};assert.throws(()=>pageForward(full,"next.signature"));assert.equal(full.pages.length,512);
 assert.deepEqual(pageForward(emptyDirectory(),"next.signature").pages,["","next.signature"]);
});
