import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { createRequire } from "node:module";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-delivery-cloud-121");
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-recovery-120"), desktop = path.resolve("../copypaste-desktop-cloud-121"), web = path.resolve("../copypaste-web-cloud-121");
const prefix = `.data/dedicated-cloud-121/desktop-ui-${attempt}`, hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const tail of [".json", ".log", "-journey.json", "-verifier.mjs", "-journey-verifier.ts"]) await assert.rejects(access(prefix + tail), e => e.code === "ENOENT");
async function occupied(port) { return new Promise(resolve => { const s = createConnection({host:"127.0.0.1",port});s.once("connect",()=>{s.destroy();resolve(true);});s.once("error",()=>resolve(false)); }); }
for (const port of [4310,4317]) assert.equal(await occupied(port),false,"Keep unrelated services untouched");
async function snapshot() {
  const result = {};
  for (const folder of [platform, desktop, web, delivery]) {
    const names = execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","ls-files","--cached","--others","--exclude-standard","-z","--","src","renderer","renderer-source.json","scripts","tests","catalog","contracts","migrations","skills","public","package.json","package-lock.json","tsconfig.json","vite.config.ts","deployment.json",":(glob)assets/*.png",":(glob)assets/*.ico",":(glob)assets/*.cmd","assets/browser-shell.html","assets/browser-shell.css","assets/browser-shell.js","assets/licenses"],{cwd:folder,encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
    for(const name of [...new Set(names)].sort()) result[path.basename(folder)+"/"+name]=hash(await readFile(path.join(folder,name)));
  }
  return result;
}
const binary=path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"),pin=JSON.parse(await readFile(path.join(desktop,"contracts/local-codex-runtime.json")));
assert.equal(hash(await readFile(binary)),pin.windows_x64_sha256);
const before=await snapshot(),verifier=await readFile(import.meta.filename),worker=await readFile("scripts/qa-dedicated-desktop-ui-v1.ts");
for(const[name,expected]of Object.entries(before)) {const bytes=await readFile(path.resolve("..",name));assert.equal(hash(bytes),expected);const dest=prefix+"-sources/"+name;await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:"wx"});}
await writeFile(prefix+"-verifier.mjs",verifier,{flag:"wx"});await writeFile(prefix+"-journey-verifier.ts",worker,{flag:"wx"});
process.loadEnvFile(path.join(platform,".env"));
const port=await new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});
const env={COPYPASTE_NATIVE_DATABASE_DIR:".data/native-qa/"+randomUUID(),COPYPASTE_LOCAL_CODEX_BIN:binary,COPYPASTE_LOCAL_CODEX_TEST_BIN:binary,CODEX_BIN:binary,CODEX_VERSION:pin.runtime_version};
for(const name of["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]){const u=new URL(process.env[name]);u.port=String(port);env[name]=u.href;}
const run=path.join(platform,".data/test-fixture-reclamation",randomUUID()),token=randomUUID(),candidate=path.join(desktop,".data/local-candidates",randomUUID());
await mkdir(run,{recursive:true});await writeFile(path.join(run,"manifest.json"),JSON.stringify({owner_pid:process.pid,token}),{flag:"wx"});
const log=createWriteStream(prefix+".log",{flags:"wx"});
function launch(args,cwd,extra={}) {const child=spawn(process.execPath,args,{cwd,env:{...process.env,...env,...extra},windowsHide:true,stdio:["ignore","pipe","pipe","ipc"]});let output="";child.stdout.on("data",b=>output=(output+b.toString()).slice(-20000));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const closed=new Promise(resolve=>{child.once("close",c=>resolve(c??1));child.once("error",()=>resolve(1));});return{child,closed,output:()=>output};}
const checks=[];let database,preview,shutdown=null,journeyCode=null,cleanup=null,journey=null,built=null,error=null;
try{
  for(const[name,args,cwd]of[
    ["delivery types",["node_modules/typescript/bin/tsc","--noEmit"],delivery],
    ["platform types",["node_modules/typescript/bin/tsc","--noEmit"],platform],
    ["desktop main types",["node_modules/typescript/bin/tsc","--noEmit"],desktop],
    ["desktop renderer types",["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"],desktop],
    ["program guardian",["scripts/build-program-host.mjs"],desktop],
    ["update guardian",["scripts/build-update-host.mjs"],desktop],
    ["pinned native runtime",["scripts/prepare-local-codex.mjs"],desktop],
    ["desktop main build",["node_modules/typescript/bin/tsc"],desktop],
    ["desktop native host",["scripts/build-native-host.mjs"],desktop],
    ["desktop renderer build",["node_modules/vite/bin/vite.js","build","--config","vite.config.ts"],desktop],
    ["web preview build",["node_modules/vite/bin/vite.js","build"],web],
  ]){const code=await launch(args,cwd).closed;checks.push({name,exit_code:code});assert.equal(code,0,name);}
  const pkg=JSON.parse(await readFile(path.join(desktop,"node_modules/electron-builder/package.json"))),entry=typeof pkg.bin==="string"?pkg.bin:pkg.bin["electron-builder"];
  assert.equal(await launch([path.join(desktop,"node_modules/electron-builder",entry),"--win","--dir","--config.directories.output="+candidate],desktop).closed,0,"Current native candidate packaging");
  const executable=path.join(candidate,"win-unpacked/CopyPaste.exe"),resources=path.join(candidate,"win-unpacked/resources");await access(executable);
  assert.equal(hash(await readFile(path.join(resources,"local-codex/codex.exe"))),pin.windows_x64_sha256);
  const archive=path.join(resources,"app.asar"),asar=createRequire(path.join(desktop,"package.json"))("@electron/asar");
  const entries=asar.listPackage(archive).map(n=>n.replaceAll("\\","/").replace(/^\/+/,""));
  assert.equal(entries.some(n=>/^assets\/(screenshots|workmate-current)\//.test(n)),false);
  for(const[name,expected]of Object.entries(before).filter(([name])=>name.startsWith(path.basename(desktop)+"/renderer/"))) assert.equal(hash(await readFile(path.resolve("..",name))),expected);
  for(const name of["dist/main.js","renderer-dist/index.html"]){const bytes=asar.extractFile(archive,path.normalize(name));assert.equal(hash(bytes),hash(await readFile(path.join(desktop,name))));}
  built={executable,app_asar_sha256:hash(await readFile(archive)),native_binary_sha256:pin.windows_x64_sha256,repository_media_excluded:true};
  database=launch(["scripts/native-db-launch.mjs"],platform,{COPYPASTE_NATIVE_DATABASE_START_ONLY:"true"});const end=performance.now()+900000;
  while(!database.output().includes("Native PostgreSQL ready")){assert.equal(database.child.exitCode,null);assert.ok(performance.now()<end);await new Promise(r=>setTimeout(r,200));}
  preview=launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","4317","--strictPort"],web);const webEnd=performance.now()+30000;
  while(!await occupied(4317)){assert.equal(preview.child.exitCode,null);assert.ok(performance.now()<webEnd);await new Promise(r=>setTimeout(r,200));}
  const extra={COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:token,COPYPASTE_LOCAL_DESKTOP_CANDIDATE:executable,CHROME_BIN:path.resolve("../copypaste-delivery/.data/browsers/chromium-1248/chrome-win64/chrome.exe")};
  console.log("Running the actual current packaged native Desktop journey");
  journeyCode=await launch(["--env-file="+path.join(platform,".env"),"--import","tsx","scripts/qa-dedicated-desktop-ui-v1.ts",attempt],delivery,extra).closed;
  const code=await launch(["--import","tsx","scripts/reclaim-test-fixtures.ts"],platform,extra).closed;const bytes=await readFile(path.join(run,"result.json"));await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});cleanup={...JSON.parse(bytes),exit_code:code};
  journey=JSON.parse(await readFile(prefix+"-journey.json"));
}catch(e){error=String(e);}
finally{
  if(preview?.child.exitCode===null)preview.child.kill();if(preview)await preview.closed;
  if(database?.child.connected&&database.child.exitCode===null)database.child.send({action:"shutdown"});if(database)shutdown=await database.closed;
  await new Promise(r=>log.end(r));const stable=JSON.stringify(before)===JSON.stringify(await snapshot());
  const packageStable=!!built&&hash(await readFile(path.join(path.dirname(built.executable),"resources/app.asar")))===built.app_asar_sha256;
  const passed=!error&&stable&&packageStable&&journeyCode===0&&journey?.status==="passed"&&journey.checks.length===8&&journey.company_image_calls===1&&journey.media?.skipped_capture_errors===0&&journey.media.distinct_frames>1&&journey.electron_closed&&journey.browser_closed&&journey.api_closed&&journey.fixture_closed&&journey.native_browser_fixture_closed&&journey.media_provider_closed&&cleanup?.status==="passed"&&cleanup.exit_code===0&&cleanup.workers_exited&&cleanup.results.every(r=>r.reclaimed)&&shutdown===0&&!await occupied(port)&&!await occupied(4317);
  const result={at:new Date().toISOString(),status:passed?"passed":"failed",error,checks,journey_exit:journeyCode,journey_checks:journey?.checks.length??0,source_files:before,source_unchanged:stable,packaged:built,package_unchanged:packageStable,native_codex:pin,owned_database_port:port,owned_database_directory:env.COPYPASTE_NATIVE_DATABASE_DIR,owned_database_shutdown:shutdown===0,fixture_cleanup:cleanup,verifier_sha256:hash(verifier),journey_verifier_sha256:hash(worker),raw_report:{path:prefix+".log",sha256:hash(await readFile(prefix+".log"))},journey:journey?{path:prefix+"-journey.json",sha256:hash(await readFile(prefix+"-journey.json"))}:null,scope:"Actual current packaged Desktop native authentication, consent, local Codex file/tool/ledger, native-only role and IPC boundary, three native window layouts, actual recordings, revocation and sign-out",not_validated:["Actual live model/media provider quality","Human clicks on native chooser/consent dialogs","Signed production installer","Full product acceptance"]};
  await writeFile(prefix+".json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,error,checks:result.journey_checks,source_unchanged:stable,shutdown}));assert.equal(result.status,"passed");
}
