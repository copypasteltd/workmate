"""Create a public-only client bundle/catalog, retaining the released Desktop bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,zipfile

delivery=Path(__file__).resolve().parents[1];root=delivery.parents[1];dev=delivery.parent
out=delivery/'.data/deployment-196';out.mkdir(parents=True,exist_ok=True)
public=out/'downloads';public.mkdir(exist_ok=True)
released={'artifacts': []}
desktop=dev/'copypaste-desktop/.data/deployment-196-v2/release'
extension=dev/'copypaste-extension';manifest=json.loads((extension/'dist/manifest.json').read_bytes())
version=json.loads((extension/'package.json').read_bytes())['version'];assert manifest['version']==version=='0.5.5'
assert manifest['manifest_version']==3 and manifest['side_panel']['default_path']=='sidepanel.html'
assert 'default_popup' not in manifest['action'] and manifest['host_permissions']==['https://ai-api.copypaste.hk/*']
extension_id=(extension/'extension-id.txt').read_text().strip();assert len(extension_id)==32 and all('a'<=c<='p' for c in extension_id)
archive=public/f'CopyPaste-Extension-{version}.zip';archive.write_bytes((delivery/'.data/deployment-195/downloads'/archive.name).read_bytes());entries=json.loads((delivery/'.data/deployment-195/package-receipt.private.json').read_text())['extension_entries']
catalog={'schema_version':1,'published_at':datetime.now(timezone.utc).isoformat(),'desktop':{'version':'0.7.6','platform':'windows-x64','signed':False,'artifacts':[]},'extension':{'version':version,'minimum_chrome_version':manifest['minimum_chrome_version'],'extension_id':extension_id,'installation':'unpacked','store_url':None,'artifact':{}},'checksums_url':'/downloads/releases/196/SHA256SUMS.txt'}
sources={}
for p in [desktop/'CopyPaste-0.7.6-x64-Setup.exe',desktop/'CopyPaste-0.7.6-x64-Portable.exe']:
 assert p.is_file();raw=p.read_bytes();released['artifacts'].append({'name':p.name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
for row in released['artifacts']:
 p=desktop/row['name'];raw=p.read_bytes();assert len(raw)==row['bytes'] and sha256(raw).hexdigest()==row['sha256']
 catalog['desktop']['artifacts'].append({'kind':'setup' if '-Setup.' in row['name'] else 'portable','name':row['name'],'bytes':row['bytes'],'sha256':row['sha256'],'url':'/downloads/releases/196/'+row['name']});sources[row['name']]=str(p)
raw=archive.read_bytes();catalog['extension']['artifact']={'name':archive.name,'bytes':len(raw),'sha256':sha256(raw).hexdigest(),'url':'/downloads/releases/196/'+archive.name};sources[archive.name]=str(archive)
rows=[*catalog['desktop']['artifacts'],catalog['extension']['artifact']]
sums=public/'SHA256SUMS.txt';sums.write_text(''.join(r['sha256']+'  '+r['name']+'\n' for r in rows),encoding='utf8',newline='\n');sources[sums.name]=str(sums)
target=dev/'copypaste-web/contracts/product-downloads.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
receipt={'stage':196,'status':'prepared','catalog':catalog,'catalog_sha256':sha256(target.read_bytes()).hexdigest(),'artifact_sources':sources,'extension_entries':entries,'desktop_source_and_package_versions_aligned':True,'public_files':[{'name':name,'bytes':Path(source).stat().st_size,'sha256':sha256(Path(source).read_bytes()).hexdigest()} for name,source in sources.items()]}
(out/'package-receipt.private.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'status':'prepared','desktop_version':'0.7.6','extension_version':version,'public_artifacts':len(rows),'extension_bytes':len(raw)}))
