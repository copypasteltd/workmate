import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import path from 'node:path';
const [attempt,backendAttempt,buildAttempt]=process.argv.slice(2);if(buildAttempt)assert.match(buildAttempt,/^\d{2}$/);assert.match(attempt??'',/^\d{2}$/);assert.match(backendAttempt??'',/^\d{2}$/);
const delivery=process.cwd(),platform=path.resolve('../copypaste-platform'),desktop=path.resolve('../copypaste-desktop'),extension=path.resolve('../copypaste-extension'),web=path.resolve('../copypaste-web');
const base='evidence/document-preview-146',prefix=`${base}/ui-${attempt}`,sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(base,{recursive:true});for(const suffix of['.json','.tap','-sources.json','-verifier.mjs','-journey.json'])await assert.rejects(readFile(prefix+suffix),e=>e.code==='ENOENT');
const git=(repo,args)=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',repo,...args],{encoding:'utf8',windowsHide:true,maxBuffer:16000000});
async function snapshot(archive){const files={};for(const[name,repo]of[['platform',platform],['web',web],['desktop',desktop],['extension',extension]]){
  const paths=[...new Set(git(repo,['ls-files','--cached','--others','--exclude-standard','-z','--','src','renderer/src','renderer/tsconfig.json','tests','scripts','migrations','catalog','contracts','skills','assets/fonts','public','package.json','package-lock.json','tsconfig.json','vite.config.ts']).split('\0').filter(Boolean))].sort();
  for(let i=0;i<paths.length;i+=16)await Promise.all(paths.slice(i,i+16).map(async file=>{const bytes=await readFile(path.join(repo,file)),digest=sha(bytes),object=`${base}/objects/${digest}.blob`;if(archive){await mkdir(path.dirname(object),{recursive:true});try{await writeFile(object,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),bytes);}}files[`copypaste-${name}/${file}`]={sha256:digest,...(archive?{path:object}:{})};}));
}for(const file of['scripts/qualify-document-preview-ui-146-v5.mjs','scripts/qa-document-preview-146-v3.ts','scripts/record-workmate-media.ts']){const bytes=await readFile(file),digest=sha(bytes),object=`${base}/objects/${digest}.blob`;if(archive){await mkdir(path.dirname(object),{recursive:true});try{await writeFile(object,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(await readFile(object),bytes);}}files['copypaste-delivery/'+file]={sha256:digest,...(archive?{path:object}:{})};}return files;}
const before=await snapshot(true);await writeFile(prefix+'-sources.json',JSON.stringify(before,null,2)+'\n',{flag:'wx'});await writeFile(prefix+'-verifier.mjs',await readFile(import.meta.filename),{flag:'wx'});
const backendFile=`${base}/backend-${backendAttempt}.json`,backend=JSON.parse(await readFile(backendFile));assert.equal(backend.status,'passed');assert.equal(backend.owned_database_shutdown,true);assert.equal(backend.owned_database_port_closed,true);
const backendSources=JSON.parse(await readFile(backend.source_manifest.path));
const clientDifferences=Object.entries(backendSources).filter(([name,file])=>!name.startsWith('copypaste-delivery/')&&before[name]?.sha256!==file.sha256).map(([name])=>name).sort();
assert.deepEqual(clientDifferences,[]);
// Only duplicate accessible labels in the shared picker changed. All backend,
// native kernel, extension and remaining client sources are byte-identical.

