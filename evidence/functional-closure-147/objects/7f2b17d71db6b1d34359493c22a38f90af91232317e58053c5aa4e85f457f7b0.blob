import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import path from 'node:path';
import {removeDocumentPreviewWork} from '../src/document-preview.js';
test('actual Windows file sharing locks retain an ownership marker and cleanup waits for release',{timeout:20000,skip:process.platform!=='win32'},async()=>{
  const work=path.resolve('.data/document-preview/work');await mkdir(work,{recursive:true});const directory=await mkdtemp(path.join(work,'preview-')),file=path.join(directory,'held.txt'),marker=directory+'.owner.json';
  await writeFile(file,'synthetic locked preview fixture');await writeFile(marker,JSON.stringify({schema:'workmate-document-preview-1',pid:process.pid}));
  const script=`$taskPreviewLock=[System.IO.File]::Open('${file.replaceAll("'","''")}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);[Console]::WriteLine('locked');Start-Sleep -Milliseconds 800;$taskPreviewLock.Dispose();`;
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b.toString());let code:number|null=null;const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',c=>{code=c;resolve();});});
  try{const deadline=Date.now()+7000;while(!output.includes('locked')){assert.equal(child.exitCode,null);assert.ok(Date.now()<deadline,'actual Windows lock ready');await new Promise(r=>setTimeout(r,20));}
    await assert.rejects(unlink(file),(e:any)=>['EBUSY','EPERM','EACCES'].includes(e.code));
    assert.match(await readFile(marker,'utf8'),/workmate-document-preview-1/);
    await removeDocumentPreviewWork(directory);await closed;assert.equal(code,0);
    await assert.rejects(readFile(file),(e:any)=>e.code==='ENOENT');await assert.rejects(readFile(marker),(e:any)=>e.code==='ENOENT');
    await assert.rejects(removeDocumentPreviewWork(path.resolve('.data')),/Invalid preview cleanup/);
  }finally{if(child.exitCode===null)child.kill();await closed;await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});await rm(marker,{force:true});}
});
