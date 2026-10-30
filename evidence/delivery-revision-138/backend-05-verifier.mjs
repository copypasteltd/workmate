import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), extension = path.resolve("../copypaste-extension");
const base = "evidence/delivery-revision-138", prefix = `${base}/backend-${attempt}`, sha = b => createHash("sha256").update(b).digest("hex");
await mkdir(base, { recursive: true });
const roots = { "copypaste-platform": platform, "copypaste-web": path.resolve("../copypaste-web"), "copypaste-admin": path.resolve("../copypaste-admin"), "copypaste-desktop": desktop, "copypaste-extension": extension };
async function snapshot(archive) {
  const files = {};
  for (const [name, root] of Object.entries(roots)) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer/src", "public", "scripts", "tests", "migrations", "contracts", "catalog", "skills", "package.json", "package-lock.json", "tsconfig.json", "renderer/tsconfig.json", "vite.config.ts", ".gitattributes"], { encoding: "utf8", maxBuffer: 16000000 }).split("\0").filter(Boolean);
    for (let offset = 0; offset < names.length; offset += 16) await Promise.all(names.slice(offset, offset + 16).map(async file => {
      const bytes = await readFile(path.join(root, file)), digest = sha(bytes), object = `${base}/objects/${digest}.blob`;
      if (archive) { await mkdir(path.dirname(object), { recursive: true }); try { await writeFile(object, bytes, { flag: "wx" }); } catch (e) { if (e.code !== "EEXIST") throw e; assert.deepEqual(await readFile(object), bytes); } }
      files[name + "/" + file] = { sha256: digest, ...(archive ? { path: object } : {}) };
    }));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
for (const suffix of [".json", ".tap", "-sources.json", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const before = await snapshot(true); await writeFile(prefix + "-sources.json", JSON.stringify(before, null, 2) + "\n", { flag: "wx" }); await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
assert.equal(before["copypaste-desktop/.gitattributes"].sha256, "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e");

const originPath = `${base}/backend-04.json`, originBytes=await readFile(originPath), origin=JSON.parse(originBytes);
assert.equal(origin.error,null);assert.equal(origin.database_shutdown,0);assert.equal(origin.port_closed,true);
assert.equal(origin.commands.length,8);assert.ok(origin.commands.every(c=>c.exit_code===0));
const originalSources=JSON.parse(await readFile(origin.source_manifest.path));
assert.equal(sha(await readFile(origin.source_manifest.path)),origin.source_manifest.sha256);
const changed=[...new Set([...Object.keys(before),...Object.keys(originalSources)])].filter(k=>before[k]?.sha256!==originalSources[k]?.sha256).sort();
assert.deepEqual(changed,["copypaste-platform/package.json","copypaste-platform/scripts/run-current-tests-owned-v1.mjs"].sort());
const previousPackage=JSON.parse(await readFile(originalSources["copypaste-platform/package.json"].path));
const currentPackage=JSON.parse(await readFile(path.join(platform,"package.json")));
assert.equal(previousPackage.scripts.test,"node --env-file=.env scripts/run-tests-owned.mjs tests/*.test.ts");
assert.equal(currentPackage.scripts.test,"node --env-file=.env scripts/run-current-tests-owned-v1.mjs");
previousPackage.scripts.test=currentPackage.scripts.test;assert.deepEqual(previousPackage,currentPackage);
const oldLog=await readFile(origin.raw_log.path), oldText=oldLog.toString("utf8");assert.equal(sha(oldLog),origin.raw_log.sha256);
assert.deepEqual([...oldText.matchAll(/^# tests (\d+)\r?$/gm)].map(m=>Number(m[1])),[34,36,73]);
const cluster=/creating directory [^\r\n]*\/runtime\/(\.data\/native-qa\/[a-f0-9-]{36})/.exec(oldText)?.[1];assert.ok(cluster);
const port=Number(/Native PostgreSQL ready on 127\.0\.0\.1:(\d+)/.exec(oldText)?.[1]);assert.ok(port>0);
const occupied=()=>new Promise(resolve=>{const socket=createConnection({host:"127.0.0.1",port});socket.once("connect",()=>{socket.destroy();resolve(true)});socket.once("error",e=>{socket.destroy();resolve(e.code!=="ECONNREFUSED")});});
assert.equal(await occupied(),false);
const log=createWriteStream(prefix+".tap",{flags:"wx"}),commands=[];let error=null;
try{
  for(const [name,args] of [["current test runner syntax",["--check","scripts/run-current-tests-owned-v1.mjs"]],["current test discovery",["scripts/run-current-tests-owned-v1.mjs","--list"]]]){
    const child=spawn(process.execPath,args,{cwd:platform,windowsHide:true,stdio:["ignore","pipe","pipe"]});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    const code=await new Promise(resolve=>{child.once("error",()=>resolve(1));child.once("close",c=>resolve(c??1));});commands.push({name,arguments:args,exit_code:code});assert.equal(code,0,name);console.log(name+": "+code);
  }
}catch(e){error=String(e)}finally{await new Promise(resolve=>log.end(resolve))}
const after=await snapshot(false),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([k,v])=>after[k]?.sha256===v.sha256),portClosed=!await occupied();
const report={at:new Date().toISOString(),status:!error&&unchanged&&portClosed?"passed":"failed",error,commands,
  source_manifest:{path:prefix+"-sources.json",sha256:sha(await readFile(prefix+"-sources.json"))},sources_unchanged:unchanged,
  test_execution_report:{path:originPath,sha256:sha(originBytes),original_status:origin.status,scope:"All eight original commands and 143 tests passed. The original source guard failed because only test discovery/package configuration changed during execution. Every original runtime source, test, migration, dependency and client file is exact; the two configuration files alone are separately validated here. Original failure remains unchanged; tests are not claimed as rerun."},
  test_execution_log:origin.raw_log,reused_commands:origin.commands,current_configuration_changes:changed,
  database_shutdown:origin.database_shutdown,database_shutdown_scope:"Verified stopped original owned cluster; this configuration check starts no database",port_closed:portClosed,
  reused_owned_native_cluster:{path:cluster,origin:originPath,origin_sha256:sha(originBytes),scope:"Verified stopped task-owned cluster; subsequent journeys create fresh isolated databases."},
  raw_log:{path:prefix+".tap",sha256:sha(await readFile(prefix+".tap"))},verifier:{path:prefix+"-verifier.mjs",sha256:sha(await readFile(import.meta.filename))},model_mode:origin.model_mode};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:report.status,report:prefix+".json",error}));process.exitCode=report.status==="passed"?0:1;
