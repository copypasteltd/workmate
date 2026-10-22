"""Preserve attempt 13 without treating its partial TAP as qualification."""
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    prefix = DELIVERY / 'evidence/desktop-execution-control-13'
    observation_file = DELIVERY / '.data/desktop-control-13-terminal-observation.json'
    observation = json.loads(observation_file.read_text(encoding='utf-8-sig'))
    assert observation['attempt'] == '13'
    assert observation['matching_test_processes'] == observation['database_listeners'] == 0
    raw = prefix.with_suffix('.tap')
    text = raw.read_text(encoding='utf-8')
    lines = re.findall(r'^(ok|not ok) (\d+) - (.*)$', text, re.M)
    assert lines and not re.search(r'^# tests \d+\r?$', text, re.M)
    owner_file = DELIVERY / '.data/desktop-control-13-owner.json'
    owner = json.loads(owner_file.read_text(encoding='utf-8-sig'))
    assert owner['pid'] == 32276 and owner['attempt'] == '13'
    fixture = ROOT / 'dev/copypaste-platform/.data/test-fixture-reclamation/23a8c337-5291-4bfa-bb3b-7f27be268e52'
    manifest = json.loads((fixture / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['owner_pid'] == 38436 and manifest['created_at'] == '2026-10-22T20:34:37.343Z'
    deferred = [file for file in fixture.glob('*.json') if file.name not in ('manifest.json', 'result.json')]
    assert not deferred and not (fixture / 'result.json').exists()
    report = {
        'at': observation['at'], 'status': 'interrupted',
        'scope': 'Incomplete all-Platform attempt; partial output does not establish full qualification',
        'error': 'The independently launched runner and its test owner no longer exist; no final TAP/source/cleanup receipt was produced. The interruption cause is unproven.',
        'counts': {'observed_result_lines': len(lines), 'observed_pass': sum(line[0] == 'ok' for line in lines), 'observed_fail': sum(line[0] == 'not ok' for line in lines)},
        'counts_are_partial': True, 'terminal_observation': observation,
        'source_unchanged': None, 'owned_database_shutdown': None, 'final_fixture_cleanup_proven': False,
        'fixture_inventory': {'manifest_sha256': digest(fixture / 'manifest.json'), 'registered_deferred_fixtures': 0,
                              'note': 'No deferred fixtures were registered; cleanup of unregistered in-flight resources is unproven. Historical resources remain untouched.'},
        'raw_report': {'path': raw.relative_to(DELIVERY).as_posix(), 'sha256': digest(raw)},
        'verifier': {'path': 'evidence/' + prefix.name + '-verifier.mjs', 'sha256': digest(Path(str(prefix) + '-verifier.mjs'))},
        'launcher': {'path': 'evidence/' + prefix.name + '-background-launcher.ps1', 'sha256': digest(Path(str(prefix) + '-background-launcher.ps1'))},
        'observation_sha256': digest(observation_file), 'owner_record_sha256': digest(owner_file),
        'recording_tool_sha256': digest(Path(__file__)),
        'next_action': 'Use a new source-bound fixed-inventory qualification with separately owned batches; only completed passing batches contribute coverage.'
    }
    with prefix.with_suffix('.json').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'counts': report['counts'], 'complete_qualification': False}))


if __name__ == '__main__':
    main()
