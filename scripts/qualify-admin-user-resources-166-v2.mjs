import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir,open,readFile,writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
const root=process.cwd(),platform=path.resolve("../copypaste-platform"),admin=path.resolve("../copypaste-admin"),out=path.resolve(".data/admin-user-resources-166/run-"+randomUUID());
await mkdir(out,{recursive:true});await mkdir("evidence/admin-user-resources-166",{recursive:true});
const receipt="evidence/admin-user-resources-166/qualification-02.json";await assert.rejects(readFile(receipt),e=>e.code==="ENOENT");
const log=await open(path.join(out,"commands.log"),"wx"),digest=b=>createHash("sha256").update(b).digest("hex");
process.loadEnvFile(path.join(platform,".env"));
const env={...process.env,NODE_ENV:"test",COPYPASTE_NATIVE_DATABASE_DIR:".data/native-qa/"+randomUUID(),COPYPASTE_NATIVE_DATABASE_START_ONLY:"true",COPYPASTE_FUNCTIONAL_FIXTURE:path.join(out,"private-fixture.json")};
for(const k of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]){const u=new URL(env[k]);assert.ok(["localhost","127.0.0.1"].includes(u.hostname));u.hostname="127.0.0.1";u.port="55443";u.pathname="/copypaste";env[k]=u.href;}
const files=["copypaste-platform/src/admin.ts","copypaste-platform/src/admin-content.ts","copypaste-platform/src/assets.ts","copypaste-platform/src/admin-directory.ts","copypaste-platform/tests/admin-user-resources-166-v1.test.ts","copypaste-platform/tests/admin-user-resources-fixture-166-v1.ts","copypaste-platform/scripts/serve-admin-user-resources-166-v1.ts","copypaste-admin/src/main.tsx","copypaste-admin/src/user-resources.ts","copypaste-delivery/scripts/qa-admin-user-resources-166-v2.ts","copypaste-delivery/scripts/qualify-admin-user-resources-166-v2.mjs"];
const snapshot=async()=>Object.fromEntries(await Promise.all(files.map(async n=>[n,digest(await readFile(path.resolve("..",n)))])));
const before=await snapshot(),result={at:new Date().toISOString(),status:"running",error:null,build_commands:[],source_before:before,owned_services_closed:false};
function launch(args,cwd,ipc=false){const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:ipc?["ignore",log.fd,log.fd,"ipc"]:["ignore",log.fd,log.fd]});const closed=new Promise(resolve=>{child.once("error",()=>resolve(1));child.once("close",code=>resolve(code??1));});return{child,closed};}
const occupied=port=>new Promise(resolve=>{const s=net.connect({host:"127.0.0.1",port});s.once("connect",()=>{s.destroy();resolve(true);});s.once("error",e=>{s.destroy();resolve(e.code!=="ECONNREFUSED");});s.setTimeout(1500,()=>{s.destroy();resolve(true);});});
async function ready(p,check,ms){const end=Date.now()+ms;while(!await check()){assert.equal(p.child.exitCode,null);assert.ok(Date.now()<end,"Owned readiness deadline");await new Promise(r=>setTimeout(r,150));}}
async function stop(p,ipc){if(!p||p.child.exitCode!==null)return;if(ipc&&p.child.connected)p.child.send({action:"shutdown"});else p.child.kill("SIGTERM");let timer;try{await Promise.race([p.closed,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error("Owned shutdown deadline")),55000))]);}finally{clearTimeout(timer);}}
let db,api,vite;
try{
 for(const port of [4310,4318,55443])assert.equal(await occupied(port),false,"Existing port owner preserved: "+port);
 const priorPath="evidence/admin-user-resources-166/qualification-01.json",prior=JSON.parse(await readFile(priorPath,"utf8"));
 assert.equal(prior.database_tests,8);assert.ok(prior.build_commands.length===4&&prior.build_commands.every(b=>b.exit_code===0));assert.ok(prior.owned_services_closed&&prior.source_unchanged);assert.ok(prior.error.includes("Actual Admin UI checks failed"));
 for(const [name,h]of Object.entries(prior.source_before))assert.equal(digest(await readFile(path.resolve("..",name))),h,"Original scope changed: "+name);
 result.inherited_checks={path:priorPath,sha256:digest(await readFile(priorPath)),database_tests:8,build_commands:prior.build_commands,reason:"Unchanged product/test sources; only actual browser resource locator changes. Original failed UI is retained."};
 console.log("Current source matches the prior successful builds and eight native SQL/API checks");
 db=launch(["scripts/native-db-launch.mjs"],platform,true);
 await ready(db,async()=>(await readFile(path.join(out,"commands.log"),"utf8")).includes("Native PostgreSQL ready on 127.0.0.1:55443"),120000);
 let apiReady=false;api=launch(["--import","tsx","scripts/serve-admin-user-resources-166-v1.ts"],platform,true);api.child.on("message",m=>{if(m?.ready)apiReady=true;});await ready(api,async()=>apiReady,120000);
 vite=launch(["node_modules/vite/bin/vite.js","--host","localhost","--port","4318","--strictPort"],admin);await ready(vite,async()=>{try{return(await fetch("http://localhost:4318")).ok;}catch{return false;}},30000);
 const ui=launch(["--import","tsx","scripts/qa-admin-user-resources-166-v2.ts",env.COPYPASTE_FUNCTIONAL_FIXTURE],root);assert.equal(await ui.closed,0,"Actual Admin UI checks failed; originals retained");
 const uiPath="evidence/admin-user-resources-166/admin-ui-02.json",data=JSON.parse(await readFile(uiPath,"utf8"));assert.equal(data.status,"passed");assert.ok(data.browser_closed);result.ui={path:uiPath,sha256:digest(await readFile(uiPath)),checks:data.checks.length};
}catch(e){result.error=String(e);}
finally{
 for(const [p,ipc]of[[vite,false],[api,true],[db,true]])try{await stop(p,ipc);}catch(e){result.error=(result.error||"")+"; "+String(e);}
 result.owned_services_closed=!(await occupied(4310))&&!(await occupied(4318))&&!(await occupied(55443));result.source_after=await snapshot();result.source_unchanged=JSON.stringify(before)===JSON.stringify(result.source_after);result.status=!result.error&&result.ui&&result.source_unchanged&&result.owned_services_closed?"passed":"failed";
 result.finished_at=new Date().toISOString();result.verifier_sha256=digest(await readFile(import.meta.filename));await log.close();result.private_log=path.relative(root,path.join(out,"commands.log")).replaceAll("\\","/");result.private_log_sha256=digest(await readFile(path.join(out,"commands.log")));
 await writeFile(receipt,JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,error:result.error,receipt,owned_services_closed:result.owned_services_closed}));
}
assert.equal(result.status,"passed");
