"""Preserve Stage128 source snapshots, failures and native/SQL/window observations."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/startup-recovery-evidence-128'
INDEX = OUT / 'index.json'
PREVIOUS = ROOT / 'docs/quality/history/stage128-previous-publication.json'
PUBLICATION = ROOT / 'docs/quality/history/stage127-remote-publication-receipt.json'
PREFIXES = {
    'desktop': 'dev/copypaste-desktop-publication-125/.data/startup-recovery-128',
    'backend': 'dev/copypaste-platform-publication-125/.data/startup-recovery-128',
    'ui': 'dev/copypaste-delivery/evidence/startup-recovery-128',
}
PRIORS = [ROOT / ('docs/quality/' + name + '/index.json') for name in
          ['local-startup-evidence-127', 'native-publication-evidence-126', 'controlled-publications-evidence-125']]


def digest(b): return sha256(b).hexdigest()
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def ref(p): return {'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p.read_bytes())}
def write_new(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')


def archive(ui, unit, native, sql, types):
    assert not INDEX.exists() and not PREVIOUS.exists()
    for n in [ui, unit, native, sql, types]: assert re.fullmatch(r'\d{2}', n)
    known = {entry['sha256']: entry['blob'] for p in PRIORS for entry in read(p)['entries']}
    files = []
    for prefix in PREFIXES.values():
        files.extend(p for p in sorted((ROOT / prefix).rglob('*')) if p.is_file())
    files.extend(sorted((ROOT / 'dev/copypaste-desktop-publication-125/assets/screenshots').glob('workmate-startup-recovery-128-*')))
    entries, checked = [], set()
    for p in files:
        assert not p.is_symlink(); raw = p.read_bytes(); key = digest(raw)
        blob = known.get(key, (OUT / 'blobs' / key[:2] / (key + '.blob')).relative_to(ROOT).as_posix())
        target = ROOT / blob
        if key not in checked:
            if target.exists(): assert digest(target.read_bytes()) == key
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as f: f.write(raw)
            checked.add(key)
        entries.append({'original': p.relative_to(ROOT).as_posix(), 'blob': blob, 'sha256': key, 'bytes': len(raw)})
    PREVIOUS.parent.mkdir(parents=True, exist_ok=True)
    with PREVIOUS.open('xb') as f: f.write((ROOT / 'docs/quality/workmate-publication.json').read_bytes())
    published_file = ROOT / 'dev/copypaste-delivery/.data/publication/2aeb579e-f477-421c-bf4b-ab84d52b5125/receipt.json'
    published = read(published_file)
    assert published['status'] == 'pushed_and_verified' and published['failure'] is None
    assert len(published['remote_after']) == 8 and all(r['status'] == 'passed' for r in published['checks'])
    assert published['remote_after']['docs'] == published['remote_after']['main'] == '9b615c251e609828d5da5d7bd0bfe83d14252379'
    for c in read(PREVIOUS)['components']: assert published['remote_after'][c['branch']] == c['commit']
    with PUBLICATION.open('xb') as f: f.write(published_file.read_bytes())
    window = read(ROOT / PREFIXES['ui'] / ('desktop-' + ui + '.json'))
    write_new(INDEX, {'schema_version': 1, 'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'bounded_customer_local_pre_turn_recovery_actual_pinned_codex_native_sql_unsigned_window_synthetic_provider',
        'archive_tool': ref(Path(__file__)), 'previous_archives': [ref(p) for p in PRIORS], 'previous_publication': ref(PREVIOUS), 'previous_remote_publication': ref(PUBLICATION),
        'selected': {'ui': ui, 'unit': unit, 'native': native, 'sql': sql, 'types': types},
        'entries': entries, 'entry_count': len(entries), 'unique_blobs': len(checked),
        'current_sources': {'dev/' + name: key for name, key in window['source_files'].items()},
        'qualification_source_differences': window['logic_source_differences'],
        'media': [entry for entry in entries if '/assets/screenshots/' in entry['original']],
        'limits': ['Original failed reports and source snapshots retained', 'Synthetic provider and consent decisions',
                   'No signed installer, all-node crash matrix or complete professional-role acceptance']})
    print(json.dumps(verify(False)))


def verify(current=True):
    index = read(INDEX)
    assert index['archive_tool'] == ref(Path(__file__))
    assert index['previous_publication'] == ref(PREVIOUS)
    assert index['previous_remote_publication'] == ref(PUBLICATION)
    assert index['previous_archives'] == [ref(p) for p in PRIORS]
    aliases, content = {}, {}
    for e in index['entries']:
        name, key = e['original'], e['sha256']
        assert name not in aliases and '..' not in Path(name).parts
        assert any(name.startswith(v + '/') for v in PREFIXES.values()) or name.startswith('dev/copypaste-desktop-publication-125/assets/screenshots/workmate-startup-recovery-128-')
        blob = ROOT / e['blob']; assert blob.resolve().is_relative_to((ROOT / 'docs/quality').resolve())
        assert blob.name == key + '.blob' and blob.parent.name == key[:2] and not blob.is_symlink()
        if key not in content:
            raw = blob.read_bytes(); assert digest(raw) == key; content[key] = raw
        assert len(content[key]) == e['bytes']; aliases[name] = e
    assert len(aliases) == index['entry_count'] and len(content) == index['unique_blobs']
    def body(name): return content[aliases[name]['sha256']]
    def row(name): return json.loads(body(name))
    def probe(label, n):
        base = PREFIXES[label] + ('/probe-' if label == 'desktop' else '/backend-') + n
        r = row(base + '.json'); assert r['source_unchanged']
        assert digest(body(base + '.tap')) == r.get('raw_report_sha256', r.get('raw_report', {}).get('sha256'))
        assert digest(body(base + '-verifier.mjs')) == r['verifier_sha256']
        files = r['source_files'] if label == 'desktop' else {'backend': r['source_files']}
        for repo, names in files.items():
            for name, key in names.items():
                snapshot = base + '-sources/' + (repo + '/' + name if label == 'desktop' else name)
                assert digest(body(snapshot)) == key
        return r
    # Qualify every preserved attempt, including failed compilation/runtime attempts.
    for label, pattern in [('desktop', r'/probe-\d{2}\.json$'), ('backend', r'/backend-\d{2}\.json$')]:
        for name in aliases:
            if name.startswith(PREFIXES[label] + '/') and re.search(pattern, name): probe(label, name.rsplit('-', 1)[1][:-5])
    for name in aliases:
        if not name.startswith(PREFIXES['ui'] + '/') or not re.search(r'/desktop-\d{2}\.json$', name): continue
        base = name[:-5]; attempt = row(name)
        assert attempt['source_unchanged']
        assert digest(body(base + '.tap')) == attempt['raw_report_sha256']
        assert digest(body(base + '-verifier.mjs')) == attempt['verifier_sha256']
        assert digest(body(base + '-journey-verifier.mjs')) == attempt['journey_verifier_sha256']
        for source, key in attempt['source_files'].items(): assert digest(body(base + '-sources/' + source)) == key
    selected = index['selected']; unit = probe('desktop', selected['unit']); native = probe('desktop', selected['native']); sql = probe('backend', selected['sql'])
    for r in [unit, native, sql]:
        assert r['status'] == 'passed' and r['counts']['tests'] == r['counts']['pass'] > 0
        assert all(r['counts'][k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    assert unit['source_files'] == native['source_files']
    types = probe('desktop', selected['types'])
    assert types['status'] == 'passed' and types['mode'] == 'types' and types['counts'] is None
    assert len(types['commands']) == 3 and all(r['code'] == 0 for r in types['commands'])
    assert unit['original_fixture_set_restored'] and native['original_fixture_set_restored']
    assert sql['owned_database_shutdown'] and sql['owned_database_port_closed']
    native_base = PREFIXES['desktop'] + '/probe-' + selected['native']
    native_text = body(native_base + '.tap').decode('utf-8')
    observations = [json.loads(line.split('native_startup_recovery ', 1)[1]) for line in native_text.splitlines() if 'native_startup_recovery {' in line]
    assert len(observations) == 5 and all(r['native_processes'] == 2 and r['native_processes_closed'] for r in observations)
    assert sorted(r['model_requests'] for r in observations) == [0, 1, 1, 1, 1]
    ui_base = PREFIXES['ui'] + '/desktop-' + selected['ui']; window = row(ui_base + '.json'); journey = row(ui_base + '-journey.json')
    assert window['status'] == journey['status'] == 'passed'
    origin = window['package_origin']; assert origin['attempt'] == '02'
    previous_package_path = PREFIXES['ui'] + '/desktop-' + origin['attempt'] + '.json'
    assert digest(body(previous_package_path)) == origin['sha256']
    previous_package = row(previous_package_path)
    assert previous_package['source_unchanged'] and previous_package['package_unchanged']
    assert len(previous_package['commands']) == 10 and all(r['exit_code'] == 0 for r in previous_package['commands'])
    assert origin['kind'] == 'renderer_rebuild'
    renderer_change = origin['renderer_change']
    assert renderer_change == {'path': 'copypaste-desktop/renderer/src/local-agent.tsx',
        'previous_sha256': '6110444ebb24607726bcdb6244b358f2878170e849f9021e20a360cbebff01ba',
        'current_sha256': '2306a7695fe2f5f4eb654af9c40482fd27470bf49b9dde3ab6f589f5c3303648'}
    for name in ['resources/local-codex/codex.exe', 'resources/local-codex/runtime-manifest.json']:
        assert window['package_files'][name] == previous_package['package_files'][name]
    for prefix in ['copypaste-desktop/', 'copypaste-platform/', 'copypaste-web/']:
        subset = lambda r: {k: v for k, v in r['source_files'].items() if k.startswith(prefix) and k != renderer_change['path']}
        assert subset(window) == subset(previous_package)
    assert previous_package['source_files'][renderer_change['path']] == renderer_change['previous_sha256']
    assert window['source_files'][renderer_change['path']] == renderer_change['current_sha256']
    for k in ['source_unchanged', 'package_unchanged', 'owned_database_shutdown', 'owned_database_port_closed']: assert window[k]
    assert digest(body(ui_base + '.tap')) == window['raw_report_sha256']
    assert digest(body(ui_base + '-verifier.mjs')) == window['verifier_sha256']
    assert digest(body(ui_base + '-journey-verifier.mjs')) == window['journey_verifier_sha256']
    for name, key in window['source_files'].items(): assert digest(body(ui_base + '-sources/' + name)) == key
    for name, key in sql['source_files'].items(): assert window['source_files'][name] == key
    differences = window['logic_source_differences']
    assert differences == index['qualification_source_differences'] and len(differences) == 4
    assert [r['qualification'] for r in differences] == ['controller', 'controller', 'native', 'native']
    allowed = {
        ('copypaste-platform', 'tests/desktop-startup-recovery.test.ts'): (
            '79b46d5a6c0ca9c2b1d5d057dcd2f4122c09152018f62b5f5fe7d65530d1ef1c',
            '1512cf992499f8f8c25490dc9847cf32be93b78c00a84b0d6994d3629c12cf0e'),
        ('copypaste-desktop', 'renderer/src/local-agent.tsx'): (
            '87469d32f97ad1f60ecae09146c3e608c4a04226a9773576409c217ea369a80c',
            '2306a7695fe2f5f4eb654af9c40482fd27470bf49b9dde3ab6f589f5c3303648'),
    }
    for r in differences:
        assert (r['native_sha256'], r['current_sha256']) == allowed[(r['repository'], r['path'])]
    changed = []
    for repo, files in unit['source_files'].items():
        for name, key in files.items():
            component = 'copypaste-platform' if repo == 'backend' else 'copypaste-desktop'
            final = window['source_files'][component + '/' + name]
            if key != final:
                assert (key, final) == allowed[(component, name)]
                changed.append((component, name))
    assert set(changed) == set(allowed)
    for repo, files in types['source_files'].items():
        component = 'copypaste-platform' if repo == 'backend' else 'copypaste-desktop'
        for name, key in files.items(): assert window['source_files'][component + '/' + name] == key
    assert len(journey['checks']) == 6 and not journey['errors'] and len(journey['layouts']) == 3
    for k in ['browser_closed', 'desktop_closed', 'api_closed', 'fixture_closed', 'provider_closed']: assert journey[k]
    o = journey['observations']; assert o['startup_attempt'] == 2 and o['zero_admission_proof']['safe']
    assert o['original_reservations'] == o['original_charges'] == o['provider_calls'] == 1
    assert len(o['native_processes']) == 3 and all(r['closed'] for r in o['native_processes'])
    assert len(journey['screenshots']) == 3 and len(journey['recordings']) == 2
    assert all(r['distinct_frames'] > 1 and r['skipped_capture_errors'] == 0 for r in journey['recordings'])
    if current:
        for name, key in index['current_sources'].items(): assert digest((ROOT / name).read_bytes()) == key, name
    return {'status': 'passed', 'archived_entries': len(aliases), 'unique_blobs': len(content),
        'unit_counts': unit['counts'], 'native_counts': native['counts'], 'sql_counts': sql['counts'],
        'current_compiler_checks': len(types['commands']),
        'actual_packaged_ui_checks': len(journey['checks']), 'verifier_sha256': digest(Path(__file__).read_bytes())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--archive', action='store_true')
    for n in ['ui', 'unit', 'native', 'sql', 'types']: parser.add_argument('--' + n)
    args = parser.parse_args()
    if args.archive: archive(args.ui, args.unit, args.native, args.sql, args.types)
    else: print(json.dumps(verify()))
