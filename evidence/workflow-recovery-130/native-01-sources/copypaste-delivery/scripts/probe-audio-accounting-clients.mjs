import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const attempt=process.argv[2]; assert.match(attempt??"",/^\d{2}$/); assert.equal(process.argv.length,3);
const prefix="evidence/audio-accounting-clients-"+attempt, base=path.resolve("..");
const sha=b=>createHash("sha256").update(b).digest("hex");
const sources=["copypaste-web/src/audio-production.tsx","copypaste-desktop/renderer/src/audio-production.tsx",
  "copypaste-desktop/renderer-source.json","copypaste-extension/src/audio-production.ts"];
const files={};
for(const n of sources){const bytes=await readFile(path.join(base,n));files[n]=sha(bytes);const target=prefix+"-sources/"+n;await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx"});}
await writeFile(prefix+"-verifier.mjs",await readFile(import.meta.filename),{flag:"wx"});
let raw="",error;const checks=[];const builds={};
function run(repo,args){const cwd=path.join(base,"copypaste-"+repo);try{const out=execFileSync(process.execPath,args,{cwd,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]});raw+=out;checks.push({repo,args,exit_code:0});}catch(e){raw+=String(e.stdout??"")+String(e.stderr??"");checks.push({repo,args,exit_code:e.status??1});throw e;}}
async function built(dir,prefix=""){const out={};for(const ent of await readdir(dir,{withFileTypes:true})){assert.equal(ent.isSymbolicLink(),false);const p=path.join(dir,ent.name);if(ent.isDirectory())Object.assign(out,await built(p,prefix+ent.name+"/"));else out[prefix+ent.name]=sha(await readFile(p));}return out;}
try{
  for(const repo of ["web","desktop","extension"]) run(repo,["node_modules/typescript/bin/tsc","--noEmit"]);
  run("desktop",["node_modules/typescript/bin/tsc","--noEmit","-p","renderer/tsconfig.json"]);
  run("web",["node_modules/vite/bin/vite.js","build"]);
  run("desktop",["node_modules/vite/bin/vite.js","build","--config","vite.config.ts"]);
  run("extension",["scripts/build.mjs"]);
  for(const [repo,folder] of [["web","dist"],["desktop","renderer-dist"],["extension","dist"]])builds[repo]=await built(path.join(base,"copypaste-"+repo,folder));
  const provenance=JSON.parse(await readFile(path.join(base,"copypaste-desktop/renderer-source.json"),"utf8"));
  assert.equal(provenance.native_desktop,true);assert.equal(provenance.files["src/audio-production.tsx"],files["copypaste-desktop/renderer/src/audio-production.tsx"]);
  assert.equal(files["copypaste-web/src/audio-production.tsx"],files["copypaste-desktop/renderer/src/audio-production.tsx"]);
}catch(e){error=String(e);}
let unchanged=true;for(const [n,digest] of Object.entries(files))unchanged&&=sha(await readFile(path.join(base,n)))===digest;
await writeFile(prefix+".log",raw,{flag:"wx"});
const r={at:new Date().toISOString(),status:!error&&unchanged?"passed":"failed",source_unchanged:unchanged,source_files:files,checks,builds,error,
  raw_log:{path:prefix+".log",sha256:sha(Buffer.from(raw))},scope:"Actual Web, frameless Desktop renderer and native right Side Panel compilation and fee-provenance source binding; this does not replace native client interaction acceptance."};
await writeFile(prefix+".json",JSON.stringify(r,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:r.status,checks:checks.length,error}));process.exitCode=r.status==="passed"?0:1;
