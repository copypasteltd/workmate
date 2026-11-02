from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[3]
source=root/'dev/copypaste-admin/dist'
archive=root/'dev/copypaste-delivery/.data/deployment-189/workmate-admin-termination-189-v1.zip'
rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as output:
 for file in sorted(source.rglob('*')):
  if not file.is_file():continue
  raw=file.read_bytes();name=file.relative_to(source).as_posix()
  output.writestr(name,raw);rows.append({'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 output.writestr('manifest.json',json.dumps({'stage':189,'scope':'Admin termination-only evidence; unknown fees remain reserved','files':rows},indent=2)+'\n')
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf8',newline='\n') as stream:stream.write(digest+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'sha256':digest,'files':len(rows),'bytes':archive.stat().st_size}))
