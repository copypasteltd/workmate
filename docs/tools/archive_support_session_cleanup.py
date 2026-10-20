"""Preserve a 12-check run that failed graceful native shutdown, before retry."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
retry = len(sys.argv) == 2 and sys.argv[1] == '--retry'
assert len(sys.argv) == 1 or retry
DEST = DELIVERY / ('evidence/support-session-cleanup-retry-failure' if retry else 'evidence/support-session-cleanup-failure')
DEST.mkdir(exist_ok=False)
paths = [DELIVERY / 'evidence' / name for name in
         ['auth-recovery-current.json', 'support-recheck-sessions-retry.log' if retry else 'support-recheck-sessions.log', 'support-context.json']]
paths.append(DELIVERY / 'scripts/qa-sessions.ts')
for repo, names in [
    ('web', ['64-native-authorization-current.png', '65-active-sessions-current.png', '66-sessions-mobile-dark-current.png']),
    ('desktop', ['24-active-sessions-current.png', '25-offline-signout-current.png']),
    ('extension', ['13-session-revoked-current.png', '14-account-replacement-current.png']),
]:
    paths.extend(DEV / ('copypaste-' + repo) / 'assets/screenshots' / name for name in names)
report = json.loads(paths[0].read_bytes())
assert report['status'] == 'failed' and len(report['checks']) == 12
assert report['source_unchanged'] and report['browser_closed'] and report['desktop_closed'] and report['extension_closed']
assert report['errors'] == ['Desktop cleanup: Owned Desktop required forced cleanup; graceful shutdown was not verified']
rows = []
for index, source in enumerate(paths, 1):
    target = DEST / (str(index).zfill(4) + source.suffix)
    target.write_bytes(source.read_bytes())
    rows.append({'source': source.relative_to(ROOT).as_posix(), 'archived': target.relative_to(ROOT).as_posix(),
                 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(DEST / 'archive-map.json').write_text(json.dumps({'scope': 'All twelve business checks passed, but graceful Desktop shutdown did not. Owned processes and credentials were cleared. Original failed receipt remains failed; retry is a separate run.', 'files': rows}, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(rows), 'status': report['status']}))
