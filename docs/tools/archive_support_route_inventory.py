"""Retain green reports from before the derived route inventory refresh."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
DEST = DELIVERY / 'evidence/support-before-route-inventory'
DEST.mkdir(exist_ok=False)
paths = []
for name in ['alignment-platform.json', 'alignment-platform.tap', 'support-ui.json', 'financial-ui.json', 'financial-ui-contract-samples.json', 'financial-ui-screenshots.json', 'admin-vip-credit.json', 'admin-vip-credit-screenshots.json', 'resource-ui.json', 'admin-vip.json', 'admin-vip-screenshots.json', 'admin-plans.json', 'admin-plan-screenshots.json', 'native-vip.json', 'auth-recovery-current.json', 'financial-context.json']:
    path = DELIVERY / 'evidence' / name
    if path.is_file():
        paths.append(path)
for repo in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
    paths.extend((DEV / ('copypaste-' + repo) / 'assets/screenshots').glob('*.png'))
rows = []
for index, source in enumerate(sorted(set(paths)), 1):
    target = DEST / (str(index).zfill(4) + source.suffix)
    target.write_bytes(source.read_bytes())
    rows.append({'source': source.relative_to(ROOT).as_posix(), 'archived': target.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
old = subprocess.check_output(['git', 'show', '6bb2d3b1805dbe83d5b0e3dde1d4af5fc51cdd13:contracts/implemented-routes.json'], cwd=DEV / 'copypaste-platform')
previous = json.loads((DELIVERY / 'evidence/alignment-platform.json').read_bytes())
assert hashlib.sha256(old).hexdigest() == previous['source_files']['contracts/implemented-routes.json']
target = DEST / 'inventory-before.json'
target.write_bytes(old)
rows.append({'source': 'dev/copypaste-platform/contracts/implemented-routes.json', 'archived': target.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(old).hexdigest(), 'source_commit': '6bb2d3b1805dbe83d5b0e3dde1d4af5fc51cdd13'})
current = json.loads((DEV / 'copypaste-platform/contracts/implemented-routes.json').read_bytes())
assert len(current['routes']) == 341
(DEST / 'archive-map.json').write_text(json.dumps({'scope': 'Actual 424-test and client reports before the derived route inventory was refreshed from 333 to 341 entries. These are historical source bindings; affected reports must run again against the frozen current inventory.', 'files': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(rows), 'current_route_count': len(current['routes'])}))
