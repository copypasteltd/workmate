"""Copy actual QA captures and reproduce explicitly recorded viewport crops."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
EVIDENCE = ROOT / 'dev/copypaste-delivery/evidence'


def safe_file(relative):
    result = (ROOT / relative).resolve()
    assert result.is_relative_to(ROOT)
    return result


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def save(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def refresh_existing(name):
    receipt = DOCS / 'quality' / name
    value = json.loads(receipt.read_bytes())
    for item in value['files']:
        if 'source' in item:
            source, target = safe_file(item['source']), safe_file(item['documentation'])
            target.write_bytes(source.read_bytes())
            item['sha256'] = sha(source)
            assert sha(target) == item['sha256']
        else:
            source, target = safe_file(item['original']), safe_file(item['viewport'])
            with Image.open(source) as image:
                left, top, right, bottom = item['crop']
                assert 0 <= left < right <= image.width and 0 <= top < bottom <= image.height
                image.crop((left, top, right, bottom)).save(target, 'PNG')
            repository_copy = ROOT / 'dev/copypaste-admin/assets/screenshots' / target.name
            repository_copy.write_bytes(target.read_bytes())
            item['original_sha256'], item['viewport_sha256'] = sha(source), sha(target)
    value['at'] = datetime.now(timezone.utc).isoformat()
    if 'raw_receipt' in value:
        value['raw_receipt_sha256'] = sha(safe_file(value['raw_receipt']))
        raw = json.loads(safe_file(value['raw_receipt']).read_bytes())
        by_source = {s['file']: s for s in raw['screenshots']}
        for item in value['files']:
            for key in ['url', 'viewport', 'locale', 'theme']:
                if key in by_source.get(item.get('source'), {}):
                    item[key] = by_source[item['source']][key]
    if name == 'current-ui-screenshot-provenance.json':
        value['scope'] = 'Stage 47 actual browser/source-native captures copied byte-for-byte; no synthesized or edited UI'
    save(receipt, value)
    return len(value['files'])


def main():
    copied = {name: refresh_existing(name) for name in [
        'current-ui-screenshot-provenance.json', 'payment-screenshot-provenance.json',
        'refund-screenshot-provenance.json', 'plan-screenshot-provenance.json']}
    names = {
        '60-vip-directory.png': 'admin-vip-directory.png',
        '61-vip-retained-error.png': 'admin-vip-retained-error.png',
        '62-vip-frozen-comparison.png': 'admin-vip-comparison.png',
        '63-vip-pending-review.png': 'admin-vip-pending.png',
        '64-vip-independent-review.png': 'admin-vip-independent-review.png',
        '65-vip-origin-and-history.png': 'admin-vip-origin.png',
        '66-vip-suspended-history.png': 'admin-vip-suspended-history.png',
        '67-vip-mobile-dark.png': 'admin-vip-mobile.png',
        '68-vip-mobile-frozen-preview.png': 'admin-vip-mobile-preview.png',
        '67-effective-entitlements.png': 'web-effective-entitlements.png',
        '68-entitlements-mobile-dark.png': 'web-entitlements-mobile.png',
        '26-vip-effective-rights.png': 'desktop-vip-effective.png',
        '27-vip-suspended-rights.png': 'desktop-vip-suspended.png',
        '15-vip-effective-rights.png': 'extension-vip-effective.png',
        '16-vip-suspended-rights.png': 'extension-vip-suspended.png',
    }
    files, receipts = [], []
    for label, report_name, screenshot_name in [
        ('admin', 'admin-vip.json', 'admin-vip-screenshots.json'),
        ('native', 'native-vip.json', 'native-vip-screenshots.json')]:
        report_path = EVIDENCE / report_name
        if label == 'native' and not report_path.exists():
            continue
        report = json.loads(report_path.read_bytes())
        assert report['status'] == 'passed' and not report['errors']
        assert report['source_unchanged'] and report['browser_closed']
        raw_path = EVIDENCE / screenshot_name
        raw = json.loads(raw_path.read_bytes())
        receipts.append({'report': report_path.relative_to(ROOT).as_posix(),
                         'report_sha256': sha(report_path),
                         'screenshots': raw_path.relative_to(ROOT).as_posix(),
                         'screenshots_sha256': sha(raw_path)})
        for item in raw['screenshots']:
            source = safe_file(item['file'])
            assert sha(source) == item['sha256']
            target = DOCS / 'design/implementation' / names[source.name]
            target.write_bytes(source.read_bytes())
            assert sha(target) == item['sha256']
            files.append({'source': item['file'], 'documentation': target.relative_to(ROOT).as_posix(),
                          'sha256': item['sha256'], **{k: v for k, v in item.items() if k not in {'file', 'sha256'}}})
    save(DOCS / 'quality/vip-screenshot-provenance.json', {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Actual unedited owned Admin/Web and, when passed, packaged Desktop/native SIDE_PANEL captures; exact byte copies, no synthetic UI',
        'receipts': receipts, 'files': files,
    })
    print(json.dumps({'refreshed_existing': copied, 'vip_exact_copies': len(files)}))


if __name__ == '__main__':
    main()
