// Immutable per-attempt qualification; native PostgreSQL only, no virtualization.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import {createServer, createConnection} from "node:net";
import path from "node:path";
import {sourceObject} from "./conversation-work-157-evidence.mjs";

const [mode, attempt, reuseSource] = process.argv.slice(2);
assert.ok(["backend", "ui"].includes(mode)); assert.match(attempt ?? "", /^\d{2}$/);
assert.ok(process.argv.length === 4 || process.argv.length === 5);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), admin = path.resolve("../copypaste-admin"), web=path.resolve("../copypaste-web"), desktop=path.resolve("../copypaste-desktop"), extension=path.resolve("../copypaste-extension");
assert.equal(path.basename(delivery), "copypaste-delivery");
const base = "evidence/conversation-work-157", prefix = `${base}/${mode}-${attempt}`,
  hash = b => createHash("sha256").update(b).digest("hex");
await mkdir(base, {recursive: true});
for (const tail of [".json", ".tap", "-sources.json", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + tail), e => e.code === "ENOENT");
const git = (repo, args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", repo, ...args], {encoding:"utf8", windowsHide:true});
async function object(bytes) { return sourceObject(bytes); }
async function snapshot(archive = false) {
  const files = {};
  for (const [name, repo] of [["platform", platform],["extension",extension], ...(mode === "ui" ? [["admin",admin],["web",web],["desktop",desktop]] : [])]) {
    const paths = [...new Set(git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "assets/fonts", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"]).split("\0").filter(Boolean))].sort();
    for (const file of paths) {
      const bytes = await readFile(path.join(repo, file));
      files[`copypaste-${name}/${file}`] = archive ? await object(bytes) : {sha256:hash(bytes)};
    }
  }
  for (const file of ["scripts/qualify-conversation-work-157-v1.mjs", "scripts/conversation-work-157-evidence.mjs", ...(mode === "ui" ? ["scripts/qa-conversation-work-157-v1.ts", "scripts/record-workmate-media.ts"] : [])]) {
    const bytes = await readFile(file); files[`copypaste-delivery/${file}`] = archive ? await object(bytes) : {sha256:hash(bytes)};
  }
  return files;
}
const before = await snapshot(true);
await writeFile(prefix + "-sources.json", JSON.stringify(before,null,2)+"\n", {flag:"wx"});
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), {flag:"wx"});
process.loadEnvFile(path.join(platform, ".env"));
const port = await new Promise((resolve,reject) => { const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=> {const p=server.address().port;server.close(e=>e?reject(e):resolve(p));}); });
let reusedDatabase=null;
if(reuseSource){
 assert.match(reuseSource,/^evidence\/(?:scope-data-export-152|workflow-content-history-153|runtime-pause-154|specialist-copy-155|conversation-directory-156|conversation-work-157)\/(?:backend|ui)-\d{2}\.json$/);
 const bytes=await readFile(reuseSource),old=JSON.parse(bytes);assert.equal(old.status,'passed');assert.equal(old.source_unchanged,true);assert.equal(old.owned_database_shutdown,true);assert.equal(old.owned_database_port_closed,true);assert.equal(old.fixture_cleanup.status,'passed');assert.equal(old.fixture_cleanup.exit_code,0);
 assert.match(old.owned_native_directory,/^\.data[\\/]native-qa[\\/][a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);await readFile(path.join(platform,old.owned_native_directory,'PG_VERSION'));await assert.rejects(readFile(path.join(platform,old.owned_native_directory,'postmaster.pid')),e=>e.code==='ENOENT');
 reusedDatabase={source:reuseSource,sha256:hash(bytes),directory:old.owned_native_directory,scope:'Same-task disposable native cluster after verified fixture reclamation and shutdown. Each suite creates a fresh isolated database and applies all155 migrations; no virtualization.'};
}
const nativeDirectory = reusedDatabase?.directory??`.data/native-qa/${randomUUID()}`, env = {...process.env, COPYPASTE_NATIVE_DATABASE_DIR:nativeDirectory,
 COPYPASTE_NATIVE_DATABASE_START_ONLY:"true", COPYPASTE_LOCAL_CODEX_BIN:path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe")};
for (const field of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]) {
  const value = new URL(process.env[field]); assert.ok(["127.0.0.1","localhost","::1"].includes(value.hostname));
  value.port=String(port); env[field]=value.href;
}
const log = createWriteStream(prefix + ".tap", {flags:"wx"}), checks=[];
function launch(args,cwd=platform,extra={},ipc=false) {
  const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},windowsHide:true,stdio:ipc?["ignore","pipe","pipe","ipc"]:["ignore","pipe","pipe"]});
  let output=""; child.stdout.on("data",b=>{output=(output+b).slice(-16000);});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const closed=new Promise(resolve=>{child.once("close",code=>resolve(code??1));child.once("error",()=>resolve(1));});
  return {child,closed,output:()=>output};
}
const occupied = p => new Promise(resolve=>{const socket=createConnection({host:"127.0.0.1",port:p});socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",e=>{socket.destroy();resolve(e.code!=="ECONNREFUSED");});socket.setTimeout(2000,()=>{socket.destroy();resolve(true);});});
let database, previews=[], resultCode=null, shutdown=null, error=null, cleanup=null, journey=null;
try {
  for (const [name,args,cwd] of [
    ["backend compiler",["node_modules/typescript/bin/tsc","--noEmit"],platform],
    ["backend build",["node_modules/typescript/bin/tsc"],platform],
    ["cloud bootstrap",["scripts/copy-cloud-check-bootstrap.mjs"],platform],
    ...(mode==="ui" ? [["web compiler",["node_modules/typescript/bin/tsc","--noEmit"],web],["web build",["node_modules/vite/bin/vite.js","build"],web],["extension compiler",["node_modules/typescript/bin/tsc","--noEmit"],extension],["extension build",["scripts/build.mjs"],extension],["desktop compiler",["node_modules/typescript/bin/tsc","--noEmit"],desktop],["desktop renderer compiler",["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"],desktop],["desktop renderer build",["node_modules/vite/bin/vite.js","build","--config","vite.config.ts"],desktop]] : [])]) {
    const code=await launch(args,cwd).closed;checks.push({name,exit_code:code});assert.equal(code,0,name);
  }
  database=launch(["scripts/native-db-launch.mjs"],platform,{},true);
  const deadline=Date.now()+600000;
  while (!database.output().includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode,null);assert.ok(Date.now()<deadline,"Native database readiness timeout");
    await new Promise(r=>setTimeout(r,200));
  }
  console.log("Owned native PostgreSQL ready; qualifying independent cloud task admission, result commits, cancellation and selected task control with synthetic runtime");
  if (mode==="backend") {
    const tests=["tests/conversation-work-157-v1.test.ts"];
    resultCode=await launch(["--env-file=.env","scripts/run-tests-owned.mjs",...tests]).closed;
  } else {
    for (const p of [4310,4317,4318]) assert.equal(await occupied(p),false,"Preserve existing services");
    for(const [repo,p] of [[web,4317]]) previews.push(launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port",String(p),"--strictPort"],repo));
    const deadline=Date.now()+30000;
    while (!(await occupied(4317))) {for(const item of previews)assert.equal(item.child.exitCode,null);assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,200));}
    const owned=path.join(platform,".data/test-fixture-reclamation",randomUUID()), token=randomUUID();
    await mkdir(owned,{recursive:true});await writeFile(path.join(owned,"manifest.json"),JSON.stringify({owner_pid:process.pid,token}),{flag:"wx"});
    const uiEnv={COPYPASTE_TEST_RECLAMATION_DIR:owned,COPYPASTE_TEST_RECLAMATION_TOKEN:token,
      CHROME_BIN:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe")};
    resultCode=await launch(["--import","tsx","scripts/qa-conversation-work-157-v1.ts",attempt],delivery,uiEnv).closed;
    const code=await launch(["--import","tsx","scripts/reclaim-test-fixtures.ts"],platform,uiEnv).closed;
    const bytes=await readFile(path.join(owned,"result.json"));await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});
    cleanup={exit_code:code,sha256:hash(bytes),...JSON.parse(bytes)};
    journey=JSON.parse(await readFile(prefix+"-journey.json"));
  }
} catch (e) { error=String(e); }
finally {
  for(const item of previews)if(item.child.exitCode===null)item.child.kill();
  for(const item of previews)await item.closed;
  if (database?.child.connected && database.child.exitCode===null) database.child.send({action:"shutdown"});
  if (database) shutdown=await database.closed;
  await new Promise(r=>log.end(r));
}
const raw=await readFile(prefix+".tap");
if (mode==="backend") {
  const match=raw.toString().match(/^# owned_fixture_cleanup (.+)$/m);
  if (match) { const entry=JSON.parse(match[1]),bytes=await readFile(path.join(platform,entry.path));assert.equal(hash(bytes),entry.sha256);
    await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});cleanup={exit_code:entry.exit_code,sha256:hash(bytes),...JSON.parse(bytes)}; }
}
const after=await snapshot(false), unchanged=Object.keys(before).length===Object.keys(after).length && Object.entries(before).every(([file,value])=>after[file]?.sha256===value.sha256), portClosed=!(await occupied(port));
const clientPortsClosed={};if(mode==="ui")for(const p of[4310,4317,4318])clientPortsClosed[p]=!(await occupied(p));
const passed=!error && resultCode===0 && shutdown===0 && portClosed && unchanged && cleanup?.status==="passed" && cleanup?.exit_code===0
  && Object.values(clientPortsClosed).every(Boolean)
  && (mode!=="ui" || journey?.status==="passed" && journey.browser_closed && journey.api_closed && journey.fixture_closed);
