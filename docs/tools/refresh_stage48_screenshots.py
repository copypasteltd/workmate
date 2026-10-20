"""Refresh current raw captures and add byte-exact enterprise-capacity images."""
from datetime import datetime, timezone
import json
from refresh_stage47_screenshots import ROOT, DOCS, EVIDENCE, main as refresh_previous, safe_file, sha, save


def main():
    refresh_previous()
    for name in ['resource-migrations-before.json', 'resource-migrations.json',
                 'resource-erasure-migrations-before.json', 'resource-erasure-migrations.json']:
        source, target = EVIDENCE / name, DOCS / 'quality' / name
        target.write_bytes(source.read_bytes())
        assert sha(target) == sha(source)
    current = DOCS / 'quality/current-ui-screenshot-provenance.json'
    previous = json.loads(current.read_bytes())
    previous['scope'] = 'Stage 48 actual browser/source-native captures copied byte-for-byte; no synthesized or edited UI'
    save(current, previous)
    report_path = EVIDENCE / 'resource-ui.json'
    report = json.loads(report_path.read_bytes())
    assert report['status'] == 'passed' and report['errors'] == []
    assert len(report['checks']) == 8 and len(report['screenshots']) == 8
    assert report['source_unchanged'] and report['browser_closed']
    names = {
        '71-workspace-resource-usage.png': 'web-workspace-capacity.png',
        '72-members-resource-capacity.png': 'web-member-capacity.png',
        '73-resource-capacity-mobile-dark.png': 'web-capacity-mobile.png',
        '74-resource-over-capacity.png': 'web-capacity-exceeded.png',
        '71-admin-workspace-capacity.png': 'admin-workspace-capacity.png',
        '72-admin-capacity-mobile-dark.png': 'admin-capacity-mobile.png',
        '73-admin-over-capacity.png': 'admin-capacity-exceeded.png',
        '74-admin-capacity-permission-revoked.png': 'admin-capacity-permission-revoked.png',
    }
    files = []
    for item in report['screenshots']:
        source = safe_file(item['file'])
        assert sha(source) == item['sha256']
        target = DOCS / 'design/implementation' / names[source.name]
        target.write_bytes(source.read_bytes())
        assert sha(target) == item['sha256']
        files.append({'source': item['file'], 'documentation': target.relative_to(ROOT).as_posix(),
                      'sha256': item['sha256'],
                      **{k: v for k, v in item.items() if k not in {'file', 'sha256'}}})
    save(DOCS / 'quality/resource-screenshot-provenance.json', {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Actual owned browser captures, exact copies; no synthetic UI',
        'report': report_path.relative_to(ROOT).as_posix(), 'report_sha256': sha(report_path),
        'files': files,
    })
    print(json.dumps({'resource_exact_copies': len(files)}))


if __name__ == '__main__':
    main()
