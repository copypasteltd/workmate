from pathlib import Path
import json, hashlib, subprocess
from datetime import datetime, timezone

root = Path('D:/dev/copypasted/自有agent'); delivery = root / 'dev/copypaste-delivery'
out = delivery / '.data/integrated-197-v1'; out.mkdir(parents=True, exist_ok=True)
source = (delivery / 'scripts/verify-integrated-round-196-v4.mjs').read_text(encoding='utf8')
source = source.replace('integrated-196-v4', 'integrated-197-v1').replace('196-workspace-completion-round.md', '197-connection-and-native-review-round.md')
source = source.replace('/^(workspace-completion-196|workspace-execution-196|business-quality\\.)/', '/^(desktop-unstarted-settlement-197|desktop-startup-recovery\\.|desktop-executions\\.|provider-budgets\\.|workspace-completion-196|workspace-execution-196|business-quality\\.)/')
source = source.replace("selected.some(name=>name.includes('workspace-completion-196'))", "selected.some(name=>name.includes('desktop-unstarted-settlement-197'))")
source = source.replace("Final changed-code and review/access/fee checks. Round196 v3 independently retains 73 passing baseline regressions plus six passing new checks; unchanged Office/Admin/provider suites are not repeated.", "Round197 native startup, billing, inference, company-tool and recovery regressions; prior workspace/review access checks. This is selected regression, not the full historical backend matrix.")
(delivery / 'scripts/verify-integrated-round-197-v1.mjs').write_text(source, encoding='utf8')
paths = []
for component in ['platform','web','admin','desktop','extension','delivery']:
    repo = root / 'dev' / ('copypaste-' + component)
    tracked = subprocess.run(['git','-c','core.fsmonitor=false','ls-files','-z'],cwd=repo,stdout=subprocess.PIPE,check=True).stdout.decode('utf8').split('\0')
    for name in tracked:
        if name and (name.startswith(('src/','renderer/src/','tests/','contracts/')) or name in ['package.json','package-lock.json']):
            path = repo / name
            if path.is_file(): paths.append({'path': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
for path in [root/'dev/copypaste-desktop/src/company-transport.ts', root/'dev/copypaste-platform/src/desktop-unstarted-settlement.ts',root/'dev/copypaste-desktop/tests/company-network-197-v1.test.ts',root/'dev/copypaste-platform/tests/desktop-unstarted-settlement-197-v1.test.ts']:
    paths.append({'path':path.relative_to(root).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
scan = subprocess.run(['rg','-n','TODO|FIXME|HACK|not implemented|NotImplemented',*[str(root/'dev'/('copypaste-'+c)/'src') for c in ['platform','web','admin','desktop','extension']],str(root/'dev/copypaste-desktop/renderer/src')],cwd=root,stdout=subprocess.PIPE,check=False)
assert scan.returncode in [0,1]
(out/'implementation-batch.json').write_text(json.dumps({'stage':197,'at':datetime.now(timezone.utc).isoformat(),'requirements':'docs/requirements/197-connection-and-native-review-round.md','source_files':paths,'code_todo_matches':scan.stdout.decode('utf8'),'todo_scope':'Production source markers only; absence is not proof that the 102 original requirements are accepted.','tests_run_before_batch':False},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'batch_source_files':len(paths),'todo_marker_matches':len(scan.stdout.splitlines()),'validation_script':'verify-integrated-round-197-v1.mjs'}))
