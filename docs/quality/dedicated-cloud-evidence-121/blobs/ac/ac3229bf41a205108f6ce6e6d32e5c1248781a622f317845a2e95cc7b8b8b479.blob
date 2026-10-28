import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length,3);
assert.equal(path.basename(process.cwd()),"copypaste-delivery-cloud-121");
const platform=path.resolve("../copypaste-platform-recovery-120"),prefix=`.data/dedicated-cloud-121/sqlite-${attempt}`;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
for(const suffix of[".json",".tap","-verifier.mjs"])await assert.rejects(readFile(prefix+suffix),e=>e.code==="ENOENT");
const sources=["src/cloud-sqlite-bootstrap.cjs","src/cloud-api-bootstrap.cjs","src/cloud-development-checks.ts","src/cloud-program-executor.ts","src/cloud-program-host.cs","tests/cloud-development-checks.test.ts","scripts/build-cloud-program-host.mjs"];
async function snapshot(){const result={};for(const name of sources)result[name]=hash(await readFile(path.join(platform,name)));return result;}
const before=await snapshot(),verifier=await readFile(import.meta.filename);
for(const[name,digest]of Object.entries(before)){const bytes=await readFile(path.join(platform,name));assert.equal(hash(bytes),digest);const dest=prefix+"-sources/"+name;await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:"wx"});}
await writeFile(prefix+"-verifier.mjs",verifier,{flag:"wx"});
const child=spawn(process.execPath,["--env-file=.env","--import","tsx","--test","--test-concurrency=1","tests/cloud-development-checks.test.ts"],{cwd:platform,env:process.env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
const chunks=[];child.stdout.on("data",b=>chunks.push(b));child.stderr.on("data",b=>chunks.push(b));
const exit=await new Promise(resolve=>{child.once("close",(code,signal)=>resolve({exit_code:code,signal}));child.once("error",e=>resolve({exit_code:null,error:String(e)}));});
const raw=Buffer.concat(chunks);await writeFile(prefix+".tap",raw,{flag:"wx"});
let error=null,counts=null;
try{assert.equal(exit.exit_code,0);counts=parseCompleteTap(raw.toString());requirePassingCounts(counts);assert.equal(counts.tests,15);}catch(e){error=String(e);}
const stable=JSON.stringify(before)===JSON.stringify(await snapshot());
const native=JSON.parse(await readFile(path.join(platform,".data/cloud-program-host/manifest.json")));
assert.equal(native.source_sha256,before["src/cloud-program-host.cs"]);assert.equal(native.sha256,hash(await readFile(path.join(platform,".data/cloud-program-host/cloud-program-host.exe"))));
const result={at:new Date().toISOString(),status:!error&&stable?"passed":"failed",error,...exit,counts,scope:"Original complete real native API/SQLite execution file plus a deep Windows workspace regression, preserving AppContainer isolation, bound SQL, transactions, deadlines and actual profile/workspace cleanup",source_files:before,source_unchanged:stable,native_host:native,node_version:process.version,node_sha256:hash(await readFile(process.execPath)),verifier_sha256:hash(verifier),raw_report:{path:prefix+".tap",sha256:hash(raw)}};
await writeFile(prefix+".json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,counts,error,source_unchanged:stable}));assert.equal(result.status,"passed");
