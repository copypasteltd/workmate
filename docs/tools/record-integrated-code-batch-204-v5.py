from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';Q=R/'docs/quality/integrated-round-204';Q.mkdir(parents=True,exist_ok=True)
rows=[];markers=[];extensions={'.ts','.tsx','.cts','.mts','.js','.mjs','.cjs','.css','.py','.cs'}
for repo in ['platform','web','admin','desktop','extension','delivery']:
 base=D/('copypaste-'+repo)
 for folder in ['src']+(['renderer/src'] if repo=='desktop' else []):
  for p in sorted((base/folder).rglob('*')):
   if p.is_file() and p.suffix in extensions:
    raw=p.read_bytes();rows.append({'path':p.relative_to(R).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    if re.search(r'\b(?:TODO|FIXME|HACK|XXX)\b',raw.decode('utf-8',errors='replace')):markers.append(p.relative_to(R).as_posix())
schema=[{'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((D/'copypaste-platform/migrations').glob('*.sql'))]
report={'stage':204,'status':'implementation_batch_complete_before_build_and_test','at':datetime.now(timezone.utc).isoformat(),'production_source_files':rows,'source_extensions':sorted(extensions),'migration_files':schema,'literal_markers':markers,'scope':'Complete autonomous safe diagnostics, actual delivery outcome, independently fenced cloud lease/media/provider guards and selectively shared UI, planned native/DB/browser tests plus app-only release/rollback/paid-parent-observation scripts before unified validation. All102 requirements/32 acceptance groups and external/professional limits remain.'}
p=Q/'implementation-batch-v5.json';assert not p.exists();p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'status':report['status'],'source_files':len(rows),'migrations':len(schema),'markers':markers}))
