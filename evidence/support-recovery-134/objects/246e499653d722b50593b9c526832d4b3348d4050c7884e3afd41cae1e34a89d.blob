// Immutable actual Admin/Web/packaged Desktop qualification. Native PostgreSQL only.
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {createServer,createConnection} from "node:net";
import path from "node:path";

const attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);assert.equal(process.argv.length,3);
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),desktop=path.resolve("../copypaste-desktop"),admin=path.resolve("../copypaste-admin"),web=path.resolve("../copypaste-web"),
  roots={"copypaste-platform":platform,"copypaste-desktop":desktop,"copypaste-admin":admin,"copypaste-web":web},
  base="evidence/support-recovery-134",prefix=`${base}/ui-${attempt}`,sha=b=>createHash("sha256").update(b).digest("hex");
await mkdir(base,{recursive:true});
for(const suffix of [".json",".tap","-sources.json","-verifier.mjs","-journey.json","-journey-verifier.ts"])
  await assert.rejects(readFile(prefix+suffix),e=>e.code==="ENOENT");
async function object(bytes){const file=`${base}/objects/${sha(bytes)}.blob`;await mkdir(path.dirname(file),{recursive:true});try{await writeFile(file,bytes,{flag:"wx"});}catch(e){if(e.code!=="EEXIST")throw e;assert.deepEqual(await readFile(file),bytes);}return{path:file,sha256:sha(bytes)};}
async function snapshot(archive=false){
  const files={};for(const [label,root] of Object.entries(roots)){
    const names=execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","-C",root,"ls-files","--cached","--others","--exclude-standard","-z","--",
      "src","renderer","tests","scripts","catalog","migrations","contracts","skills","public","assets",":(exclude)assets/screenshots/**",".gitattributes","deployment.json","renderer-source.json","package.json","package-lock.json","tsconfig.json","vite.config.ts"],{encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
    for(const name of [...new Set(names)].sort()){const bytes=await readFile(path.join(root,name));files[label+"/"+name]=archive?await object(bytes):{sha256:sha(bytes)};}
  }
  for(const name of ["scripts/qualify-support-recovery-ui-134-v1.mjs","scripts/qa-support-recovery-134-v1.ts","scripts/record-workmate-media.ts"]){const bytes=await readFile(name);files["copypaste-delivery/"+name]=archive?await object(bytes):{sha256:sha(bytes)};}return files;
}
const before=await snapshot(true);await writeFile(prefix+"-sources.json",JSON.stringify(before,null,2)+"\n",{flag:"wx"});
await writeFile(prefix+"-verifier.mjs",await readFile(import.meta.filename),{flag:"wx"});
await writeFile(prefix+"-journey-verifier.ts",await readFile("scripts/qa-support-recovery-134-v1.ts"),{flag:"wx"});
assert.equal(before["copypaste-desktop/.gitattributes"].sha256,"82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e");
process.loadEnvFile(path.join(platform,".env"));
const port=await new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(e=>e?reject(e):resolve(p));});});
const nativeDirectory=".data/native-qa/"+randomUUID(),databaseEnv={COPYPASTE_NATIVE_DATABASE_DIR:nativeDirectory,COPYPASTE_NATIVE_DATABASE_START_ONLY:"true"};
for(const name of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]){const url=new URL(process.env[name]);assert.ok(["127.0.0.1","localhost","::1"].includes(url.hostname));url.port=String(port);databaseEnv[name]=url.href;}
const binary=path.join(desktop,".data/runtime/windows-x64/codex.exe"),pin=JSON.parse(await readFile(path.join(desktop,"contracts/local-codex-runtime.json"),"utf8"));assert.equal(sha(await readFile(binary)),pin.windows_x64_sha256);
const run=path.join(platform,".data/test-fixture-reclamation",randomUUID()),token=randomUUID(),owned=path.resolve(".data/support-recovery-134",randomUUID());
await mkdir(run,{recursive:true});await mkdir(owned,{recursive:true});await writeFile(path.join(run,"manifest.json"),JSON.stringify({owner_pid:process.pid,token}),{flag:"wx"});
const env={...process.env,...databaseEnv,COPYPASTE_LOCAL_CODEX_BIN:binary,COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:token,
  CHROME_BIN:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),COPYPASTE_SUPPORT_OWNED:owned};
