"""Preserve exact failing harness bytes before a narrowly scoped repair."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'
DIRECTORY = ROOT / 'docs/quality/history/stage81-before-fixture-port-repair'


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = DIRECTORY / 'receipt.json'
    assert not output.exists()
    failure_file = DELIVERY / 'evidence/desktop-execution-control-29-batch-07-attempt-01.json'
    failure = read(failure_file)
    assert failure['status'] == 'failed' and failure['source_unchanged'] and failure['owned_database_shutdown']
    raw = DELIVERY / failure['raw_report']['path']
    assert digest(raw) == failure['raw_report']['sha256']
    witness_file = ROOT / 'docs/quality/managed-video-blocked-port-review.json'
    witness = read(witness_file)
    assert witness['actual_node_fetch_probe']['cause'] == 'bad port'
    assert raw.read_bytes().startswith((ROOT / witness['observed_tap_prefix']['path']).read_bytes())
    cleanup_file = ROOT / 'docs/quality/managed-video-blocked-port-fixture-cleanup.json'
    cleanup = read(cleanup_file)
    assert cleanup['status'] == 'passed' and cleanup['worker_exited'] and cleanup['database_removed'] and cleanup['directory_removed']
    plan = read(DELIVERY / 'evidence/desktop-execution-control-29-plan.json')
    records = []
    for name in ['tests/capability-video-fixture.ts', 'tests/capability-video-verification.test.ts']:
        file = ROOT / 'dev/copypaste-platform' / name
        actual = digest(file)
        assert actual == plan['source_files']['copypaste-platform/' + name]
        target = DIRECTORY / file.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(file.read_bytes())
        records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(), 'sha256': actual})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'archived_before_test_harness_repair', 'files': records,
        'failed_attempt': {'path': failure_file.relative_to(ROOT).as_posix(), 'sha256': digest(failure_file)},
        'live_cause': {'path': witness_file.relative_to(ROOT).as_posix(), 'sha256': digest(witness_file)},
        'owned_fixture_cleanup': {'path': cleanup_file.relative_to(ROOT).as_posix(), 'sha256': digest(cleanup_file)},
        'scope': 'Preserve failed raw TAP, actual blocked-port witness, exact harness bytes and owned forced-stop cleanup. No product source or failed outcome is rewritten.',
        'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'files': len(records)}))


if __name__ == '__main__':
    main()
