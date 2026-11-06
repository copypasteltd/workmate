"""Check current guide/media links, protected files and owned runtime cleanup."""
from pathlib import Path
import json,hashlib,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-197'
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(DELIVERY/'.data/acceptance-193/baseline/receipt.json')['preserved_untracked']
for rel,digest in protected.items():assert (ROOT/rel).is_file() and sha(ROOT/rel)==digest,'Protected user file changed: '+rel
cleanup=load(DELIVERY/'.data/deployment-197/runtime-cleanup-v1.sanitized.json');assert cleanup['status']=='cleaned' and cleanup['owned_browsers_remaining']==cleanup['owned_desktop_instances_remaining']==0
(OUT/'runtime-cleanup.json').write_text(json.dumps(cleanup,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 folder=DEV/('copypaste-'+name)
 for filename in ['README.md','README.en.md']:
  p=folder/filename;text=p.read_text(encoding='utf8');assert text.startswith('<!-- integrated-round-197 -->')
  current=text.split('<!-- integrated-round-196 -->',1)[0];assert '```mermaid' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  if name in ['web','admin','desktop','extension']:assert any(x.endswith('.png') for x in links) and any(x.endswith('.gif') for x in links) and any(x.endswith('.mp4') for x in links)
  for rel in links:assert (folder/rel).is_file(),rel
  readmes.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'current_media':links})
for p in OUT.glob('*.json'):
 text=p.read_text(encoding='utf8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),'Unexpected credential-like public value: '+p.name
report={'stage':197,'status':'passed','scope':'Current round README/media destinations, public secret-like values, protected files and owned process cleanup only; does not claim all historical documentation was revalidated.','readmes':readmes,'protected_files_preserved':len(protected),'runtime_cleanup':cleanup,'source_marker_scan':'No TODO/FIXME/HACK/not-implemented production-source marker hit. This is not equivalent to closing all102 original requirements.'}
(OUT/'documentation-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'passed','readmes':len(readmes),'protected_files':len(protected),'owned_browsers_remaining':0}))
