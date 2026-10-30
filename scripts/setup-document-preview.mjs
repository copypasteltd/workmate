import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile), root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32')throw new Error('This setup provisions the verified native Windows Office renderer. PDF previews require no Office installation.');
const version='26.8.2',directory=path.join(root,'.data/document-preview'), office=path.join(directory,'libreoffice-'+version);
const source=`https://download.documentfoundation.org/libreoffice/stable/${version}/win/x86_64/LibreOffice_${version}_Win_x86-64.msi`;
const pinned='ff4b911403b67ee9e6249f820f9782c44bb32c94fdaa45b0da53a8e419e5307a';
const sha=body=>createHash('sha256').update(body).digest('hex');
await mkdir(directory,{recursive:true});
const html=await (await fetch(source+'.mirrorlist',{signal:AbortSignal.timeout(30000)})).text();
const match=html.match(/SHA-?256(?:\s|<[^>]+>|:)*([a-f0-9]{64})/i)??html.match(/\b([a-f0-9]{64})\b/i);
if(!match)throw new Error('The official download page did not provide its SHA-256 checksum');
const expected=match[1].toLowerCase(),msi=path.join(directory,'LibreOffice_'+version+'.msi');
if(expected!==pinned)throw new Error('The official release checksum changed; review a new pinned Office runtime before installing it');
let valid=false;try{valid=sha(await readFile(msi))===expected;}catch{}
if(!valid){
  const response=await fetch(source,{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw new Error('Official Office runtime download failed');
  let total=0;const digest=createHash('sha256'),partial=msi+'.partial';
  await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,done){total+=chunk.length;if(total>600*1024**2){done(new Error('Office package exceeds the download limit'));return;}digest.update(chunk);done(null,chunk);}}),createWriteStream(partial));
  if(digest.digest('hex')!==expected)throw new Error('Official Office package checksum mismatch; original partial download retained');
  const {rename}=await import('node:fs/promises');await rename(partial,msi);
}
await mkdir(office,{recursive:true});
const candidates=[path.join(office,'program/soffice.com'),path.join(office,'LibreOffice/program/soffice.com')];
let officePath;for(const p of candidates){try{await access(p);officePath=p;break;}catch{}}
if(!officePath){
  const log=path.join(directory,'extract-'+Date.now()+'.log');
  await exec('msiexec.exe',['/a',msi,'/qn','TARGETDIR='+office,'/l*v',log],{windowsHide:true,timeout:240000,maxBuffer:1024**2});
  for(const p of candidates){try{await access(p);officePath=p;break;}catch{}}
}
if(!officePath)throw new Error('The extracted Office launcher was not found');
const sourceFile=path.join(root,'src/document-preview-host.cs'),host=path.join(directory,'WorkmateDocumentPreview.exe');
const compiler=path.join(process.env.WINDIR??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
await exec(compiler,['/nologo','/target:exe','/out:'+host,sourceFile],{windowsHide:true,timeout:30000,maxBuffer:1024**2});
const result={version,source,msi_sha256:expected,office_path:officePath,office_sha256:sha(await readFile(officePath)),host_path:host,host_sha256:sha(await readFile(host)),host_source_sha256:sha(await readFile(sourceFile))};
await writeFile(path.join(directory,'runtime.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'ready',version,manifest:'.data/document-preview/runtime.json',administrative_extraction:true,system_office_installation:false}));
