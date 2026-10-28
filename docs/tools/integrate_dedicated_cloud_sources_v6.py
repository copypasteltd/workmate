"""Integrate qualified backend bytes while the independent complete run continues."""
from pathlib import Path
from datetime import datetime, timezone
import json

from integrate_dedicated_cloud_sources import ROOT, DEV, RAW, OUT, checked, digest, git
from integrate_dedicated_cloud_sources_v2 import desktop_dependencies
from integrate_dedicated_cloud_sources_v5 import frozen

PLAN = OUT / 'backend-plan-v5.json'
OUTPUT = OUT / 'backend-applied-v6.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def main():
    assert not OUTPUT.exists()
    plan = read(PLAN)
    assert plan['verifier_sha256'] == digest(ROOT / 'docs/tools/integrate_dedicated_cloud_sources_v5.py')
    assert plan['previous_plan_sha256'] == digest(OUT / 'plan.json')
    assert plan['frozen_plan_sha256'] == digest(RAW / 'full-05-plan.json')
    current = frozen()
    core_file = DEV / 'copypaste-platform-recovery-120/.data/dedicated-cloud-121/core-17.json'
    core = read(core_file)
    assert core['status'] == 'passed' and core['source_unchanged'] and core['owned_database_shutdown']
    assert core['counts'] == {'tests': 24, 'pass': 24, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    for name, expected in core['source_files'].items():
        relative = name.removeprefix('copypaste-platform/')
        assert name != relative and current['source_files']['copypaste-platform-recovery-120/' + relative] == expected
    for attempt in ['desktop-ui-07', 'ui-13', 'extension-ui-05']:
        value = read(RAW / (attempt + '.json'))
        assert value['status'] == 'passed' and value['source_unchanged'] and value['owned_database_shutdown']
    dependencies = desktop_dependencies()
    row = plan['repository']
    source, target = ROOT / row['candidate'], ROOT / row['target']
    assert git(target, 'rev-parse', 'HEAD').decode().strip() == row['baseline']
    assert git(target, 'branch', '--show-current').decode().strip() == row['branch']
    for item in row['changed']:
        src, dst = checked(source, item['path']), checked(target, item['path'])
        assert digest(src) == item['after_sha256'], src
        assert (digest(dst) if dst.is_file() else None) == item['before_sha256'], dst
    for name, expected in row['retained_existing_files'].items():
        assert digest(checked(target, name)) == expected
    for item in row['changed']:
        file = checked(target, item['path'])
        if file.is_file():
            backup = OUT / 'before-v6/platform' / item['path']
            backup.parent.mkdir(parents=True, exist_ok=True)
            with backup.open('xb') as stream:
                stream.write(file.read_bytes())
    for item in row['changed']:
        file = checked(target, item['path'])
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(checked(source, item['path']).read_bytes())
        assert digest(file) == item['after_sha256']
    assert frozen() == current
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'copied_and_verified',
              'plan_sha256': digest(PLAN), 'files': len(row['changed']), 'deleted_files': 0,
              'core_qualification': {'path': core_file.relative_to(ROOT).as_posix(), 'sha256': digest(core_file)},
              'core_counts': core['counts'], 'desktop_cross_repository_dependencies_preserved': dependencies,
              'retained_published_only_files': len(row['retained_existing_files']),
              'full_regression_pending_at_integration': True, 'published': False,
              'scope': 'Exact-byte reversible source integration after scoped core/client/UI qualification. Complete regression and publication remain independently gated.',
              'verifier_sha256': digest(Path(__file__))}
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': result['status'], 'files': len(row['changed']),
                      'deleted_files': 0, 'full_regression_pending': True, 'published': False}))


if __name__ == '__main__':
    main()
