#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v3/backend
systemd-run --quiet --wait --pipe --collect --unit=workmate-native-qualification-191-v7 --property=User=workmate --property=Group=workmate --property=Delegate=yes --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property=PrivateTmp=yes --property=ReadWritePaths=/opt/workmate/overlays/native-repair-191-v3/backend/.data/native-qualification-191 --property=ReadWritePaths=/sys/fs/cgroup/system.slice/workmate-native-qualification-191-v7.service --property=WorkingDirectory=/opt/workmate/overlays/native-repair-191-v3/backend /usr/bin/python3 /opt/workmate/overlays/native-repair-191-v3/backend/scripts/launch-linux-native-service.py /opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --input-type=module <<'WM_NATIVE_191'
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCloudProgram,cloudProgramAvailable} from './dist/src/cloud-program-executor.js';
import {runCloudApiCheck,runCloudDatabaseCheck} from './dist/src/cloud-development-checks.js';
import {cloudBrowserAvailable} from './dist/src/cloud-browser-runtime.js';
import {runCloudBrowserPreview} from './dist/src/cloud-browser-preview.js';
const data=path.resolve('.data/native-qualification-191',randomUUID());await mkdir(data,{recursive:true});
const report={stage:191,scope:'Actual native Linux runtime, no AI inference simulation',checks:[],status:'running',started_at:new Date().toISOString()};
const source=(text,name='main.cjs')=>[{path:name,bytes:Buffer.from(text)}];
try{
 assert.equal(await cloudProgramAvailable(),true);assert.equal(await cloudBrowserAvailable(),true);
 const canary=path.join(data,'outside.txt');await writeFile(canary,'PRIVATE CANARY');
 const program=await runCloudProgram(data,{program:'node',entry:'main.cjs'},source(`const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net'),assert=require('node:assert/strict');
 let outside=false;try{fs.readFileSync(${JSON.stringify(canary)})}catch(e){outside=['ENOENT','EPERM','EACCES','ERR_ACCESS_DENIED'].includes(e.code)}assert.ok(outside);assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.AI_API_KEY,undefined);
 assert.throws(()=>process.execve('/usr/bin/id',['id'],{}),{code:'ERR_ACCESS_DENIED'});let childDenied=false;try{childDenied=Boolean(cp.spawnSync('/usr/bin/id',[]).error)}catch(e){childDenied=e.code==='ERR_ACCESS_DENIED'}assert.ok(childDenied);const socket=net.connect({host:'127.0.0.1',port:63073});socket.on('error',()=>{fs.writeFileSync('result.json',JSON.stringify({outside_denied:outside,child_denied:true,network_denied:true}));console.log('ISOLATION_VERIFIED')});socket.on('connect',()=>{throw Error('Network unexpectedly reachable')});`));
 assert.equal(program.receipt.passed,true,JSON.stringify({stderr:program.receipt.stderr,host:program.receipt.host}));assert.match(program.receipt.stdout,/ISOLATION_VERIFIED/);assert.equal(program.receipt.workspace_deleted,true);assert.equal(JSON.parse(program.files.find(f=>f.path==='result.json').bytes).outside_denied,true);
 report.checks.push({name:'Actual program read/write; outside-file, subprocess and host-network denial; cleanup',status:'passed',receipt:program.receipt});
 const fail=await runCloudProgram(data,{program:'node_test',entry:'suite.cjs'},source(`require('node:test')('failure remains failure',()=>require('node:assert/strict').equal(1,2));`,'suite.cjs'));
 assert.equal(fail.receipt.passed,false);assert.notEqual(fail.receipt.exit_code,0);report.checks.push({name:'Failing built-in tests retain their failing exit',status:'passed',receipt:fail.receipt});
 const timeout=await runCloudProgram(data,{program:'node',entry:'main.cjs',timeout_ms:200},source('while(true){}'));
 assert.equal(timeout.receipt.passed,false);assert.equal(timeout.receipt.host.timed_out,true);assert.equal(timeout.receipt.host.job_empty,true);report.checks.push({name:'Deadline kills owned native execution and empties cgroup',status:'passed',receipt:timeout.receipt});
 const preview=await runCloudBrowserPreview(data,{entry:'index.html',actions:[{action:'fill',selector:'#name',value:'CopyPaste'},{action:'click',selector:'#go'}],checks:[{name:'Actual click response',selector:'#result',expect:{text:'Hello CopyPaste'}}],timeout_ms:20000},source('<!doctype html><input id="name"><button id="go" onclick="document.querySelector(\'#result\').textContent=\'Hello \'+document.querySelector(\'#name\').value">Run</button><p id="result"></p>','index.html'));
 assert.equal(preview.receipt.passed,true,JSON.stringify(preview.receipt));report.checks.push({name:'Actual isolated Chromium fill/click/assert/screenshot, renderer sandbox and cleanup',status:'passed',receipt:preview.receipt});
 
 const api=await runCloudApiCheck(data,{entry:'api.cjs',requests:[{name:'Real API response',method:'GET',path:'/actual',expect:{status:200,json:{ok:true}}}]},source("module.exports=(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:req.url==='/actual'}));};",'api.cjs'));
 assert.equal(api.receipt.passed,true,JSON.stringify(api.receipt));report.checks.push({name:'Actual Linux API module requests and response assertions through bounded stdin channel',status:'passed',receipt:api.receipt});
 const sql=await runCloudDatabaseCheck(data,{entry:'schema.sql',checks:[{name:'Real SQLite query',sql:'SELECT value FROM example WHERE id=?',params:[1],expect:{rows:[{value:'original'}]}}]},source("CREATE TABLE example(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO example VALUES(1,'original');",'schema.sql'));
 assert.equal(sql.receipt.passed,true,JSON.stringify(sql.receipt));report.checks.push({name:'Actual Linux SQLite execution and exact query result',status:'passed',receipt:sql.receipt});
 const denied=await runCloudBrowserPreview(data,{entry:'index.html',checks:[{name:'External host access is blocked',selector:'#result',expect:{text:'DENIED'}}]},source('<p id="result"></p><script>fetch("http://127.0.0.1:63073/health/ready").then(()=>document.querySelector("#result").textContent="BAD").catch(()=>document.querySelector("#result").textContent="DENIED")</script>','index.html'));
 assert.equal(denied.receipt.passed,true,JSON.stringify(denied.receipt));assert.equal(denied.receipt.host.job_empty,true);report.checks.push({name:'Customer browser cannot reach the service host; actual denial and cleanup',status:'passed',receipt:denied.receipt});
 const infinite=await runCloudBrowserPreview(data,{entry:'index.html',timeout_ms:1500,checks:[{name:'No false passing result',selector:'h1',expect:{text:'Never'}}]},source('<script>while(true){}</script>','index.html'));
 assert.equal(infinite.receipt.passed,false);assert.equal(infinite.receipt.host.job_empty,true);assert.equal(infinite.receipt.workspace_deleted,true);report.checks.push({name:'Infinite page script is stopped without false success or retained browser process',status:'passed',receipt:infinite.receipt});
 for(const f of preview.files.filter(f=>['browser-preview.png','page-dom.html','page-text.txt'].includes(f.path)))await writeFile(path.join(data,f.path),f.bytes,{flag:'wx'});
 report.status='passed';

}catch(e){report.status='failed';report.error=String(e.stack);process.exitCode=1;}
finally{report.finished_at=new Date().toISOString();const file=path.join(data,'qualification.json');await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:file,error:report.error,passed:report.checks.map(v=>v.name)}));}
WM_NATIVE_191
