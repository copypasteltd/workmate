#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_DIAG_195'
from pathlib import Path
import subprocess
root=Path('/opt/workmate/overlays/integrated-195-v3/backend')
source=r'''
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';import path from 'node:path';import {pathToFileURL} from 'node:url';import {zipSync,strToU8} from 'fflate';
const d=path.resolve('.data/document-preview/diagnostic-195-v1'),runtime=JSON.parse(await readFile('.data/document-preview/runtime.json'));
await mkdir(d);for(const n of ['profile','output'])await mkdir(path.join(d,n));
const entries={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Controlled Office diagnostic 195</w:t></w:r></w:p></w:body></w:document>'};
const input=path.join(d,'input.docx');await writeFile(input,zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)]))));
const c=spawn(runtime.host_path,[String(process.pid),runtime.office_path,pathToFileURL(path.join(d,'profile')).href,path.join(d,'output'),input,d],{stdio:['ignore','pipe','pipe']});let output='';for(const s of [c.stdout,c.stderr])s.on('data',b=>output+=b.toString());c.on('close',async code=>{await writeFile(path.join(d,'converter.log'),output);console.log(JSON.stringify({code,controlled_fixture_diagnostic:output.slice(0,4000),directory:d}));});
'''
p=root/'scripts/diagnose-office-195-v1.mjs';assert not p.exists();p.write_text(source);p.chmod(0o644)
subprocess.run(['runuser','-u','workmate','--','/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node',str(p)],cwd=root,check=True)
WM_DIAG_195
