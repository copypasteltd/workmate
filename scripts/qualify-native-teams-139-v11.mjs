import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), extension = path.resolve("../copypaste-extension");
const base = "evidence/native-teams-139", prefix = `${base}/backend-${attempt}`, sha = b => createHash("sha256").update(b).digest("hex");
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
// Reuse only the exact previously passed tests after a renderer-only copy/navigation change.
const originPath = `${base}/backend-10.json`, originBytes = await readFile(originPath), origin = JSON.parse(originBytes);
assert.equal(origin.status, "passed");assert.equal(origin.sources_unchanged,true);assert.equal(origin.database_shutdown,0);assert.equal(origin.port_closed,true);
assert.ok(origin.commands.every(c=>c.exit_code===0));
const priorBytes=await readFile(origin.source_manifest.path);assert.equal(sha(priorBytes),origin.source_manifest.sha256);
const prior=JSON.parse(priorBytes);assert.deepEqual(Object.keys(before),Object.keys(prior));
const changed=Object.keys(before).filter(k=>before[k].sha256!==prior[k].sha256);
assert.deepEqual(changed,["copypaste-desktop/renderer/src/agent-groups.tsx"]);
assert.equal(sha(await readFile(origin.raw_log.path)),origin.raw_log.sha256);
const counts=[...(await readFile(origin.raw_log.path,"utf8")).matchAll(/^# tests (\d+)\r?$/gm)].map(m=>Number(m[1]));assert.deepEqual(counts,[9,51,36,81]);
const commands=[];
const child=spawn(process.execPath,["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"],{cwd:desktop,windowsHide:true,stdio:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>output+=b);
const code=await new Promise(resolve=>{child.once("error",e=>{output+=String(e);resolve(1);});child.once("close",c=>resolve(c??1));});
commands.push({name:"current Desktop renderer compiler",arguments:["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"],exit_code:code});
await writeFile(prefix+".tap",output+"\n",{flag:"wx"});
const after=await snapshot(false),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([k,v])=>after[k]?.sha256===v.sha256);
const passed=code===0&&unchanged;
const report={at:new Date().toISOString(),status:passed?"passed":"failed",error:passed?null:"Renderer compilation or source binding failed",commands,reused_commands:origin.commands,
 test_execution_report:{path:originPath,sha256:sha(originBytes)},test_execution_log:origin.raw_log,source_change_scope:changed,
 source_manifest:{path:prefix+"-sources.json",sha256:sha(await readFile(prefix+"-sources.json"))},sources_unchanged:unchanged,database_started:false,database_shutdown:origin.database_shutdown,port_closed:origin.port_closed,
 raw_log:{path:prefix+".tap",sha256:sha(await readFile(prefix+".tap"))},verifier:{path:prefix+"-verifier.mjs",sha256:sha(await readFile(import.meta.filename))},
 model_mode:"Exact 177 passed tests and native database shutdown retained from backend-10. Only one Desktop renderer file changed: local approval copy and post-approval navigation. All backend/controller/test/extension sources remain byte-identical; the changed renderer compiles now and receives a new actual packaged UI journey. No new database runtime test is claimed."};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:report.status,report:prefix+".json",error:report.error}));process.exitCode=passed?0:1;
