"""Check current Desktop discovery preserves every published baseline test."""
from pathlib import Path
from hashlib import sha256
import json,subprocess
ROOT=Path(__file__).resolve().parents[2];repo=ROOT/'dev/copypaste-desktop'
baseline='ba67c97ca3515842118748989552602a25221f58'
old=subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),'ls-tree','--name-only',baseline+':tests'],encoding='utf-8').splitlines()
old={'tests/'+p for p in old if p.endswith('.test.ts')}
raw=subprocess.check_output(['D:/Program Files/nodejs/node.exe','scripts/run-current-tests-v1.mjs','--list'],cwd=repo)
current=json.loads(raw);assert old.issubset(current)
assert 'tests/local-workflow-handoff-145-v2.test.ts' in current and 'tests/local-workflow-handoff-145-v1.test.ts' not in current
value={'status':'passed','baseline_commit':baseline,'baseline_test_files':sorted(old),'current_test_files':current,
 'raw_discovery_utf8':raw.decode('utf-8'),'raw_sha256':sha256(raw).hexdigest(),'new_current_tests':sorted(set(current)-old),
 'historical_test_preserved':'tests/local-workflow-handoff-145-v1.test.ts','scope':'Discovery only. Does not claim the complete Desktop suite was executed.'}
with (ROOT/'docs/quality/workflow-handoff-test-selection-145.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(value,f,indent=2)
print(json.dumps({'status':'passed','baseline_tests':len(old),'current_tests':len(current)}))
