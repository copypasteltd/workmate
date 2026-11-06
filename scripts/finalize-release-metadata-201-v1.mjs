import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('.data/deployment-201-v1'),web=path.resolve('../copypaste-web');await mkdir(out,{recursive:true});
assert.equal(JSON.parse(await readFile('.data/integrated-201-v4/verification.json','utf8')).state,'passed');
const catalog=await readFile(path.join(web,'contracts/product-downloads.json'));
assert.equal(JSON.parse(catalog).desktop.version,'0.7.14');
const report={stage:201,status:'running',scope:'Final artifact names/bytes/SHA-256 are known only after packaging. Rebuild Web and verify its exact catalog after this release metadata update; product code remains the completed final integrated-201-v3 batch.',catalog_sha256:createHash('sha256').update(catalog).digest('hex'),checks:[]};
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH??process.env.Path??'')};
for(const [phase,args] of [['web-build',[npm,'run','build']],['catalog-test',['--import','tsx','--test','tests/product-downloads.test.ts']]]){
 let output='';const p=spawn(process.execPath,args,{cwd:web,env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of [p.stdout,p.stderr])s.on('data',b=>{output+=b.toString();});
 const code=await new Promise(resolve=>{p.once('error',()=>resolve(1));p.once('close',c=>resolve(c??1));});const log=phase+'-final-v1.log';await writeFile(path.join(out,log),output,{flag:'wx'});report.checks.push({phase,exit_code:code,log,sha256:createHash('sha256').update(output).digest('hex')});assert.equal(code,0,phase);
}
report.status='passed';report.finished_at=new Date().toISOString();await writeFile(path.join(out,'release-metadata-validation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:path.join(out,'release-metadata-validation.json')}));