const log=createWriteStream(prefix+".tap",{flags:"wx"}),commands=[],previews=[],packageFiles={};
function launch(args,cwd=platform,extra={},ipc=false){const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},windowsHide:true,stdio:ipc?["ignore","pipe","pipe","ipc"]:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",b=>{output=(output+b).slice(-16000);});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const closed=new Promise(resolve=>{child.once("error",()=>resolve(1));child.once("close",code=>resolve(code??1));});return{child,closed,output:()=>output};}
const occupied=p=>new Promise(resolve=>{const socket=createConnection({host:"127.0.0.1",port:p});socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",e=>{socket.destroy();resolve(e.code!=="ECONNREFUSED");});socket.setTimeout(2000,()=>{socket.destroy();resolve(true);});});
async function ready(child,check,ms){const end=Date.now()+ms;while(!await check()){assert.equal(child.child.exitCode,null);assert.ok(Date.now()<end,"Owned service readiness deadline");await new Promise(r=>setTimeout(r,200));}}
const packageRoot=path.join(desktop,`release/support-recovery-134-${attempt}/win-unpacked`);
let database,error=null,resultCode=null,journey=null,cleanup=null,shutdown=null,backend=null;
try{
  for(const p of [4310,4317,4318])assert.equal(await occupied(p),false,"Preserve existing services");
  const npm=process.env.COPYPASTE_NPM_CLI??path.join(path.dirname(process.execPath),"node_modules/npm/bin/npm-cli.js");assert.ok(path.isAbsolute(npm));await readFile(npm);
  for(const [name,args,cwd] of [
    ["backend compiler",["node_modules/typescript/bin/tsc","--noEmit"],platform],
    ["backend build",["node_modules/typescript/bin/tsc"],platform],
    ["cloud bootstrap",["scripts/copy-cloud-check-bootstrap.mjs"],platform],
    ["admin compiler",["node_modules/typescript/bin/tsc","--noEmit"],admin],
    ["admin build",["node_modules/vite/bin/vite.js","build"],admin],
    ["Web compiler",["node_modules/typescript/bin/tsc","--noEmit"],web],
    ["Web build",["node_modules/vite/bin/vite.js","build"],web],
    ["Desktop renderer compiler",["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"],desktop],
    ["Desktop support bridge boundary",["--import","tsx","--test","tests/support-recovery.test.ts"],desktop],
    ["Desktop build",[npm,"run","build"],desktop],
    ["unsigned Windows package",["node_modules/electron-builder/out/cli/cli.js","--win","--dir",`--config.directories.output=release/support-recovery-134-${attempt}`],desktop],
  ]){const code=await launch(args,cwd).closed;commands.push({name,exit_code:code});assert.equal(code,0,name);console.log(name+": passed");}
  for(const name of ["CopyPaste.exe","resources/app.asar","resources/local-codex/codex.exe","resources/local-codex/runtime-manifest.json"])packageFiles[name]=sha(await readFile(path.join(packageRoot,name)));
  assert.equal(packageFiles["resources/local-codex/codex.exe"],pin.windows_x64_sha256);
  const asar=createRequire(path.join(desktop,"package.json"))("@electron/asar");
  for(const name of ["dist/main.js","dist/preload.cjs","renderer-dist/index.html"])assert.equal(sha(asar.extractFile(path.join(packageRoot,"resources/app.asar"),path.normalize(name))),sha(await readFile(path.join(desktop,name))),name);
  database=launch(["scripts/native-db-launch.mjs"],platform,{},true);await ready(database,()=>database.output().includes("Native PostgreSQL ready"),600000);
  for(const [root,port] of [[web,4317],[admin,4318]]){const preview=launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(port),"--strictPort"],root);previews.push(preview);await ready(preview,()=>occupied(port),30000);}
  console.log("Actual Admin/Web/packaged native Desktop support journey starting");
  resultCode=await launch(["--import","tsx","scripts/qa-support-recovery-134-v1.ts",attempt],delivery,{COPYPASTE_LOCAL_DESKTOP_CANDIDATE:path.join(packageRoot,"CopyPaste.exe")}).closed;
  journey=JSON.parse(await readFile(prefix+"-journey.json"));
  const bytes=await readFile("evidence/support-recovery-134/backend-01.json");backend={path:"evidence/support-recovery-134/backend-01.json",sha256:sha(bytes),...JSON.parse(bytes)};
  assert.equal(backend.status,"passed");const covered=JSON.parse(await readFile(backend.source_manifest.path));
  for(const [name,row] of Object.entries(covered))if(name.startsWith("copypaste-platform/"))assert.equal(before[name]?.sha256,row.sha256,name);
}catch(e){error=String(e);}
finally{
  try{const code=await launch(["--import","tsx","scripts/reclaim-test-fixtures.ts"]).closed,bytes=await readFile(path.join(run,"result.json"));await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});cleanup={exit_code:code,sha256:sha(bytes),...JSON.parse(bytes)};}catch(e){error??=String(e);}
  for(const preview of previews){if(preview.child.exitCode===null)preview.child.kill();await preview.closed;}
  if(database?.child.connected&&database.child.exitCode===null)database.child.send({action:"shutdown"});if(database)shutdown=await database.closed;
  await new Promise(r=>log.end(r));
}
const raw=await readFile(prefix+".tap"),after=await snapshot(),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([name,row])=>after[name]?.sha256===row.sha256),portsClosed={};
for(const p of [port,4310,4317,4318])portsClosed[p]=!(await occupied(p));
let packageUnchanged=Object.keys(packageFiles).length===4;for(const [name,digest] of Object.entries(packageFiles))if(sha(await readFile(path.join(packageRoot,name)))!==digest)packageUnchanged=false;
const passed=!error&&resultCode===0&&journey?.status==="passed"&&journey.checks.length===18&&journey.errors.length===0&&journey.screenshots.length===9&&journey.recordings.length===5&&journey.layouts.length===10&&
  journey.recordings.every(r=>r.distinct_frames>1&&r.skipped_capture_errors===0)&&journey.browser_closed&&journey.desktop_closed&&journey.api_closed&&journey.fixture_closed&&journey.model_calls===0&&
  cleanup?.status==="passed"&&cleanup.exit_code===0&&shutdown===0&&Object.values(portsClosed).every(Boolean)&&unchanged&&packageUnchanged;
