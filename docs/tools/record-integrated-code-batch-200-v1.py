from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re
root=Path(__file__).resolve().parents[2];out=root/'docs/quality/integrated-round-200';out.mkdir(parents=True,exist_ok=True)
repos=['copypaste-platform','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension','copypaste-delivery']
rows=[];markers=[]
for repo in repos:
 base=root/'dev'/repo
 folders=['src']+(['renderer/src'] if repo=='copypaste-desktop' else [])
 for folder in folders:
  for p in sorted((base/folder).rglob('*')):
   if p.is_file() and p.suffix in ['.ts','.tsx','.js','.mjs','.css']:
    b=p.read_bytes();rows.append({'path':p.relative_to(root).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    if re.search(r'\b(?:TODO|FIXME|HACK)\b',b.decode('utf-8',errors='replace')):markers.append(p.relative_to(root).as_posix())
report={'stage':200,'at':datetime.now(timezone.utc).isoformat(),'status':'implementation_batch_complete_before_build_and_test','plan':'docs/requirements/200-design-production-round.md','production_source_files':rows,'unresolved_literal_markers':markers,'scope':'All autonomous items in the complete planned batch are implemented. A zero marker count is not complete original-product acceptance. The original102 requirements and32 groups remain tracked.'}
(out/'implementation-batch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'status':report['status'],'production_files':len(rows),'literal_markers':markers},ensure_ascii=False))
