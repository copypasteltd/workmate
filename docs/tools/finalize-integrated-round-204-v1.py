"""Validate final bilingual guides, original scope and measured release evidence."""
from pathlib import Path
import hashlib,json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(L/'.data/acceptance-204/baseline/receipt.json')['preserved_untracked'];assert len(protected)==27
for path,digest in protected.items():assert sha(R/path)==digest,path
summary=load(Q/'test-summary.json');assert summary['total_qualified_cases']==sum(summary['counts'].values())==725
verification=load(Q/'verification.json');assert verification['status']=='passed' and verification['qualified_backend_case_count']==204
assert verification['backend_groups']==3 and verification['backend_failed_cases']==0
assert len(verification['retained_backend_cases'])==167 and len(verification['current_backend_cases'])==37
assert all(c['passed'] for c in verification['retained_backend_cases']+verification['current_backend_cases'])
assert verification['original_failed_whole']['failed']==21
manifest=load(Q/'final-source-manifest.json');assert manifest['prebuild_snapshot_sha256']==sha(Q/'implementation-batch-v6.json')
assert len(manifest['production_source_files'])==842 and len(manifest['migration_files'])==165
for row in manifest['production_source_files']+manifest['migration_files']:assert sha(R/row['path'])==row['sha256'],row['path']
actual_media=load(Q/'actual-media.json')['files'];assert len({r['path'] for r in actual_media})==len(actual_media)
for row in actual_media:
 assert sha(D/row['path'])==row['sha256']
 assert row['origin'] in ['actual_live204','controlled_ui204','retained198'] and row['label']
 if row['origin']=='actual_live204':assert '204-v1' in row['path']
 elif row['origin']=='controlled_ui204':assert '204-v3' in row['path']
 else:assert '198' in row['path'] and row['path'].startswith(('copypaste-admin/','copypaste-extension/'))
readmes=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 for filename in ['README.md','README.en.md']:
  p=D/('copypaste-'+name)/filename;text=p.read_text('utf-8');assert text.startswith('<!-- integrated-round-204 -->')
  current=text.split('<!-- integrated-round-203 -->',1)[0];assert '```mermaid' in current and 'integrated-round-204' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  for link in links:assert (p.parent/link).is_file(),link
  if name in ['web','desktop','admin','extension']:assert all(any(link.endswith(ext) for link in links) for ext in ['.png','.gif','.mp4'])
  if name in ['admin','extension']:assert all('198' in link for link in links)
  readmes.append({'path':p.relative_to(R).as_posix(),'sha256':sha(p),'current_media':links})
versions={name:load(D/('copypaste-'+name)/'package.json')['version'] for name in ['platform','web','admin','desktop','extension','delivery']}
assert versions=={'platform':'0.5.11','web':'0.5.13','admin':'0.5.2','desktop':'0.7.17','extension':'0.5.7','delivery':'0.5.11'}
overlay=load(Q/'requirements-overlay.json');old=load(R/'docs/quality/integrated-round-203/requirements-overlay.json')
assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id'] for r in overlay['requirements']})==102
for before,after in zip(old['requirements'],overlay['requirements']):assert {k:v for k,v in after.items() if k!='round204_overlay'}==before
for before,after in zip(old['groups'],overlay['groups']):assert {k:v for k,v in after.items() if not k.startswith('round204_')}==before
assert not any(g['round204_full_acceptance_closed'] for g in overlay['groups'])
for name in ['verification','live-production-journey','controlled-tool-feedback-ui','public-downloads','inner-downloads','network-preserved','runtime-cleanup','final-service-state']:
 assert load(Q/(name+'.json'))['status']=='passed',name
deployment=load(Q/'deployment.json');assert deployment['status']=='deployed' and deployment['schema_version']==165 and deployment['network_configuration_unchanged'] and deployment['database_and_proxy_processes_unchanged'] and not deployment['rollback_tested']
network=load(Q/'network-preserved.json');assert network['network_configuration_unchanged'] and len(network['files'])==9
services=load(Q/'final-service-state.json');assert services['credentials_preserved'] and services['database_proxy_processes_and_restarts_preserved'] and not services['server_network_writes']
downloads=load(Q/'public-downloads.json');assert load(D/'copypaste-web/contracts/product-downloads.json')==downloads['catalog']
assert len(downloads['public']['downloads'])==len(downloads['inner']['downloads'])==4
assert all(row['status']=='complete_verified' and '/releases/20401/' in row['url'] for row in downloads['public']['downloads'])
cleanup=load(Q/'runtime-cleanup.json')
for key in ['owned_browsers_remaining','owned_desktop_instances_remaining','owned_db_helpers_remaining','owned_qa_transports_remaining','owned_transport_listeners_remaining']:assert cleanup[key]==0
live=load(Q/'live-production-journey.json');assert live['owned_windows_closed'] and live['packaged_version']=='0.7.17' and len(live['downloads'])==6 and live['native_diagnostics']['errors']==[]
for fmt in ['html','csv','json']:
 rows=[r for r in live['downloads'] if r['format']==fmt];assert len(rows)==2 and len({(r['bytes'],r['sha256']) for r in rows})==1
ui=load(Q/'controlled-tool-feedback-ui.json');assert ui['owned_browser_closed'] and ui['owned_local_server_closed'] and ui['recordings'][0]['distinct_frames']>=4
recovery=load(Q/'marketing-tool-recovery.json');assert recovery['status']=='passed' and len(recovery['files'])==9 and recovery['actual_charge_micros']=='306432'
roles=load(Q/'specialist-functional-samples.json');assert roles['professional_customer_acceptance'] is False and roles['new_paid_trials']==1 and roles['prior_successful_trials_repeated']==0
assert roles['passed_roles']==len({r['role'] for r in roles['selected']}) and roles['passed_roles'] in [11,12]
for p in Q.rglob('*.json'):
 text=p.read_text('utf-8');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',text),p.name
for p in [R/'docs/development/204-runtime-delivery-and-lease.md',R/'docs/requirements/204-runtime-delivery-and-lease.md',R/'docs/changes/204-runtime-delivery-and-lease.md',Q/'README.md']:
 for rel in re.findall(r'\]\(([^)]+)\)',p.read_text('utf-8')):
  if '://' not in rel and not rel.startswith('#'):assert (p.parent/rel.split('#')[0]).exists(),(p.name,rel)
report={'stage':204,'status':'passed','scope':'Current12 bilingual guides, final842 production sources/165 migrations, distinct725 qualified related cases, actual final clients, controlled error UI, full download bytes, network/credential/DB/proxy preservation, exact-owner cleanup and all102/32. Original failures and professional/external/production limitations remain; no full-goal claim.','versions':versions,'readmes':readmes,'related_qualified_cases':725,'protected_files_preserved':27,'functional_roles':roles['passed_roles'],'original_scope_requirements':102,'runtime_cleanup':cleanup}
with (Q/'documentation-check.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'status':'passed','readmes':12,'related_cases':725,'protected_files':27,'functional_roles':roles['passed_roles']}))