process.loadEnvFile(path.join(platform,'.env'));const owned=path.resolve('.data/document-preview-146','ui-'+randomUUID()),run=path.join(platform,'.data/test-fixture-reclamation',randomUUID()),token=randomUUID();await mkdir(owned,{recursive:true});await mkdir(run,{recursive:true});await writeFile(path.join(run,'manifest.json'),JSON.stringify({owner_pid:process.pid,token}),{flag:'wx'});
const port=backend.owned_native_port,env={...process.env,COPYPASTE_NATIVE_DATABASE_DIR:backend.owned_native_directory,COPYPASTE_NATIVE_DATABASE_START_ONLY:'true',COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:token,COPYPASTE_BUSINESS_INPUTS_OWNED:owned,CHROME_BIN:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe')};
for(const name of['OWNER_DATABASE_URL','DATABASE_URL','CONTROL_DATABASE_URL','QUEUE_DATABASE_URL']){const url=new URL(env[name]);assert.ok(['127.0.0.1','localhost','::1'].includes(url.hostname));url.port=String(port);env[name]=url.href;}
const pinned=JSON.parse(await readFile(path.join(desktop,'contracts/local-codex-runtime.json'))),binary=path.join(desktop,'.data/runtime/windows-x64/codex.exe');assert.equal(sha(await readFile(binary)),pinned.windows_x64_sha256);env.COPYPASTE_LOCAL_CODEX_BIN=binary;
const log=createWriteStream(prefix+'.tap',{flags:'wx'}),commands=[],previews=[],packageRoot=path.join(desktop,`release/document-preview-146-${buildAttempt??attempt}/win-unpacked`),packageFiles={};let reusedBuild=null,database,shutdown=null,error=null,resultCode=null,journey=null,cleanup=null;
function launch(args,cwd=platform,extra={},ipc=false){const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe',...(ipc?['ipc']:[])]});let output='';child.stdout.on('data',b=>{output=(output+b).slice(-16000);});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const closed=new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('close',c=>resolve(c??1));});return{child,closed,output:()=>output};}
async function command(name,args,cwd){const code=await launch(args,cwd).closed;commands.push({name,arguments:args,exit_code:code});console.log(name+': '+code);assert.equal(code,0,name);}
const occupied=p=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:p});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',e=>{socket.destroy();resolve(e.code!=='ECONNREFUSED');});});
async function ready(child,probe,ms){const end=Date.now()+ms;while(!await probe()){assert.equal(child.child.exitCode,null,child.output());assert.ok(Date.now()<end,'Owned process readiness');await new Promise(r=>setTimeout(r,200));}}
try{
  for(const p of[port,4310,4317])assert.equal(await occupied(p),false,'Preserve existing services');
  const npm=process.env.COPYPASTE_NPM_CLI??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');await readFile(npm);
  if(buildAttempt){
    const file=`${base}/ui-${buildAttempt}.json`,bytes=await readFile(file),build=JSON.parse(bytes);
    assert.equal(build.commands.length,11);assert.ok(build.commands.every(c=>c.exit_code===0));assert.equal(build.source_unchanged,true);assert.equal(build.package_unchanged,true);
    const original=JSON.parse(await readFile(build.source_manifest.path));
    const changed=[...new Set([...Object.keys(original),...Object.keys(before)])].filter(name=>!name.startsWith('copypaste-delivery/')&&original[name]?.sha256!==before[name]?.sha256).sort();
    assert.deepEqual(changed,['copypaste-platform/src/document-preview-package.ts','copypaste-platform/src/document-preview.ts','copypaste-platform/tests/document-preview-cleanup-146-v1.test.ts','copypaste-platform/tests/document-preview-package-146-v1.test.ts'],'Only backend cleanup and its new native lock case differ; every packaged client source is byte-identical');
    assert.equal(Object.keys(build.package_files).length,4);for(const[name,digest]of Object.entries(build.package_files))assert.equal(sha(await readFile(path.join(packageRoot,name))),digest);
    reusedBuild={path:file,sha256:sha(bytes),source_manifest:build.source_manifest,package_files:build.package_files,scope:'Identical product sources and Windows package; original failed journey remains failed. The current backend cleanup and native lock case are separately qualified, and the current backend is rebuilt before the journey.'};
    await command('current typed qualification setup',['node_modules/typescript/bin/tsc','--noEmit'],delivery);
    await command('current backend build',['node_modules/typescript/bin/tsc'],platform);
    await command('current backend bootstrap',['scripts/copy-cloud-check-bootstrap.mjs'],platform);
  }else{
  for(const[name,args,cwd]of[
    ['delivery compile',['node_modules/typescript/bin/tsc','--noEmit'],delivery],
    ['native surface boundary checks',['--test','tests/native-surface-integrity.test.mjs'],delivery],
    ['backend build',['node_modules/typescript/bin/tsc'],platform],['backend bootstrap',['scripts/copy-cloud-check-bootstrap.mjs'],platform],
    ['Web compile',['node_modules/typescript/bin/tsc','--noEmit'],web],['Web build',['node_modules/vite/bin/vite.js','build'],web],
    ['extension compile',['node_modules/typescript/bin/tsc','--noEmit'],extension],['extension build',['scripts/build.mjs'],extension],
    ['Desktop renderer compile',['node_modules/typescript/bin/tsc','--noEmit','-p','renderer/tsconfig.json'],desktop],['Desktop build',[npm,'run','build'],desktop],
    ['unsigned Windows package',['node_modules/electron-builder/out/cli/cli.js','--win','--dir',`--config.directories.output=release/document-preview-146-${attempt}`],desktop],
  ])await command(name,args,cwd);
  }
  for(const file of['CopyPaste.exe','resources/app.asar','resources/local-codex/codex.exe','resources/local-codex/runtime-manifest.json'])packageFiles[file]=sha(await readFile(path.join(packageRoot,file)));
  assert.equal(packageFiles['resources/local-codex/codex.exe'],pinned.windows_x64_sha256);
  database=launch(['scripts/native-db-launch.mjs'],platform,{},true);await ready(database,()=>Promise.resolve(database.output().includes('Native PostgreSQL ready')),600000);
  const preview=launch(['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4317','--strictPort'],web);previews.push(preview);await ready(preview,()=>occupied(4317),30000);
  resultCode=await launch(['--import','tsx','scripts/qa-document-preview-146-v3.ts',attempt],delivery,{COPYPASTE_LOCAL_DESKTOP_CANDIDATE:path.join(packageRoot,'CopyPaste.exe')}).closed;
  journey=JSON.parse(await readFile(prefix+'-journey.json'));
}catch(e){error=String(e);}finally{
  for(const preview of previews){if(preview.child.exitCode===null)preview.child.kill();await preview.closed;}
  const code=await launch(['--import','tsx','scripts/reclaim-test-fixtures.ts'],platform).closed;
  try{const bytes=await readFile(path.join(run,'result.json'));await writeFile(prefix+'-fixture-cleanup.json',bytes,{flag:'wx'});cleanup={exit_code:code,...JSON.parse(bytes)};}catch(e){error??=String(e);}
  if(database?.child.connected&&database.child.exitCode===null)database.child.send({action:'shutdown'});if(database)shutdown=await database.closed;await new Promise(r=>log.end(r));
}
const after=await snapshot(false),unchanged=Object.keys(before).length===Object.keys(after).length&&Object.entries(before).every(([name,value])=>after[name]?.sha256===value.sha256),portsClosed={};for(const p of[port,4310,4317])portsClosed[p]=!await occupied(p);
let packageUnchanged=Object.keys(packageFiles).length===4;for(const[file,digest]of Object.entries(packageFiles))if(sha(await readFile(path.join(packageRoot,file)))!==digest)packageUnchanged=false;
const passed=!error&&resultCode===0&&shutdown===0&&unchanged&&packageUnchanged&&Object.values(portsClosed).every(Boolean)&&cleanup?.status==='passed'&&cleanup?.exit_code===0&&journey?.status==='passed'&&journey.browser_closed&&journey.desktop_closed&&journey.extension_closed&&journey.api_closed&&journey.fixture_closed;
const report={at:new Date().toISOString(),status:passed?'passed':'failed',error,commands,reused_build:reusedBuild,result_exit_code:resultCode,source_unchanged:unchanged,source_manifest:{path:prefix+'-sources.json',sha256:sha(await readFile(prefix+'-sources.json'))},raw_report:{path:prefix+'.tap',sha256:sha(await readFile(prefix+'.tap'))},verifier:{path:prefix+'-verifier.mjs',sha256:sha(await readFile(import.meta.filename))},backend_vs_ui_source_differences:clientDifferences,backend:{path:backendFile,sha256:sha(await readFile(backendFile))},owned_native_directory:backend.owned_native_directory,owned_native_port:port,owned_database_shutdown:shutdown===0,ports_closed:portsClosed,fixture_cleanup:cleanup,package_files:packageFiles,package_unchanged:packageUnchanged,document_runtime:backend.document_runtime,journey:journey?{path:prefix+'-journey.json',sha256:sha(await readFile(prefix+'-journey.json')),checks:journey.checks}:null,scope:'Actual Web, unsigned frameless Windows package and Chrome native right Side Panel; current PDF and Office pages, fixed versions and source withdrawal. No AI calls. This is not production or complete local Codex/OS acceptance.'};
await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,report:prefix+'.json',error}));assert.ok(passed,'Preserve the original failed report, sources and verifier');
