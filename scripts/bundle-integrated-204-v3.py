from pathlib import Path
import hashlib,json,zipfile,re,posixpath
R=Path(__file__).resolve().parents[2];L=R/'copypaste-delivery';out=L/'.data/deployment-204-v1';out.mkdir(parents=True,exist_ok=True)
assert json.loads((out/'release-metadata-validation.json').read_text())['status']=='passed'
files=[];sources=[]
for component,folders,names in [('backend',['src','dist','migrations','scripts','contracts'],['package.json','package-lock.json']),('web',['dist'],[]),('admin',['dist'],[])]:
 base=R/('copypaste-platform' if component=='backend' else 'copypaste-'+component)
 for folder in folders:
  sources.extend((component,base,p) for p in (base/folder).rglob('*') if p.is_file() and p.suffix not in ['.map'] and '.data' not in p.relative_to(base).parts and 'node_modules' not in p.relative_to(base).parts and p.relative_to(base).parts[:2]!=('dist','tests'))
 sources.extend((component,base,base/n) for n in names)
relative={component+'/'+p.relative_to(base).as_posix() for component,base,p in sources}
modules={component+'/'+p.relative_to(base).as_posix():p for component,base,p in sources if component=='backend' and p.suffix in ['.js','.mjs','.cjs'] and p.relative_to(base).parts[0]=='dist'}
pending=[rel for rel in modules if rel.startswith('backend/dist/src/')]+['backend/dist/scripts/migration-runner.js'];seen=set();imports=[]
while pending:
 rel=pending.pop()
 if rel in seen:continue
 seen.add(rel);assert rel in modules,rel
 for match in re.finditer(r"(?:\bfrom\s*|\bimport\s*\(?\s*)[\"'](\.[^\"']+)[\"']",modules[rel].read_text('utf-8')):
  target=posixpath.normpath(posixpath.join(posixpath.dirname(rel),match[1]));assert target in relative,(rel,match[1],target)
  imports.append({'from':rel,'to':target})
  if target in modules:pending.append(target)
assert 'backend/dist/contracts/task-schemas.json' in relative and len(imports)>100
archive=out/'integrated-204-v3.zip';assert not archive.exists()
with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for component,base,p in sources:
  assert not p.is_symlink();raw=p.read_bytes();rel=component+'/'+p.relative_to(base).as_posix();z.writestr(rel,raw);files.append({'path':rel,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 manifest={'stage':204,'schema_version':165,'static_runtime_imports':imports,'files':files};z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
(out/'candidate-manifest-v3.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':'bundled','files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