const report={at:new Date().toISOString(),status:passed?"passed":"failed",error,commands,result_exit_code:resultCode,
  source_manifest:{path:prefix+"-sources.json",sha256:sha(await readFile(prefix+"-sources.json"))},source_unchanged:unchanged,
  raw_report:{path:prefix+".tap",sha256:sha(raw)},verifier:{path:prefix+"-verifier.mjs",sha256:sha(await readFile(import.meta.filename))},
  journey:journey?{path:prefix+"-journey.json",sha256:sha(await readFile(prefix+"-journey.json")),checks:journey.checks}:null,
  backend:backend?{path:backend.path,sha256:backend.sha256,counts:backend.counts}:null,package_directory:path.relative(delivery,packageRoot).replaceAll("\\","/"),package_files:packageFiles,package_unchanged:packageUnchanged,
  native_codex:pin,owned_native_directory:nativeDirectory,owned_native_port:port,owned_database_shutdown:shutdown===0,ports_closed:portsClosed,fixture_cleanup:cleanup,
  scope:"Actual bounded support journey with synthetic business data and no model calls; unsigned native Windows package. Not complete product or production acceptance."};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:report.status,error,source_unchanged:unchanged,package_unchanged:packageUnchanged,checks:journey?.checks.length??0}));assert.ok(passed,"Preserve each executed attempt and its original sources");
