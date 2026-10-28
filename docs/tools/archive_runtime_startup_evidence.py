"""Archive exact Stage 122 native receipts, including failures, without rewriting history."""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUT = ROOT / 'docs/quality/runtime-startup-evidence-122'
INDEX = OUT / 'index.json'
SELECTED = {
    'cloud_native': '.data/runtime-startup-122/platform-01/receipt.json',
    'desktop_native': '.data/runtime-startup-122/desktop-02/receipt.json',
    'web': '.data/runtime-startup-122/web-01/receipt.json',
    'worker_billing': '.data/runtime-billing-122/backend-04.json',
    'desktop_ui': '.data/runtime-startup-122/ui/desktop-ui-02.json',
}
MAPPING = {'copypaste-platform-runtime-122': 'copypaste-platform',
           'copypaste-desktop-runtime-122': 'copypaste-desktop',
           'copypaste-web-runtime-122': 'copypaste-web', 'copypaste-delivery': 'copypaste-delivery'}


def digest(body):
    return sha256(body).hexdigest()


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def safe(name):
    assert isinstance(name, str) and '\\' not in name
    p = Path(name)
    assert not p.anchor and '..' not in p.parts and ':' not in name
    return ROOT / p


def passing(value):
    assert value['status'] == 'passed' and value['source_unchanged'] is True


