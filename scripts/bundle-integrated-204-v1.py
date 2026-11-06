from pathlib import Path
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
 manifest={'stage':204,'schema_version':165,'files':files};z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
(out/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':'bundled','files':len(files),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
