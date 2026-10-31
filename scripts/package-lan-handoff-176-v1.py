"""Package the explicit LAN increment after branch publication; never rewrite v0.1.3."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[3];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-176'
archive=P/'workmate-lan-deployment-176.zip';assert not archive.exists();files={}
def add(p,name=None):
 assert p.is_file();name=name or p.relative_to(ROOT).as_posix();assert name not in files;files[name]=p
for client in ['web','admin']:
 repo=DEV/('copypaste-'+client)
 for folder in ['src','tests','public']:
  for p in sorted((repo/folder).rglob('*')):
   if p.is_file():add(p,'sources/'+client+'/'+p.relative_to(repo).as_posix())
 for p in sorted(repo.iterdir()):
  if p.is_file() and (p.name.startswith(('package','tsconfig','vite.config')) or p.name=='index.html'):add(p,'sources/'+client+'/'+p.name)
 for folder,pattern in [('assets/screenshots','176*.png'),('assets/demos','176-lan-http.*')]:
  for p in sorted((repo/folder).glob(pattern)):add(p)
for component in ['platform','web','admin','desktop','extension','delivery']:
 for name in ['README.md','README.en.md']:add(DEV/('copypaste-'+component)/name)
for p in sorted((D/'scripts').glob('*176*')):
 if p.is_file():add(p)
for p in sorted((D/'evidence/lan-deployment-176').iterdir()):
 if p.is_file():add(p)
add(D/'tests/public-config-session-176.test.ts')
for name in ['releases/lan-176.md','development/176-lan-http-deployment.md','changes/176-lan-http-deployment.md','requirements/32-lan-http-deployment.md','quality/lan-deployment-176.json']:add(ROOT/'docs'/name)
for p in sorted((ROOT/'docs/assets/lan-176').iterdir()):add(p)
add(P/'workmate-lan-http-176-v2.zip','runtime/workmate-lan-http-176-v2.zip');add(P/'workmate-lan-http-176-v2.zip.sha256','runtime/workmate-lan-http-176-v2.zip.sha256')
publications=sorted(P.glob('publication-*/receipt.json'),key=lambda p:p.stat().st_mtime);assert publications
publication=json.loads(publications[-1].read_bytes());assert publication['status']=='published_and_verified';add(publications[-1],'publication.sanitized.json')
rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name,p in sorted(files.items()):
  raw=p.read_bytes();z.writestr(name,raw);rows.append({'path':name,'bytes':len(raw),'sha256':sha256(raw).hexdigest()})
 manifest={'stage':176,'at':datetime.now(timezone.utc).isoformat(),'kind':'incremental_LAN_deployment_handoff','base':'workmate-v0.1.3-complete.zip','base_sha256':'cdb87da0ce9a74150ee6016d4263e1b0ce2b0c5f905effc21ce6a033c18b56e7','frontend_increment':'lan-http-176-v2','publication_refs':publication['verified_refs'],'files':rows,'credentials_included':False}
 z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 z.writestr('HANDOFF.md','# Workmate LAN deployment / 内网部署\n\nRead docs/releases/lan-176.md for access, OTP/TOTP login, credentials location and operations.\n\n本包是原 v0.1.3 完整包之上的明确增量；原始六仓完整源码及 Windows 安装包保留在服务器 /opt/workmate/sources 和 /opt/workmate/downloads。sources/web、sources/admin 是本轮完整可构建前端；dev/ 下保存更新说明、真实媒体及部署脚本。凭据仅在服务器 /root/cfg/workmate/，不随此包分发。\n\nThis is an explicit increment over the immutable complete v0.1.3 bundle. The original six buildable source trees and native installers remain on the server. sources/web and sources/admin contain the current complete frontend build inputs. Deployment scripts, updated repository guides and actual recordings are included. Credentials are stored only under server /root/cfg/workmate/ and are excluded from this artifact.\n')
checksum=sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8',newline='\n') as f:f.write(checksum+'  '+archive.name+'\n')
with (P/'handoff-package.sanitized.json').open('x',encoding='utf-8') as f:json.dump({'stage':176,'artifact':archive.name,'bytes':archive.stat().st_size,'sha256':checksum,'files':len(rows)},f,indent=2)
print(json.dumps({'phase':'handoff_packaged','artifact':archive.name,'bytes':archive.stat().st_size,'sha256':checksum,'files':len(rows)}))
