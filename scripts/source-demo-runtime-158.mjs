import assert from "node:assert/strict";
import {readFile,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify,parseEnv} from "node:util";
import path from "node:path";
const execute=promisify(execFile);
export function sourceDatabasePort(){
 const value=process.env.COPYPASTE_SOURCE_DATABASE_PORT??"55432";
 assert.match(value,/^\d+$/,"COPYPASTE_SOURCE_DATABASE_PORT must be an explicit local TCP port");const port=Number(value);
 assert.ok(port>=1024&&port<=65535&&!([4310,4317,4318,4319].includes(port)),"Select a separate unprivileged local database port");return port;
}
export const sourceRoot=()=>path.resolve(process.env.COPYPASTE_DEV_ROOT??path.join(import.meta.dirname,"../.."));
const helpers=["codex.exe","codex-command-runner.exe","codex-windows-sandbox-setup.exe","codex-code-mode-host.exe"];
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
/** A source-demo convenience only. Production cloud runtime configuration and
 * the customer's native Desktop permission/session model remain independent. */
export async function assertLocalSourceDemo(root,{requireEnvironment=true}={}){
 assert.equal(process.platform,"win32","The supplied demo runtime supports Windows x64");assert.equal(process.arch,"x64");
 assert.notEqual(process.env.NODE_ENV,"production","Source demo cannot start in production");
 for(const repo of ["platform","web","admin","desktop","extension","delivery"]){
  const p=JSON.parse(await readFile(path.join(root,"copypaste-"+repo,"package.json"),"utf8"));assert.ok(p.name?.startsWith("@copypaste/"),"Keep all six source directories together");
 }
 let env;try{env=parseEnv(await readFile(path.join(root,"copypaste-platform/.env"),"utf8"));}
 catch(e){if(e.code!=="ENOENT")throw e;if(requireEnvironment)throw new Error("Run npm run bootstrap:demo before starting the source demo");return;}
 assert.notEqual(env.NODE_ENV,"production","Existing production configuration is preserved; use a separate local source demo");
 for(const name of ["DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL","OWNER_DATABASE_URL"]){
  const raw=process.env[name]??env[name];assert.ok(raw,"Local database configuration is incomplete; run bootstrap:demo");const u=new URL(raw);
  assert.ok(["postgres:","postgresql:"].includes(u.protocol)&&["localhost","127.0.0.1","[::1]","::1"].includes(u.hostname)&&u.port===String(sourceDatabasePort()),"Source demo requires the explicitly selected loopback native database port; existing remote configuration is preserved");
 }
}
export async function prepareSourceDemoRuntime(root,{prepareExplicit=true}={}){
 const desktop=path.join(root,"copypaste-desktop"),directory=path.join(desktop,".data/runtime/windows-x64");
 if(prepareExplicit&&process.env.COPYPASTE_LOCAL_CODEX_BIN){
  await execute(process.execPath,["scripts/prepare-local-codex.mjs"],{cwd:desktop,env:process.env,windowsHide:true,timeout:60000,maxBuffer:1024*1024});
 }
 let pin,manifest;try{pin=JSON.parse(await readFile(path.join(desktop,"contracts/local-codex-runtime.json"),"utf8"));manifest=JSON.parse(await readFile(path.join(directory,"runtime-manifest.json"),"utf8"));}
 catch(e){if(e.code!=="ENOENT")throw e;throw new Error("Prepare the supplied pinned Codex first: set COPYPASTE_LOCAL_CODEX_BIN to codex.exe with its adjacent helpers, then run npm run bootstrap:demo. The source kit's runtime companion is already prepared.");}
 assert.equal(pin.kernel,"codex");assert.equal(manifest.runtime,pin.runtime_version);assert.equal(manifest.platform,"windows-x64");
 assert.deepEqual(Object.keys(manifest.files).sort(),[...helpers].sort(),"The pinned runtime companion must include all four native helpers");
 const files={};
 for(const name of helpers){const file=path.join(directory,name),bytes=await readFile(file),expected=manifest.files[name];assert.ok(bytes.length>100000);assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256,"Prepared native runtime changed: "+name);files[name]={bytes:bytes.length,sha256:sha(bytes)};}
 assert.equal(files["codex.exe"].sha256,pin.windows_x64_sha256,"Codex must match the product pin");
 const executable=await realpath(path.join(directory,"codex.exe")),{stdout}=await execute(executable,["--version"],{cwd:desktop,windowsHide:true,timeout:20000});
 assert.equal(stdout.trim(),"codex-cli "+pin.runtime_version);
 return {executable,version:pin.runtime_version,files,platform:"windows-x64"};
}
