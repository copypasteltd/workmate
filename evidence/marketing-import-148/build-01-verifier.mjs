import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const attempt=process.argv[2];assert.match(attempt??'',/^\d{2}$/);
const delivery=process.cwd(),web=path.resolve('../copypaste-web'),desktop=path.resolve('../copypaste-desktop'),extension=path.resolve('../copypaste-extension'),base='evidence/marketing-import-148',prefix=base+'/build-'+attempt,sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(base+'/objects',{recursive:true});for(const s of['.json','.tap','-sources.json','-verifier.mjs'])await assert.rejects(readFile(prefix+s),e=>e.code==='ENOENT');
async function snapshot(archive){const files={};for(const[name,repo]of[['web',web],['desktop',desktop],['extension',extension]]){
 const names=execFileSync('git',['-C',repo,'ls-files','--cached','--others','--exclude-standard','-z','--','src','renderer/src','renderer/tsconfig.json','public','scripts','tests','contracts','assets/fonts','package.json','package-lock.json','tsconfig.json','vite.config.ts'],{encoding:'utf8',windowsHide:true,maxBuffer:16000000}).split('\0').filter(Boolean);
 for(const file of[...new Set(names)].sort()){const b=await readFile(path.join(repo,file)),digest=sha(b),object=base+'/objects/'+digest+'.blob';if(archive){try{await writeFile(object,b,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),b);}}files['copypaste-'+name+'/'+file]={sha256:digest,...(archive?{path:object}:{})};}}return files;}
const before=await snapshot(true);await writeFile(prefix+'-sources.json',JSON.stringify(before,null,2)+'\n',{flag:'wx'});await writeFile(prefix+'-verifier.mjs',await readFile(import.meta.filename),{flag:'wx'});
const log=createWriteStream(prefix+'.tap',{flags:'wx'}),commands=[],packageFiles={},packageRoot=path.join(desktop,'release/marketing-import-148-'+attempt+'/win-unpacked');let error=null;
async function command(name,args,cwd){const code=await new Promise(resolve=>{const c=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});c.stdout.pipe(log,{end:false});c.stderr.pipe(log,{end:false});c.once('error',()=>resolve(1));c.once('close',resolve);});commands.push({name,arguments:args,exit_code:code});console.log(name+': '+code);assert.equal(code,0,name);}
try{const npm=process.env.COPYPASTE_NPM_CLI??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 for(const[name,args,cwd]of[
 ['native surface boundaries',['--test','tests/native-surface-integrity.test.mjs'],delivery],
 ['Web compiler',['node_modules/typescript/bin/tsc','--noEmit'],web],['Web build',['node_modules/vite/bin/vite.js','build'],web],
 ['Desktop renderer compiler',['node_modules/typescript/bin/tsc','--noEmit','-p','renderer/tsconfig.json'],desktop],
 ['Desktop build',[npm,'run','build'],desktop],['unsigned Windows package',['node_modules/electron-builder/out/cli/cli.js','--win','--dir','--config.directories.output=release/marketing-import-148-'+attempt],desktop]
 ])await command(name,args,cwd);
 for(const name of['CopyPaste.exe','resources/app.asar','resources/local-codex/codex.exe','resources/local-codex/runtime-manifest.json'])packageFiles[name]=sha(await readFile(path.join(packageRoot,name)));
 const pinned=JSON.parse(await readFile(path.join(desktop,'contracts/local-codex-runtime.json')));assert.equal(packageFiles['resources/local-codex/codex.exe'],pinned.windows_x64_sha256);
}catch(e){error=String(e);}finally{await new Promise(r=>log.end(r));}
const after=await snapshot(false),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([name,v])=>v.sha256===after[name]?.sha256);
const report={at:new Date().toISOString(),status:!error&&commands.length===6&&commands.every(c=>c.exit_code===0)&&Object.keys(packageFiles).length===4&&unchanged?'passed':'failed',error,commands,source_unchanged:unchanged,package_root:packageRoot,package_files:packageFiles,
 source_manifest:{path:prefix+'-sources.json',sha256:sha(await readFile(prefix+'-sources.json'))},raw_report:{path:prefix+'.tap',sha256:sha(await readFile(prefix+'.tap'))},verifier:{path:prefix+'-verifier.mjs',sha256:sha(await readFile(import.meta.filename))},scope:'Current Web and unsigned frameless Windows Desktop marketing import build; unchanged Extension runtime retains its separately labelled Stage147 build evidence. Actual interaction qualification is recorded separately.'};
await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,report:prefix+'.json',error}));assert.equal(report.status,'passed');
