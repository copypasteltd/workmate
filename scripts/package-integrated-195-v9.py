"""Package one immutable, secret-free integration candidate."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1];dev=root.parent
out=root/'.data/deployment-195';out.mkdir(parents=True,exist_ok=True)
archive=out/'integrated-195-v9.zip';rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for component,folders in [('backend',['src','dist','migrations','contracts','scripts']),('web',['dist']),('admin',['dist'])]:
  base=dev/('copypaste-platform' if component=='backend' else 'copypaste-'+component)
  files=[p for folder in folders for p in (base/folder).rglob('*') if p.is_file()]
  if component=='backend':files += [base/'package.json',base/'package-lock.json']
  for p in sorted(files):
   assert not p.is_symlink() and '.env' not in p.parts and '.data' not in p.parts
   name=component+'/'+p.relative_to(base).as_posix();data=p.read_bytes();z.writestr(name,data)
   rows.append(dict(path=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
 for p in [root/'scripts/qualify-office-integrated-195-v2.mjs']:
  data=p.read_bytes();name='tools/'+p.name;z.writestr(name,data);rows.append(dict(path=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
 manifest=dict(stage=195,schema_version=163,files=rows)
 z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
hash=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.zip.sha256').write_text(hash+'  '+archive.name+'\n')
print(json.dumps(dict(archive=str(archive),files=len(rows),sha256=hash)))
