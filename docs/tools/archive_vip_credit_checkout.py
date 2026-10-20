"""Keep the first independent-clone failure before publishing missing captures."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'
mode = sys.argv[1] if len(sys.argv) > 1 else 'first'
assert mode in {'first', 'path'}
DEST = DELIVERY / ('evidence/vip-credit-clone-first' if mode == 'first' else 'evidence/vip-credit-clone-path')
assert not DEST.exists()
report_path = DELIVERY / 'evidence/byte-integrity.json'
report = json.loads(report_path.read_bytes())
assert report['owned_temporary_clones_removed'] is True
assert report['checks'][-1]['status'] == 'failed'
assert ('admin-payment-evidence-record.png' if mode == 'first' else 'Filename too long') in report['checks'][-1]['detail']
entries = []


def preserve(source, content, prefix='', **extra):
    relative = source.relative_to(ROOT)
    target = DEST / (prefix + '-' + source.name if prefix else source.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    entries.append({'source': relative.as_posix(),
                    'archived': target.relative_to(ROOT).as_posix(),
                    'sha256': hashlib.sha256(content).hexdigest(), **extra})


for source in [report_path, DELIVERY / 'evidence/vip-credit-byte-integrity.log',
               DELIVERY / 'scripts/qa-byte-integrity.ts']:
    preserve(source, source.read_bytes())
if mode == 'first':
    image = ROOT / 'dev/copypaste-admin/assets/screenshots/admin-payment-evidence-record.png'
    preserve(image, image.read_bytes(), 'working')
    revision = report['heads']['copypaste-admin']
    committed = subprocess.check_output(['git', 'show', revision + ':assets/screenshots/' + image.name],
                                        cwd=ROOT / 'dev/copypaste-admin')
    assert committed != image.read_bytes()
    preserve(image, committed, 'committed', source_git_revision=revision)
(DEST / 'archive-map.json').write_text(json.dumps({
    'scope': ('First independent-clone check failed because nine current derived payment/refund captures had not been committed. Exact failed receipt, log, unchanged verifier, and the first mismatched committed/working image are preserved. Temporary clones were removed.' if mode == 'first' else 'Second independent-clone check encountered the Windows file-name limit in the newly nested archive. Exact failed receipt, log and unchanged verifier are preserved before shortening only that archive path. Temporary clones were removed.'),
    'files': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(entries)}))
