"""Archive unchanged Desktop startup probes and actual packaged UI/SQL evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / 'dev/copypaste-desktop-publication-125'
DELIVERY = ROOT / 'dev/copypaste-delivery'
PROBES = DESKTOP / '.data/local-startup-127'
UI = DELIVERY / 'evidence/local-startup-127'
OUT = ROOT / 'docs/quality/local-startup-evidence-127'
INDEX = OUT / 'index.json'
PREVIOUS = ROOT / 'docs/quality/history/stage127-previous-publication.json'
PRIORS = [ROOT / 'docs/quality/native-publication-evidence-126/index.json', ROOT / 'docs/quality/controlled-publications-evidence-125/index.json']


def digest(body): return sha256(body).hexdigest()
def read(file): return json.loads(file.read_text(encoding='utf-8-sig'))
def ref(file): return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file.read_bytes())}


def safe_file(name):
    assert isinstance(name, str) and '\\' not in name and '..' not in Path(name).parts
    file = ROOT / name
    assert file.resolve().is_relative_to(ROOT.resolve()) and not file.is_symlink(), name
    return file


def collect(folder, pattern):
    result = []
    for file in sorted(folder.iterdir()):
        if re.fullmatch(pattern + r'(?:\.json|\.tap|-verifier\.mjs|-journey\.json|-journey-verifier\.mjs|-fixture-cleanup\.json|-owned-cleanup\.json)', file.name): result.append(file)
        elif re.fullmatch(pattern + '-sources', file.name): result.extend(sorted(p for p in file.rglob('*') if p.is_file()))
    return result


def archive(selected):
    assert re.fullmatch(r'[0-9]{2}', selected)
    assert not INDEX.exists() and not PREVIOUS.exists()
    files = collect(PROBES, r'probe-[0-9]{2}') + collect(UI, r'desktop-[0-9]{2}')
    media = []
    for journey_file in sorted(UI.glob('desktop-??-journey.json')):
        journey = read(journey_file)
        media.extend(journey['screenshots'])
        media.extend(item for recording in journey['recordings'] for item in recording['files'])
    for item in media:
        file = safe_file('dev/' + item['path'])
        assert file.parent == DESKTOP / 'assets/screenshots' and file.name.startswith('workmate-local-startup-127-')
        assert digest(file.read_bytes()) == item['sha256']
        files.append(file)
    files = sorted(set(files))
    prior_indices = [read(file) for file in PRIORS]
    reusable = {row['sha256']: row for index in prior_indices for row in index['entries']}
    entries, checked = [], set()
    for file in files:
        assert not file.is_symlink() and (file.resolve().is_relative_to(PROBES.resolve()) or file.resolve().is_relative_to(UI.resolve()) or file.parent == DESKTOP / 'assets/screenshots')
        body = file.read_bytes(); key = digest(body); assert len(body) < 100 * 1024 * 1024
        if key in reusable:
            blob = safe_file(reusable[key]['blob'])
            if key not in checked: assert blob.read_bytes() == body
        else:
            blob = OUT / 'blobs' / key[:2] / (key + '.blob'); blob.parent.mkdir(parents=True, exist_ok=True)
            if blob.exists(): assert blob.read_bytes() == body
            else:
                with blob.open('xb') as stream: stream.write(body)
        checked.add(key)
        entries.append({'original': file.relative_to(ROOT).as_posix(), 'blob': blob.relative_to(ROOT).as_posix(), 'sha256': key, 'bytes': len(body)})
    with PREVIOUS.open('xb') as stream: stream.write((ROOT / 'docs/quality/workmate-publication.json').read_bytes())
    probes = [{'number': file.stem.removeprefix('probe-'), 'status': read(file)['status'], 'mode': read(file)['mode'], 'counts': read(file)['counts']}
              for file in sorted(PROBES.glob('probe-??.json'))]
    attempts = [{'number': file.stem.removeprefix('desktop-'), 'status': read(file)['status']}
                for file in sorted(UI.glob('desktop-??.json'))]
    ui = read(UI / ('desktop-' + selected + '.json'))
    current = {'dev/' + name: key for name, key in ui['source_files'].items()}
    value = {'schema_version': 1, 'at': datetime.now(timezone.utc).isoformat(), 'archive_tool': ref(Path(__file__)),
             'previous_archives': [ref(file) for file in PRIORS], 'previous_publication': ref(PREVIOUS),
             'scope': 'actual_pinned_customer_local_codex_and_unsigned_packaged_desktop_native_sql_with_synthetic_model_and_dialog_decisions',
             'selected_ui_attempt': selected, 'selected_native_probe': '07', 'selected_unit_probe': '06',
             'probes': probes, 'ui_attempts': attempts, 'entries': entries, 'entry_count': len(entries), 'unique_blobs': len(checked),
             'media': media,
             'current_sources': current, 'new_media': True, 'desktop_pre_turn_recovery_qualified': False,
             'limits': ['Original failed and cancelled attempts remain unchanged', 'No automatic Desktop startup replay', 'No signed installer, live model or full professional-role qualification']}
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    with INDEX.open('x', encoding='utf-8', newline='\n') as stream: json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps(verify(False)))


def verify(current=True):
    value = read(INDEX)
    assert value['archive_tool'] == ref(Path(__file__)) and value['previous_publication'] == ref(PREVIOUS)
    assert value['previous_archives'] == [ref(file) for file in PRIORS]
    content, aliases, paths = {}, {}, {}
    allowed = {row['blob'] for file in PRIORS for row in read(file)['entries']}
    for entry in value['entries']:
        name, key, blob_name = entry['original'], entry['sha256'], entry['blob']
        assert name not in aliases and name.startswith(('dev/copypaste-desktop-publication-125/.data/local-startup-127/', 'dev/copypaste-delivery/evidence/local-startup-127/', 'dev/copypaste-desktop-publication-125/assets/screenshots/workmate-local-startup-127-'))
        assert blob_name in allowed or blob_name.startswith('docs/quality/local-startup-evidence-127/blobs/')
        if blob_name not in paths: paths[blob_name] = safe_file(blob_name)
        file = paths[blob_name]; assert file.name == key + '.blob' and file.parent.name == key[:2]
        if key not in content:
            raw = file.read_bytes(); assert digest(raw) == key; content[key] = raw
        assert len(content[key]) == entry['bytes']; aliases[name] = entry
    assert len(aliases) == value['entry_count'] and len(content) == value['unique_blobs']
    def body(name):
        assert name in aliases, name
        return content[aliases[name]['sha256']]
    def row(name): return json.loads(body(name))
    probe_prefix = 'dev/copypaste-desktop-publication-125/.data/local-startup-127/probe-'
    selected = {}
    for item in value['probes']:
        base = probe_prefix + item['number']; report = row(base + '.json')
        assert report['mode'] == item['mode'] and report['status'] == item['status'] and report['counts'] == item['counts']
        assert report['source_unchanged'] and digest(body(base + '.tap')) == report['raw_report_sha256']
        assert digest(body(base + '-verifier.mjs')) == report['verifier_sha256']
        for name, key in report['source_files'].items(): assert digest(body(base + '-sources/' + name)) == key
        selected[item['number']] = report
    assert selected['01']['known_lease_gap_reproduced'] and selected['01']['counts']['fail'] == 2
    assert selected['02']['status'] == 'failed' and selected['02']['counts']['cancelled'] == 17 and not selected['02']['original_fixture_set_restored']
    cleanup = row(probe_prefix + '02-owned-cleanup.json')
    assert cleanup['empty_directory_removed_after_terminal_run'] and cleanup['failed_report_sha256'] == digest(body(probe_prefix + '02.json'))
    for number in [value['selected_native_probe'], value['selected_unit_probe']]:
        report = selected[number]; counts = report['counts']; assert report['status'] == 'passed' and report['original_fixture_set_restored']
        assert counts['tests'] == counts['pass'] > 0 and all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
        assert report['source_files'] == selected[value['selected_native_probe']]['source_files']
    assert selected[value['selected_unit_probe']]['counts']['pass'] == 73
    native_text = body(probe_prefix + value['selected_native_probe'] + '.tap').decode('utf-8')
    observations = [json.loads(line.split('native_startup_lease ', 1)[1]) for line in native_text.splitlines() if 'native_startup_lease {' in line]
    assert len(observations) == 1 and observations[0]['elapsed_ms'] >= 48000 and observations[0]['heartbeats'] >= 5
    assert observations[0]['native_processes'] == observations[0]['model_requests'] == 1 and observations[0]['native_processes_closed']
    ui_prefix = 'dev/copypaste-delivery/evidence/local-startup-127/desktop-'
    ui = journey = None
    ui_reports = {}
    for item in value['ui_attempts']:
        base = ui_prefix + item['number']; report = row(base + '.json'); assert report['status'] == item['status']
        assert digest(body(base + '.tap')) == report['raw_report_sha256'] and digest(body(base + '-verifier.mjs')) == report['verifier_sha256']
        assert digest(body(base + '-journey-verifier.mjs')) == report['journey_verifier_sha256']
        for name, key in report['source_files'].items(): assert digest(body(base + '-sources/' + name)) == key
        ui_reports[item['number']] = report
        if item['number'] == value['selected_ui_attempt']: ui, journey = report, row(base + '-journey.json')
    assert ui and journey and ui['status'] == journey['status'] == 'passed'
    first = ui_reports['01']
    assert first['source_unchanged'] and first['package_unchanged'] and first['owned_database_shutdown'] and first['owned_database_port_closed']
    assert first['journey_exit_code'] == 1 and all(command['exit_code'] == 0 for command in first['commands'])
    reused = ui_reports['02']
    assert reused['previous_ui_attempt'] == {'path': 'evidence/local-startup-127/desktop-01.json', 'sha256': digest(body(ui_prefix + '01.json')), 'status': 'failed'}
    assert reused['status'] == 'passed' and reused['source_unchanged'] and reused['package_unchanged']
    assert reused['reused_unchanged_package'] and reused['package_files'] == first['package_files']
    third = ui_reports['03']
    assert third['status'] == 'failed' and third['journey_exit_code'] == 1
    assert third['source_unchanged'] and third['package_unchanged'] and third['owned_database_shutdown'] and third['owned_database_port_closed']
    assert all(command['exit_code'] == 0 for command in third['commands'])
    assert ui['previous_ui_attempt'] == {'path': 'evidence/local-startup-127/desktop-03.json', 'sha256': digest(body(ui_prefix + '03.json')), 'status': 'failed'}
    assert ui['reused_unchanged_package'] and ui['package_files'] == third['package_files']
    assert all(command['exit_code'] == 0 for command in ui['commands'])
    assert ui['source_unchanged'] and ui['package_unchanged'] and ui['owned_database_shutdown'] and ui['owned_database_port_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and ui['fixture_cleanup']['actual_filesystem_checked'] and all(x['reclaimed'] for x in ui['fixture_cleanup']['results'])
    assert digest(body(ui_prefix + value['selected_ui_attempt'] + '-fixture-cleanup.json')) == ui['fixture_cleanup']['sha256']
    for number in [value['selected_native_probe'], value['selected_unit_probe']]:
        receipt = ui['logic_receipts'][number]
        assert receipt['sha256'] == digest(body(probe_prefix + number + '.json')) and receipt['counts'] == selected[number]['counts']
    assert journey['errors'] == [] and len(journey['checks']) == 5 and len(journey['recordings']) == 2 and len(journey['screenshots']) == 3
    assert all(recording['distinct_frames'] > 1 and recording['skipped_capture_errors'] == 0 for recording in journey['recordings'])
    assert all(journey[key] for key in ['browser_closed', 'desktop_closed', 'api_closed', 'fixture_closed', 'provider_closed'])
    expected_media = journey['screenshots'] + [item for recording in journey['recordings'] for item in recording['files']]
    assert all(item in value['media'] for item in expected_media)
    for item in value['media']:
        assert digest(body('dev/' + item['path'])) == item['sha256']
        if current:
            primary = ROOT / 'dev/copypaste-desktop/assets/screenshots' / Path(item['path']).name
            assert digest(primary.read_bytes()) == item['sha256']
    observations = journey['observations']; assert observations['elapsed_ms'] >= 48000 and observations['provider_calls'] == 1
    assert observations['original_reservations'] == observations['original_charges'] == 1 and observations['charged_micros'] == '22' and observations['revoked_charged_micros'] == '0'
    assert len(observations['native_processes']) == 2 and all(x['closed'] for x in observations['native_processes'])
    assert {x['width'] for x in journey['layouts']} == {1000, 1240, 1440}
    assert len(journey['layout_attempts']) == 3
    assert all(x['requested'] == x['inner']['width'] == x['native']['bounds']['width'] == x['native']['content']['width'] and x['native']['zoom'] == 1 and not x['native']['maximized'] and not x['native']['fullscreen'] and not x['native']['minimized'] for x in journey['layout_attempts'])
    assert all(not x['horizontal'] and x['visible_scrollbars'] == [] and x['native']['menu'] and not x['native']['menu_visible'] and x['native']['bounds'] == x['native']['content'] for x in journey['layouts'])
    assert value['current_sources'] == {'dev/' + name: key for name, key in ui['source_files'].items()}
    for name, key in selected[value['selected_native_probe']]['source_files'].items(): assert value['current_sources']['dev/copypaste-desktop/' + name] == key
    if current:
        for name, key in value['current_sources'].items(): assert digest(safe_file(name).read_bytes()) == key, name
    return {'status': 'passed', 'archived_entries': len(aliases), 'unique_blobs': len(content), 'unit_counts': selected[value['selected_unit_probe']]['counts'],
            'native_counts': selected[value['selected_native_probe']]['counts'], 'actual_packaged_ui_checks': len(journey['checks']), 'ui_observations': observations,
            'failed_attempts_retained': ['probe-01', 'probe-02'] + ['desktop-' + number for number, report in ui_reports.items() if report['status'] == 'failed'],
            'desktop_pre_turn_recovery_qualified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['archive', 'verify']); parser.add_argument('--ui')
    args = parser.parse_args()
    archive(args.ui) if args.action == 'archive' else print(json.dumps(verify()))
