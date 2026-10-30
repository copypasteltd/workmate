import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);assert.equal(process.argv.length,3);
const delivery=process.cwd(),desktop=path.resolve("../copypaste-desktop-publication-125");
const prefix=path.resolve("evidence/receipt-sync-131/baseline-"+attempt),shadow=path.join(desktop,".data/receipt-sync-131","legacy-"+randomUUID());
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix),{recursive:true});
for(const suffix of [".json",".tap","-verifier.mjs"])await assert.rejects(readFile(prefix+suffix),error=>error.code==="ENOENT");
const original=path.join(desktop,".data/receipt-sync-131/probe-01-sources"),baseline="891a9daacea1c62250c2aba79fce65a9ecf84205";
async function files(root){const result=[];for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())result.push(...await files(file));else if(entry.isFile())result.push(file);else throw new Error("Unexpected legacy source link");}return result;}
const saved={};
for(const file of [...await files(path.join(original,"src")),...await files(path.join(original,"contracts")),path.join(original,"package.json")]){
 const name=path.relative(original,file),body=await readFile(file);
 assert.equal(sha(execFileSync("git",["-c","core.fsmonitor=false","-c","core.untrackedCache=false","show",baseline+":"+name.replaceAll("\\","/")],{cwd:desktop,windowsHide:true,maxBuffer:8*1024*1024})),sha(body),name);
 for(const folder of [shadow,prefix+"-sources"]){const target=path.join(folder,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body,{flag:"wx"});}saved[name.replaceAll("\\","/")]=sha(body);
}
const currentTest=await readFile(path.join(desktop,"tests/local-receipt-sync.test.ts"));
const edited=currentTest.toString().replace('    assert.equal((await f.view()).receiptPending, true);\n','');
assert.notEqual(edited,currentTest.toString());
const legacyTest=path.join(shadow,"tests/local-receipt-sync.test.ts");await mkdir(path.dirname(legacyTest),{recursive:true});await writeFile(legacyTest,edited,{flag:"wx"});
await mkdir(path.join(prefix+"-sources","tests"),{recursive:true});await writeFile(path.join(prefix+"-sources","tests/local-receipt-sync.test.ts"),edited,{flag:"wx"});
await writeFile(prefix+"-verifier.mjs",await readFile(import.meta.filename),{flag:"wx"});
const before=(await readdir(path.join(desktop,".data/controller-tests"))).sort();
const raw=createWriteStream(prefix+".tap",{flags:"wx"}),commands=[];
for(const [label,file]of [["legacy",legacyTest],["current",path.join(desktop,"tests/local-receipt-sync.test.ts")]]){
 const args=["--import","tsx","--test","--test-name-pattern=^receipt synchronization flushes a saved child",file];
 const child=spawn(process.execPath,args,{cwd:desktop,windowsHide:true,stdio:["ignore","pipe","pipe"]});let output="";
 for(const stream of [child.stdout,child.stderr]){stream.pipe(raw,{end:false});stream.on("data",bytes=>{output+=bytes;});}
 const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
 const counts=Object.fromEntries(["tests","pass","fail","cancelled","skipped","todo"].map(name=>[name,Number(output.match(new RegExp("^# "+name+" (\\d+)\\r?$","m"))?.[1]??-1)]));commands.push({label,code,counts});
}
await new Promise(resolve=>raw.end(resolve));
const fixturesRestored=JSON.stringify(before)===JSON.stringify((await readdir(path.join(desktop,".data/controller-tests"))).sort());
const passed=commands[0].code===1 && commands[0].counts.tests===1 && commands[0].counts.fail===1 && commands[1].code===0 && commands[1].counts.tests===1 && commands[1].counts.pass===1 && fixturesRestored;
const report={at:new Date().toISOString(),status:passed?"passed_reproduced_original_receipt_loss":"failed",baseline_commit:baseline,commands,
 original_sources:saved,legacy_test_sha256:sha(edited),current_test_sha256:sha(currentTest),fixtures_restored:fixturesRestored,
 scope:"Same saved child-before-parent assertion against exact Stage130 Git execution sources and current execution sources. Legacy-only removal of the new UI flag assertion ensures the failure exercises the lost child finish request. Synthetic saved journal and transport; no native process or database.",
 raw_sha256:sha(await readFile(prefix+".tap")),verifier_sha256:sha(await readFile(import.meta.filename))};
await writeFile(prefix+".json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:report.status,commands,fixtures_restored:fixturesRestored}));process.exitCode=passed?0:1;
