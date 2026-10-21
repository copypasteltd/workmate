"""Bind durable provider controls to executed bytes; retain the original acceptance scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from refresh_stage52_capabilities import (
    ROOT, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt,
    source_snapshot, verify_run,
)

BASELINE = '0389895'
PLATFORM_BASELINE = 'c5b3f75'
HISTORY = ROOT / 'docs/quality/history/stage55-before-provider'


def suite(name, current=False):
    data = read(DELIVERY / 'evidence' / (name + '.json'))
    result = verify_run(name, expected_status=data['status'],
                        verifier_snapshot=DELIVERY / data['verifier_snapshot'])
    assert data['schema_change'] is True
    cleanup = data['fixture_cleanup']
    path = DELIVERY / cleanup['path']
    assert digest(path) == cleanup['sha256']
    assert cleanup['status'] == 'passed' and cleanup['workers_exited']
    assert cleanup['actual_filesystem_checked'] and all(row['reclaimed'] for row in cleanup['results'])
    result['fixture_cleanup'] = receipt(path)
    if current:
        expected = {**source_snapshot(), '.env.example': digest(PLATFORM / '.env.example')}
        assert data['source_files'] == expected, 'Executed platform bytes differ'
        assert data['status'] == 'passed'
        assert data['migration_sha256'] == digest(PLATFORM / 'migrations/066-durable-provider-requests.sql')
    return result


def names(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--focused', required=True)
    parser.add_argument('--full', required=True)
    parser.add_argument('--credential-scan', required=True)
    args = parser.parse_args()
    for value in (args.focused, args.full, args.credential_scan):
        assert re.fullmatch(r'\d{2}', value)
    baseline_bytes = git(ROOT, 'show', BASELINE + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = suite('provider-control-candidate-' + args.focused, current=True)
    full = suite('provider-control-regression-' + args.full, current=True)
    previous = baseline['inference_request_verification']['full_platform_regression']
    old_raw = ROOT / previous['raw_report']['path']
    assert digest(old_raw) == previous['raw_report']['sha256']
    current_names = names(ROOT / full['raw_report']['path'])
    assert not (names(old_raw) - current_names), 'A previous named test disappeared'
    assert not (names(ROOT / focused['raw_report']['path']) - current_names)
    assert full['counts']['tests'] > previous['counts']['tests']

    migrations = {}
    historical = git(PLATFORM, 'ls-tree', '-r', '--name-only', PLATFORM_BASELINE, '--', 'migrations').decode().splitlines()
    assert len(historical) == 65
    for name in historical:
        path = PLATFORM / name
        assert path.read_bytes() == git(PLATFORM, 'show', PLATFORM_BASELINE + ':' + name)
        migrations[name] = digest(path)
    assert len(list((PLATFORM / 'migrations').glob('*.sql'))) == 66

    static_path = DELIVERY / 'evidence/provider-control-static-01.json'
    static = read(static_path)
    assert static['status'] == 'passed' and static['source_unchanged']
    assert static['source_files'] == {**source_snapshot(), '.env.example': digest(PLATFORM / '.env.example')}
    assert static['verifier_sha256'] == digest(DELIVERY / static['verifier_snapshot'])
    assert static['verifier_sha256'] == digest(DELIVERY / 'scripts/run-provider-static-checks.mjs')
    assert [item['name'] for item in static['checks']] == ['typecheck', 'build']
    for item in static['checks']:
        assert item['exit_code'] == 0 and item['raw_sha256'] == digest(DELIVERY / item['raw_report'])
    old_types_path = DELIVERY / 'evidence/provider-control-types-01.json'
    old_types = read(old_types_path)
    assert old_types['status'] == 'failed' and old_types['exit_code'] != 0
    assert digest(DELIVERY / old_types['raw_report']) == old_types['raw_sha256']
    assert 'TS2550' in (DELIVERY / old_types['raw_report']).read_text(encoding='utf-8')

    attempts, preimages = [], {}
    for path in sorted((DELIVERY / 'evidence').glob('provider-control-*.json')):
        if not re.fullmatch(r'provider-control-(core|candidate|regression)-\d{2}\.json', path.name):
            continue
        attempts.append(suite(path.stem))
        data = read(path)
        for name, expected in data['source_files'].items():
            if digest(PLATFORM / name) == expected:
                continue
            candidates = sorted((DELIVERY / 'evidence').glob('provider-control-*-' + name.replace('/', '__')))
            preserved = next((candidate for candidate in candidates if digest(candidate) == expected), None)
            assert preserved is not None, 'Missing exact historical source: ' + path.stem + ':' + name
            preimages[preserved.relative_to(ROOT).as_posix()] = receipt(preserved)

    upgrade_path = DELIVERY / 'evidence/provider-control-upgrade.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['source_unchanged']
    assert upgrade['owned_database_shutdown'] and upgrade['database_shutdown_exit_code'] == 0
    assert upgrade['candidate']['sha256'] == focused['sha256']
    assert upgrade['regression']['sha256'] == full['sha256']
    assert upgrade['verifier_sha256'] == digest(DELIVERY / 'scripts/upgrade-provider-control-local.mjs')
    before_path = DELIVERY / 'evidence/provider-control-migrations-before.json'
    after_path = DELIVERY / 'evidence/provider-control-migrations.json'
    before, after = read(before_path), read(after_path)
    assert before['status'] == 'captured_before_upgrade' and after['status'] == 'passed'
    assert {item['database'] for item in after['databases']} == {'copypaste', 'copypaste_test'}
    assert after['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-provider-control-migrations.mjs')
    for row in after['databases']:
        old = next(item for item in before['databases'] if item['database'] == row['database'])
        assert row['original'] == old['original']
        assert row['migrations'][:65] == old['migrations'] and len(row['migrations']) == 66
        assert row['original_migration_bytes'] == old['original_migration_bytes']
        assert row['historical_requests_fabricated'] is False and row['request_rows'] == row['event_rows'] == 0
        assert len(row['controls']) == 4 and len(row['bootstrap_policies']) == len(row['bootstrap_heads']) == 2
        for filename, expected in row['original_migration_bytes'].items():
            assert digest(PLATFORM / 'migrations' / filename) == expected
    scan_path = ROOT / 'docs/quality' / ('provider-control-credential-scan-' + args.credential_scan + '.json')
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['matches'] == [] and scan['configured_patterns'] > 0
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_provider_credentials.mjs')
    expected_files = {path.relative_to(ROOT).as_posix() for path in (DELIVERY / 'evidence').iterdir()
                      if path.is_file() and path.name.startswith('provider-control-')}
    assert {item['path'] for item in scan['files']} == expected_files
    for item in scan['files']:
        assert digest(ROOT / item['path']) == item['sha256']
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Durable shared provider admission, request facts and conservative orphan recovery; simulated AI; not whole-product acceptance',
        'documentation_verifier': receipt(Path(__file__).resolve()),
        'documentation_verifier_dependency': receipt(Path(__file__).with_name('refresh_stage52_capabilities.py').resolve()),
        'prior_checkpoint': {**receipt(ROOT / 'docs/quality/inference-request-checkpoint.json'), 'source_commit': BASELINE},
        'original_scope': {'requirements': 102, 'summary': baseline['summary'], 'fully_accepted_requirements': 0,
                           'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
        'focused': focused, 'full_platform_regression': full,
        'platform_build_and_types': receipt(static_path),
        'preserved_compilation_diagnostic': receipt(old_types_path),
        'prior_named_test_count': previous['counts']['tests'],
        'all_prior_named_tests_retained': dict(names(old_raw)),
        'executions': attempts, 'historical_source_preimages': list(preimages.values()),
        'current_platform_sources': {**source_snapshot(), '.env.example': digest(PLATFORM / '.env.example')},
        'repository_heads': {name: git(PLATFORM.parent / name, 'rev-parse', 'HEAD').decode().strip()
                             for name in ('copypaste-platform','copypaste-delivery','copypaste-web','copypaste-admin','copypaste-desktop','copypaste-extension')},
        'immutable_migrations_001_065': migrations,
        'additive_migration_066': receipt(PLATFORM / 'migrations/066-durable-provider-requests.sql'),
        'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
        'normative_openapi_sha256': OPENAPI_SHA,
        'configured_credential_scan': {**receipt(scan_path), 'files': len(scan['files']), 'matches': 0},
        'browser_scope': 'No browser, Electron or extension process opened; previous client UI evidence retains its original backend and source scope',
        'remaining': [
            'Per-paid-call budget allocation using exact internal input counting and explicit output bounds; separate platform verification budget',
            'Complete Admin provider policy publication, request directory and evidence-based reconciliation controls',
            'Production egress enforcement, original TC/NFR/G01-G10, complete business acceptance, live-role qualification and client distribution',
        ],
    }
    repair = {
        'cluster': 'durable_provider_request_control',
        'verified_subflow': '真实 Worker 与后台验证共用 PostgreSQL 请求准入、不可变归属和策略；跨进程并发与一分钟速率、准备中承诺及发出前复查；完整终止用量落盘后才向 Codex 交接下一轮；未知及进程丢失保留容量，未发出可证零；精确费用分子不重复入账。逐调用预算和完整后台策略控制仍未完成，原综合验收保持开放。',
        'evidence': ['provider_request_verification'],
        'implementation_docs': ['technical/56-durable-provider-request-control.md'],
        'source_files': ['dev/copypaste-platform/' + name for name in (
            'migrations/066-durable-provider-requests.sql','src/provider-request-control.ts',
            'src/internal-ai-gateway.ts','src/worker.ts','src/capability-releases.ts','src/capability-verification.ts')],
    }
    result = json.loads(baseline_bytes)
    for item in result['requirements']:
        if item['requirement_id'] in {f'REQ-{value:03}' for value in (1,43,44,45,46,52,79,83,96,99,102)}:
            item.setdefault('verified_repairs', []).append(repair)
    assert len(result['requirements']) == 102
    assert Counter(row['assessment'] for row in result['requirements']) == Counter(row['assessment'] for row in baseline['requirements'])
    for old, new in zip(baseline['requirements'], result['requirements']):
        assert all(new[key] == old[key] for key in old if key != 'verified_repairs')
        assert new.get('verified_repairs', [])[:len(old.get('verified_repairs', []))] == old.get('verified_repairs', [])
    result['at'] = checkpoint['at']
    result['provider_request_verification'] = checkpoint
    result['evidence']['platform_regression'] = full
    result['evidence_currentness_policy'] += ' Stage56: only the new provider-control platform runs bind to current backend bytes; earlier UI/native reports retain their original scope.'
    if args.write:
        HISTORY.mkdir(parents=True, exist_ok=True)
        path = HISTORY / 'requirements-alignment-progress.json'
        if path.exists():
            assert path.read_bytes() == baseline_bytes
        else:
            with path.open('xb') as stream:
                stream.write(baseline_bytes)
        for path, data in ((ROOT / 'docs/quality/provider-control-checkpoint.json', checkpoint),
                           (ROOT / 'docs/quality/requirements-alignment-progress.json', result)):
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status':'passed','write':args.write,'focused':focused['counts'],'full':full['counts'],
                      'source_files':len(checkpoint['current_platform_sources']),'prior_named_tests_retained':previous['counts']['tests'],
                      'requirements':102,'fully_accepted_requirements':0,'immutable_migrations':65}, ensure_ascii=False))


if __name__ == '__main__':
    main()