def counts(raw, expected=None):
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        assert len(re.findall(r'^# ' + key + r' (\d+)\r?$', raw.decode(), re.M)) == 1
    result = {key: int(re.search(r'^# ' + key + r' (\d+)\r?$', raw.decode(), re.M)[1])
              for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
    assert result['tests'] > 0 and result['pass'] == result['tests']
    assert all(result[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    if expected is not None:
        assert result == expected
    return result


def selected_conditions(selected):
    assert set(selected) == set(SELECTED)
    for value in selected.values():
        passing(value)
    assert [s['counts']['pass'] for s in selected['cloud_native']['steps'] if 'counts' in s] == [12]
    assert [s['counts']['pass'] for s in selected['desktop_native']['steps'] if 'counts' in s] == [180, 25]
    assert [s['counts']['pass'] for s in selected['web']['steps'] if 'counts' in s] == [20]
    billing, ui = selected['worker_billing'], selected['desktop_ui']
    assert billing['test_files'] == ['tests/seo-change-tasks.test.ts', 'tests/billing-sources.test.ts',
                                      'tests/internal-ai-gateway.test.ts', 'tests/provider-request-control.test.ts',
                                      'tests/runtime-startup-billing.test.ts']
    assert billing['owned_database_shutdown'] and billing['owned_database_port_closed'] and billing['fixture_cleanup']
    assert billing['counts'] == {'tests': 79, 'pass': 79, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert ui['journey_checks'] == 8 and ui['package_unchanged'] and ui['owned_database_shutdown']
    assert ui['fixture_cleanup']['status'] == 'passed' and ui['fixture_cleanup']['exit_code'] == 0


def reports():
    selected = {key: read(DELIVERY / name) for key, name in SELECTED.items()}
    selected_conditions(selected)
    billing, ui = selected['worker_billing'], selected['desktop_ui']
    # Current runtime bytes must be the bytes used by both real native and UI runs.
    native = read(DELIVERY / '.data/runtime-startup-122/platform-01/source-bindings.json')
    assert native['copypaste-platform-runtime-122/src/runtime.ts'] == ui['source_files']['copypaste-platform-runtime-122/src/runtime.ts']
    desktop = read(DELIVERY / '.data/runtime-startup-122/desktop-02/source-bindings.json')
    for name, value in desktop.items():
        if name.startswith('copypaste-desktop-runtime-122/'):
            assert ui['source_files'][name] == value, name
    web = read(DELIVERY / '.data/runtime-startup-122/web-01/source-bindings.json')
    for name, expected in web.items():
        assert ui['source_files'][name] == expected, name
    for name, value in billing['source_files'].items():
        target = name.replace('copypaste-platform/', 'copypaste-platform-runtime-122/', 1)
        if target in ui['source_files']:
            if ui['source_files'][target] != value:
                # Only the newly authored integration fixture was split after
                # UI qualification. The final existing SEO file is exactly the
                # earlier 18-case native-qualified version, and the final full
                # billing run covers it plus the independent recovery fixture.
                assert target == 'copypaste-platform-runtime-122/tests/seo-change-tasks.test.ts', name
                assert native[target] == value, name
        assert digest((DEV / target).read_bytes()) == value, name
    return selected


def archive():
    selected = reports()
    OUT.mkdir(parents=True, exist_ok=True)
    assert not INDEX.exists()
    entries = {}
    from audit_workmate_publication import configured_credentials
    credentials = configured_credentials()

    def add(file):
        file = file.resolve()
        assert file.is_relative_to(DEV.resolve()) and file.is_file()
        body = file.read_bytes()
        assert not any(secret in body for secret in credentials), 'Configured credential in archive input: ' + file.relative_to(ROOT).as_posix()
        key = digest(body)
        previous = ROOT / f'docs/quality/dedicated-cloud-evidence-121/blobs/{key[:2]}/{key}.blob'
        blob = previous if previous.exists() else OUT / f'blobs/{key[:2]}/{key}.blob'
        if blob.exists():
            assert blob.read_bytes() == body
        else:
            blob.parent.mkdir(parents=True, exist_ok=True)
            with blob.open('xb') as stream:
                stream.write(body)
        entries[file.relative_to(ROOT).as_posix()] = {'sha256': key, 'bytes': len(body), 'blob': blob.relative_to(ROOT).as_posix()}

    for scope in ['platform-01', 'desktop-01', 'desktop-02', 'web-01']:
        folder = DELIVERY / '.data/runtime-startup-122' / scope
        for file in sorted(folder.rglob('*')):
            assert not file.is_symlink()
            if file.is_file():
                add(file)
    for folder, pattern in [(DELIVERY / '.data/runtime-billing-122', 'backend-0[1234]*'),
                            (DELIVERY / '.data/runtime-startup-122/ui', 'desktop-ui-0[12]*')]:
        for file in sorted(folder.glob(pattern)):
            if file.is_file():
                add(file)
            else:
                for child in sorted(file.rglob('*')):
                    assert not child.is_symlink()
                    if child.is_file():
                        add(child)
    ui = selected['desktop_ui']
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and len(journey['checks']) == 8 and not journey['errors']
    assert len(journey['screenshots']) == 6 and len(journey['media']['files']) == 2
    assert journey['media']['distinct_frames'] > 1 and journey['media']['skipped_capture_errors'] == 0
    for flag in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed', 'native_browser_fixture_closed', 'media_provider_closed']:
        assert journey[flag] is True
    for media in journey['screenshots'] + journey['media']['files']:
        file = DEV / media['path']
        assert digest(file.read_bytes()) == media['sha256']
        add(file)
    capture = DEV / journey['media']['raw_capture_directory']
    assert capture.resolve().is_relative_to((DELIVERY / '.data/workmate-media').resolve())
    for file in sorted(capture.rglob('*')):
        assert not file.is_symlink()
        if file.is_file():
            add(file)
    bindings = {}
    for name, expected in selected['worker_billing']['source_files'].items():
        bindings['dev/' + name] = expected
    for name, expected in ui['source_files'].items():
        repo, relative = name.split('/', 1)
        target = 'dev/' + MAPPING[repo] + '/' + relative
        if target in bindings and bindings[target] != expected:
            assert name == 'copypaste-platform-runtime-122/tests/seo-change-tasks.test.ts'
            continue
        assert digest((DEV / name).read_bytes()) == expected, name
        bindings[target] = expected
    index = {'format': 'copypaste.runtime-startup-evidence.v1', 'verifier_sha256': digest(Path(__file__).read_bytes()),
             'selected': {key: 'dev/copypaste-delivery/' + name for key, name in SELECTED.items()},
             'entries': entries, 'current_source_files': bindings, 'source_workspace_mapping': MAPPING,
             'superseded_ui_test_fixture': {
                 'path': 'dev/copypaste-platform/tests/seo-change-tasks.test.ts',
                 'ui_execution_sha256': ui['source_files']['copypaste-platform-runtime-122/tests/seo-change-tasks.test.ts'],
                 'final_full_regression_sha256': bindings['dev/copypaste-platform/tests/seo-change-tasks.test.ts'],
                 'reason': 'Restore the original 18 SEO cases; prepare the new real recovery fixture in its own test file. Runtime assertion limit stays 120 seconds.'},
             'scope': 'Bounded native startup, turn isolation, same-task billing, and packaged Desktop UI; synthetic company responses.'}
    with INDEX.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(index, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    verify(False)


def verify(delivered=False):
    value = read(INDEX)
    assert value['format'] == 'copypaste.runtime-startup-evidence.v1'
    assert value['verifier_sha256'] == digest(Path(__file__).read_bytes())
    cache = {}
    for original, item in value['entries'].items():
        assert safe(original).is_relative_to(DEV)
        key = item['sha256']
        assert re.fullmatch('[a-f0-9]{64}', key)
        assert item['blob'] in [f'docs/quality/{folder}/blobs/{key[:2]}/{key}.blob'
                               for folder in ['dedicated-cloud-evidence-121', 'runtime-startup-evidence-122']]
        if key not in cache:
            cache[key] = safe(item['blob']).read_bytes()
        assert digest(cache[key]) == key and len(cache[key]) == item['bytes']
    def body(original):
        return cache[value['entries'][original]['sha256']]
    selected = {key: json.loads(body(original)) for key, original in value['selected'].items()}
    selected_conditions(selected)
    first_billing = json.loads(body('dev/copypaste-delivery/.data/runtime-billing-122/backend-01.json'))
    assert first_billing['status'] == 'failed' and first_billing['source_unchanged']
    assert first_billing['counts'] == {'tests': 79, 'pass': 78, 'fail': 0, 'cancelled': 1, 'skipped': 0, 'todo': 0}
    failed_raw = body('dev/copypaste-delivery/' + first_billing['raw_report']['path'])
    assert digest(failed_raw) == first_billing['raw_report']['sha256']
    assert b'test timed out after 120000ms' in failed_raw
    assert first_billing['owned_database_shutdown'] and first_billing['owned_database_port_closed']
    isolated_failure = json.loads(body('dev/copypaste-delivery/.data/runtime-billing-122/backend-02.json'))
    assert isolated_failure['status'] == 'failed' and isolated_failure['source_unchanged']
    assert isolated_failure['counts'] == {'tests': 1, 'pass': 0, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert isolated_failure['owned_database_shutdown'] and isolated_failure['owned_database_port_closed']
    isolated_raw = body('dev/copypaste-delivery/' + isolated_failure['raw_report']['path'])
    assert digest(isolated_raw) == isolated_failure['raw_report']['sha256']
    assert b"'draft_ready'" in isolated_raw and b"'failed'" in isolated_raw
    focused = json.loads(body('dev/copypaste-delivery/.data/runtime-billing-122/backend-03.json'))
    passing(focused)
    assert focused['test_files'] == ['tests/runtime-startup-billing.test.ts']
    assert focused['counts'] == {'tests': 1, 'pass': 1, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    focused_raw = body('dev/copypaste-delivery/' + focused['raw_report']['path'])
    assert digest(focused_raw) == focused['raw_report']['sha256']
    counts(focused_raw, focused['counts'])
    for key, report in selected.items():
        passing(report)
        original = Path(value['selected'][key])
        if 'steps' in report:
            assert digest(body((original.parent / 'verifier.mjs').as_posix())) == report['verifier_sha256']
            binding_bytes = body((original.parent / 'source-bindings.json').as_posix())
            assert digest(binding_bytes) == report['bindings_sha256']
            for name, expected in json.loads(binding_bytes).items():
                assert digest(body((original.parent / 'sources' / name).as_posix())) == expected, name
            for step in report['steps']:
                raw = body((original.parent / (step['name'] + '.tap')).as_posix())
                assert step['passed'] and step['code'] == 0 and digest(raw) == step['sha256']
                if 'counts' in step:
                    counts(raw, step['counts'])
        else:
            prefix = original.as_posix().removesuffix('.json')
            assert digest(body(prefix + '-verifier.mjs')) == report['verifier_sha256']
            for name, expected in report['source_files'].items():
                assert digest(body(prefix + '-sources/' + name)) == expected, name
            raw = body('dev/copypaste-delivery/' + report['raw_report']['path'])
            assert digest(raw) == report['raw_report']['sha256']
            if 'counts' in report:
                counts(raw, report['counts'])
                markers = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', raw.decode(), re.M)
                assert len(markers) == 1
                marker = json.loads(markers[0])
                cleanup_body = body('dev/copypaste-delivery/' + report['fixture_cleanup']['path'])
                assert marker['exit_code'] == report['fixture_cleanup']['exit_code'] == 0
                assert digest(cleanup_body) == marker['sha256'] == report['fixture_cleanup']['sha256']
                cleanup = json.loads(cleanup_body)
                assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
                assert all(row['reclaimed'] for row in cleanup['results'])
            if 'journey' in report:
                journey_body = body('dev/copypaste-delivery/' + report['journey']['path'])
                assert digest(journey_body) == report['journey']['sha256']
                assert digest(body(prefix + '-journey-verifier.ts')) == report['journey_verifier_sha256']
                journey = json.loads(journey_body)
                assert journey['status'] == 'passed' and len(journey['checks']) == 8 and not journey['errors']
                for flag in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed', 'native_browser_fixture_closed', 'media_provider_closed']:
                    assert journey[flag] is True
                for media in journey['screenshots'] + journey['media']['files']:
                    assert digest(body('dev/' + media['path'])) == media['sha256']
    if delivered:
        for name, expected in value['current_source_files'].items():
            assert digest(safe(name).read_bytes()) == expected, name
    result = {'status': 'passed', 'entries': len(value['entries']), 'unique_blobs': len(cache),
              'source_bindings': len(value['current_source_files']), 'delivered_sources_checked': delivered}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['archive', 'verify'])
    parser.add_argument('--delivered', action='store_true')
    args = parser.parse_args()
    archive() if args.action == 'archive' else verify(args.delivered)
