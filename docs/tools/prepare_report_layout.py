"""Preserve the three qualified files before the responsive report repair."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'dev/copypaste-delivery/.data/preparation/report-layout-112'
assert not TARGET.exists()
cp_path = ROOT / 'docs/quality/web-analytics-checkpoint.json'
cp = json.loads(cp_path.read_text('utf-8'))
names = ['dev/copypaste-web/src/web-analytics.css',
         'dev/copypaste-desktop/renderer/src/web-analytics.css',
         'dev/copypaste-desktop/renderer-source.json']
files = {}
for name in names:
    data = (ROOT / name).read_bytes()
    digest = sha256(data).hexdigest()
    assert digest == cp['source_files'][name], name
    target = TARGET / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as stream:
        stream.write(data)
    files[name] = digest
heads = {}
for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
    repo = ROOT / ('dev/copypaste-' + name)
    args = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
    assert not subprocess.check_output(args + ['status', '--porcelain'], cwd=repo)
    heads[name] = subprocess.check_output(args + ['rev-parse', 'HEAD'], cwd=repo).decode().strip()
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 112,
           'baseline_checkpoint_sha256': sha256(cp_path.read_bytes()).hexdigest(),
           'source_files': files, 'component_heads': heads,
           'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}
with (TARGET / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(receipt, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'preserved', 'source_files': len(files)}))
