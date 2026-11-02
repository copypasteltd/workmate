from pathlib import Path
from hashlib import sha256
import json,zipfile
ROOT=Path(__file__).resolve().parents[3];WEB=ROOT/'dev/copypaste-web';OUT=ROOT/'dev/copypaste-delivery/.data/deployment-187';OUT.mkdir(parents=True,exist_ok=True)
archive=OUT/'web-scroll-187-v1.zip';rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted((WEB/'dist').rglob('*')):
  if p.is_file():
   raw=p.read_bytes();name=p.relative_to(WEB/'dist').as_posix();z.writestr(name,raw);rows.append({'path':name,'sha256':sha256(raw).hexdigest(),'bytes':len(raw)})
 m={'stage':187,'files':rows,'sources':{n:sha256((WEB/n).read_bytes()).hexdigest() for n in ['src/main.tsx','src/scroll-surfaces.css','src/style.css']}}
 z.writestr('manifest.json',json.dumps(m,indent=2)+'\n')
digest=sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf8',newline='\n') as f:f.write(digest+'\n')
with (OUT/'package-v1.json').open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps({'archive':archive.name,'sha256':digest,'bytes':archive.stat().st_size,'files':len(rows),'sources':m['sources']},indent=2)+'\n')
print(json.dumps({'archive':archive.name,'bytes':archive.stat().st_size,'files':len(rows),'sha256':digest}))
