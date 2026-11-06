import {spawn} from 'node:child_process';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/acceptance-202/native-db-owner-v1');await mkdir(out,{recursive:true});
const child=spawn(process.execPath,['scripts/native-db-launch.mjs'],{cwd:path.resolve('../copypaste-platform'),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let output='';for(const s of[child.stdout,child.stderr])s.on('data',b=>output+=b.toString());
await writeFile(path.join(out,'owner.private.json'),JSON.stringify({owner_pid:process.pid,child_pid:child.pid,at:new Date().toISOString()})+'\n',{flag:'wx'});
const timer=setInterval(async()=>{try{await readFile(path.join(out,'stop'));child.send({action:'shutdown'});clearInterval(timer);}catch{}},1000);
const code=await new Promise(r=>{child.once('error',()=>r(1));child.once('close',c=>r(c??1));});clearInterval(timer);await writeFile(path.join(out,'output.log'),output,{flag:'wx'});await writeFile(path.join(out,'closed.json'),JSON.stringify({owner_pid:process.pid,child_pid:child.pid,exit_code:code,at:new Date().toISOString()})+'\n',{flag:'wx'});assert.equal(code,0);
