"""Copy actual, unedited support screenshots and receipts; never reconstruct UI."""
from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'
DOCS = ROOT / 'docs'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def main():
    path = DELIVERY / 'evidence/support-ui.json'
    report = json.loads(path.read_bytes())
    assert report['status'] == 'passed' and not report['errors']
    assert len(report['checks']) == 8 and len(report['screenshots']) == 9
    assert report['browser_closed'] and report['owned_credentials_revoked'] and report['source_unchanged']
    files = []
    for item in report['screenshots']:
        source = (ROOT / item['file']).resolve()
        assert source.is_relative_to(ROOT / 'dev') and sha(source) == item['sha256'] and item['unedited']
        target = DOCS / 'design/implementation' / source.name
        target.write_bytes(source.read_bytes())
        files.append({'source': item['file'], 'documentation': target.relative_to(ROOT).as_posix(), **{k: v for k, v in item.items() if k != 'file'}})
    copies = []
    for repo, name in [('copypaste-platform', '51-support-en-light-1440.png'), ('copypaste-delivery', '51-support-en-light-1440.png')]:
        source = DOCS / 'design/implementation' / name
        target = ROOT / 'dev' / repo / 'assets/screenshots' / 'support-view.png'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': sha(source)})
    save(DOCS / 'quality/support-screenshot-provenance.json', {'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Nine actual unedited Web/Admin support screenshots; no generated mockups', 'report_sha256': sha(path), 'files': files, 'readme_copies': copies})
    for name in ['support-ui.json', 'support-migrations-before.json', 'support-migrations.json']:
        (DOCS / 'quality' / name).write_bytes((DELIVERY / 'evidence' / name).read_bytes())
    print(json.dumps({'actual_support_screenshots': len(files), 'independent_readme_copies': len(copies)}))


if __name__ == '__main__':
    main()
