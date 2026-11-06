"""Prepare the full 204 verification/release batch before its first build/test."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';S=L/'scripts'
def put(p,s):
 assert not p.exists(),p
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf-8',newline='\n')
def derive(source,target,pairs):
 s=source.read_text('utf-8')
 for a,b in pairs:
  assert a in s,(source,a);s=s.replace(a,b)
 put(target,s)
for name in ['owned-native-db','company-qa-tunnel']:
 ext='mjs' if name=='owned-native-db' else 'py'
 derive(S/f'{name}-203-v1.{ext}',S/f'{name}-204-v1.{ext}',[('acceptance-203','acceptance-204')]+([("'stage':203","'stage':204")] if ext=='py' else []))
derive(D/'copypaste-desktop/scripts/package-integrated-203-v1.mjs',D/'copypaste-desktop/scripts/package-integrated-204-v1.mjs',[
 ('deployment-203-v1','deployment-204-v1'),('integrated-203-v2','integrated-204-v1'),('stage:203','stage:204')])
for name,ext in [('prepare-public-downloads','py'),('finalize-release-metadata','mjs'),('upload-downloads','py'),('activate-downloads','sh'),('qualify-inner-downloads','py')]:
 pairs=[('deployment-203-v1','deployment-204-v1'),('0.7.16','0.7.17'),('20301','20401'),("'stage':203","'stage':204"),('stage:203','stage:204'),('integrated-203-v2','integrated-204-v1'),('workmate-downloads-203-v1','workmate-downloads-204-v1'),('integrated-203/downloads-v1','integrated-204/downloads-v1')]
 old=(S/f'{name}-203-v1.{ext}').read_text('utf-8');pairs=[(a,b) for a,b in pairs if a in old]
 derive(S/f'{name}-203-v1.{ext}',S/f'{name}-204-v1.{ext}',pairs)
derive(S/'qualify-public-stream-203-v2.mjs',S/'qualify-public-stream-204-v1.mjs',[
 ('deployment-203-v1','deployment-204-v1'),('stage:203','stage:204')])
derive(S/'verify-network-preserved-203-v1.sh',S/'verify-network-preserved-204-v1.sh',[
 ('integrated-203/network-preserved-v1.json','integrated-204/network-preserved-v1.json'),("'stage':203","'stage':204")])

put(S/'verify-integrated-round-204-v1.mjs',r'''import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('../..'),out=path.resolve('.data/integrated-204-v1');await mkdir(out,{recursive:true});
const batch=JSON.parse(await readFile(path.join(root,'docs/quality/integrated-round-204/implementation-batch.json'),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of batch.production_source_files)assert.equal(sha(await readFile(path.join(root,row.path))),row.sha256,row.path);
const report={stage:204,status:'running',state:'running',checks:[],scope:'Unified changed Backend/Web/Desktop builds and related current tests; unchanged Admin/Extension are source-qualified carry-forwards. Actual native PostgreSQL and pinned Codex fixture tests; not full historical or professional/production acceptance.'};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
async function run(component,phase,args){let output='';const p=spawn(process.execPath,args,{cwd:path.resolve('../copypaste-'+component),env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[p.stdout,p.stderr])s.on('data',b=>output+=b.toString());const code=await new Promise(r=>{p.once('error',e=>{output+=e.name;r(1);});p.once('close',c=>r(c??1));});const log=component+'-'+phase+'.log';await writeFile(path.join(out,log),output,{flag:'wx'});report.checks.push({component,phase,exit_code:code,log:'.data/integrated-204-v1/'+log,sha256:sha(output)});await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({component,phase,exit_code:code}));}
await Promise.all(['platform','web','desktop'].map(c=>run(c,'build',[npm,'run','build'])));
await run('desktop','types',[npm,'run','typecheck']);
if(report.checks.every(c=>c.exit_code===0)){
 await Promise.all([run('web','test',[npm,'run','test']),run('delivery','test',[npm,'run','test'])]);
 await run('desktop','test',['scripts/run-current-tests-203-v1.mjs']);
 const files=['runtime-tool-feedback-204-v1','runtime-feedback-native-204-v1','runtime-image-failure-189-v1','cloud-task-lease-204-v1','provider-request-control','paid-task-inputs','execution-capacity','task-pause-154-v3','schema-compatibility','audio-production','audio-authorization-upgrade-189-v1','audio-accounting-188-v1','generated-video-jobs-188-v1','cloud-workflows','analysis-role-tools','analysis-role-delivery','analysis-calculation','analysis-review-202-v3','desktop-executions-139-v3'];
 await run('platform','test',['--env-file=.env','scripts/run-tests-owned.mjs',...files.map(v=>'tests/'+v+'.test.ts')]);
}
report.state=report.status=report.checks.length===8&&report.checks.every(c=>c.exit_code===0)?'passed':'failures_for_integrated_debugging';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,receipt:path.join(out,'verification.json')}));if(report.status!=='passed')process.exitCode=1;
''')

put(S/'bundle-integrated-204-v1.py',r'''from pathlib import Path
import hashlib,json,zipfile
R=Path(__file__).resolve().parents[2];L=R/'copypaste-delivery';out=L/'.data/deployment-204-v1';out.mkdir(parents=True,exist_ok=True)
assert json.loads((out/'release-metadata-validation.json').read_text())['status']=='passed'
files=[];sources=[]
for component,folders,names in [('backend',['src','dist/src','dist/scripts','dist/assets','migrations','scripts','contracts'],['package.json','package-lock.json']),('web',['dist'],[]),('admin',['dist'],[])]:
 base=R/('copypaste-platform' if component=='backend' else 'copypaste-'+component)
 for folder in folders:
  sources.extend((component,base,p) for p in (base/folder).rglob('*') if p.is_file() and p.suffix not in ['.map'] and '.data' not in p.relative_to(base).parts and 'node_modules' not in p.relative_to(base).parts)
 sources.extend((component,base,base/n) for n in names)
archive=out/'integrated-204-v1.zip';assert not archive.exists()
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for component,base,p in sources:
  assert not p.is_symlink();raw=p.read_bytes();rel=component+'/'+p.relative_to(base).as_posix();z.writestr(rel,raw);files.append({'path':rel,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 manifest={'stage':204,'schema_version':164,'files':files};z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
(out/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':'bundled','files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
''')
derive(S/'upload-integrated-202-v1.py',S/'upload-integrated-204-v1.py',[
 ('deployment-202-v1','deployment-204-v1'),('integrated-202-v1.zip','integrated-204-v1.zip'),('workmate-upload-202-v1','workmate-upload-204-v1')])
print('Complete build/test, packaging, download, unchanged-network, transport and bundle scripts prepared. No build/test/deployment executed.')
