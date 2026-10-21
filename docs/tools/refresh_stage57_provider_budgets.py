"""Bind per-request budgets to actual execution evidence without reducing acceptance scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from refresh_stage52_capabilities import (
    ROOT, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt, source_snapshot, verify_run,
)

BASELINE = '3dc4d4c'
PLATFORM_BASELINE = '0ed17e7'


def names(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def suite(name, current=False):
    data = read(DELIVERY / 'evidence' / (name + '.json'))
    result = verify_run(name, expected_status=data['status'], verifier_snapshot=DELIVERY / data['verifier_snapshot'])
    assert data['schema_change'] is True
    cleanup = data['fixture_cleanup']
    assert digest(DELIVERY / cleanup['path']) == cleanup['sha256']
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(item['reclaimed'] for item in cleanup['results'])
    result['fixture_cleanup'] = receipt(DELIVERY / cleanup['path'])
    if current:
        assert data['status'] == 'passed'
        assert data['source_files'] == {**source_snapshot(), '.env.example': digest(PLATFORM / '.env.example')}
        assert data['migration_sha256'] == digest(PLATFORM / 'migrations/067-per-request-budget-enforcement.sql')
    return result


def main():
    p = argparse.ArgumentParser()
    for flag in ('focused', 'full', 'static', 'credential-scan'):
        p.add_argument('--' + flag, required=True)
    p.add_argument('--write', action='store_true')
    a = p.parse_args()
    for value in (a.focused, a.full, a.static, a.credential_scan):
        assert re.fullmatch(r'\d{2}', value)
    baseline_bytes = git(ROOT, 'show', BASELINE + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = suite('provider-budget-candidate-' + a.focused, True)
    full = suite('provider-budget-regression-' + a.full, True)
    previous = baseline['provider_request_verification']['full_platform_regression']
    old_raw = ROOT / previous['raw_report']['path']
    assert digest(old_raw) == previous['raw_report']['sha256']
    assert not (names(old_raw) - names(ROOT / full['raw_report']['path'])), 'An earlier named test disappeared'
    assert not (names(ROOT / focused['raw_report']['path']) - names(ROOT / full['raw_report']['path']))
    assert full['counts']['tests'] > previous['counts']['tests']
    migrations = {}
    old_files = git(PLATFORM, 'ls-tree', '-r', '--name-only', PLATFORM_BASELINE, '--', 'migrations').decode().splitlines()
    assert len(old_files) == 66
    for name in old_files:
        assert (PLATFORM / name).read_bytes() == git(PLATFORM, 'show', PLATFORM_BASELINE + ':' + name)
        migrations[name] = digest(PLATFORM / name)
    assert len(list((PLATFORM / 'migrations').glob('*.sql'))) == 67
    static_path = DELIVERY / 'evidence' / ('provider-budget-static-' + a.static + '.json')
    static = read(static_path)
    assert static['status'] == 'passed' and static['source_unchanged']
    assert static['source_files'] == read(ROOT / full['path'])['source_files']
    assert static['verifier_sha256'] == digest(DELIVERY / static['verifier_snapshot']) == digest(DELIVERY / 'scripts/run-provider-budget-static-checks.mjs')
    assert [item['name'] for item in static['checks']] == ['typecheck', 'build']
    for item in static['checks']:
        assert item['exit_code'] == 0 and item['raw_sha256'] == digest(DELIVERY / item['raw_report'])
    attempts, preimages = [], {}
    for path in sorted((DELIVERY / 'evidence').glob('provider-budget-*.json')):
        if not re.fullmatch(r'provider-budget-(core|candidate|regression)-\d{2}\.json', path.name):
            continue
        attempts.append(suite(path.stem))
        for name, expected in read(path)['source_files'].items():
            if digest(PLATFORM / name) == expected:
                continue
            preserved = next((x for x in (DELIVERY / 'evidence').glob('provider-budget-*-' + name.replace('/', '__')) if digest(x) == expected), None)
            assert preserved is not None, 'Missing exact executed preimage: ' + path.stem + ':' + name
            preimages[preserved.relative_to(ROOT).as_posix()] = receipt(preserved)
    upgrade_path = DELIVERY / 'evidence/provider-budget-upgrade.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['source_unchanged'] and upgrade['owned_database_shutdown'] and upgrade['database_shutdown_exit_code'] == 0
    assert upgrade['candidate']['sha256'] == focused['sha256'] and upgrade['regression']['sha256'] == full['sha256']
    assert upgrade['verifier_sha256'] == digest(DELIVERY / 'scripts/upgrade-provider-budget-local.mjs')
    before_path, after_path = (DELIVERY / 'evidence' / name for name in ('provider-budget-migrations-before.json','provider-budget-migrations.json'))
    before, after = read(before_path), read(after_path)
    assert before['status'] == 'captured_before_upgrade' and after['status'] == 'passed'
    assert after['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-provider-budget-migrations.mjs')
    assert {r['database'] for r in after['databases']} == {'copypaste','copypaste_test'}
    for row in after['databases']:
        old = next(x for x in before['databases'] if x['database'] == row['database'])
        assert row['original'] == old['original'] and len(row['original']) >= 136
        assert row['migrations'][:66] == old['migrations'] and len(row['migrations']) == 67
        assert row['original_migration_bytes'] == old['original_migration_bytes']
        assert row['historical_spend_fabricated'] is False and len(row['controls']) == 8
        assert all(n == 0 for n in row['empty_new_tables'].values())
    scan_path = ROOT / 'docs/quality' / ('provider-budget-credential-scan-' + a.credential_scan + '.json')
    scan = read(scan_path)
    assert scan['status'] == 'passed' and not scan['matches'] and scan['configured_patterns'] > 0
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_provider_budget_credentials.mjs')
    expected_files = {x.relative_to(ROOT).as_posix() for x in (DELIVERY / 'evidence').iterdir() if x.is_file() and x.name.startswith('provider-budget-')}
    assert {x['path'] for x in scan['files']} == expected_files
    for item in scan['files']:
        assert digest(ROOT / item['path']) == item['sha256']
    # Preserve the real historical construction instead of adding a production
    # fallback for databases which have not applied the budget migration.
    old_billing = git(PLATFORM, 'show', PLATFORM_BASELINE + ':src/billing.ts').decode()
    assert (PLATFORM / 'src/billing.ts').read_text(encoding='utf-8').replace(
        '  await tx.query("SELECT register_task_ai_budget($1)", [task]);\n', '', 1) == old_billing
    legacy_path = PLATFORM / 'tests/fixtures/billing-before-budget.ts'
    legacy = legacy_path.read_text(encoding='utf-8')
    for start, end in (('function exactAmount','async function balanceState'),
                       ('async function taskWallet','export async function reserve'),
                       ('export async function reserve','export async function settle')):
        fragment = old_billing[old_billing.index(start):old_billing.index(end)]
        if start == 'export async function reserve':
            fragment = fragment.replace('export async function reserve(', 'async function legacyReserve(', 1)
        assert fragment in legacy, 'Historical financial function changed'
    assert 'Historical reserve fixture is forbidden after SQL067' in legacy
    assert not any('billing-before-budget' in path.read_text(encoding='utf-8') for path in (PLATFORM / 'src').rglob('*.ts'))
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Exact internal input counting, shared original task budgets, platform-funded counting and bounded Admin verification; authorized simulated AI; not whole-product acceptance',
        'documentation_verifier': receipt(Path(__file__).resolve()),
        'documentation_verifier_dependency': receipt(Path(__file__).with_name('refresh_stage52_capabilities.py')),
        'prior_checkpoint': {**receipt(ROOT / 'docs/quality/provider-control-checkpoint.json'), 'source_commit': BASELINE},
        'original_scope': {'requirements':102,'summary':baseline['summary'],'fully_accepted_requirements':0,'qualified_live_roles':0,'all_TC_NFR_G01_G10_retained':True},
        'focused':focused,'full_platform_regression':full,'platform_build_and_types':receipt(static_path),
        'prior_named_test_count':previous['counts']['tests'],'all_prior_named_tests_retained':dict(names(old_raw)),
        'executions':attempts,'historical_source_preimages':list(preimages.values()),
        'current_platform_sources':{**source_snapshot(),'.env.example':digest(PLATFORM / '.env.example')},
        'immutable_migrations_001_066':migrations,'additive_migration_067':receipt(PLATFORM / 'migrations/067-per-request-budget-enforcement.sql'),
        'local_database_upgrade':{'execution':receipt(upgrade_path),'before':receipt(before_path),'after':receipt(after_path)},
        'normative_openapi_sha256':OPENAPI_SHA,'configured_credential_scan':{**receipt(scan_path),'files':len(scan['files']),'matches':0},
        'historical_reservation_fixture':{**receipt(legacy_path),'source_commit':PLATFORM_BASELINE,'original_functions_unchanged':True,
                                          'scope':'Pre067 upgrade construction only; current runtime always registers its original budget'},
        'browser_scope':'No browser or native client opened; previous UI and native package receipts retain their original source scope',
        'remaining':['Complete Admin provider policy publication, request directory and evidence-based reconciliation controls',
                     'Production egress enforcement, original TC/NFR/G01-G10, complete business acceptance, live-role qualification and client distribution'],
    }
    repair = {'cluster':'per_request_budget_enforcement','verified_subflow':'内部实际输入计数绑定原请求；文本与图片共用任务原预留，平台承担计数费；后台验证独立运行与每日预算；跨调用精确分子统一结算，未知保留承诺，用量超出先存真实事实再核账。完整后台策略界面和综合验收继续开放。',
              'evidence':['provider_budget_verification'],'implementation_docs':['technical/57-per-request-budget-enforcement.md'],
              'source_files':['dev/copypaste-platform/' + n for n in ('migrations/067-per-request-budget-enforcement.sql','src/provider-budgets.ts','src/internal-ai-gateway.ts','src/provider-request-control.ts','src/worker.ts','src/capability-releases.ts')]}
    result = json.loads(baseline_bytes)
    for item in result['requirements']:
        if item['requirement_id'] in {f'REQ-{n:03}' for n in (1,43,44,45,46,52,79,83,96,99,102)}:
            item.setdefault('verified_repairs',[]).append(repair)
    assert len(result['requirements']) == 102 and Counter(x['assessment'] for x in result['requirements']) == Counter(x['assessment'] for x in baseline['requirements'])
    for old,new in zip(baseline['requirements'],result['requirements']):
        assert all(new[k] == old[k] for k in old if k != 'verified_repairs')
        assert new.get('verified_repairs',[])[:len(old.get('verified_repairs',[]))] == old.get('verified_repairs',[])
    result['at'] = checkpoint['at']; result['provider_budget_verification'] = checkpoint; result['evidence']['platform_regression'] = full
    result['evidence_currentness_policy'] += ' Stage57: only provider-budget platform runs bind current backend bytes; earlier UI/native receipts retain original scope.'
    if a.write:
        history = ROOT / 'docs/quality/history/stage56-before-budget'; history.mkdir(parents=True,exist_ok=True)
        path = history / 'requirements-alignment-progress.json'
        if path.exists(): assert path.read_bytes() == baseline_bytes
        else: path.write_bytes(baseline_bytes)
        for path,data in ((ROOT / 'docs/quality/provider-budget-checkpoint.json',checkpoint),(ROOT / 'docs/quality/requirements-alignment-progress.json',result)):
            path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'focused':focused['counts'],'full':full['counts'],'source_files':len(checkpoint['current_platform_sources']),
                      'prior_named_tests_retained':previous['counts']['tests'],'requirements':102,'fully_accepted_requirements':0,'immutable_migrations':66}))


if __name__ == '__main__':
    main()
