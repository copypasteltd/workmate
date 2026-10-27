import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const id = process.argv[2];
assert.match(id ?? "", /^\d{2}$/);
const platform = path.resolve("../copypaste-platform");
const prefix = "evidence/template-video-static-" + id;
await assert.rejects(access(prefix + ".json"), (e) => e.code === "ENOENT");
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function snapshot() {
  const files = execFileSync("git", ["-c","core.fsmonitor=false","-c","core.untrackedCache=false","ls-files","--cached","--others","--exclude-standard","-z"], {cwd:platform,windowsHide:true,encoding:"utf8"})
    .split("\0").filter((file) => /^(src|tests|migrations|catalog|contracts|scripts|skills|public|assets\/fonts)\//.test(file) || /^(package(-lock)?|tsconfig)\.json$/.test(file) || file === ".env.example" || file === ".gitattributes");
  const result = {};
  for (const file of [...new Set(files)].sort()) result[file] = sha(await readFile(path.join(platform,file)));
  return result;
}
const before = await snapshot();
const require = createRequire(path.join(platform,"package.json"));
const packageFile = require.resolve("typescript/package.json");
const definition = JSON.parse(await readFile(packageFile,"utf8"));
const compiler = path.resolve(path.dirname(packageFile),definition.bin.tsc);
const verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, {flag:"wx"});
const compiledVerifier=await readFile("scripts/qa-template-video-compiled.mjs");
await writeFile(prefix+"-compiled-runtime-verifier.mjs",compiledVerifier,{flag:"wx"});
const checks = [];
for (const [name,args] of [["typecheck",["--noEmit"]],["build",[]]]) {
  const file = prefix + "-" + name + ".log";
  const stream = createWriteStream(file,{flags:"wx"});
  const child = spawn(process.execPath,[compiler,...args],{cwd:platform,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",(bytes) => stream.write(bytes));
  child.stderr.on("data",(bytes) => stream.write(bytes));
  const code = await new Promise((resolve,reject) => {child.once("close",resolve);child.once("error",reject);});
  await new Promise((resolve) => stream.end(resolve));
  checks.push({name,exit_code:code,raw_report:file,raw_sha256:sha(await readFile(file))});
  if (code !== 0) break;
}
const runtimeFile=prefix+"-compiled-runtime.log",runtimeLog=createWriteStream(runtimeFile,{flags:"wx"}),runtime=spawn(process.execPath,["scripts/qa-template-video-compiled.mjs"],{cwd:process.cwd(),windowsHide:true,stdio:["ignore","pipe","pipe"]});
runtime.stdout.pipe(runtimeLog,{end:false});runtime.stderr.pipe(runtimeLog,{end:false});
const runtimeCode=await new Promise((resolve,reject)=>{runtime.once("close",resolve);runtime.once("error",reject);});await new Promise(resolve=>runtimeLog.end(resolve));
checks.push({name:"compiled-runtime-profile",exit_code:runtimeCode,raw_report:runtimeFile,raw_sha256:sha(await readFile(runtimeFile))});
const stable = JSON.stringify(before) === JSON.stringify(await snapshot()) && sha(verifier) === sha(await readFile(import.meta.filename));
const passed = stable && checks.length === 3 && checks.every((item) => item.exit_code === 0);
const report = {at:new Date().toISOString(),status:passed?"passed":"failed",scope:"TypeScript type checking, actual build and compiled native font/encoder profile of exact template-video platform bytes; no browser or whole-product acceptance",source_unchanged:stable,source_files:before,verifier_sha256:sha(verifier),verifier_snapshot:prefix + "-verifier.mjs",compiled_runtime_verifier:{path:prefix+"-compiled-runtime-verifier.mjs",sha256:sha(compiledVerifier)},checks};
await writeFile(prefix + ".json",JSON.stringify(report,null,2) + "\n",{flag:"wx"});
console.log(JSON.stringify({status:report.status,source_unchanged:stable,checks:checks.map(({name,exit_code}) => ({name,exit_code}))}));
if (!passed) process.exitCode = 1;
