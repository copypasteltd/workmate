#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/native-repair-191-v1/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --input-type=module <<'WM_DIAG_191'
import {readFile,writeFile,unlink} from 'node:fs/promises';
const file='./dist/src/cloud-browser-runtime.diagnostic-191.js';
try{
 const raw=(await readFile('./dist/src/cloud-browser-runtime.js','utf8')).replace('catch {\n        cached = undefined;','catch (e) {\n        console.error(e); cached = undefined;');
 await writeFile(file,raw,{flag:'wx'});
 const m=await import(file);await m.checkedCloudBrowserRuntime();console.log('CONTRACT_OK');
}finally{await unlink(file);}
WM_DIAG_191
