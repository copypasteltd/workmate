from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
root=Path(__file__).resolve().parents[2];dev=root/'dev';out=root/'docs/quality/integrated-round-202';out.mkdir(parents=True,exist_ok=True)
rows=[];markers=[]
for repo in ['copypaste-platform','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension','copypaste-delivery']:
 for folder in ['src']+(['renderer/src'] if repo=='copypaste-desktop' else []):
  for p in sorted((dev/repo/folder).rglob('*')):
   if p.is_file() and p.suffix in ['.ts','.tsx','.js','.mjs','.css']:
    b=p.read_bytes();rows.append({'path':p.relative_to(root).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
    if re.search(r'\b(?:TODO|FIXME|HACK)\b',b.decode('utf8',errors='replace')):markers.append(p.relative_to(root).as_posix())
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'status':'implementation_batch_complete_before_build_and_test','plan':'docs/requirements/202-marketing-review-round.md','production_source_files':rows,'unresolved_literal_markers':markers,'scope':'Complete autonomous marketing-history/review/export/uncertain-request batch, native bounded POST saving, client state and planned meaningful verification/operations implemented before the first build/test. All original102requirements and32groups remain; external, professional and production gates are not closed by this batch.'}
(out/'implementation-batch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'status':report['status'],'production_files':len(rows),'literal_markers':markers},ensure_ascii=False))
