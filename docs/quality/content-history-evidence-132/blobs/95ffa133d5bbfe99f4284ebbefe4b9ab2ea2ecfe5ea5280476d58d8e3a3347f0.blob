import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const attempt=process.argv[2];
assert.match(attempt??'',/^\d{2}$/);
assert.equal(path.basename(process.cwd()),'copypaste-platform-recovery-120');
assert.equal(process.platform,'win32');
const prefix=path.resolve('.data/dedicated-cloud-121/browser-reclamation-'+attempt);
for(const suffix of ['.json','.tap','-verifier.mjs']) await assert.rejects(readFile(prefix+suffix),e=>e.code==='ENOENT');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function snapshot(){
 const names=execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false','ls-files','--cached','--others','--exclude-standard','-z','--','src','tests','scripts','migrations','catalog','contracts','package.json','package-lock.json','tsconfig.json'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
 return Object.fromEntries(await Promise.all([...new Set(names)].sort().map(async name=>[name,hash(await readFile(name))])));
}
const before=await snapshot();
for(const [name,expected] of Object.entries(before)){
 const bytes=await readFile(name); assert.equal(hash(bytes),expected);
 const target=path.join(prefix+'-sources',name); await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
}
await writeFile(prefix+'-verifier.mjs',await readFile(import.meta.filename),{flag:'wx'});
const started=new Date().toISOString();
const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/cloud-browser-preview.test.ts'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const chunks=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
const code=await new Promise(resolve=>{child.once('close',resolve);child.once('error',()=>resolve(1));});
const raw=Buffer.concat(chunks);await writeFile(prefix+'.tap',raw,{flag:'wx'});
const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,Number(raw.toString().match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??-1)]));
const unchanged=JSON.stringify(before)===JSON.stringify(await snapshot());
const passed=code===0&&unchanged&&counts.tests>0&&counts.pass===counts.tests&&['fail','cancelled','skipped','todo'].every(k=>counts[k]===0);
const report={schema:1,status:passed?'passed':'failed',started_at:started,finished_at:new Date().toISOString(),counts,exit_code:code,source_unchanged:unchanged,source_files:before,raw_sha256:hash(raw),native_windows_browser:true};
await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,counts,source_unchanged:unchanged,report:prefix+'.json'}));
if(!passed)process.exitCode=1;
