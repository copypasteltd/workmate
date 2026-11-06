"""Check exact shipped evidence, guides and preserved original scope."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-205'
load=lambda p:json.loads(p.read_text('utf-8-sig'));sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
protected=load(L/'.data/acceptance-205/baseline/receipt.json')['preserved_untracked'];assert len(protected)==27
for p,h in protected.items():assert sha(R/p)==h,p
v=load(Q/'verification.json');assert v['status']=='passed' and v['failed_cases']==0 and not v['full_original_goal_accepted']
summary=load(Q/'test-summary.json');assert summary['round205_executed_cases']==v['passed_cases'] and summary['total_qualified_cases']==sum(summary['counts'].values())
for c in v['retained_checks']+v['checks']:assert c['exit_code']==0 and sha(L/c['log'])==c['sha256']
manifest=load(Q/'final-source-manifest.json');assert len(manifest['production_source_files'])==844 and len(manifest['migration_files'])==166 and manifest['prebuild_snapshot_sha256']==sha(Q/'implementation-batch-v2.json')
for r in manifest['production_source_files']+manifest['migration_files']:assert sha(R/r['path'])==r['sha256'],r['path']
assert manifest['release_metadata']['web_download_catalog_sha256']==sha(D/'copypaste-web/contracts/product-downloads.json')
media=load(Q/'actual-media.json')['files'];assert len(media)==len({r['path'] for r in media})
for r in media:assert sha(D/r['path'])==r['sha256'] and r['origin'] in ['actual_live205','controlled_ui205','retained198']
guides=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
 for filename in ['README.md','README.en.md']:
  p=D/('copypaste-'+name)/filename;text=p.read_text('utf-8');assert text.startswith('<!-- integrated-round-205 -->')
  current=text.split('<!-- integrated-round-204 -->',1)[0];assert '```mermaid' in current and 'integrated-round-205' in current
  links=re.findall(r'\]\((assets/screenshots/[^)]+)\)',current)
  for link in links:assert (p.parent/link).is_file(),(name,link)
  if name in ['web','desktop','admin','extension']:assert all(any(link.endswith(ext) for link in links) for ext in ['.png','.gif','.mp4'])
  guides.append({'path':p.relative_to(R).as_posix(),'sha256':sha(p),'current_media':links})
versions={n:load(D/('copypaste-'+n)/'package.json')['version'] for n in ['platform','web','admin','desktop','extension','delivery']}
assert versions=={'platform':'0.5.12','web':'0.5.14','admin':'0.5.2','desktop':'0.7.18','extension':'0.5.7','delivery':'0.5.12'}
for n,version in versions.items():
 lock=load(D/('copypaste-'+n)/'package-lock.json');assert lock['version']==lock['packages']['']['version']==version
old=load(R/'docs/quality/integrated-round-204/requirements-overlay.json');new=load(Q/'requirements-overlay.json')
assert len(new['groups'])==32 and len(new['requirements'])==len({r['id'] for r in new['requirements']})==102
for a,b in zip(old['requirements'],new['requirements']):assert {k:v for k,v in b.items() if k!='round205_overlay'}==a
for a,b in zip(old['groups'],new['groups']):assert {k:v for k,v in b.items() if not k.startswith('round205_')}==a and b['round205_full_acceptance_closed'] is False
for name in ['live-production-journey','controlled-tool-feedback-ui','inner-downloads','network-preserved','final-service-state','runtime-cleanup']:assert load(Q/(name+'.json'))['status']=='passed',name
live=load(Q/'live-production-journey.json');assert live['owned_windows_closed'] and live['packaged_version']=='0.7.18' and not live['javascript_errors'] and len(live['downloads'])==6 and live['native_diagnostics']['errors']==[]
assert live['authorized_tool_outcome_summary']['total']==0
for fmt in ['html','csv','json']:
 rows=[r for r in live['downloads'] if r['format']==fmt];assert len(rows)==2 and len({(r['bytes'],r['sha256']) for r in rows})==1
ui=load(Q/'controlled-tool-feedback-ui.json');assert ui['owned_browser_closed'] and ui['owned_local_server_closed'] and ui['recordings'][0]['distinct_frames']>=4
network=load(Q/'network-preserved.json');assert network['network_configuration_unchanged'] and len(network['files'])==9
services=load(Q/'final-service-state.json');assert services['credentials_preserved'] and services['database_proxy_processes_and_restarts_preserved'] and not services['server_network_writes']
deployment=load(Q/'deployment.json');assert deployment['status']=='deployed' and deployment['schema_version']==166 and deployment['network_configuration_unchanged'] and deployment['database_and_proxy_processes_unchanged'] and not deployment['rollback_tested']
public=load(Q/'public-downloads.json');gate=load(Q/'open-public-download-gate.json');assert public['catalog']==load(D/'copypaste-web/contracts/product-downloads.json')
assert public['full_public_download_gate']==gate['full_public_download_gate'] and len(public['inner']['downloads'])==4
assert gate['qualified_complete_files']==len([r for r in public['public']['downloads'] if r['status']=='complete_verified']) and gate['full_public_download_gate']==(gate['qualified_complete_files']==4)
assert gate['status']==('passed' if gate['full_public_download_gate'] else 'not_passed')
published=load(Q/'download-publication.json');assert published['status']=='published' and published['full_files_and_parent_directories_fsynced'] and published['network_configuration_unchanged']
assert published['interrupted_original_preserved'].startswith('/opt/workmate/downloads/interrupted/20501-')
original_public=L/'.data/deployment-205-v1/public-download-v1.sanitized.json'
for row in public['public']['downloads']:
 if row.get('retained_exact_whole_file'):
  assert row['source_receipt_sha256']==sha(original_public)
  prior=[r for r in load(original_public)['downloads'] if r['name']==row['name']];assert len(prior)==1 and prior[0]['status']=='complete_verified' and (prior[0]['bytes'],prior[0]['sha256'])==(row['bytes'],row['sha256'])
cleanup=load(Q/'runtime-cleanup.json')
for key in ['owned_browsers_remaining','owned_desktop_instances_remaining','owned_db_helpers_remaining','owned_qa_transports_remaining','owned_transport_listeners_remaining']:assert cleanup[key]==0
for p in Q.rglob('*.json'):
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',p.read_text('utf-8')),p.name
for p in [R/'docs/requirements/205-call-scoped-delivery.md',R/'docs/development/205-call-scoped-tool-outcomes.md',R/'docs/changes/205-call-scoped-delivery.md',Q/'README.md']:
 for link in re.findall(r'\]\(([^)]+)\)',p.read_text('utf-8')):
  if '://' not in link and not link.startswith('#'):assert (p.parent/link.split('#')[0]).exists(),(p.name,link)
report={'stage':205,'status':'passed' if gate['full_public_download_gate'] else 'documented_with_open_checks','at':datetime.now(timezone.utc).isoformat(),'documentation_consistency_checks_passed':True,'full_public_download_gate':gate['full_public_download_gate'],'full_original_goal_accepted':False,'original_requirements':102,'original_groups':32,'related_qualified_cases':summary['total_qualified_cases'],'current_executed_cases':v['passed_cases'],'protected_original_files':27,'versions':versions,'readmes':guides,'scope':'Current12 bilingual usage guides, final844 sources/166 migrations, measured selected tests, actual deployed/final native clients, controlled UI, full inner files, exact public complete-file gate, network/service preservation and exact-owner resource cleanup. Full original external/professional/operational/device acceptance remains explicit.'}
p=Q/'documentation-check.json';assert not p.exists();p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8');print(json.dumps({'status':report['status'],'related_cases':report['related_qualified_cases'],'readmes':12,'full_public_download_gate':gate['full_public_download_gate']}))
