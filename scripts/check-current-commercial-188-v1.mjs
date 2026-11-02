import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('../..'),platform=path.join(root,'dev/copypaste-platform'),out=path.resolve('.data/acceptance-188/native-cause-tests-'+randomUUID());
await mkdir(out,{recursive:true});
const env={...process.env};
for(const line of (await readFile('.data/acceptance-188/regression-8064c5cc-46c2-445d-b2fd-94d092406c00/native-test.private.env','utf8')).split('\n')){const i=line.indexOf('=');if(i>0)env[line.slice(0,i)]=line.slice(i+1);}
const pin=JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8'));
env.NODE_ENV='test';env.CODEX_BIN=path.join(root,'dev/copypaste-desktop/.data/runtime/windows-x64/codex.exe');env.CODEX_VERSION=pin.runtime_version;env.COPYPASTE_LOCAL_CODEX_TEST_BIN=env.CODEX_BIN;
const files=['tests/audio-accounting-188-v1.test.ts', 'tests/capability-audio-verification-188-v1.test.ts', 'tests/capability-video-verification-188-v1.test.ts', 'tests/generated-video-jobs-188-v1.test.ts', 'tests/capability-releases-188-v1.test.ts', 'tests/plan-versions-188-v1.test.ts', 'tests/financial-notifications-188-v1.test.ts'];
const log=await open(path.join(out,'tests.log'),'wx');const child=spawn(process.execPath,['scripts/run-tests-owned.mjs',...files],{cwd:platform,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log.write(b));child.stderr.on('data',b=>log.write(b));
const code=await new Promise(resolve=>child.once('close',resolve));await log.close();const bytes=await readFile(path.join(out,'tests.log'));const counts=Object.fromEntries([...bytes.toString().matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
const report={stage:188,status:code===0?'passed':'failed',files,exit_code:code,counts,log_sha256:createHash('sha256').update(bytes).digest('hex')};await writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,receipt:path.join(out,'receipt.json')}));assert.equal(code,0);