const report={at:new Date().toISOString(),status:passed?"passed":"failed",mode,error,checks,result_exit_code:resultCode,
  source_unchanged:unchanged,source_manifest:{path:prefix+"-sources.json",sha256:hash(await readFile(prefix+"-sources.json"))},
  raw_report:{path:prefix+".tap",sha256:hash(raw)},verifier:{path:prefix+"-verifier.mjs",sha256:hash(await readFile(import.meta.filename))},
  reused_owned_database:reusedDatabase,owned_native_directory:nativeDirectory,owned_native_port:port,owned_database_shutdown:shutdown===0,owned_database_port_closed:portClosed,
  fixture_cleanup:cleanup,client_ports_closed:clientPortsClosed,journey:journey?{path:prefix+"-journey.json",sha256:hash(await readFile(prefix+"-journey.json")),checks:journey.checks}:null,
  scope:"Focused independent cloud tasks in one conversation: real SQL/HTTP and Worker with synthetic runtime, per-task stop and budget, retries, quotas, selected target, actual Web browser. Shared Desktop cloud renderer rebuilt; native local execution is unchanged and no new installed Desktop/Side Panel run is claimed. No real model request. Broad historical/cross-OS regression omitted under the fast-release instruction. Frozen v0.1.0-rc.1 remains stage148."};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:report.status,report:prefix+".json",source_unchanged:unchanged,error}));
assert.ok(passed,"Preserve the original failed report and verifier");
