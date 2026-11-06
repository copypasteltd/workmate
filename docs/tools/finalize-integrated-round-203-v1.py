"""Validate current guides, original scope, source/media hashes and final receipts."""
from pathlib import Path
import hashlib,json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-203'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(L/'.data/acceptance-203/baseline/receipt.json')['preserved_untracked']
for path,digest in protected.items():assert sha(R/path)==digest,path
summary=load(Q/'test-summary.json');assert summary['total']==sum(summary['counts'].values())==688
manifest=load(Q/'final-source-manifest.json');assert len(manifest['production_source_files'])==829 and sha(Q/'implementation-batch.json')==manifest['prebuild_snapshot_sha256']
for row in manifest['production_source_files']:assert sha(R/row['path'])==row['sha256'],row['path']
actual_media=load(Q/'actual-media.json')['files'];assert len(actual_media)==9
for row in actual_media:assert sha(D/row['path'])==row['sha256'] and Path(row['path']).stem.endswith('-live')
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 for filename in ['README.md','README.en.md']:
  p=D/('copypaste-'+name)/filename;text=p.read_text('utf-8');assert text.startswith('<!-- integrated-round-203 -->');current=text.split('<!-- integrated-round-202 -->',1)[0];assert '```mermaid' in current and 'integrated-round-203' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  for link in links:assert (p.parent/link).is_file(),link
  if name in ['web','desktop','admin','extension']:assert all(any(x.endswith(s) for x in links) for s in ['.png','.gif','.mp4'])
  if name in ['web','desktop']:assert all('203-v4' in x for x in links)
  if name in ['admin','extension']:assert '198' in current
  readmes.append({'path':p.relative_to(R).as_posix(),'sha256':sha(p),'current_media':links})
versions={n:load(D/('copypaste-'+n)/'package.json')['version'] for n in ['platform','web','admin','desktop','extension','delivery']};assert versions=={'platform':'0.5.10','web':'0.5.12','admin':'0.5.2','desktop':'0.7.16','extension':'0.5.7','delivery':'0.5.10'}
overlay=load(Q/'requirements-overlay.json');old=load(R/'docs/quality/integrated-round-202/requirements-overlay.json');assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id'] for r in overlay['requirements']})==102
assert not any(g['round203_full_acceptance_closed'] for g in overlay['groups'])
for prior,current in zip(old['requirements'],overlay['requirements']):assert {k:v for k,v in current.items() if k!='round203_overlay'}==prior
for prior,current in zip(old['groups'],overlay['groups']):assert {k:v for k,v in current.items() if not k.startswith('round203_')}==prior
for name in ['verification.json','live-production-journey.json','isolated-production-journey.json','public-downloads.json','inner-downloads.json','network-preserved.json','runtime-cleanup.json']:assert load(Q/name)['status']=='passed',name
deployment=load(Q/'deployment.json');assert deployment['static']['api_restarted'] is False and deployment['static']['network_configuration_unchanged'] and deployment['runtime_materialization']['network_configuration_unchanged']
assert load(Q/'network-preserved.json')['network_configuration_unchanged']
services=load(Q/'final-service-state.json');assert services['status']=='passed' and services['network_configuration_files_equal']==9 and services['credentials_preserved'] and services['same_api_database_proxy_pids'] and services['server_network_writes'] is False
public=load(Q/'public-downloads.json');assert load(D/'copypaste-web/contracts/product-downloads.json')==public['catalog'];assert all(r['status']=='complete_verified' for r in public['public']['downloads'])
cleanup=load(Q/'runtime-cleanup.json')
for field in ['owned_browsers_remaining','owned_desktop_instances_remaining','owned_db_helpers_remaining','owned_qa_transports_remaining','owned_transport_listeners_remaining']:assert cleanup[field]==0
live=load(Q/'live-production-journey.json');assert live['owned_windows_closed'] and live['packaged_version']=='0.7.16' and not live['native_diagnostics']['errors'] and len(live['downloads'])==6
for fmt in ['html','csv','json']:
 rows=[x for x in live['downloads'] if x['format']==fmt];assert len(rows)==2 and len({(x['bytes'],x['sha256']) for x in rows})==1
roles=load(Q/'specialist-functional-samples.json');assert roles['professional_customer_acceptance'] is False and 3<=roles['passed_roles']<=12
assert roles['passed_roles']==len({r['role'] for r in roles['selected']})==len(roles['server_proof']['tasks'])
assert roles['owned_settlement']['actual_micros']=='250508'
for p in Q.rglob('*.json'):
 text=p.read_text('utf-8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),p.name
for p in [R/'docs/development/203-specialist-intake-and-runtime.md',R/'docs/requirements/203-specialist-intake-and-client-review.md',R/'docs/changes/203-specialist-intake.md',Q/'README.md']:
 for rel in re.findall(r'\]\(([^)]+)\)',p.read_text('utf-8')):
  if '://' not in rel and not rel.startswith('#'):assert (p.parent/rel.split('#')[0]).exists(),(p.name,rel)
report={'stage':203,'status':'passed','scope':'Current twelve bilingual guides, final source and actual live media hashes, selected current/retained688 related cases, native final package, full download bytes, strict server-network preservation, owned cleanup and all original102 requirements/32 groups. Actual role counts/failures and H2/lease/professional/production limits remain explicit. No full-goal acceptance claim.','versions':versions,'readmes':readmes,'protected_files_preserved':len(protected),'related_cases':688,'passed_controlled_roles':roles['passed_roles'],'remaining_original_scope':102,'runtime_cleanup':cleanup}
destination=Q/'documentation-check.json';assert not destination.exists();destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8');print(json.dumps({'status':'passed','readmes':12,'related_cases':688,'protected_files':len(protected),'passed_controlled_roles':roles['passed_roles']}))
