"""Check the final documented release, preserved sources and owned cleanup."""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-200'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(DEL/'.data/acceptance-193/baseline/receipt.json')['preserved_untracked']
for rel,digest in protected.items():assert (ROOT/rel).is_file() and sha(ROOT/rel)==digest,rel
cleanup=load(DEL/'.data/deployment-200-v2/final-owned-process-check-v3.sanitized.json');assert cleanup['status']=='cleaned'
assert cleanup['owned_browsers_remaining']==cleanup['owned_desktop_instances_remaining']==cleanup['owned_db_helpers_remaining']==cleanup['owned_qa_transports_remaining']==0
(OUT/'runtime-cleanup.json').write_text(json.dumps(cleanup,ensure_ascii=False,indent=2)+'\n','utf-8')
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 folder=DEV/('copypaste-'+name)
 for filename in ['README.md','README.en.md']:
  p=folder/filename;text=p.read_text('utf-8');assert text.startswith('<!-- integrated-round-200 -->');current=text.split('<!-- integrated-round-199 -->',1)[0];assert '```mermaid' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  if name in ['web','admin','desktop','extension']:assert all(any(x.endswith(ext) for x in links) for ext in ['.png','.gif','.mp4'])
  for rel in links:assert (folder/rel).is_file(),rel
  if name in ['admin','extension']:assert '198' in current,'Unchanged-client historical media must remain labelled'
  readmes.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'current_media':links})
for r in load(OUT/'actual-media.json')['files']:assert sha(DEV/r['path'])==r['sha256']
for r in load(OUT/'final-source-manifest.json')['final_reviewed_source_manifest']:assert sha(ROOT/r['path'])==r['sha256'],r['path']
assert sha(OUT/'implementation-batch.json')==load(OUT/'final-source-manifest.json')['original_prebuild_manifest_sha256']
overlay=load(OUT/'requirements-overlay.json');assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id'] for r in overlay['requirements']})==102
assert not any(g['round200_full_acceptance_closed'] for g in overlay['groups'])
versions={n:load(DEV/('copypaste-'+n)/'package.json')['version'] for n in ['platform','web','admin','desktop','extension','delivery']}
assert versions=={'platform':'0.5.8','web':'0.5.9','admin':'0.5.2','desktop':'0.7.13','extension':'0.5.7','delivery':'0.5.7'}
catalog=load(DEV/'copypaste-web/contracts/product-downloads.json');assert catalog==load(OUT/'public-downloads.json')['catalog'];assert catalog['desktop']['version']==versions['desktop'] and catalog['extension']['version']==versions['extension']
assert load(OUT/'test-summary.json')['total']==631
for p in OUT.rglob('*.json'):
 text=p.read_text('utf-8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),p.name
for p in [ROOT/'docs/development/200-design-production.md',ROOT/'docs/requirements/200-design-production-round.md',ROOT/'docs/changes/200-design-production.md',OUT/'README.md']:
 for rel in re.findall(r'\]\(([^)]+)\)',p.read_text('utf-8')):
  if '://' not in rel and not rel.startswith('#'):assert (p.parent/rel.split('#')[0]).exists(),(p.name,rel)
report={'stage':200,'status':'passed','scope':'Current bilingual guides, actual media/source hashes, release/catalog versions, all102 requirements/32 groups, protected files and owned cleanup. Not whole historical documentation, professional or production qualification.','versions':versions,'readmes':readmes,'protected_files_preserved':len(protected),'runtime_cleanup':cleanup}
(OUT/'documentation-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'status':'passed','readmes':12,'tests':631,'protected_files':len(protected),'versions':versions}))
