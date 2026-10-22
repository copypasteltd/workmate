"""Verify bounded Desktop proofs and preserve their exact source/evidence bytes."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def digest(file):
    return sha256(file.read_bytes()).hexdigest()

def exclusive(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('xb') as handle:
        handle.write(data)

def main():
    parser = argparse.ArgumentParser()
    for flag in ('control', 'native', 'ui'):
        parser.add_argument('--' + flag, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(args, k)) for k in ('control', 'native', 'ui'))
    evidence = DELIVERY / 'evidence'
    names = [f'desktop-execution-control-{args.control}.json', f'local-codex-native-{args.native}.json', f'desktop-local-ui-{args.ui}.json']
    control, native, ui = reports = [read(evidence / name) for name in names]
    assert all(r['status'] == 'passed' and r['source_unchanged'] for r in reports)
    assert control['native_binary_exercised'] and control['owned_database_shutdown']
    assert control['scope'] == 'desktop_server_contract_and_existing_cloud_regressions'
    assert control['counts']['tests'] >= 11 and control['counts']['pass'] == control['counts']['tests']
    assert native['counts'] == {'tests': 10, 'pass': 10, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert ui['counts'] == {'journey_checks': 7, 'errors': 0} and ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert len(ui['checks']) == 11 and all(c['exit_code'] == 0 for c in ui['checks'])
    assert ui['fixture_cleanup']['status'] == 'passed' and ui['fixture_cleanup']['exit_code'] == 0
    assert all(r['reclaimed'] for r in ui['fixture_cleanup']['results'])
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and all(journey[k] for k in ('electron_closed', 'browser_closed', 'api_closed', 'fixture_closed'))
    assert len(journey['checks']) == 7 and len(journey['screenshots']) == 4
    assert journey['media']['skipped_capture_errors'] == 0 and journey['media']['observed_frames'] >= 5 and journey['media']['distinct_frames'] >= 2
    for report in (control, ui):
        for key in ('raw_report', 'verifier') + (('journey', 'journey_verifier', 'fixture_cleanup') if report is ui else ()):
            proof = report[key]
            assert digest(DELIVERY / proof['path']) == proof['sha256'], proof['path']
    assert digest(DELIVERY / native['raw_report']) == native['raw_sha256']
    sources = {}
    for report in reports:
        for file, expected in report['source_files'].items():
            source = ('copypaste-desktop/' + file) if report is native else file
            assert digest(DEV / source) == expected, source
            if source in sources:
                assert sources[source] == expected
            sources[source] = expected
    log = (DELIVERY / ui['raw_report']['path']).read_text(encoding='utf-8')
    assert re.search(r'^# tests 37$', log, re.M) and re.search(r'^# pass 37$', log, re.M)
    assert re.search(r'^# fail 0$', log, re.M) and re.search(r'^# skipped 0$', log, re.M)
    for item in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / item['path']) == item['sha256'], item['path']
    for item in journey['media']['files']:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(DEV / item['path']), '-f', 'null', '-'], check=True, capture_output=True)
    asar = (DELIVERY / ui['packaged']['executable']).resolve().parent / 'resources/app.asar'
    assert asar.is_relative_to(DEV) and digest(asar) == ui['packaged']['app_asar_sha256']
    archived = []
    archive = ROOT / 'docs/quality/history/desktop-local-product-qualified-sources'
    for source, expected in sorted(sources.items()):
        if source.startswith('copypaste-desktop/') or any(x in source for x in ('desktop-execution', 'desktop-local', 'desktop-runtime', 'desktop-tool-policy')):
            target = archive / (source.replace('/', '__') + '.txt')
            exclusive(target, (DEV / source).read_bytes())
            assert digest(target) == expected
            archived.append({'source': 'dev/' + source, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': expected})
    attempts = []
    for prefix, number in [('desktop-execution-control', args.control), ('desktop-local-ui', args.ui), ('local-codex-native', args.native)]:
        for index in range(1, int(number) + 1):
            file = evidence / f'{prefix}-{index:02}.json'
            previous = read(file)
            attempts.append({'path': 'dev/copypaste-delivery/evidence/' + file.name, 'sha256': digest(file), 'status': previous['status'], 'counts': previous['counts'],
                             'scope': 'Original attempt retained; only the selected passing reports bind the current source'})
    for name in names + [f'desktop-local-ui-{args.ui}-journey.json']:
        exclusive(ROOT / 'docs/quality' / name, (evidence / name).read_bytes())
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_native_desktop_product_subset', 'requirements': 'CLIENT01 DESK-L01–L08',
              'selected': vars(args), 'source_files_verified': len(sources), 'source_archives': archived,
              'control_tests': control['counts'], 'native_tests': native['counts'], 'desktop_unit_tests': 37,
              'native_ui_checks': journey['checks'], 'screenshots': journey['screenshots'], 'media': journey['media'], 'full_media_decode': 'passed',
              'packaged': ui['packaged'], 'attempts': attempts,
              'limits': ['Model/provider responses and native chooser/dialog decisions are explicit fixtures; native Codex, Electron, auth, files, sandbox, API and ledger actually run',
                         'Unsigned Windows x64 candidate; human OS-dialog clicks, production model, signing and full OS/app matrix remain unqualified',
                         'Five native software/landing-page roles admitted; all eighteen role and media-tool qualification remains required',
                         '102 REQ/102 TC/NFR/G01–G10 baseline remains 81 partial, 21 unproven, zero fully accepted'],
              'verifier_sha256': digest(Path(__file__))}
    exclusive(ROOT / 'docs/quality/desktop-local-execution-checkpoint.json', (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'status': result['status'], 'source_files': len(sources), 'control_tests': control['counts']['tests'], 'native_tests': 10, 'unit_tests': 37, 'ui_checks': 7}))

if __name__ == '__main__':
    main()
