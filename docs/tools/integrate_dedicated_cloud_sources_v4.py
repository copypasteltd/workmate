"""Amend the reviewed backend plan without replacing any executed evidence."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json

from integrate_dedicated_cloud_sources import ROOT, DEV, RAW, OUT, checked, digest, git

PLAN = OUT / 'backend-plan-v3.json'
REPORT = RAW / 'full-04.json'
FROZEN = RAW / 'full-04-plan.json'
TEST = 'tests/dedicated-cloud.test.ts'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def frozen():
    value = read(FROZEN)
    for name, expected in value['source_files'].items():
        assert digest(checked(DEV, name)) == expected, name
    return value


def plan():
    assert not PLAN.exists()
    old = read(OUT / 'plan.json')
    assert old['verifier_sha256'] == digest(ROOT / 'docs/tools/integrate_dedicated_cloud_sources.py')
    row = next(r for r in old['repositories'] if r['component'] == 'platform')
    source, target = ROOT / row['candidate'], ROOT / row['target']
    before = next(item for item in row['changed'] if item['path'] == TEST)
    assert (digest(checked(target, TEST)) if checked(target, TEST).is_file() else None) == before['before_sha256']
    amendment = {**before, 'after_sha256': digest(checked(source, TEST)),
                 'bytes': checked(source, TEST).stat().st_size, 'line_endings_only': False}
    assert amendment['after_sha256'] != before['after_sha256']
    row['changed'] = [amendment if item['path'] == TEST else item for item in row['changed']]
    frozen()
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'reviewable_backend_amendment',
             'previous_plan_sha256': digest(OUT / 'plan.json'),
             'frozen_plan_sha256': digest(FROZEN), 'repository': row,
             'amendments': [{'path': TEST, 'previous_candidate_sha256': before['after_sha256'],
                             'current_candidate_sha256': amendment['after_sha256'],
                             'reason': 'Authenticated fixture heartbeat after long migrations; stale-capacity admission regression; cleanup on setup failure'}],
             'production_timeout_or_authority_changes': False,
             'verifier_sha256': digest(Path(__file__))}
    save(PLAN, value)
    print(json.dumps({'status': value['status'], 'files': len(row['changed']), 'amended_files': 1}))


def apply():
    value = read(PLAN)
    assert value['verifier_sha256'] == digest(Path(__file__))
    assert value['previous_plan_sha256'] == digest(OUT / 'plan.json')
    assert value['frozen_plan_sha256'] == digest(FROZEN)
    current = frozen()
    report = read(REPORT)
    assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
    assert report['source_files'] == current['source_files']
    import record_integrated_recovery as reader
    reader.L = RAW.parent.parent
    counts = reader.raw_counts(REPORT, report)
    assert counts['tests'] == counts['pass'] and all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    output = OUT / 'backend-applied-v3.json'
    assert not output.exists()
    row = value['repository']
    source, target = ROOT / row['candidate'], ROOT / row['target']
    assert git(target, 'rev-parse', 'HEAD').decode().strip() == row['baseline']
    assert git(target, 'branch', '--show-current').decode().strip() == row['branch']
    # All target and source bytes are checked before the first mutation.
    for item in row['changed']:
        src, dst = checked(source, item['path']), checked(target, item['path'])
        assert digest(src) == item['after_sha256'], src
        assert (digest(dst) if dst.is_file() else None) == item['before_sha256'], dst
    for name, expected in row['retained_existing_files'].items():
        assert digest(checked(target, name)) == expected, name
    for item in row['changed']:
        dst = checked(target, item['path'])
        if dst.is_file():
            backup = OUT / 'before-v3/platform' / item['path']
            backup.parent.mkdir(parents=True, exist_ok=True)
            with backup.open('xb') as stream:
                stream.write(dst.read_bytes())
    for item in row['changed']:
        dst = checked(target, item['path'])
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(checked(source, item['path']).read_bytes())
        assert digest(dst) == item['after_sha256']
    assert digest(FROZEN) == value['frozen_plan_sha256']
    frozen()
    save(output, {'at': datetime.now(timezone.utc).isoformat(), 'status': 'copied_and_verified',
                  'plan_sha256': digest(PLAN), 'full_regression_sha256': digest(REPORT),
                  'files': len(row['changed']), 'deleted_files': 0,
                  'retained_published_only_files': len(row['retained_existing_files']),
                  'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'copied_and_verified', 'files': len(row['changed']), 'deleted_files': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['plan', 'apply'])
    plan() if parser.parse_args().mode == 'plan' else apply()
