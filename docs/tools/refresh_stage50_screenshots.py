"""Copy actual financial captures, upgrade receipts and local README images."""
from datetime import datetime, timezone
import json
from refresh_stage49_screenshots import ROOT, DOCS, EVIDENCE, main as refresh_previous, safe_file, sha, save


def main():
    refresh_previous()
    current = DOCS / 'quality/current-ui-screenshot-provenance.json'
    current_provenance = json.loads(current.read_bytes())
    current_provenance['scope'] = 'Stage 50 current browser/source-native context captures copied byte-for-byte; original stage 49 captures remain archived separately'
    save(current, current_provenance)
    report_path = EVIDENCE / 'financial-ui.json'
    report = json.loads(report_path.read_bytes())
    captures_path = EVIDENCE / 'financial-ui-screenshots.json'
    captures = json.loads(captures_path.read_bytes())
    assert report['status'] == 'passed' and not report['errors']
    assert len(report['checks']) == 8 and len(captures['screenshots']) == 8
    assert report['source_unchanged'] and report['browser_closed'] and report['desktop_closed'] and report['extension_closed']
    assert report['source_files'] == captures['source_files']
    names = {
        '39-financial-inbox.png': 'web-financial-inbox.png',
        '40-financial-unknown.png': 'web-financial-unknown.png',
        '41-financial-narrow-dark.png': 'web-financial-narrow-dark.png',
        '42-financial-offline.png': 'web-financial-offline.png',
        '28-financial-inbox.png': 'desktop-financial-inbox.png',
        '29-financial-unknown.png': 'desktop-financial-unknown.png',
        '17-financial-inbox.png': 'extension-financial-inbox.png',
        '18-financial-unknown.png': 'extension-financial-unknown.png',
    }
    files = []
    for item in captures['screenshots']:
        source = safe_file(item['file'])
        assert sha(source) == item['sha256']
        target = DOCS / 'design/implementation' / names[source.name]
        target.write_bytes(source.read_bytes())
        files.append({'source': item['file'], 'documentation': target.relative_to(ROOT).as_posix(),
                      **{k:v for k,v in item.items() if k != 'file'}})
    save(DOCS / 'quality/financial-screenshot-provenance.json', {
        'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Eight actual unedited owned Web, packaged Desktop and native SIDE_PANEL screenshots; copied without rendering or reconstruction',
        'report_sha256': sha(report_path), 'capture_report_sha256': sha(captures_path), 'files': files,
    })
    for name in ['financial-migrations-before.json', 'financial-migrations.json', 'financial-ui.json',
                 'financial-ui-contract-samples.json', 'financial-ui-screenshots.json']:
        (DOCS / 'quality' / name).write_bytes((EVIDENCE / name).read_bytes())
    copies = []
    for repo, source_name, target_name in [
        ('copypaste-platform', 'web-financial-inbox.png', 'financial-inbox.png'),
        ('copypaste-admin', 'web-financial-inbox.png', 'financial-client-inbox.png'),
        ('copypaste-delivery', 'web-financial-inbox.png', 'financial-web.png'),
        ('copypaste-delivery', 'desktop-financial-inbox.png', 'financial-desktop.png'),
        ('copypaste-delivery', 'extension-financial-inbox.png', 'financial-extension.png'),
    ]:
        source = DOCS / 'design/implementation' / source_name
        target = ROOT / 'dev' / repo / 'assets/screenshots' / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': sha(source)})
    # Existing cross-repository README copies also follow their new actual QA
    # images; their former bytes are retained in the phase 49 flat archive.
    previous = DOCS / 'quality/vip-credit-readme-screenshots.json'
    value = json.loads(previous.read_bytes())
    for item in value['files']:
        source, target = ROOT / item['source'], ROOT / item['target']
        target.write_bytes(source.read_bytes())
        item['sha256'] = sha(source)
    save(previous, value)
    save(DOCS / 'quality/financial-readme-screenshots.json', {'files': copies})
    print(json.dumps({'financial_exact_copies': len(files), 'financial_repository_copies':len(copies)}))


if __name__ == '__main__':
    main()
