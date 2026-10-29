"""Retain exact administrator-revision runs and failures with current source bindings."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from itertools import islice
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
QUALITY = ROOT / 'docs/quality'
OUT = QUALITY / 'admin-content-evidence-123'
INDEX = OUT / 'index.json'
MAPPING = {'copypaste-platform': 'copypaste-platform',
           'copypaste-admin': 'copypaste-admin',
           'copypaste-admin-content-123': 'copypaste-admin',
           'copypaste-delivery': 'copypaste-delivery'}
EXPECTED_TESTS = ['tests/admin-content-revisions.test.ts', 'tests/agent-groups.test.ts',
                  'tests/project-configuration.test.ts', 'tests/solutions.test.ts',
                  'tests/schema-compatibility.test.ts']


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(body):
    return sha256(body).hexdigest()


def contents(paths):
    """Bound independent reads; retain at most sixteen prefetched bodies."""
    iterator = iter(paths)
    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = deque((p, pool.submit(p.read_bytes)) for p in islice(iterator, 16))
        while pending:
            path, future = pending.popleft()
            yield path, future.result()
            next_path = next(iterator, None)
            if next_path is not None:
                pending.append((next_path, pool.submit(next_path.read_bytes)))


def safe(name):
    assert isinstance(name, str) and '\\' not in name
    p = Path(name)
    assert not p.anchor and '..' not in p.parts and ':' not in name
    target = ROOT / p
    assert target.resolve().is_relative_to(ROOT.resolve())
    return target


def conditions(backend, ui, journey, raw):
    for result in [backend, ui]:
        assert result['status'] == 'passed' and result['source_unchanged'] is True
        assert result['owned_database_shutdown'] and result['owned_database_port_closed']
    assert backend['scope'] == 'admin_content_revisions_full'
    assert backend['test_files'] == EXPECTED_TESTS and backend['test_exit'] == 0
    counts = {}
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        values = re.findall(r'^# ' + key + r' (\d+)\r?$', raw.decode(), re.M)
        assert len(values) == 1
        counts[key] = int(values[0])
    assert counts == backend['counts'] and counts['tests'] == 75 and counts['pass'] == counts['tests']
    assert all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    for label in ['reference search exposes actual shared project files',
                  'revision history uses stable bounded pages']:
        assert len(re.findall(r'^ok \d+ - ' + label, raw.decode(), re.M)) == 1
    assert backend['fixture_cleanup']['exit_code'] == 0
    assert ui['journey_exit_code'] == 0 and ui['owned_preview_closed']
    assert all(check['exit_code'] == 0 for check in ui['checks'])
    assert ui['fixture_cleanup']['status'] == 'passed' and ui['fixture_cleanup']['exit_code'] == 0
    assert ui['fixture_cleanup']['workers_exited'] and ui['fixture_cleanup']['actual_filesystem_checked']
    assert all(r['reclaimed'] for r in ui['fixture_cleanup']['results'])
    assert journey['status'] == 'passed' and len(journey['checks']) == 7 and journey['errors'] == []
    assert journey['model_calls'] == 0 and len(journey['screenshots']) == 6
    layouts = journey['layout_checks']
    assert len(layouts) >= 7
    assert {row['viewport_width'] for row in layouts} == {375, 768, 1024, 1440}
    assert all(row['page_fits'] and row['dialog_content_fits'] and row['fields_inside_viewport']
               and row['visible_fields'] > 0 and row['dialog_left'] >= -1
               and row['dialog_right'] <= row['viewport_width'] + 1 for row in layouts)
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert len(journey['recordings']) == 2
    for recording in journey['recordings']:
        assert recording['observed_frames'] >= 5 and recording['distinct_frames'] > 1
        assert recording['skipped_capture_errors'] == 0 and len(recording['files']) == 2


def retained_bindings(index, archived, backend, ui, journey):
    """Check saved originals independently of the current working directories."""
    bindings = {}
    for key, result in [('backend', backend), ('ui', ui)]:
        selected = index['selected'][key]
        assert selected.endswith('.json')
        prefix = selected[:-5]
        for name, expected in result['source_files'].items():
            assert digest(archived(prefix + '-sources/' + name)) == expected, name
            repo, relative = name.split('/', 1)
            target = 'dev/' + MAPPING[repo] + '/' + relative
            assert target not in bindings or bindings[target] == expected
            bindings[target] = expected
        cleanup_name = 'dev/copypaste-delivery/' + result['fixture_cleanup']['path']
        cleanup_bytes = archived(cleanup_name)
        assert digest(cleanup_bytes) == result['fixture_cleanup']['sha256']
        cleanup = json.loads(cleanup_bytes)
        assert cleanup['status'] == 'passed' and cleanup['workers_exited']
        assert cleanup['actual_filesystem_checked'] and cleanup['results']
        assert all(row['reclaimed'] for row in cleanup['results'])
    assert bindings == index['current_source_files']
    backend_verifier = index['selected']['backend'][:-5] + '-verifier.mjs'
    assert digest(archived(backend_verifier)) == backend['verifier_sha256']
    ui_prefix = index['selected']['ui'][:-5]
    for field, suffix in [('verifier', '-verifier.mjs'),
                          ('journey_verifier', '-journey-verifier.ts')]:
        name = 'dev/copypaste-delivery/' + ui[field]['path']
        assert name == ui_prefix + suffix
        assert digest(archived(name)) == ui[field]['sha256']
    for screenshot in journey['screenshots']:
        assert screenshot['edited'] is False
        assert digest(archived('dev/' + screenshot['path'])) == screenshot['sha256']
    for recording in journey['recordings']:
        for media in recording['files']:
            body = archived('dev/' + media['path'])
            assert len(body) == media['bytes'] and digest(body) == media['sha256']
        folder = 'dev/' + recording['raw_capture_directory'] + '/'
        names = sorted(name for name in index['entries']
                       if name.startswith(folder) and re.fullmatch(r'frame-\d{6}\.jpg', name[len(folder):]))
        assert len(names) == recording['observed_frames']
        assert [name[len(folder):] for name in names] == [f'frame-{n:06d}.jpg' for n in range(len(names))]
        assert len({digest(archived(name)) for name in names}) == recording['distinct_frames']
        concat = archived(folder + 'capture.ffconcat').decode('utf-8')
        frame_names = re.findall(r"^file '(frame-\d{6}\.jpg)'$", concat, re.M)
        assert frame_names == [name[len(folder):] for name in names] + [names[-1][len(folder):]]
        durations = re.findall(r'^duration ([0-9]+\.[0-9]+)$', concat, re.M)
        assert len(durations) == len(names) and all(float(value) >= 0.02 for value in durations)


def archive(backend_attempt, ui_attempt):
    assert not INDEX.exists(), 'Never overwrite an executed evidence index'
    backend_name = f'dev/copypaste-delivery/.data/admin-content-123/backend-{backend_attempt}.json'
    ui_name = f'dev/copypaste-delivery/evidence/admin-content-ui-{ui_attempt}.json'
    backend, ui = read(safe(backend_name)), read(safe(ui_name))
    journey_name = 'dev/copypaste-delivery/' + ui['journey']['path']
    journey = read(safe(journey_name))
    raw_name = 'dev/copypaste-delivery/' + backend['raw_report']['path']
    raw = safe(raw_name).read_bytes()
    assert digest(raw) == backend['raw_report']['sha256']
    conditions(backend, ui, journey, raw)
    from audit_workmate_publication import configured_credentials
    credentials = configured_credentials()
    entries, known_blobs, files = {}, {}, []

    def add(file, body):
        assert not file.is_symlink()
        file = file.resolve()
        assert file.is_relative_to(DEV.resolve()) and file.is_file() and not file.is_symlink()
        key = digest(body)
        blob = known_blobs.get(key)
        if blob is None:
            assert not any(secret in body for secret in credentials), 'Configured credential in evidence'
            candidates = [QUALITY / f'{stage}/blobs/{key[:2]}/{key}.blob'
                          for stage in ['runtime-startup-evidence-122', 'dedicated-cloud-evidence-121']]
            blob = next((p for p in candidates if p.is_file()), OUT / f'blobs/{key[:2]}/{key}.blob')
            if blob.exists():
                assert blob.read_bytes() == body
            else:
                blob.parent.mkdir(parents=True, exist_ok=True)
                with blob.open('xb') as stream:
                    stream.write(body)
            known_blobs[key] = blob
        entries[file.relative_to(ROOT).as_posix()] = {
            'sha256': key, 'bytes': len(body), 'blob': blob.relative_to(ROOT).as_posix()}

    folders = [(DELIVERY / '.data/admin-content-123', 'backend-*'),
               (DELIVERY / 'evidence', 'admin-content-ui-*')]
    for folder, pattern in folders:
        for candidate in sorted(folder.glob(pattern)):
            assert not candidate.is_symlink()
            if candidate.is_file():
                files.append(candidate)
            else:
                for file in sorted(candidate.rglob('*')):
                    assert not file.is_symlink()
                    if file.is_file():
                        files.append(file)
    for screenshot in journey['screenshots']:
        file = DEV / screenshot['path']
        assert digest(file.read_bytes()) == screenshot['sha256'] and screenshot['edited'] is False
        files.append(file)
    for recording in journey['recordings']:
        for media in recording['files']:
            file = DEV / media['path']
            assert digest(file.read_bytes()) == media['sha256']
            files.append(file)
        capture = DEV / recording['raw_capture_directory']
        assert capture.resolve().is_relative_to((DELIVERY / '.data/workmate-media').resolve())
        for file in sorted(capture.rglob('*')):
            assert not file.is_symlink()
            if file.is_file():
                files.append(file)
    for file, body in contents(dict.fromkeys(files)):
        add(file, body)
    bindings = {}
    for result in [backend, ui]:
        for name, expected in result['source_files'].items():
            repo, relative = name.split('/', 1)
            target = 'dev/' + MAPPING[repo] + '/' + relative
            assert target not in bindings or bindings[target] == expected
            assert digest(safe(target).read_bytes()) == expected, target
            bindings[target] = expected
    value = {'format': 'copypaste.admin-content-evidence.v1',
             'at': datetime.now(timezone.utc).isoformat(),
             'verifier_sha256': digest(Path(__file__).read_bytes()),
             'selected': {'backend': backend_name, 'ui': ui_name, 'journey': journey_name},
             'entries': entries, 'current_source_files': bindings, 'source_workspace_mapping': MAPPING,
             'recording_verification': 'Retained raw frame bytes, counts, distinct hashes, ordered FFconcat durations and exact encoded media. The legacy recorder did not save its in-memory timestamp array, so its frame_manifest_sha256 is retained without claiming it can be independently reconstructed.',
             'scope': 'Scoped actual team, shared-brief and method revisions, current authorization, distinct provenance, original-request recovery and actual Admin UI. Synthetic company inference remains authorized; these editing flows make no model calls.'}
    OUT.mkdir(parents=True, exist_ok=True)
    with INDEX.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return verify(True)


def verify(current=True):
    index = read(INDEX)
    assert index['format'] == 'copypaste.admin-content-evidence.v1'
    assert index['verifier_sha256'] == digest(Path(__file__).read_bytes())
    unique, cache, cached_bytes = {}, {}, 0
    for name, entry in index['entries'].items():
        assert safe(name).is_relative_to(DEV)
        blob_path = safe(entry['blob'])
        assert blob_path not in unique or unique[blob_path] == entry
        unique[blob_path] = entry
    for file, body in contents(unique):
        entry = unique[file]
        assert len(body) == entry['bytes'] and digest(body) == entry['sha256'], str(file)
        if cached_bytes + len(body) <= 128 * 1024 * 1024:
            cache[file] = body
            cached_bytes += len(body)
    def archived(name):
        file = safe(index['entries'][name]['blob'])
        return cache[file] if file in cache else file.read_bytes()
    backend, ui, journey = [json.loads(archived(index['selected'][k])) for k in ['backend', 'ui', 'journey']]
    conditions(backend, ui, journey, archived('dev/copypaste-delivery/' + backend['raw_report']['path']))
    retained_bindings(index, archived, backend, ui, journey)
    for result in [backend, ui]:
        raw_name = 'dev/copypaste-delivery/' + result['raw_report']['path']
        assert digest(archived(raw_name)) == result['raw_report']['sha256']
    assert digest(archived('dev/copypaste-delivery/' + ui['journey']['path'])) == ui['journey']['sha256']
    cleanup = json.loads(archived('dev/copypaste-delivery/' + backend['fixture_cleanup']['path']))
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(row['reclaimed'] for row in cleanup['results'])
    assert digest(archived('dev/copypaste-delivery/' + backend['fixture_cleanup']['path'])) == backend['fixture_cleanup']['sha256']
    if current:
        current_files = {safe(name): expected for name, expected in index['current_source_files'].items()}
        for file, body in contents(current_files):
            assert digest(body) == current_files[file], str(file)
    result = {'status': 'passed', 'evidence_files': len(index['entries']),
              'current_source_files': len(index['current_source_files']),
              'backend_counts': backend['counts'], 'actual_ui_checks': len(journey['checks']),
              'screenshots': len(journey['screenshots']), 'recordings': len(journey['recordings']),
              'layout_observations': len(journey['layout_checks']),
              'current_sources_checked': current}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', action='store_true')
    parser.add_argument('--backend', default='05')
    parser.add_argument('--ui', default='03')
    args = parser.parse_args()
    for attempt in [args.backend, args.ui]:
        assert re.fullmatch(r'\d{2}', attempt)
    archive(args.backend, args.ui) if args.archive else verify(True)
