import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
const attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);assert.equal(process.argv.length,3);
const desktop=path.resolve("../copypaste-desktop"),prefix="evidence/desktop-browser-"+attempt;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
for(const tail of [".json",".log","-verifier.mjs"])await assert.rejects(access(prefix+tail),e=>e.code==="ENOENT");
async function snapshot(){
  const result={};
  for(const name of ["desktop","platform","delivery"]){
    const repo=path.resolve("../copypaste-"+name);
    const files=execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","ls-files","--cached","--others","--exclude-standard","-z","--","src","scripts","tests","contracts","assets/browser-shell.html","assets/browser-shell.css","assets/browser-shell.js","package.json","package-lock.json","tsconfig.json"],{cwd:repo,encoding:"utf8",windowsHide:true}).split("\0").filter(Boolean);
    for(const file of [...new Set(files)].sort())result["copypaste-"+name+"/"+file]=sha(await readFile(path.join(repo,file)));
  }return result;
}
const before=await snapshot(),verifier=await readFile(import.meta.filename);await writeFile(prefix+"-verifier.mjs",verifier,{flag:"wx"});
for(const [name,expected]of Object.entries(before)){
  const bytes=await readFile(path.resolve("..",name));assert.equal(sha(bytes),expected);
  const file=path.resolve(prefix+"-sources",name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{flag:"wx"});
}
const owned=path.resolve(".data/native-browser-checks",randomUUID());await mkdir(owned,{recursive:true});
const require=createRequire(path.join(desktop,"package.json"));
require("esbuild").buildSync({entryPoints:[path.resolve("scripts/record-workmate-media.ts")],outfile:path.join(owned,"media.cjs"),bundle:true,platform:"node",format:"cjs",logLevel:"silent"});
const log=createWriteStream(prefix+".log",{flags:"wx"});
async function launch(executable,args,cwd,environment={}){
  const env={...process.env,...environment};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise(resolve=>{child.once("close",code=>resolve(code??1));child.once("error",()=>resolve(1));});return code;
}
let code=1,error,journey;
try{
  assert.equal(await launch(process.execPath,["node_modules/typescript/bin/tsc"],desktop),0);
  code=await launch(path.join(desktop,"node_modules/electron/dist/electron.exe"),["scripts/check-native-browser.cjs"],desktop,{COPYPASTE_BROWSER_CHECK_ROOT:owned,COPYPASTE_BROWSER_CHECK_ATTEMPT:attempt,COPYPASTE_BROWSER_MEDIA_HELPER:path.join(owned,"media.cjs")});
  journey=JSON.parse(await readFile(path.join(owned,"result.json")));
}catch(e){error=String(e);}
await new Promise(resolve=>log.end(resolve));
const unchanged=JSON.stringify(before)===JSON.stringify(await snapshot());
const passed=!error&&code===0&&unchanged&&journey?.status==="passed"&&journey.checks.length===10&&journey.owned_windows_closed&&journey.http_server_closed&&journey.media?.distinct_frames>1&&journey.media?.skipped_capture_errors===0;
const report={at:new Date().toISOString(),status:passed?"passed":"failed",source_unchanged:unchanged,source_files:before,exit_code:code,error,journey,raw_log:prefix+".log",raw_log_sha256:sha(await readFile(prefix+".log")),verifier_sha256:sha(verifier),owned_directory:path.relative(process.cwd(),owned),not_validated:["Native Codex tool routing and company inference","Packaged product IPC and customer consent","Cross-origin iframe DOM access","Complete third-party application operation","Entire product acceptance"]};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:report.status,checks:journey?.checks.length,source_unchanged:unchanged,error:journey?.error??error}));process.exitCode=passed?0:1;
