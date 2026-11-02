#!/usr/bin/env bash
set -euo pipefail
cd /opt/workmate/overlays/real-services-189-v2/backend
/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module <<'WM_IMAGE_DECODER_189'
import {PNG} from 'pngjs';
import {validateVerificationPNG} from './dist/src/png-validation.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const image=new PNG({width:1024,height:1024});image.data.fill(255);
const bytes=PNG.sync.write(image);
const report={stage:189,scope:'Read-only decoder self-check with an explicit synthetic white PNG; no API call and no model qualification',node:process.version,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
try{validateVerificationPNG(bytes);report.status='passed';}catch(error){report.status='failed';report.error_class=error.constructor.name;report.error_code=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:null;report.decoder_error=String(error.message).slice(0,200);}
const file='/root/cfg/workmate/live-189-v2/image-decoder-'+randomUUID()+'.sanitized.json';await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,receipt:file}));
WM_IMAGE_DECODER_189
