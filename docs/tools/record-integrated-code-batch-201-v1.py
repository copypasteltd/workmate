"""Record the entire implemented batch before its first build or test."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
root=Path(__file__).resolve().parents[2];dev=root/'dev';out=root/'docs/quality/integrated-round-201';out.mkdir(parents=True,exist_ok=True)
for name in ['video-projects.tsx','video-projects.css','motion-production.tsx','motion-editor-model.ts','motion-draft-state.ts','use-motion-editor.ts']:
 (dev/'copypaste-desktop/renderer/src'/name).write_bytes((dev/'copypaste-web/src'/name).read_bytes())
(dev/'copypaste-desktop/tests/motion-production-201.test.ts').write_text((dev/'copypaste-web/tests/motion-production-201.test.ts').read_text('utf8').replace('../src/','../renderer/src/'),encoding='utf8',newline='\n')
rows=[];markers=[]
for repo in ['copypaste-platform','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension','copypaste-delivery']:
 for folder in ['src']+(['renderer/src'] if repo=='copypaste-desktop' else []):
  for p in sorted((dev/repo/folder).rglob('*')):
   if p.is_file() and p.suffix in ['.ts','.tsx','.js','.mjs','.css']:
    b=p.read_bytes();rows.append({'path':p.relative_to(root).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    if re.search(r'\b(?:TODO|FIXME|HACK)\b',b.decode('utf8',errors='replace')):markers.append(p.relative_to(root).as_posix())
report={'stage':201,'at':datetime.now(timezone.utc).isoformat(),'status':'implementation_batch_complete_before_build_and_test','plan':'docs/requirements/201-motion-production-round.md','production_source_files':rows,'unresolved_literal_markers':markers,'scope':'All autonomous code in the complete motion-production batch is implemented. Tests follow the frozen batch. The full original102 requirements/32groups, external services and professional/production gates remain; no global completion inferred from TODO markers.'}
(out/'implementation-batch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status'],'production_files':len(rows),'literal_markers':markers},ensure_ascii=False))
