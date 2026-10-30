import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
assert.equal(path.basename(process.cwd()),"copypaste-delivery-cloud-121");
const output=".data/dedicated-cloud-121/regression-preparation-01.json";
await assert.rejects(access(output),error=>error.code==="ENOENT");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex"),changes=[];
async function copy(source,target){
  const bytes=await readFile(source),before=await readFile(target).catch(error=>{if(error.code!=="ENOENT")throw error;return null;});
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);
  changes.push({target,source,before_sha256:before?hash(before):null,after_sha256:hash(bytes)});
}
const original=path.resolve("../copypaste-platform"),candidate=path.resolve("../copypaste-platform-recovery-120"),delivery=path.resolve("../copypaste-delivery");
for(const name of ["scripts/test-fixture-ownership.ts","scripts/reclaim-test-fixtures.ts","scripts/run-tests-owned.mjs","tests/native-test-environment.ts","tests/test-fixture-ownership.test.ts"])
  await copy(path.join(original,name),path.join(candidate,name));
for(const name of ["scripts/integrated-recovery-inventory.mjs","tests/integrated-recovery-inventory.test.mjs"])
  await copy(path.join(delivery,name),name);
let runner=(await readFile(path.join(delivery,"scripts/run-integrated-recovery-full-v2.mjs"),"utf8"))
  .replaceAll('"copypaste-delivery"','"copypaste-delivery-cloud-121"')
  .replaceAll('"../copypaste-platform"','"../copypaste-platform-recovery-120"')
  .replaceAll('"copypaste-platform/"','"copypaste-platform-recovery-120/"')
  .replaceAll('"copypaste-delivery/"','"copypaste-delivery-cloud-121/"')
  .replaceAll('"evidence/integrated-recovery-full-"','".data/dedicated-cloud-121/full-"')
  .replaceAll('scripts/run-integrated-recovery-full-v2.mjs','scripts/run-dedicated-cloud-full-v1.mjs');
await writeFile("scripts/run-dedicated-cloud-full-v1.mjs",runner,{flag:"wx"});
changes.push({target:"scripts/run-dedicated-cloud-full-v1.mjs",source:"../copypaste-delivery/scripts/run-integrated-recovery-full-v2.mjs",before_sha256:null,after_sha256:hash(Buffer.from(runner))});
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({at:new Date().toISOString(),status:"prepared",changes,verifier_sha256:hash(await readFile(import.meta.filename)),scope:"Copy the current registered ownership and resumable per-file regression controls to the isolated candidate. No primary source, database or prior evidence is changed. Complete product qualification still requires new actual runs."},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:"prepared",files:changes.length}));
