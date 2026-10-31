"""Publish a precise source patch over v0.1.3 plus stage176, not a replacement freeze."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,zipfile
ROOT=Path(__file__).resolve().parents[3];D=ROOT/'dev/copypaste-delivery';P=D/'.data/deployment-177'
names=json.loads((P/'publication-paths.json').read_bytes())
repos={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
files={}
for branch,paths in names.items():
 repo=ROOT if branch=='docs' else ROOT/'dev'/('copypaste-'+repos[branch])
 for name in paths:
  file=repo/name;key=file.relative_to(ROOT).as_posix();assert key not in files;files[key]=file
for name in ['workmate-domain-runtime-177.zip','workmate-domain-frontends-177.zip','workmate-domain-frontends-177.zip.sha256','CopyPaste-Extension-0.5.3.zip','workmate-domain-clients-177.json','workmate-domain-clients-177.sha256']:
 files['runtime/'+name]=P/name
publications=sorted(P.glob('publication-*/receipt.json'),key=lambda p:p.stat().st_mtime)
publication=json.loads(publications[-1].read_bytes());assert publication['status']=='published_and_verified'
files['publication.sanitized.json']=publications[-1]
private=json.loads((P/'qa-login-context.json').read_bytes())
sensitive=[str(v).encode() for k,v in private.items() if k.endswith(('_secret','_password'))]
rows=[];archive=P/'workmate-domains-177.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name,p in sorted(files.items()):
  raw=p.read_bytes();assert not any(v in raw for v in sensitive),'No private credential may enter the handoff'
  z.writestr(name,raw);rows.append({'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
 manifest={'stage':177,'at':datetime.now(timezone.utc).isoformat(),'kind':'public_domain_additive_source_patch','base_release':'v0.1.3','base_sha256':'cdb87da0ce9a74150ee6016d4263e1b0ce2b0c5f905effc21ce6a033c18b56e7','previous_increment':'workmate-lan-deployment-176.zip','files':rows,'publication_refs':publication['verified_refs'],'credentials_included':False,'native_installers':'Separate new 0.7.2 Setup/Portable downloads, exact hashes in runtime/workmate-domain-clients-177.json'}
 z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 z.writestr('HANDOFF.md','# Workmate public domains / 正式域名增量\n\nRead docs/releases/domains-177.md. This archive is an additive patch over the immutable complete v0.1.3 bundle and stage176 deployment. Overlay dev/copypaste-* files onto their matching repositories; preserve unchanged files and rebuild with the included lockfiles. Backend compiled overlay and complete current frontend source/build archives are under runtime/. New Desktop installers are separate public downloads with exact SHA256 hashes. The unpacked Extension ZIP is included.\n\n本包补充原 v0.1.3 及阶段176，不能单独替代冻结全量源码；按 dev/ 各仓相对路径叠加变更，保留未变化文件后使用原锁文件构建。runtime/ 提供后端编译增量和完整前端构建/源码。新版 Desktop 安装包单独下载，摘要见清单；扩展安装包已包含。凭据仅在服务器 /root/cfg/workmate/，不随本包分发。\n')
digest=sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8',newline='\n') as f:f.write(digest+'  '+archive.name+'\n')
with (P/'handoff-package.sanitized.json').open('x') as f:json.dump({'stage':177,'artifact':archive.name,'bytes':archive.stat().st_size,'sha256':digest,'files':len(rows)},f,indent=2)
print(json.dumps({'artifact':archive.name,'bytes':archive.stat().st_size,'sha256':digest,'files':len(rows)}))
