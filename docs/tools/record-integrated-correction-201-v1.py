"""Collect the complete first-build correction; preserve the failed run and source baseline."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
root=Path(__file__).resolve().parents[2];dev=root/'dev';quality=root/'docs/quality/integrated-round-201'
baseline=json.loads((quality/'implementation-batch.json').read_text('utf8'));changed=[]
for name in ['video-projects.tsx','motion-production.tsx']:
 p=dev/'copypaste-desktop/renderer/src'/name;b=p.read_bytes();s=b.decode('utf8');needle='import { browserCrypto as crypto } from "./browser-crypto";\n';assert s.count(needle)==1
 p.write_text(s.replace(needle,''),encoding='utf8',newline='\n');changed.append({'path':p.relative_to(root).as_posix(),'before_sha256':hashlib.sha256(b).hexdigest(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
for row in baseline['production_source_files']:
 p=root/row['path'];digest=hashlib.sha256(p.read_bytes()).hexdigest();assert digest==next((c['sha256'] for c in changed if c['path']==row['path']),row['sha256']);row['sha256']=digest;row['bytes']=p.stat().st_size
baseline.update(at=datetime.now(timezone.utc).isoformat(),reason='The shared Web editor imported the Web HTTP-origin crypto adapter. The native Electron renderer already provides secure Web Crypto; remove both Web-only imports without changing native execution.',changes=changed,original_failed_receipt='dev/copypaste-delivery/.data/integrated-201-v1/verification.json')
(quality/'post-build-code-batch.json').write_text(json.dumps(baseline,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
p=dev/'copypaste-delivery/scripts/verify-integrated-round-201-v2.mjs';assert not p.exists();s=(p.with_name('verify-integrated-round-201-v1.mjs')).read_text('utf8').replace('.data/integrated-201-v1','.data/integrated-201-v2').replace('integrated-round-201/implementation-batch.json','integrated-round-201/post-build-code-batch.json');p.write_text(s,encoding='utf8',newline='\n')
print(json.dumps({'complete_build_correction_files':len(changed),'original_failure_retained':True}))
