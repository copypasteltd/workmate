import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const out=path.resolve('.data/deployment-196/public-release-v1.sanitized.json');
const expected=JSON.parse(await readFile('.data/deployment-196/package-receipt.private.json','utf8'));
const catalog=JSON.parse(await readFile('../copypaste-web/contracts/product-downloads.json','utf8'));
const result={stage:196,status:'running',at:new Date().toISOString(),health:[],downloads:[]};
try{
 for(const domain of ['agent','agent-dashboard','ai-api']){
  const url=`https://${domain}.copypaste.hk/health/ready`,r=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const body=await r.json();assert.equal(body.kernel,'codex');assert.equal(body.data_mode,'configured_services');assert.equal(body.ai_ready,true);result.health.push({url,status:r.status,body});
 }
 for(const name of ['CopyPaste-0.7.6-x64-Setup.exe','CopyPaste-0.7.6-x64-Portable.exe','CopyPaste-Extension-0.5.5.zip','SHA256SUMS.txt']){
  const spec=expected.public_files.find(f=>f.name===name),url='https://agent.copypaste.hk/downloads/releases/196/'+name;assert.ok(spec);
  const head=await fetch(url,{method:'HEAD',headers:{'Accept-Encoding':'identity'},signal:AbortSignal.timeout(30000)});assert.equal(head.status,200);if(head.headers.get('content-length')!==null)assert.equal(Number(head.headers.get('content-length')),spec.bytes);
  const range=await fetch(url,{headers:{Range:'bytes=0-15','Accept-Encoding':'identity'},signal:AbortSignal.timeout(30000)});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);
  const full=await fetch(url,{headers:{'Accept-Encoding':'identity'},signal:AbortSignal.timeout(300000)});assert.equal(full.status,200);const hash=createHash('sha256');let bytes=0;for await(const part of full.body){hash.update(part);bytes+=part.byteLength;}const sha256=hash.digest('hex');assert.equal(bytes,spec.bytes);assert.equal(sha256,spec.sha256);result.downloads.push({name,url,bytes,sha256,head:200,range:206,full:200});
  console.log(JSON.stringify({download:name,verified:true,bytes}));
 }
 result.catalog=catalog;result.status='passed';
}catch(e){result.status='failed';result.error=e.name+': '+e.message;}
finally{result.finished_at=new Date().toISOString();await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,receipt:out,error:result.error}));}
assert.equal(result.status,'passed');
