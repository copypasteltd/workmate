from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';out=R/'docs/quality/integrated-round-203';out.mkdir(parents=True,exist_ok=True)
rows=[];markers=[]
for repo in ['platform','web','admin','desktop','extension','delivery']:
 base=D/('copypaste-'+repo)
 for folder in ['src']+(['renderer/src'] if repo=='desktop' else []):
  for p in sorted((base/folder).rglob('*')):
   if p.is_file() and p.suffix in ['.ts','.tsx','.cts','.mts','.js','.mjs','.cjs','.css']:
    raw=p.read_bytes();rows.append({'path':p.relative_to(R).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    if re.search(r'\b(?:TODO|FIXME|HACK)\b',raw.decode('utf-8',errors='replace')):markers.append(p.relative_to(R).as_posix())
report={'stage':203,'at':datetime.now(timezone.utc).isoformat(),'status':'implementation_batch_complete_before_build_and_test','plan':'docs/requirements/203-specialist-intake-and-client-review.md','production_source_files':rows,'unresolved_literal_markers':markers,'scope':'Entire autonomous specialist attachment/scope/durable paid submission/optional reference/wide review batch and planned verification/role trial/deployment/download scripts completed before unified verification. .cts/.mts explicitly included. All102original requirements/32groups remain; literal markers do not determine completion.'}
p=out/'implementation-batch.json';assert not p.exists();p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'status':report['status'],'files':len(rows),'markers':markers}))
