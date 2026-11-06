from pathlib import Path
import json, hashlib, subprocess
from datetime import datetime,timezone
R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';D=R/'dev/copypaste-delivery/.data/acceptance-205/fixture-reclamation-readback-v1';D.mkdir(parents=True,exist_ok=False)
run=P/'.data/test-fixture-reclamation/57d1eb16-4c5e-4c4c-b9c9-9838b8e93d21'
old=(run/'result.json').read_bytes();result=json.loads(old);manifest=json.loads((run/'manifest.json').read_text('utf-8'))
assert result['status']=='failed'
checks=[]
for f in sorted((run/'owned').glob('*.json')):
 item=json.loads(f.read_text('utf-8'));assert item['token']==manifest['token'];target=Path(item['directory']).resolve();assert target.parent==(P/'.data/test-runs').resolve();assert f.stem==item['id']==target.name
 checks.append({'id':item['id'],'worker_pid':item['worker_pid'],'directory_absent':not target.exists()})
pids=sorted(set([manifest['owner_pid']]+[c['worker_pid'] for c in checks]));cmd='$ids=@('+','.join(str(p) for p in pids)+'); @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $ids } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress'
out=subprocess.run(['pwsh','-NoProfile','-Command',cmd],capture_output=True,text=True,check=True).stdout.strip();live=json.loads(out) if out else [];live=[live] if isinstance(live,dict) else live
report={'at':datetime.now(timezone.utc).isoformat(),'status':'confirmed_absent' if all(c['directory_absent'] for c in checks) and not live else 'requires_review','original_failed_receipt_sha256':hashlib.sha256(old).hexdigest(),'original_failed_receipt_preserved':True,'scope':'Read-only current filesystem and process readback of exactly the first whole205-v1 launch owned fixtures; no deletion, killing or historical receipt rewriting','checks':checks,'live_process_observations':live}
(D/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8');print(json.dumps({'status':report['status'],'fixtures':len(checks),'live_processes':len(live)}));assert report['status']=='confirmed_absent'
