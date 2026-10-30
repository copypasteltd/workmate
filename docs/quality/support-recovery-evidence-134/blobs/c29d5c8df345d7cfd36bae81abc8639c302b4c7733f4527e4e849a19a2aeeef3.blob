// Preserve each executed attempt and its exact source; native PostgreSQL only.
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {createServer,createConnection} from "node:net";
import path from "node:path";

const [mode,attempt]=process.argv.slice(2);
assert.ok(["baseline","backend"].includes(mode));assert.match(attempt??"",/^\d{2}$/);assert.equal(process.argv.length,4);
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),base="evidence/support-recovery-134",prefix=`${base}/${mode}-${attempt}`;
const sha=b=>createHash("sha256").update(b).digest("hex");
await mkdir(base,{recursive:true});
for(const suffix of [".json",".tap","-sources.json","-verifier.mjs"])
  await assert.rejects(readFile(prefix+suffix),e=>e.code==="ENOENT");
async function object(body){
  const file=`${base}/objects/${sha(body)}.blob`;await mkdir(path.dirname(file),{recursive:true});
  try{await writeFile(file,body,{flag:"wx"});}catch(e){if(e.code!=="EEXIST")throw e;assert.deepEqual(await readFile(file),body);}
  return {path:file,sha256:sha(body)};
}
async function snapshot(archive=false){
  const files={};
  const names=execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","-C",platform,"ls-files","--cached","--others","--exclude-standard","-z","--",
    "src","tests","scripts","migrations","catalog","contracts","skills","assets/fonts","public","package.json","package-lock.json","tsconfig.json","vite.config.ts"],{encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
  for(const name of [...new Set(names)].sort()){
    const bytes=await readFile(path.join(platform,name));files["copypaste-platform/"+name]=archive?await object(bytes):{sha256:sha(bytes)};
  }
  const self=path.relative(delivery,import.meta.filename).replaceAll("\\","/"),bytes=await readFile(import.meta.filename);
  files["copypaste-delivery/"+self]=archive?await object(bytes):{sha256:sha(bytes)};return files;
}
const before=await snapshot(true);
await writeFile(prefix+"-sources.json",JSON.stringify(before,null,2)+"\n",{flag:"wx"});
await writeFile(prefix+"-verifier.mjs",await readFile(import.meta.filename),{flag:"wx"});
process.loadEnvFile(path.join(platform,".env"));
const port=await new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(e=>e?reject(e):resolve(port));});});
const nativeDirectory=".data/native-qa/"+randomUUID(),env={...process.env,COPYPASTE_NATIVE_DATABASE_DIR:nativeDirectory,COPYPASTE_NATIVE_DATABASE_START_ONLY:"true",
  COPYPASTE_LOCAL_CODEX_BIN:path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe")};
for(const name of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]){
  const url=new URL(process.env[name]);assert.ok(["127.0.0.1","localhost","::1"].includes(url.hostname));url.port=String(port);env[name]=url.href;
}
const log=createWriteStream(prefix+".tap",{flags:"wx"}),checks=[];
function launch(args,ipc=false){
  const child=spawn(process.execPath,args,{cwd:platform,env,windowsHide:true,stdio:ipc?["ignore","pipe","pipe","ipc"]:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",b=>{output=(output+b).slice(-16000);});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const closed=new Promise(resolve=>{child.once("close",code=>resolve(code??1));child.once("error",()=>resolve(1));});return{child,closed,output:()=>output};
}
const occupied=p=>new Promise(resolve=>{const socket=createConnection({host:"127.0.0.1",port:p});socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",e=>{socket.destroy();resolve(e.code!=="ECONNREFUSED");});socket.setTimeout(2000,()=>{socket.destroy();resolve(true);});});
let database,resultCode=null,shutdown=null,error=null,cleanup=null;
try{
  for(const [name,args] of [["backend compiler",["node_modules/typescript/bin/tsc","--noEmit"]],["backend build",["node_modules/typescript/bin/tsc"]],["cloud bootstrap",["scripts/copy-cloud-check-bootstrap.mjs"]]]){
    const code=await launch(args).closed;checks.push({name,exit_code:code});assert.equal(code,0,name);
  }
  database=launch(["scripts/native-db-launch.mjs"],true);
  const deadline=Date.now()+600000;
  while(!database.output().includes("Native PostgreSQL ready")){
    assert.equal(database.child.exitCode,null);assert.ok(Date.now()<deadline,"Native database readiness deadline");await new Promise(r=>setTimeout(r,200));
  }
  console.log("Owned native PostgreSQL ready; actual scoped support and source withdrawal qualification");
  const tests=mode==="baseline"?["tests/support-recovery.test.ts"]:
    ["tests/support-recovery.test.ts","tests/support-source-access.test.ts","tests/admin-support.test.ts","tests/admin-content-history.test.ts","tests/task-history-sources.test.ts"];
  resultCode=await launch(["--env-file=.env","scripts/run-tests-owned.mjs",...tests]).closed;
}catch(e){error=String(e);}
finally{
  if(database?.child.connected&&database.child.exitCode===null)database.child.send({action:"shutdown"});
  if(database)shutdown=await database.closed;
  await new Promise(r=>log.end(r));
}
const raw=await readFile(prefix+".tap"),match=raw.toString().match(/^# owned_fixture_cleanup (.+)$/m);
if(match){const entry=JSON.parse(match[1]),body=await readFile(path.join(platform,entry.path));assert.equal(sha(body),entry.sha256);
  await writeFile(prefix+"-fixture-cleanup.json",body,{flag:"wx"});cleanup={exit_code:entry.exit_code,sha256:sha(body),...JSON.parse(body)};}
const after=await snapshot(),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([name,v])=>after[name]?.sha256===v.sha256),portClosed=!(await occupied(port));
const passed=!error&&resultCode===0&&shutdown===0&&portClosed&&unchanged&&cleanup?.status==="passed"&&cleanup?.exit_code===0;
const counts=Object.fromEntries(["tests","pass","fail","cancelled","skipped","todo"].map(name=>[name,Number(raw.toString().match(new RegExp("^# "+name+" (\\d+)$","m"))?.[1]??-1)]));
const report={at:new Date().toISOString(),status:passed?"passed":"failed",mode,error,checks,counts,result_exit_code:resultCode,source_unchanged:unchanged,
  source_manifest:{path:prefix+"-sources.json",sha256:sha(await readFile(prefix+"-sources.json"))},raw_report:{path:prefix+".tap",sha256:sha(raw)},
  verifier:{path:prefix+"-verifier.mjs",sha256:sha(await readFile(import.meta.filename))},owned_native_directory:nativeDirectory,owned_native_port:port,
  owned_database_shutdown:shutdown===0,owned_database_port_closed:portClosed,fixture_cleanup:cleanup,
  scope:"Actual native PostgreSQL and specified support/source/history test files. Business data and retained results are synthetic; no production model or complete product acceptance."};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:report.status,report:prefix+".json",counts,source_unchanged:unchanged,error}));
assert.ok(passed,"Keep the original failed report and exact sources; use a new attempt for corrections");
