"""Additive source/runtime handoff over the published stage177 baseline."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,zipfile
ROOT=Path(__file__).resolve().parents[3];D=ROOT/'dev/copypaste-delivery';P=D/'.data/deployment-178'
names=json.loads((P/'publication-paths.json').read_bytes())
comp={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
pubs=sorted(P.glob('publication-*/receipt.json'),key=lambda p:p.stat().st_mtime)
publication=json.loads(pubs[-1].read_bytes());assert publication['status']=='published_and_verified'
files={}
for b,paths in names.items():
 repo=ROOT if b=='docs' else ROOT/'dev'/('copypaste-'+comp[b])
 for name in paths:
  p=repo/name;files[p.relative_to(ROOT).as_posix()]=p
for name in ['workmate-model-connections-178.zip','workmate-model-connections-178.zip.sha256']:
 files['runtime/'+name]=P/name
files['publication.sanitized.json']=pubs[-1]
secrets=json.loads((P/'qa-login-context.json').read_bytes())
private=[str(v).encode() for k,v in secrets.items() if k.endswith(('_password','_secret'))]
archive=P/'workmate-model-configuration-178.zip';rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name,p in sorted(files.items()):
  raw=p.read_bytes();assert not any(s in raw for s in private),'Private credential excluded'
  z.writestr(name,raw);rows.append({'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
 z.writestr('manifest.json',json.dumps({'stage':178,'at':datetime.now(timezone.utc).isoformat(),'kind':'model_configuration_additive_source_and_runtime','base_release':'v0.1.3','previous_increment':'workmate-domains-177.zip','files':rows,'publication_refs':publication['verified_refs'],'credentials_included':False},ensure_ascii=False,indent=2)+'\n')
 z.writestr('HANDOFF.md','# Per-model API configuration / 每个模型的接口与密钥\n\nRead docs/releases/model-connections-178.md. Apply this additive patch over the frozen v0.1.3 and subsequent stage176/stage177 increments. Source paths match the independent repositories. runtime/ contains the deployed schema157 backend and complete Web/Admin builds. This increment does not replace native installers or certify a real supplier. Keys are deliberately excluded.\n\n本包是在 v0.1.3 与阶段176／177之上的增量；按 dev/ 的独立仓库路径叠加文件并保留其他源码。runtime/ 包含实际部署的后端、迁移157和完整 Web／Admin 构建。后台每个模型独立配置地址及密钥。现有客户端继续访问公司接口，无需供应商密钥。\n')
h=sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8',newline='\n') as f:f.write(h+'  '+archive.name+'\n')
with (P/'handoff-package.sanitized.json').open('x',encoding='utf-8') as f:json.dump({'stage':178,'artifact':archive.name,'bytes':archive.stat().st_size,'sha256':h,'files':len(rows)},f,indent=2)
print(json.dumps({'status':'packaged','bytes':archive.stat().st_size,'sha256':h,'files':len(rows)}))
