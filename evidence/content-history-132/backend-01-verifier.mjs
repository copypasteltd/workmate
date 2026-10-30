// Immutable per-attempt qualification; native PostgreSQL only, no virtualization.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import {createServer, createConnection} from "node:net";
import path from "node:path";

const [mode, attempt] = process.argv.slice(2);
assert.ok(["backend", "ui"].includes(mode)); assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 4);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), admin = path.resolve("../copypaste-admin");
assert.equal(path.basename(delivery), "copypaste-delivery");
const base = "evidence/content-history-132", prefix = `${base}/${mode}-${attempt}`,
  hash = b => createHash("sha256").update(b).digest("hex");
await mkdir(base, {recursive: true});
for (const tail of [".json", ".tap", "-sources.json", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + tail), e => e.code === "ENOENT");
const git = (repo, args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", repo, ...args], {encoding:"utf8", windowsHide:true});
async function object(bytes) {
  const name = `${base}/objects/${hash(bytes)}.blob`; await mkdir(path.dirname(name), {recursive:true});
  try { await writeFile(name, bytes, {flag:"wx"}); }
  catch (e) { if (e.code !== "EEXIST") throw e; assert.deepEqual(await readFile(name), bytes); }
  return {path:name, sha256:hash(bytes)};
}
async function snapshot(archive = false) {
  const files = {};
  for (const [name, repo] of [["platform", platform], ...(mode === "ui" ? [["admin", admin]] : [])]) {
    const paths = [...new Set(git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "assets/fonts", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"]).split("\0").filter(Boolean))].sort();
    for (const file of paths) {
      const bytes = await readFile(path.join(repo, file));
      files[`copypaste-${name}/${file}`] = archive ? await object(bytes) : {sha256:hash(bytes)};
    }
  }
  for (const file of ["scripts/qualify-content-history-132-v1.mjs", ...(mode === "ui" ? ["scripts/qa-content-history-132-v1.ts", "scripts/record-workmate-media.ts"] : [])]) {
    const bytes = await readFile(file); files[`copypaste-delivery/${file}`] = archive ? await object(bytes) : {sha256:hash(bytes)};
  }
  return files;
}
const before = await snapshot(true);
await writeFile(prefix + "-sources.json", JSON.stringify(before,null,2)+"\n", {flag:"wx"});
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), {flag:"wx"});
process.loadEnvFile(path.join(platform, ".env"));
const port = await new Promise((resolve,reject) => { const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=> {const p=server.address().port;server.close(e=>e?reject(e):resolve(p));}); });
const nativeDirectory = `.data/native-qa/${randomUUID()}`, env = {...process.env, COPYPASTE_NATIVE_DATABASE_DIR:nativeDirectory,
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
let database, preview, resultCode=null, shutdown=null, error=null, cleanup=null, journey=null;
try {
  for (const [name,args,cwd] of [
    ["backend compiler",["node_modules/typescript/bin/tsc","--noEmit"],platform],
    ["backend build",["node_modules/typescript/bin/tsc"],platform],
    ["cloud bootstrap",["scripts/copy-cloud-check-bootstrap.mjs"],platform],
    ...(mode==="ui" ? [["admin compiler",["node_modules/typescript/bin/tsc","--noEmit"],admin],["admin build",["node_modules/vite/bin/vite.js","build"],admin]] : [])]) {
    const code=await launch(args,cwd).closed;checks.push({name,exit_code:code});assert.equal(code,0,name);
  }
  database=launch(["scripts/native-db-launch.mjs"],platform,{},true);
  const deadline=Date.now()+600000;
  while (!database.output().includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode,null);assert.ok(Date.now()<deadline,"Native database readiness timeout");
    await new Promise(r=>setTimeout(r,200));
  }
  console.log("Owned native PostgreSQL ready; qualifying actual content history and authorization with explicit synthetic customer data");
  if (mode==="backend") {
    const tests=["tests/admin-content-history.test.ts","tests/persistent-work.test.ts","tests/admin-profile-revisions.test.ts","tests/schema-compatibility.test.ts"];
    resultCode=await launch(["--env-file=.env","scripts/run-tests-owned.mjs",...tests]).closed;
  } else {
    for (const p of [4310,4318]) assert.equal(await occupied(p),false,"Preserve existing services");
    preview=launch(["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","4318","--strictPort"],admin);
    const deadline=Date.now()+30000;
    while (!(await occupied(4318))) {assert.equal(preview.child.exitCode,null);assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,200));}
    const owned=path.join(platform,".data/test-fixture-reclamation",randomUUID()), token=randomUUID();
    await mkdir(owned,{recursive:true});await writeFile(path.join(owned,"manifest.json"),JSON.stringify({owner_pid:process.pid,token}),{flag:"wx"});
    const uiEnv={COPYPASTE_TEST_RECLAMATION_DIR:owned,COPYPASTE_TEST_RECLAMATION_TOKEN:token,
      CHROME_BIN:path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe")};
    resultCode=await launch(["--import","tsx","scripts/qa-content-history-132-v1.ts",attempt],delivery,uiEnv).closed;
    const code=await launch(["--import","tsx","scripts/reclaim-test-fixtures.ts"],platform,uiEnv).closed;
    const bytes=await readFile(path.join(owned,"result.json"));await writeFile(prefix+"-fixture-cleanup.json",bytes,{flag:"wx"});
    cleanup={exit_code:code,sha256:hash(bytes),...JSON.parse(bytes)};
    journey=JSON.parse(await readFile(prefix+"-journey.json"));
  }
} catch (e) { error=String(e); }
finally {
  if (preview?.child.exitCode===null) preview.child.kill();
  if (preview) await preview.closed;
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
const passed=!error && resultCode===0 && shutdown===0 && portClosed && unchanged && cleanup?.status==="passed" && cleanup?.exit_code===0
  && (mode!=="ui" || journey?.status==="passed" && journey.browser_closed && journey.api_closed && journey.fixture_closed);
const report={at:new Date().toISOString(),status:passed?"passed":"failed",mode,error,checks,result_exit_code:resultCode,
  source_unchanged:unchanged,source_manifest:{path:prefix+"-sources.json",sha256:hash(await readFile(prefix+"-sources.json"))},
  raw_report:{path:prefix+".tap",sha256:hash(raw)},verifier:{path:prefix+"-verifier.mjs",sha256:hash(await readFile(import.meta.filename))},
  owned_native_directory:nativeDirectory,owned_native_port:port,owned_database_shutdown:shutdown===0,owned_database_port_closed:portClosed,
  fixture_cleanup:cleanup,journey:journey?{path:prefix+"-journey.json",sha256:hash(await readFile(prefix+"-journey.json")),checks:journey.checks}:null,
  scope:"Bounded administrator history reading and existing related customer behavior; explicit synthetic customer data, actual native SQL and browser when requested. Not complete product qualification."};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:report.status,report:prefix+".json",source_unchanged:unchanged,error}));
assert.ok(passed,"Preserve the original failed report and verifier");
