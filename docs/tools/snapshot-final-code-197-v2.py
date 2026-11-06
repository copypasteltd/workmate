from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256
import json,subprocess
root=Path(__file__).resolve().parents[2];d=root/'dev/copypaste-delivery';out=d/'.data/integrated-197-v2'
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
previous=d/'.data/integrated-197-v1/implementation-batch.json';old=load(previous)
paths={r['path'] for r in old['source_files']}
paths.update('dev/'+p for p in [
 'copypaste-platform/src/execution-timing.ts','copypaste-platform/tests/execution-timing-197-v1.test.ts','copypaste-platform/tests/workspace-execution-196-v2.test.ts',
 'copypaste-web/src/execution-timing.ts','copypaste-web/tests/execution-timing-197-v1.test.ts',
 'copypaste-desktop/renderer/src/execution-timing.ts','copypaste-desktop/tests/execution-timing-197-v1.test.ts'])
scan=subprocess.run(['rg','-n','TODO|FIXME|HACK|not implemented|NotImplemented',*[str(root/'dev'/('copypaste-'+c)/'src') for c in ['platform','web','admin','desktop','extension']],str(root/'dev/copypaste-desktop/renderer/src')],cwd=root,stdout=subprocess.PIPE)
assert scan.returncode in [0,1]
report={'stage':197,'hashes_observed_at':datetime.now(timezone.utc).isoformat(),'scope':'Source hashes observed after integrated-v2 validation and final numeric download catalog update. This observation is not mislabeled as a pre-test snapshot.','requirements':'docs/requirements/197-connection-and-native-review-round.md','current_batch_started':load(out/'code-batch-complete.json'),'prior_batch':{'path':previous.relative_to(root).as_posix(),'sha256':sha256(previous.read_bytes()).hexdigest(),'selected_passes':519},'integrated_validation':'528 selected passing checks; exact log hashes in verification.json; final artifact catalog is independently rebuilt and checked.','source_files':[{'path':p,'sha256':sha256((root/p).read_bytes()).hexdigest()} for p in sorted(paths)],'code_todo_matches':scan.stdout.decode('utf8'),'todo_scope':'Production marker scan only, not proof that all32 groups/102 original requirements or external/professional/production acceptance are complete.'}
(out/'implementation-batch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'source_files':len(paths),'todo_marker_matches':len(scan.stdout.splitlines())}))
