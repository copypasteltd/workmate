import {readFile,writeFile,mkdir,open,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
const runtime=JSON.parse(await readFile('.data/document-preview/runtime.json','utf8'));
const root=path.resolve('.data/office-launch-195-'+randomUUID());await mkdir(root);
const bytes=zipSync(Object.fromEntries(Object.entries({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Controlled Word launch 香港</w:t></w:r></w:p></w:body></w:document>'}).map(([k,v])=>[k,strToU8(v)])));
const results=[];
for(const program of ['soffice.bin','soffice.com']){
 const dir=path.join(root,program),profile=path.join(dir,'profile'),output=path.join(dir,'output'),input=path.join(dir,'input.docx');await mkdir(path.join(profile,'user'),{recursive:true});await mkdir(output);await writeFile(input,bytes);
 await writeFile(path.join(profile,'user/registrymodifications.xcu'),'<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Setup/Office"><prop oor:name="FirstStartWizardCompleted" oor:op="fuse"><value>true</value></prop></item></oor:items>');
 for(let attempt=0;attempt<2;attempt++){
  const log=await open(path.join(dir,'converter-'+attempt+'.log'),'wx'),started=Date.now();
  const child=spawn(runtime.host_path,[String(process.pid),path.join(path.dirname(runtime.office_path),program),pathToFileURL(profile).href,output,input,dir],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  const timer=setTimeout(()=>child.kill('SIGKILL'),52000),exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);await log.close();const files=await readdir(output);const result={program,attempt,exit,milliseconds:Date.now()-started,files};results.push(result);console.log(JSON.stringify(result));if(exit!==81)break;
 }
}
await writeFile(path.join(root,'receipt.json'),JSON.stringify({stage:195,results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({receipt:path.join(root,'receipt.json')}));
