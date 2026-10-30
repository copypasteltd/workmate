import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const destination=path.resolve('.data/dedicated-cloud-121/browser-lifecycle-probe-02.json');
await assert.rejects(readFile(destination),e=>e.code==='ENOENT');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=Object.fromEntries(await Promise.all(['src/cloud-browser-preview.ts','src/cloud-browser-host.cs','src/cloud-browser-reclamation.ts'].map(async name=>[name,digest(await readFile(name))])));
process.env.DEBUG='pw:browser';
const {runCloudBrowserPreview}=await import('../src/cloud-browser-preview.ts');
const results=[];
for(const [name,expected] of [['passing','Actual'],['failing','Expected']]){
 const started_at=new Date().toISOString();
 const result=await runCloudBrowserPreview(path.resolve('.data/dedicated-cloud-121/browser-probes',randomUUID()),{entry:'index.html',checks:[{name:'Actual heading',selector:'h1',expect:{text:expected}}]},[{path:'index.html',bytes:Buffer.from('<h1>Actual</h1>')}]);
 results.push({name,started_at,finished_at:new Date().toISOString(),receipt:result.receipt});
}
const after=Object.fromEntries(await Promise.all(Object.keys(sources).map(async name=>[name,digest(await readFile(name))])));
assert.deepEqual(after,sources);
await writeFile(destination,JSON.stringify({source_files:sources,results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,results:results.map(({name,receipt})=>({name,passed:receipt.passed,stop_reason:receipt.stop_reason,exit_code:receipt.exit_code,error:receipt.check_result.error,host_elapsed_ms:receipt.host.elapsed_ms}))}));
