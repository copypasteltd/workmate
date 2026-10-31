"""Package the tested clients under new names without changing frozen installers."""
from pathlib import Path
from hashlib import sha256
import json, zipfile

ROOT=Path(__file__).resolve().parents[3]
out=ROOT/'dev/copypaste-delivery/.data/deployment-177'
native=json.loads((out/'native-941cd5d9-8ee4-4cf4-aa4f-7ca809d0759e/receipt.json').read_bytes())
assert native['status']=='passed' and native['owned_windows_closed']
desktop=ROOT/'dev/copypaste-desktop/.data/deployment-177/release'
extension=ROOT/'dev/copypaste-extension'
rows=[]
for name in ['CopyPaste-0.7.2-x64-Portable.exe','CopyPaste-0.7.2-x64-Setup.exe']:
    p=desktop/name
    rows.append({'file':name,'bytes':p.stat().st_size,'sha256':sha256(p.read_bytes()).hexdigest(),'signed':False})
archive=out/'CopyPaste-Extension-0.5.3.zip'
entries=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted((extension/'dist').rglob('*')):
        if not p.is_file():continue
        raw=p.read_bytes();name=p.relative_to(extension/'dist').as_posix();z.writestr(name,raw)
        entries.append({'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
rows.append({'file':archive.name,'bytes':archive.stat().st_size,'sha256':sha256(archive.read_bytes()).hexdigest(),'extension_id':'fffkcnmfdhahlnifgdilabheppkgnlok'})
manifest={'stage':177,'files':rows,'extension_entries':entries,'native_qualification':native,'credentials_included':False,
 'origins':{'api':'https://ai-api.copypaste.hk','web':'https://agent.copypaste.hk','admin':'https://agent-dashboard.copypaste.hk'}}
with (out/'workmate-domain-clients-177.json').open('x',encoding='utf-8') as f:json.dump(manifest,f,indent=2)
with (out/'workmate-domain-clients-177.sha256').open('x',encoding='utf-8',newline='\n') as f:
    for row in rows:f.write(row['sha256']+'  '+row['file']+'\n')
print(json.dumps({'stage':177,'files':rows}))
