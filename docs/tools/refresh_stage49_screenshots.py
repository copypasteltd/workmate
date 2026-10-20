"""Refresh current captures and copy unedited atomic-command screenshots."""
import json
from datetime import datetime, timezone
from refresh_stage48_screenshots import main as refresh_previous
from refresh_stage47_screenshots import ROOT, DOCS, EVIDENCE, safe_file, sha, save


def main():
    refresh_previous()
    for name in ['vip-credit-migrations-before.json', 'vip-credit-migrations.json']:
        source = EVIDENCE / name
        (DOCS / 'quality' / name).write_bytes(source.read_bytes())
    report_path = EVIDENCE / 'admin-vip-credit.json'
    report = json.loads(report_path.read_bytes())
    captures = json.loads((EVIDENCE / 'admin-vip-credit-screenshots.json').read_bytes())
    assert report['status'] == 'passed' and report['errors'] == []
    assert len(report['checks']) == 9 and len(captures['screenshots']) == 12
    assert report['browser_closed'] and report['source_unchanged']
    files = []
    for item in captures['screenshots']:
        source = safe_file(item['file'])
        assert sha(source) == item['sha256']
        name = 'admin-' + source.name.split('-', 1)[1] if '/copypaste-admin/' in item['file'] else 'web-' + source.name.split('-', 1)[1]
        target = DOCS / 'design/implementation' / name
        target.write_bytes(source.read_bytes())
        files.append({'source': item['file'], 'documentation': target.relative_to(ROOT).as_posix(),
                      **{k: v for k, v in item.items() if k != 'file'}})
    save(DOCS / 'quality/vip-credit-screenshot-provenance.json', {
        'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Unedited owned browser captures copied exactly; scroll positions are actual UI states, not reconstructed composites',
        'report': report_path.relative_to(ROOT).as_posix(), 'report_sha256': sha(report_path),
        'capture_report': (EVIDENCE / 'admin-vip-credit-screenshots.json').relative_to(ROOT).as_posix(),
        'capture_report_sha256': sha(EVIDENCE / 'admin-vip-credit-screenshots.json'), 'files': files,
    })
    current = DOCS / 'quality/current-ui-screenshot-provenance.json'
    value = json.loads(current.read_bytes())
    value['scope'] = 'Stage 49 current browser/source-native captures copied byte-for-byte; original stage 48 captures remain archived'
    save(current, value)
    print(json.dumps({'vip_credit_exact_copies': len(files)}))


if __name__ == '__main__':
    main()
