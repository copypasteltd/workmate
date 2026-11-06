"""Validate delivered guides, exact evidence scope, preserved sources and owned cleanup."""
from pathlib import Path
import hashlib,json,re
root=Path(__file__).resolve().parents[2];dev=root/'dev';delivery=dev/'copypaste-delivery';out=root/'docs/quality/integrated-round-202'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(delivery/'.data/acceptance-193/baseline/receipt.json')['preserved_untracked']
for rel,digest in protected.items():assert (root/rel).is_file() and sha(root/rel)==digest,rel
cleanup=load(out/'runtime-cleanup.json');assert cleanup['status']=='passed'
for field in ['owned_browsers_remaining','owned_desktop_instances_remaining','owned_db_helpers_remaining','owned_qa_transports_remaining']:assert cleanup[field]==0
summary=load(out/'test-summary.json');assert summary['total']==sum(summary['counts'].values()) and summary['counts']['copypaste-platform']>=147
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 folder=dev/('copypaste-'+name)
 for filename in ['README.md','README.en.md']:
  p=folder/filename;text=p.read_text('utf8');assert text.startswith('<!-- integrated-round-202 -->');current=text.split('<!-- integrated-round-201 -->',1)[0];assert '```mermaid' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  if name in ['web','admin','desktop','extension']:assert all(any(v.endswith(ext) for v in links) for ext in ['.png','.gif','.mp4'])
  for rel in links:assert (folder/rel).is_file(),rel
  if name in ['admin','extension']:assert '198' in current
  readmes.append({'path':p.relative_to(root).as_posix(),'sha256':sha(p),'current_media':links})
for r in load(out/'actual-media.json')['files']:assert sha(dev/r['path'])==r['sha256']
manifest=load(out/'final-source-manifest.json');assert len(manifest['production_source_files'])==823 and len(manifest['supplemental_native_preloads'])==3
for r in manifest['production_source_files']+manifest['supplemental_native_preloads']:assert sha(root/r['path'])==r['sha256'],r['path']
assert sha(out/'implementation-batch.json')==manifest['original_prebuild_snapshot_sha256']
overlay=load(out/'requirements-overlay.json');assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id'] for r in overlay['requirements']})==102;assert not any(g['round202_full_acceptance_closed'] for g in overlay['groups'])
versions={n:load(dev/('copypaste-'+n)/'package.json')['version'] for n in ['platform','web','admin','desktop','extension','delivery']};assert versions=={'platform':'0.5.10','web':'0.5.11','admin':'0.5.2','desktop':'0.7.15','extension':'0.5.7','delivery':'0.5.9'}
assert load(out/'network-preserved.json')['network_configuration_unchanged'];assert load(out/'deployment.json')['deployment']['backend_root'].endswith('integrated-202-v2/backend')
assert load(dev/'copypaste-web/contracts/product-downloads.json')==load(out/'public-downloads.json')['catalog']
for name in ['verification.json','live-production-journey.json','isolated-production-journey.json','public-downloads.json','inner-downloads.json']:assert load(out/name).get('status')=='passed'
live=load(out/'live-production-journey.json');assert len(live['downloads'])==6 and live['native_diagnostics']['errors']==[]
for format in ['html','csv','json']:
 rows=[r for r in live['downloads'] if r['format']==format];assert len(rows)==2 and len({(r['bytes'],r['sha256']) for r in rows})==1
for p in out.rglob('*.json'):
 text=p.read_text('utf8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),p.name
for p in [root/'docs/development/202-marketing-review.md',root/'docs/requirements/202-marketing-review-round.md',root/'docs/changes/202-marketing-review.md',out/'README.md']:
 for rel in re.findall(r'\]\(([^)]+)\)',p.read_text('utf8')):
  if '://' not in rel and not rel.startswith('#'):assert (p.parent/rel.split('#')[0]).exists(),(p.name,rel)
report={'stage':202,'status':'passed','scope':'Current twelve bilingual component guides, actual media/source/preload hashes, exact related-test counts, real clients/downloads, network preservation, versions, all102 requirements/32 groups and protected files/owned cleanup. No whole historical/professional/production acceptance claim.','versions':versions,'readmes':readmes,'protected_files_preserved':len(protected),'related_assertions':summary['total'],'runtime_cleanup':cleanup}
(out/'documentation-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'status':'passed','readmes':12,'assertions':summary['total'],'protected_files':len(protected)}))
