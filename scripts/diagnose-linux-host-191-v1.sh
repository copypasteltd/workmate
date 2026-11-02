#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v1/backend
runuser -u workmate -- /opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --input-type=module <<'WM_DIAG_HOST_191'
import {mkdir,copyFile,readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {spawn} from 'node:child_process';import path from 'node:path';
const root=path.resolve('.data/native-qualification-191/cloud-programs',randomUUID());await mkdir(root+'/runtime',{recursive:true});await mkdir(root+'/work');await copyFile(process.execPath,root+'/runtime/node');
const sha=createHash('sha256').update(await readFile(process.execPath)).digest('hex');
const child=spawn(path.resolve('.data/cloud-program-host-linux/cloud-linux-host.py'),[root,root+'/runtime/node',sha,'5000','--eval','console.log("NATIVE_STARTED")'],{stdio:['pipe','pipe','pipe']});
let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const code=await new Promise((r,j)=>{child.once('close',r);child.once('error',j)});
console.log(JSON.stringify({code,stdout:out,stderr:err,receipt:JSON.parse(await readFile(root+'/host-receipt.json','utf8'))}));
WM_DIAG_HOST_191
