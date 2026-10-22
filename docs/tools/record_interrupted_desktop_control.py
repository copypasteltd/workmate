"""Retain a partial run without inventing a final TAP, source or cleanup result."""
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    prefix = DELIVERY / 'evidence/desktop-execution-control-12'
    observed_file = DELIVERY / '.data/desktop-control-12-terminal-observation.json'
    observed = json.loads(observed_file.read_text(encoding='utf-8-sig'))
    assert observed['attempt'] == '12'
    assert observed['matching_test_processes'] == observed['database_listeners'] == 0
    log = prefix.with_suffix('.tap')
    text = log.read_text(encoding='utf-8')
    lines = re.findall(r'^(ok|not ok) (\d+) - (.*)$', text, re.M)
    assert lines and not re.search(r'^# tests \d+\r?$', text, re.M)
    run = ROOT / 'dev/copypaste-platform/.data/test-fixture-reclamation/1a6711f0-083a-4c75-a061-b90c06c4bfe8'
    manifest = json.loads((run / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['owner_pid'] == 19940 and manifest['created_at'] == '2026-10-22T19:45:56.354Z'
    registered = [p for p in run.glob('*.json') if p.name not in ('manifest.json', 'result.json')]
    assert not registered and not (run / 'result.json').exists()
    report = {
        'at': observed['at'], 'status': 'interrupted',
        'scope': 'Incomplete all-Platform attempt; partial results are not a full-suite qualification',
        'error': 'Execution handle unavailable; subsequent process and listener inventory found no runner, test worker or owned database. No final receipt or TAP summary was produced. The interruption cause is unproven.',
        'counts': {'observed_result_lines': len(lines), 'observed_pass': sum(x[0] == 'ok' for x in lines), 'observed_fail': sum(x[0] == 'not ok' for x in lines)},
        'counts_are_partial': True, 'terminal_observation': observed,
        'source_unchanged': None, 'source_before_snapshot_recovered': False,
        'owned_database_shutdown': None, 'final_fixture_cleanup_proven': False,
        'fixture_inventory': {'manifest_sha256': digest(run / 'manifest.json'), 'registered_deferred_fixtures': 0,
                              'note': 'No deferred records were registered. Unregistered in-flight resources cannot be proven cleaned; historical resources remain untouched.'},
        'raw_report': {'path': log.relative_to(DELIVERY).as_posix(), 'sha256': digest(log)},
        'runner_verifier': {'path': prefix.name + '-verifier.mjs', 'sha256': digest(Path(str(prefix) + '-verifier.mjs'))},
        'observation_sha256': digest(observed_file), 'recording_tool_sha256': digest(Path(__file__)),
        'next_action': 'Run a fresh full-suite attempt under an independently tracked hidden process; preserve this attempt unchanged',
    }
    with prefix.with_suffix('.json').open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'counts': report['counts'], 'complete_qualification': False}))


if __name__ == '__main__':
    main()
