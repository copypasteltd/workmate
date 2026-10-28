"""Apply exactly the three native-browser repairs after the frozen full run ends."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import shutil
import subprocess
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
L = DEV / 'copypaste-delivery'
P = DEV / 'copypaste-platform'
CANDIDATE = DEV / 'copypaste-platform-recovery-120'
OUTPUT = L / 'evidence/integrated-recovery-native-browser-application-01.json'
assert not OUTPUT.exists()
digest = lambda path: sha256(path.read_bytes()).hexdigest()
read = lambda path: json.loads(path.read_text(encoding='utf-8'))
full = read(L / 'evidence/integrated-recovery-full-02.json')
assert full['source_unchanged'] and full['owned_database_shutdown']
assert full['status'] == 'failed' and full['counts']['fail'] == 1
raw = L / full['raw_report']['path']
assert digest(raw) == full['raw_report']['sha256']
failures = re.findall(r'^not ok \d+ - (.*?)\r?$', raw.read_text(encoding='utf-8'), re.M)
assert failures == ['controller death is observed natively and only a positively closed orphan profile is reclaimed'], failures
baseline = read(L / 'evidence/integrated-recovery-clients-01.json')
qualified = CANDIDATE / '.data/dedicated-cloud-121/browser-reclamation-02.json'
report = read(qualified)
assert report['status'] == 'passed' and report['source_unchanged']
assert report['counts'] == {'tests': 10, 'pass': 10, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
selected = ['src/cloud-browser-host.cs', 'src/cloud-browser-reclamation.ts', 'tests/cloud-browser-preview.test.ts']
changes = []
for name in selected:
    before = digest(P / name)
    assert before == baseline['source_files']['copypaste-platform/' + name], name
    assert digest(CANDIDATE / name) == report['source_files'][name], name
    changes.append({'path': name, 'before_sha256': before, 'after_sha256': digest(CANDIDATE / name)})
evidence = []
for attempt in ['01', '02']:
    prefix = CANDIDATE / ('.data/dedicated-cloud-121/browser-reclamation-' + attempt)
    original = read(prefix.with_suffix('.json'))
    target = L / ('evidence/native-browser-recovery-' + attempt)
    assert not target.exists()
    target.mkdir()
    for suffix, name in [('.json', 'report.json'), ('.tap', 'raw.tap'), ('-verifier.mjs', 'verifier.mjs')]:
        source = Path(str(prefix) + suffix)
        shutil.copyfile(source, target / name)
    assert digest(target / 'raw.tap') == original['raw_sha256']
    for name, expected in original['source_files'].items():
        source = Path(str(prefix) + '-sources') / name
        assert digest(source) == expected, name
        output = target / 'sources' / name
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output)
    evidence.append({'path': (target / 'report.json').relative_to(L).as_posix(), 'sha256': digest(target / 'report.json'),
                     'raw_sha256': digest(target / 'raw.tap'), 'verifier_sha256': digest(target / 'verifier.mjs'),
                     'counts': original['counts'], 'status': original['status']})
for name in selected:
    shutil.copyfile(CANDIDATE / name, P / name)
subprocess.run(['node', 'scripts/setup-cloud-browser.mjs'], cwd=P, check=True)
manifest = P / '.data/cloud-browser-host/manifest.json'
assert read(manifest)['host_source_sha256'] == digest(P / selected[0])
result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'applied', 'changes': changes,
          'qualified_native_browser_attempts': evidence, 'prior_complete_run': {
              'path': 'evidence/integrated-recovery-full-02.json', 'sha256': digest(L / 'evidence/integrated-recovery-full-02.json')},
          'runtime_manifest_sha256': digest(manifest),
          'scope': 'Three browser ownership/reclamation files only. The isolated archives include unrelated unfinished candidate source, which these ten browser tests neither execute nor qualify. A new complete regression and current client checks must pass before publication.',
          'verifier_sha256': digest(Path(__file__))}
with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
print(json.dumps({'status': 'applied', 'files': len(changes), 'native_browser_counts': report['counts']}))
