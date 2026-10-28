"""Preserve exact candidate evidence once per byte identity, including failed attempts."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import os
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery-cloud-121'
PRIMARY_DELIVERY = DEV / 'copypaste-delivery'
RAW = DELIVERY / '.data/dedicated-cloud-121'
OUT = ROOT / 'docs/quality/dedicated-cloud-evidence-121'
INDEX = OUT / 'index.json'
REPOS = {
    'copypaste-platform-recovery-120': 'copypaste-platform',
    **{f'copypaste-{name}-cloud-121': f'copypaste-{name}' for name in ['web', 'admin', 'desktop', 'extension', 'delivery']},
}
REPOS.update({name: name for name in REPOS.values()})
SELECTED = {
    'backend': RAW / 'full-05.json', 'desktop_units': RAW / 'desktop-01.json',
    'desktop_ui': RAW / 'desktop-ui-07.json', 'web_admin_ui': RAW / 'ui-13.json',
    'extension_ui': RAW / 'extension-ui-05.json', 'client_units': RAW / 'clients-01.json',
    'native_node_contracts': RAW / 'node-08.json', 'sqlite_deep_path': RAW / 'sqlite-01.json',
    'integrated_clients': PRIMARY_DELIVERY / '.data/dedicated-delivered-121/clients-01.json',
}
COUNTERS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']


def digest(body):
    return sha256(body).hexdigest()


def relative(name):
    assert isinstance(name, str) and name and '\\' not in name and ':' not in name
    assert not name.startswith('/') and all(part not in ['', '.', '..'] for part in name.split('/'))
    assert not any(ord(c) < 32 or ord(c) == 127 for c in name)
    return PurePosixPath(name)


def contained(file, base):
    file, base = Path(file), Path(base)
    assert file.resolve().is_relative_to(base.resolve()) and not file.is_symlink(), file
    return file


def read(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def passing(value):
    assert value['tests'] > 0 and value['tests'] == value['pass']
    assert all(value[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])


def checked_reference(base, value):
    file = contained(base / relative(value['path']), base)
    assert digest(file.read_bytes()) == value['sha256'], file
    return file


def tap_counts(file):
    return parse_tap(file.read_text(encoding='utf-8-sig'), str(file))


def parse_tap(body, label):
    assert not re.search(r'^\s*not ok(?:\s|$)', body, re.M), (label, 'Failed TAP case')
    result = {}
    for key in COUNTERS:
        matches = re.findall(r'^# ' + key + r' (\d+)\r?$', body, re.M)
        assert len(matches) == 1, (label, key)
        result[key] = int(matches[0])
    passing(result)
    return result


def verify_archived_reports(index):
    """Recheck raw receipts from committed CAS objects without candidate folders."""
    def body(original):
        item = index['entries'][relative(original).as_posix()]
        value = contained(ROOT / relative(item['blob']), OUT).read_bytes()
        assert digest(value) == item['sha256'] and len(value) == item['bytes']
        return value

    def report(original):
        return json.loads(body(original))

    def referenced(base, ref):
        original = (PurePosixPath(base) / relative(ref['path'])).as_posix()
        value = body(original)
        assert digest(value) == ref['sha256'], original
        return value

    backend = report(index['selected']['backend'])
    base = 'copypaste-delivery-cloud-121'
    inventory = json.loads(referenced(base, backend['raw_report']))
    assert inventory['format'] == backend['verification_mode'] == 'source_bound_complete_inventory_v2'
    plan = json.loads(referenced(base, inventory['plan']))
    assert plan['source_files'] == backend['source_files']
    assert plan['verifier_sha256'] == backend['verifier_sha256']
    assert plan['test_files'] == backend['test_files'] == inventory['test_files']
    assert len(set(plan['test_files'])) == len(plan['test_files'])
    actual_tests = sorted('tests/' + PurePosixPath(name).name for name in plan['source_files']
                          if re.fullmatch(r'copypaste-platform-recovery-120/tests/[a-z0-9-]+\.test\.ts', name))
    assert plan['test_files'] == actual_tests
    epochs = {}
    for ref in inventory['epochs']:
        closed = json.loads(referenced(base, ref))
        assert closed['status'] == 'passed' and closed['native_port_closed']
        epoch = json.loads(referenced(base, closed['epoch']))
        assert epoch['plan_sha256'] == inventory['plan']['sha256']
        assert epoch['id'] not in epochs
        if closed['mode'] == 'actual_child_exit':
            assert not closed['database_started'] or closed['database_exit'] == 0
        else:
            assert closed['mode'] == 'interrupted_owners_observed_gone' and closed['owner_gone']
            for recovery in closed['verified_fixture_recovery']:
                cleanup = json.loads(referenced(base, recovery['cleanup']))
                assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
        epochs[epoch['id']] = (epoch, closed)
    rows = [json.loads(referenced(base, ref)) for ref in inventory['file_receipts']]
    assert [row['test_file'] for row in rows] == plan['test_files']
    totals = {key: 0 for key in COUNTERS}
    for row in rows:
        assert row['status'] == 'passed' and row['exit_code'] == 0 and row['source_unchanged']
        assert row['source_fingerprint'] == plan['source_fingerprint']
        assert row['verifier_sha256'] == backend['verifier_sha256']
        assert row['args'] == ['--env-file=.env', 'scripts/run-tests-owned.mjs', row['test_file']]
        epoch, closed = epochs[row['epoch']]
        assert row['test_file'] in epoch['files']
        if closed['mode'] == 'actual_child_exit':
            assert closed['database_exit'] == 0 and all(c['exit_code'] == 0 for c in closed['checks'])
        tap = referenced(base, row['raw_report']).decode('utf-8-sig')
        counts = parse_tap(tap, row['test_file'])
        assert counts == row['counts']
        markers = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', tap, re.M)
        assert len(markers) == 1 and json.loads(markers[0]) == row['fixture_cleanup']
        assert row['fixture_cleanup']['exit_code'] == 0
        assert row['fixture_cleanup_report']['sha256'] == row['fixture_cleanup']['sha256']
        cleanup = json.loads(referenced(base, row['fixture_cleanup_report']))
        assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
        assert all(item['reclaimed'] for item in cleanup['results'])
        for key in COUNTERS:
            totals[key] += counts[key]
    assert totals == inventory['counts'] == backend['counts']
    for key in ['desktop_units', 'client_units', 'integrated_clients']:
        value = report(index['selected'][key])
        base = 'copypaste-delivery' if key == 'integrated_clients' else 'copypaste-delivery-cloud-121'
        for check in value['checks']:
            assert check['exit_code'] == 0
            raw = referenced(base, check['raw_report'])
            if 'counts' in check:
                assert parse_tap(raw.decode('utf-8-sig'), key) == check['counts']
    for key in ['native_node_contracts', 'sqlite_deep_path']:
        value = report(index['selected'][key])
        raw = referenced('copypaste-delivery-cloud-121', value['raw_report'])
        assert parse_tap(raw.decode('utf-8-sig'), key) == value['counts']


def current_source(report_key, name):
    p = relative(name)
    if p.parts[0] in REPOS:
        original = DEV / p
        canonical = Path('dev') / REPOS[p.parts[0]] / Path(*p.parts[1:])
    else:
        repo = {'desktop_units': 'copypaste-desktop-cloud-121',
                'native_node_contracts': 'copypaste-delivery-cloud-121',
                'sqlite_deep_path': 'copypaste-platform-recovery-120'}[report_key]
        original = DEV / repo / p
        canonical = Path('dev') / REPOS[repo] / p
    return contained(original, DEV), canonical.as_posix()


def selected_reports():
    reports, bindings = {}, {}
    for key, file in SELECTED.items():
        value = read(file)
        assert value['status'] == 'passed' and value['source_unchanged'], file
        if key in ['backend', 'desktop_ui', 'web_admin_ui', 'extension_ui']:
            assert value['owned_database_shutdown'], file
        verifier = file.parent / (file.stem + '-verifier.mjs')
        expected_verifier = value.get('verifier_sha256') or value.get('verifier', {}).get('sha256')
        assert expected_verifier and digest(verifier.read_bytes()) == expected_verifier, file
        for source, expected in value['source_files'].items():
            actual, canonical = current_source(key, source)
            assert digest(actual.read_bytes()) == expected, (file, source)
            archive = file.parent / (file.stem + '-sources') / relative(source)
            assert digest(contained(archive, file.parent).read_bytes()) == expected, archive
            assert canonical not in bindings or bindings[canonical] == expected, canonical
            bindings[canonical] = expected
        reports[key] = value
    backend = reports['backend']
    import record_integrated_recovery as previous_reader
    previous_reader.L = DELIVERY
    passing(previous_reader.raw_counts(SELECTED['backend'], backend))
    expected = ['tests/' + p.name for p in sorted((DEV / 'copypaste-platform-recovery-120/tests').glob('*.test.ts')) if re.fullmatch(r'[a-z0-9-]+\.test\.ts', p.name)]
    assert backend['test_files'] == expected
    for key in ['desktop_units', 'client_units', 'integrated_clients']:
        base = PRIMARY_DELIVERY if key == 'integrated_clients' else DELIVERY
        for check in reports[key]['checks']:
            assert check['exit_code'] == 0
            raw = checked_reference(base, check['raw_report'])
            if 'counts' in check:
                assert tap_counts(raw) == check['counts']
    assert sum(c.get('counts', {}).get('tests', 0) for c in reports['integrated_clients']['checks']) == 338
    for key in ['native_node_contracts', 'sqlite_deep_path']:
        assert tap_counts(checked_reference(DELIVERY, reports[key]['raw_report'])) == reports[key]['counts']
    for key, required in [('desktop_ui', 8), ('web_admin_ui', 8), ('extension_ui', 8)]:
        ref = reports[key]['journey']
        file = contained(DELIVERY / relative(ref['path']), RAW)
        assert digest(file.read_bytes()) == ref['sha256']
        journey = read(file)
        assert journey['status'] == 'passed' and len(journey['checks']) == required and not journey['errors']
        assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
        if key == 'desktop_ui':
            assert journey['electron_closed'] and journey['company_image_calls'] == 1
            assert 'company image/video tools' not in journey['media']['source']
        reports[key + '_journey'] = journey
    return reports, bindings


def walk_files(folder):
    assert contained(folder, DEV).is_dir()
    for directory, directories, files in os.walk(folder, followlinks=False):
        for name in directories:
            assert not (Path(directory) / name).is_symlink()
        for name in sorted(files):
            file = contained(Path(directory) / name, folder)
            assert file.name != '.env' and not file.name.endswith(('.pem', '.key')), file
            yield file


def archive():
    assert not INDEX.exists(), 'The published archive index is immutable'
    reports, bindings = selected_reports()
    OUT.mkdir(parents=True, exist_ok=True)
    entries, objects = {}, {}

    def add(file):
        file = contained(file, DEV)
        name = file.relative_to(DEV).as_posix()
        body = file.read_bytes(); value = digest(body)
        assert len(body) < 90 * 1024 * 1024, file
        blob = OUT / 'blobs' / value[:2] / (value + '.blob')
        blob.parent.mkdir(parents=True, exist_ok=True)
        if blob.exists():
            assert blob.read_bytes() == body
        else:
            with blob.open('xb') as stream:
                stream.write(body)
        assert digest(file.read_bytes()) == value, 'An active writer changed the evidence'
        row = {'sha256': value, 'bytes': len(body), 'blob': blob.relative_to(ROOT).as_posix()}
        assert name not in entries or entries[name] == row
        entries[name] = row; objects[value] = len(body)

    evidence_roots = [RAW, PRIMARY_DELIVERY / '.data/dedicated-delivered-121',
                      PRIMARY_DELIVERY / '.data/dedicated-cloud-integration-121',
                      PRIMARY_DELIVERY / '.data/native-node-distributions/01',
                      DEV / 'copypaste-platform-recovery-120/.data/dedicated-cloud-121/browser-close-diagnostic-03',
                      DEV / 'copypaste-platform-recovery-120/.data/dedicated-cloud-121/core-17-sources']
    for folder in evidence_roots:
        for file in walk_files(folder):
            add(file)
    core_prefix = DEV / 'copypaste-platform-recovery-120/.data/dedicated-cloud-121/core-17'
    for suffix in ['.json', '.tap', '-verifier.mjs']:
        add(Path(str(core_prefix) + suffix))
    diagnostic_log = DEV / 'copypaste-platform-recovery-120/.data/dedicated-cloud-121/browser-close-diagnostic-03.log'
    add(diagnostic_log)
    diagnostic_verifier = diagnostic_log.with_suffix('.mjs')
    add(diagnostic_verifier)
    # Retain available media from failed and superseded journeys too. Only the
    # selected journeys contribute qualification; missing old media stays explicit.
    missing_media = []
    selected_journeys = {reports[key]['journey']['path'] for key in
                         ['desktop_ui', 'web_admin_ui', 'extension_ui']}
    for journey_path in sorted(RAW.glob('*-journey.json')):
        journey = read(journey_path)
        selected = journey_path.relative_to(DELIVERY).as_posix() in selected_journeys
        movies = ([journey['media']] if journey.get('media') else journey.get('recordings', []))
        media = journey.get('screenshots', []) + [file for movie in movies for file in movie['files']]
        for item in media:
            file = contained(DEV / relative(item['path']), DEV)
            if not file.is_file():
                assert not selected, file
                missing_media.append({'journey': journey_path.relative_to(DEV).as_posix(),
                                      'original': item['path']})
                continue
            assert digest(file.read_bytes()) == item['sha256']
            add(file)
        for movie in movies:
            if selected:
                assert movie['skipped_capture_errors'] == 0 and movie['distinct_frames'] > 1
            capture = contained(DEV / relative(movie['raw_capture_directory']), DELIVERY / '.data/workmate-media')
            if not capture.is_dir():
                assert not selected, capture
                missing_media.append({'journey': journey_path.relative_to(DEV).as_posix(),
                                      'original': movie['raw_capture_directory']})
                continue
            for file in walk_files(capture):
                add(file)
    attempts = []
    for p in sorted(RAW.glob('*.json')):
        value = read(p)
        if isinstance(value, dict) and 'status' in value:
            attempts.append({'original': p.relative_to(DEV).as_posix(), 'status': value['status'], 'error': value.get('error')})
    # A verifier without a terminal receipt is retained as an incomplete attempt;
    # it is never promoted to a passing run or treated as proof of a dead process.
    incomplete = []
    for p in sorted(RAW.glob('*-verifier.*')):
        stem = p.name.split('-verifier.')[0]
        if not (RAW / (stem + '.json')).exists():
            incomplete.append({'attempt': stem, 'verifier': p.relative_to(DEV).as_posix(),
                               'status': 'no_terminal_report; liveness_not_inferred'})
    value = {'format': 'copypaste.exact-evidence-cas.v1', 'at': datetime.now(timezone.utc).isoformat(),
             'stage': 121, 'status': 'source_bound_evidence_archived',
             'selected': {key: file.relative_to(DEV).as_posix() for key, file in SELECTED.items()},
             'current_source_files': dict(sorted(bindings.items())), 'workspace_mapping': REPOS,
             'entries': dict(sorted(entries.items())), 'objects': len(objects), 'unique_bytes': sum(objects.values()),
             'attempts': attempts, 'incomplete_attempts': incomplete,
             'unavailable_historical_media': missing_media,
             'original_requirement_count': 102, 'full_product_acceptance': 'not_proven',
             'live_provider_qualified': False, 'actual_linux_host_qualified': False,
             'verifier_sha256': digest(Path(__file__).read_bytes())}
    with INDEX.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')
    verify(False)


def verify(delivered):
    value = read(INDEX)
    assert value['format'] == 'copypaste.exact-evidence-cas.v1'
    assert value['verifier_sha256'] == digest(Path(__file__).read_bytes())
    objects = {}
    for original, item in value['entries'].items():
        relative(original)
        assert re.fullmatch('[a-f0-9]{64}', item['sha256'])
        expected = f"docs/quality/dedicated-cloud-evidence-121/blobs/{item['sha256'][:2]}/{item['sha256']}.blob"
        assert item['blob'] == expected
        if item['sha256'] not in objects:
            body = contained(ROOT / relative(item['blob']), OUT).read_bytes()
            assert digest(body) == item['sha256'] and len(body) == item['bytes']
            objects[item['sha256']] = len(body)
        assert objects[item['sha256']] == item['bytes']
    assert len(objects) == value['objects'] and sum(objects.values()) == value['unique_bytes']
    for key, original in value['selected'].items():
        item = value['entries'][original]
        result = read(ROOT / item['blob'])
        assert result['status'] == 'passed' and result['source_unchanged'], key
    verify_archived_reports(value)
    if delivered:
        for name, expected in value['current_source_files'].items():
            assert digest(contained(ROOT / relative(name), DEV).read_bytes()) == expected, name
        backend = read(ROOT / value['entries'][value['selected']['backend']]['blob'])
        actual_tests = sorted('tests/' + p.name for p in (DEV / 'copypaste-platform/tests').glob('*.test.ts')
                              if re.fullmatch(r'[a-z0-9-]+\.test\.ts', p.name))
        assert backend['test_files'] == actual_tests
    print(json.dumps({'status': 'passed', 'original_paths': len(value['entries']), 'unique_objects': len(objects), 'unique_bytes': value['unique_bytes'], 'qualified_source_files': len(value['current_source_files']), 'delivered_source_checked': delivered}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['archive', 'verify'])
    parser.add_argument('--delivered', action='store_true')
    args = parser.parse_args()
    archive() if args.action == 'archive' else verify(args.delivered)
