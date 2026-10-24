"""Bind current native presentation/capture repairs and retain historical failures."""
import argparse
from datetime import datetime, timezone
import difflib
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui', required=True)
    parser.add_argument('--desktop', required=True)
    args = parser.parse_args()
    output = ROOT / 'docs/quality/creative-feedback-capture-repair-review.json'
    assert not output.exists()
    failures = []
    for attempt, count, reason in [('40', 33, 'restore full creative feedback'),
                                   ('41', 33, 'Timeout 20000ms exceeded'),
                                   ('43', 29, 'brand compact preflight')]:
        file = DELIVERY / f'evidence/desktop-local-ui-{attempt}.json'
        report = read(file)
        assert report['status'] == 'failed' and report['source_unchanged'] and report['owned_database_shutdown']
        journey = read(DELIVERY / report['journey']['path'])
        assert len(journey['checks']) == count and reason in journey['errors'][0]
        failures.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file),
                         'status': 'failed', 'passing_checks_before_failure': count, 'failure': journey['errors'][0]})
    failed = read(DELIVERY / 'evidence/desktop-local-ui-43.json')
    before_navigation = read(DELIVERY / 'evidence/desktop-local-ui-42.json')
    assert before_navigation['status'] == 'passed' and before_navigation['source_unchanged']
    records = []

    def bind(name, archive, expected, scope, assertions=True):
        file = DEV / name
        before, after = archive.read_bytes(), file.read_bytes()
        assert sha256(before).hexdigest() == expected
        if assertions:
            assert [v for v in before.splitlines() if b'assert.' in v] == [v for v in after.splitlines() if b'assert.' in v], name
        records.append({'path': name, 'archive': archive.relative_to(ROOT).as_posix(),
                        'before_sha256': expected, 'after_sha256': digest(file), 'scope': scope,
                        'reviewed_diff': ''.join(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True),
                            fromfile='qualified-before/' + name, tofile='current/' + name))})

    preimages = read(ROOT / 'docs/quality/history/stage82-native-capture-before-unification/receipt.json')['exact_qualified_preimages']
    assert len(preimages) == 8
    for row in preimages:
        assert row['sha256'] == failed['source_files'][row['path']]
        bind(row['path'], ROOT / row['archive'], row['sha256'],
             'Native captures and recordings receive the shared serialized Electron surface capture. Web brand capture defaults remain unchanged.')
        raw = (DEV / row['path']).read_bytes()
        if not row['path'].endswith('brand-library-ui.ts'):
            assert b'await page.screenshot()' not in raw
    native = (DELIVERY / 'scripts/qa-desktop-local.ts').read_text(encoding='utf-8')
    assert 'const captureSurface = () => serializeCapture(' in native and 'webContents.capturePage()' in native
    brand = (DELIVERY / 'scripts/brand-library-ui.ts').read_text(encoding='utf-8')
    assert 'captureSurface?: () => Promise<Buffer>' in brand
    assert 'captureSurface ?? (() => page.screenshot({ type: "jpeg", quality: 85 }))' in brand
    allowed = {row['path'] for row in preimages}
    for name, value in failed['source_files'].items():
        if name not in allowed:
            assert digest(DEV / name) == value, name

    name = 'copypaste-delivery/scripts/creative-feedback-ui.ts'
    first = read(DELIVERY / 'evidence/desktop-local-ui-40.json')
    bind(name, ROOT / 'docs/quality/history/stage82-desktop-40-sources' / name, first['source_files'][name],
         'Native surface injection, actual paint/theme settling, report framing, Windows Ctrl+Home and failure-before-route-restore geometry. Original API, overflow and scroll-position conditions remain; two navigation visibility conditions are added.')
    creative = (DEV / name).read_text(encoding='utf-8')
    assert 'page.keyboard.press("Control+Home")' in creative and 'instanceof CSSTransition' in creative
    assert '[".sidebar",".preference-controls"].every' in creative
    for condition in ['scrollTop>20', 'r.scrollTop+r.clientHeight>=r.scrollHeight-3', 'scrollTop<3']:
        assert condition in creative

    name = 'copypaste-desktop/src/preload.cts'
    archive = ROOT / 'docs/quality/history/stage82-preload-before-navigation/preload.cts'
    old = archive.read_bytes()
    assert sha256(old).hexdigest() == before_navigation['source_files'][name]
    expected = old.replace(b'\r\n', b'\n').replace(b'overflow-x:clip; transform:translateZ(0); }',
        b'overflow-x:clip; transform:translateZ(0); scroll-padding-top:64px; }\n    #root :is(.sidebar,.preference-controls) { translate:0 var(--cp-root-scroll,0px); }')
    expected = expected.replace(b"  // dialogs stay below the native title bar without resetting the user's page.",
        b'  // navigation/preferences remain in view and dialogs stay below the title bar.')
    assert expected == (DEV / name).read_bytes()
    bind(name, archive, before_navigation['source_files'][name],
         'Native-only sidebar/preferences counter-scroll, scroll padding below persistent controls, explanatory comment and LF line endings.', assertions=False)
    current = []
    for stem in ['creative-feedback-ui-' + args.ui, 'desktop-local-ui-' + args.desktop]:
        file = DELIVERY / 'evidence' / (stem + '.json')
        report = read(file)
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
        for row in records:
            assert report['source_files'][row['path']] == row['after_sha256']
        current.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)})
    output.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(),
        'status': 'verified_native_presentation_and_ui_repairs', 'product_source_changes': 1,
        'ui_helper_changes': 9, 'assertions_removed_or_changed': 0, 'additional_navigation_visibility_checks': 2,
        'changed_files': records, 'current_ui_qualifications': current, 'historical_failures': failures,
        'whole_page_return_shortcut': 'Windows Ctrl+Home; focused native-log Home/End remains independently verified',
        'scope': 'Native-only persistent navigation is reviewed separately from shared capture plumbing. All selected core, compatibility, clients, Web/native UI and complete-platform receipts bind current exact sources without source-change waivers. Functional attempt 42 retains its original scope; visual findings prompted the navigation and settled-theme capture repairs. Failed attempts 40, 41 and 43 remain failed.',
        'verifier_sha256': digest(Path(__file__))}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('Reviewed one native presentation file and nine capture helpers; historical failures retained.')


if __name__ == '__main__':
    main()
