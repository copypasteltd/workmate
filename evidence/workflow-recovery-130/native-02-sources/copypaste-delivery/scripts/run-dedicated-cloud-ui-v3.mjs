import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";

const attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);assert.equal(process.argv.length,3);
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform-recovery-120"),web=path.resolve("../copypaste-web-cloud-121"),admin=path.resolve("../copypaste-admin-cloud-121");
assert.equal(path.basename(delivery),"copypaste-delivery-cloud-121");
const prefix=".data/dedicated-cloud-121/ui-"+attempt,hash=b=>createHash("sha256").update(b).digest("hex");
for(const suffix of [".json",".log","-journey.json","-verifier.mjs","-journey-verifier.ts"])await assert.rejects(access(prefix+suffix),e=>e.code==="ENOENT");
async function snapshot(){
  const result={};for(const repo of [platform,web,admin,delivery]){
    const files=execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","ls-files","--cached","--others","--exclude-standard","-z","--","src","scripts","tests","migrations","catalog","contracts","skills","public","package.json","package-lock.json","tsconfig.json","vite.config.ts"],{cwd:repo,encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
    for(const file of [...new Set(files)].sort())result[path.basename(repo)+"/"+file]=hash(await readFile(path.join(repo,file)));
  }return result;
}
async function tree(folder,prefix=""){
  const result={};for(const e of await readdir(folder,{withFileTypes:true})){
    assert.equal(e.isSymbolicLink(),false);const file=path.join(folder,e.name);
    if(e.isDirectory())Object.assign(result,await tree(file,prefix+e.name+"/"));else result[prefix+e.name]=hash(await readFile(file));
  }return result;
}
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const occupied=port=>new Promise(resolve=>{const s=createConnection({host:"127.0.0.1",port});s.once("connect",()=>{s.destroy();resolve(true);});s.once("error",()=>resolve(false));});
const ports={database:await freePort(),api:await freePort(),web:await freePort(),admin:await freePort()};assert.equal(new Set(Object.values(ports)).size,4);
const before=await snapshot(),verifier=await readFile(import.meta.filename),journeyVerifier=await readFile("scripts/qa-dedicated-cloud-ui-v3.ts");
for(const [file,digest]of Object.entries(before)){const bytes=await readFile(path.resolve("..",file));assert.equal(hash(bytes),digest);const dest=prefix+"-sources/"+file;await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:"wx"});}
await writeFile(prefix+"-verifier.mjs",verifier,{flag:"wx"});await writeFile(prefix+"-journey-verifier.ts",journeyVerifier,{flag:"wx"});
process.loadEnvFile(path.join(platform,".env"));
const dbEnv={COPYPASTE_NATIVE_DATABASE_DIR:".data/native-qa/"+randomUUID()};
for(const name of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]){const url=new URL(process.env[name]);url.port=String(ports.database);dbEnv[name]=url.href;}
const run=path.join(platform,".data/test-fixture-reclamation",randomUUID()),token=randomUUID();await mkdir(run,{recursive:true});await writeFile(path.join(run,"manifest.json"),JSON.stringify({owner_pid:process.pid,token}),{flag:"wx"});
const log=createWriteStream(prefix+".log",{flags:"wx"});
function launch(args,cwd,env={}){const child=spawn(process.execPath,args,{cwd,env:{...process.env,...dbEnv,...env},windowsHide:true,stdio:["ignore","pipe","pipe","ipc"]});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const closed=new Promise(resolve=>{child.once("close",code=>resolve(code??1));child.once("error",()=>resolve(1));});return{child,closed};}
let database,webPreview,adminPreview,error=null,shutdown=null,cleanupExit=null,journeyExit=null,compiled=null;const checks=[];
try{
  for(const [name,args,cwd,env]of [
    ["platform-typecheck",["node_modules/typescript/bin/tsc","--noEmit"],platform,{}],
    ["web-build",["node_modules/vite/bin/vite.js","build"],web,{VITE_API_BASE:`http://localhost:${ports.api}`}],
    ["admin-build",["node_modules/vite/bin/vite.js","build"],admin,{VITE_API_BASE:`http://localhost:${ports.api}`}],
  ]){const exit=await launch(args,cwd,env).closed;checks.push({name,exit});assert.equal(exit,0,name);}
  compiled={web:await tree(path.join(web,"dist")),admin:await tree(path.join(admin,"dist"))};
  database=launch(["scripts/native-db-launch.mjs"],platform,{COPYPASTE_NATIVE_DATABASE_START_ONLY:"true"});let output="";database.child.stdout.on("data",b=>{output=(output+b.toString()).slice(-20000);});
  let end=Date.now()+900000;while(!output.includes("Native PostgreSQL ready")){assert.equal(database.child.exitCode,null);assert.ok(Date.now()<end,"Native database startup");await new Promise(r=>setTimeout(r,200));}
  webPreview=launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(ports.web),"--strictPort"],web);
  adminPreview=launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(ports.admin),"--strictPort"],admin);
  end=Date.now()+30000;while(!await occupied(ports.web)||!await occupied(ports.admin)){assert.equal(webPreview.child.exitCode,null);assert.equal(adminPreview.child.exitCode,null);assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,200));}
  const env={COPYPASTE_CLOUD_UI_PORTS:JSON.stringify(ports),COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:token,CHROME_BIN:path.resolve("../copypaste-delivery/.data/browsers/chromium-1248/chrome-win64/chrome.exe")};
  journeyExit=await launch(["--import","tsx","scripts/qa-dedicated-cloud-ui-v3.ts",attempt],delivery,env).closed;
  cleanupExit=await launch(["--import","tsx","scripts/reclaim-test-fixtures.ts"],platform,env).closed;
  const bytes=await readFile(path.join(run,"result.json"));await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});
}catch(e){error=String(e);}finally{
  for(const process of [webPreview,adminPreview]){if(process?.child.exitCode===null)process.child.kill();if(process)await process.closed;}
  if(database?.child.connected&&database.child.exitCode===null)database.child.send({action:"shutdown"});if(database)shutdown=await database.closed;
  await new Promise(r=>log.end(r));
  const after=await snapshot(),sourceUnchanged=JSON.stringify(before)===JSON.stringify(after),buildUnchanged=!!compiled&&JSON.stringify(compiled)===JSON.stringify({web:await tree(path.join(web,"dist")),admin:await tree(path.join(admin,"dist"))});
  const journeyBytes=await readFile(prefix+"-journey.json").catch(()=>null),journey=journeyBytes?JSON.parse(journeyBytes):null,cleanupBytes=await readFile(prefix+"-fixture-cleanup.json").catch(()=>null),cleanup=cleanupBytes?JSON.parse(cleanupBytes):null;
  const passed=!error&&journeyExit===0&&cleanupExit===0&&shutdown===0&&sourceUnchanged&&buildUnchanged&&journey?.status==="passed"&&journey.browser_closed&&journey.api_closed&&journey.fixture_closed&&journey.recordings.length===2&&journey.layouts.length>=6&&cleanup?.status==="passed"&&cleanup.workers_exited&&cleanup.actual_filesystem_checked&&cleanup.results.every(r=>r.reclaimed);
  const result={status:passed?"passed":"failed",scope:"Actual Web/Admin cost consent, exact file metadata picker, private session controls and reasoned admin actions; synthetic preprovisioned node protocol and pixels, no actual remote computer or Codex execution claimed",at:new Date().toISOString(),error,ports,checks,journey_exit_code:journeyExit,source_files:before,source_unchanged:sourceUnchanged,compiled,compiled_unchanged:buildUnchanged,verifier:{path:prefix+"-verifier.mjs",sha256:hash(verifier)},journey_verifier:{path:prefix+"-journey-verifier.ts",sha256:hash(journeyVerifier)},raw_report:{path:prefix+".log",sha256:hash(await readFile(prefix+".log"))},journey:journeyBytes?{path:prefix+"-journey.json",sha256:hash(journeyBytes)}:null,fixture_cleanup:cleanupBytes?{path:prefix+"-fixture-cleanup.json",sha256:hash(cleanupBytes)}:null,owned_database_shutdown:shutdown===0,owned_previews_closed:[webPreview,adminPreview].every(p=>!p||p.child.exitCode!==null||p.child.signalCode!==null)};
  await writeFile(prefix+".json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,error,checks:journey?.checks,source_unchanged:sourceUnchanged,shutdown}));assert.ok(passed,"Inspect preserved source-bound cloud-computer UI attempt");
}
