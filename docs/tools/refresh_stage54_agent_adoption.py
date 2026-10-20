"""Verify recorded stage54 executions and append bounded repairs to all 102 requirements."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from refresh_stage52_capabilities import (
    ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, read, receipt,
    git, source_snapshot, verify_run,
)

BASELINE = 'cbea4f9216881c2a9b607cf38ed990d7ff67a0e2'
HISTORY = ROOT / 'docs/quality/history/stage53-before-agent-adoption'


def bound(entry):
    path = DELIVERY / entry['path']
    assert digest(path) == entry['sha256']
    return receipt(path)


def cleanup(value):
    bound(value)
    assert value['status'] == 'passed' and value['workers_exited']
    assert value['actual_filesystem_checked'] and all(r['reclaimed'] for r in value['results'])


def suite(name, current=False):
    data = read(DELIVERY / 'evidence' / (name + '.json'))
    result = verify_run(name, expected_status=data['status'],
                        verifier_snapshot=DELIVERY / data['verifier_snapshot'])
    cleanup(data['fixture_cleanup'])
    if current:
        assert data['status'] == 'passed'
        assert data['source_files'] == source_snapshot()
        assert data['migration_sha256'] == digest(PLATFORM / 'migrations/065-explicit-agent-adoption.sql')
    return result


def browser(name, native=False):
    path = DELIVERY / 'evidence' / (name + '.json')
    data = read(path)
    assert data['status'] == 'passed' and data['exit_code'] == 0
    assert data['source_unchanged'] and data['web_build_unchanged']
    assert data['owned_database_shutdown'] and data['owned_web_preview_closed']
    assert data['cleanup_exit_code'] == data['database_shutdown_exit_code'] == 0
    assert data['counts']['checks'] >= 10 and data['counts']['errors'] == 0
    expected_keys = {'docs/contracts/agent-adoption.openapi.json'}
    repos = ['copypaste-platform','copypaste-web','copypaste-delivery']
    if native:
        repos += ['copypaste-desktop','copypaste-extension']
    for repo in repos:
        names = git(DEV / repo,'ls-files','--cached','--others','--exclude-standard','-z').decode().split('\0')
        expected_keys.update(repo + '/' + f for f in set(names)
            if re.match(r'^(src|scripts|tests|contracts|catalog|migrations|public)/',f)
            or re.fullmatch(r'(package(-lock)?|tsconfig|vite\.config)\.(json|ts)',f))
    assert expected_keys == set(data['source_files']), 'Added or removed browser verification inputs'
    context_only_changes = []
    for f, h in data['source_files'].items():
        source = ROOT / f if f.startswith('docs/') else DEV / f
        if digest(source) != h:
            # These helpers/tests are source context, not imports of either UI
            # worker. Bind their exact old bytes to the preserved failed run,
            # while suite(current=True) above independently binds their current
            # bytes to the complete passing platform regression.
            independent = {
                'copypaste-delivery/scripts/package-agent-adoption.mjs':
                    ('agent-adoption-artifacts-01-verifier.mjs', 'Independent unused packaging verifier; current execution bound by native_artifacts'),
                'copypaste-platform/tests/runtime.test.ts':
                    ('agent-adoption-regression-01-runtime.test.ts', 'Unimported runtime test: numeric-only failure diagnostics; current full regression required'),
                'copypaste-platform/tests/skill-lifecycle.test.ts':
                    ('agent-adoption-regression-01-skill-lifecycle.test.ts', 'Unimported lifecycle test: explicit comparison/confirmation; current full regression required'),
            }
            assert f in independent, 'Changed browser source: ' + f
            preimage, scope = independent[f]
            old = DELIVERY / 'evidence' / preimage
            assert digest(old) == h
            if f.startswith('copypaste-platform/'):
                failed = read(DELIVERY / 'evidence/agent-adoption-regression-01.json')
                assert failed['source_files'][f.split('/', 1)[1]] == h
                assert failed['status'] == 'failed'
            context_only_changes.append({'path': f, 'recorded_sha256': h, 'current_sha256': digest(source),
                'preimage': receipt(old), 'scope': scope})
    for field in ('journey', 'raw_report', 'verifier', 'journey_verifier'):
        bound(data[field])
    for field, script in [('verifier', 'run-agent-adoption-' + ('native.mjs' if native else 'ui.mjs')),
                           ('journey_verifier', 'qa-agent-adoption-' + ('native.ts' if native else 'ui.ts'))]:
        assert data[field]['sha256'] == digest(DELIVERY / 'scripts' / script)
    cleanup(data['fixture_cleanup'])
    journey = read(DELIVERY / data['journey']['path'])
    assert journey['status'] == 'passed' and not journey['errors']
    assert journey['browser_closed'] and journey['owned_api_closed']
    assert all(c['status'] == 'passed' for c in journey['checks'])
    if native:
        assert journey['desktop_closed'] and journey['extension_closed']
        assert journey['artifacts_unchanged_after_run']
        assert journey['inspection']['desktop']['no_application_menu']
        assert journey['inspection']['extension']['side'] == 'right'
        assert journey['inspection']['extension']['native_context_type'] == 'SIDE_PANEL'
        assert journey['artifact_inventory_legacy_verifier_executed'] is False
        artifacts = journey['tested_artifacts']
        for repo, key in [('copypaste-desktop', 'desktop'), ('copypaste-extension', 'extension')]:
            names = set(git(DEV / repo,'ls-files','--cached','--others','--exclude-standard','-z').decode().split('\0'))
            names = {f for f in names if f and not re.fullmatch(r'README(?:\.[\w-]+)?\.md',f)
                and not f.startswith('assets/screenshots/') and not f.startswith('docs/')}
            assert names == {f['path'] for f in artifacts[key]['source_files']}
            for f in artifacts[key]['source_files']:
                assert digest(DEV / repo / f['path']) == f['sha256']
        for f in artifacts['desktop']['runtime_files']:
            assert digest(DEV / 'copypaste-desktop/release/adoption-54/win-unpacked' / f['path']) == f['sha256']
        for f in artifacts['extension']['dist_files']:
            assert digest(DEV / 'copypaste-extension/dist' / f['path']) == f['sha256']
        for f in artifacts['desktop']['installer_files']:
            assert digest(DEV / 'copypaste-desktop/release/adoption-54' / f['path']) == f['sha256']
    else:
        assert journey['supplemental_contract_sha256'] == digest(ROOT / 'docs/contracts/agent-adoption.openapi.json')
        assert len(journey['screenshots']) >= 5
    for shot in journey['screenshots']:
        assert shot['edited'] is False and digest(DEV / shot['path']) == shot['sha256']
    for f, h in data['web_build']['dist_files'].items():
        assert digest(DEV / 'copypaste-web/dist' / f) == h
    return {**receipt(path), 'journey': bound(data['journey']), 'checks': len(journey['checks']),
            'unedited_screenshots': len(journey['screenshots']), 'independent_context_changes': context_only_changes}


def main():
    p = argparse.ArgumentParser()
    for name in ('focused', 'full', 'ui', 'native', 'contract', 'artifacts', 'documentation'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--write', action='store_true')
    args = p.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(args, k)) for k in ('focused','full','ui','native','contract','artifacts','documentation'))
    baseline_bytes = git(ROOT, 'show', BASELINE + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = suite('agent-adoption-candidate-' + args.focused, current=True)
    full = suite('agent-adoption-regression-' + args.full, current=True)
    assert focused['counts']['tests'] >= 93 and full['counts']['tests'] >= 484
    names = lambda path: Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))
    full_names = names(ROOT / full['raw_report']['path'])
    prior_full = baseline['evidence']['platform_regression']
    assert digest(ROOT / prior_full['raw_report']['path']) == prior_full['raw_report']['sha256']
    assert not (names(ROOT / prior_full['raw_report']['path']) - full_names), 'An old named test disappeared'
    assert not (names(ROOT / focused['raw_report']['path']) - full_names)
    web = browser('agent-adoption-ui-' + args.ui)
    native = browser('agent-adoption-native-' + args.native, native=True)
    contract_path = DELIVERY / 'evidence' / ('agent-adoption-contract-' + args.contract + '.json')
    contract = read(contract_path)
    assert contract['status'] == 'passed' and contract['source_unchanged'] and len(contract['checks']) == 5 and not contract['errors']
    for f, h in contract['source_files'].items():
        assert digest(ROOT / f) == h
    assert (DELIVERY / 'evidence' / ('agent-adoption-contract-' + args.contract + '-verifier.ts')).read_bytes() == (DELIVERY / 'scripts/check-agent-adoption-contract.ts').read_bytes()
    artifact_path = DELIVERY / 'evidence' / ('agent-adoption-artifacts-' + args.artifacts + '.json')
    artifacts = read(artifact_path)
    assert artifacts['status'] == 'passed' and not artifacts['signed'] and not artifacts['installed_or_published']
    assert artifacts['extension_zip_matches_tested_dist'] and artifacts['validation']['sha256'] == native['journey']['sha256']
    assert artifacts['verifier_sha256'] == digest(DELIVERY / 'scripts/package-agent-adoption.mjs')
    for a in artifacts['artifacts']:
        assert digest(DEV / a['path']) == a['sha256'] and (DEV / a['path']).stat().st_size == a['bytes']
    mirror_path = ROOT / 'docs/quality/agent-adoption-artifacts-02.json'
    assert mirror_path.read_bytes() == artifact_path.read_bytes()
    screenshots_path = ROOT / 'docs/quality/agent-adoption-screenshots-01.json'
    shots = read(screenshots_path)
    assert shots['status'] == 'passed' and len(shots['images']) == 10
    for image in shots['images']:
        assert not image['edited']
        assert digest(ROOT / image['path']) == image['sha256'] == digest(DEV / image['source'])
    initial_artifacts_path = DELIVERY / 'evidence/agent-adoption-artifacts-01.json'
    initial_artifacts = read(initial_artifacts_path)
    assert initial_artifacts['status'] == 'failed' and initial_artifacts['exit_code'] == 1
    assert initial_artifacts['verifier_sha256'] == digest(DELIVERY / initial_artifacts['verifier_snapshot'])
    upgrade_path = DELIVERY / 'evidence/agent-adoption-upgrade.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['source_unchanged'] and upgrade['owned_database_shutdown']
    assert upgrade['candidate']['sha256'] == focused['sha256'] and upgrade['regression']['sha256'] == full['sha256']
    assert upgrade['verifier_sha256'] == digest(DELIVERY / 'scripts/upgrade-agent-adoption-local.mjs')
    before_path, migration_path = DELIVERY / 'evidence/agent-adoption-migrations-before.json', DELIVERY / 'evidence/agent-adoption-migrations.json'
    before, migration = read(before_path), read(migration_path)
    assert migration['status'] == 'passed' and migration['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-agent-adoption-migrations.mjs')
    assert {d['database'] for d in migration['databases']} == {'copypaste', 'copypaste_test'}
    for d in migration['databases']:
        old = next(x for x in before['databases'] if x['database'] == d['database'])
        assert len(d['original']) == 131 and d['original'] == old['original']
        assert len(d['migrations']) == 65 and d['migrations'][:64] == old['migrations']
        assert d['original_migration_bytes'] == old['original_migration_bytes']
        assert d['historical_adoptions_fabricated'] is False
        for f, h in d['original_migration_bytes'].items():
            assert digest(PLATFORM / 'migrations' / f) == h
        assert d['controls']['agent_adoption_previews']['new_rows'] == 0
    doc_path = ROOT / 'docs/quality' / ('agent-adoption-docs-' + args.documentation + '.json')
    doc = read(doc_path)
    assert doc['status'] == 'passed' and doc['checks_failed'] == 0
    assert doc['counts']['requirements'] == doc['counts']['acceptance_cases'] == 102
    assert doc['counts']['api_operations'] == 225 and doc['counts']['qualified_roles'] == 0
    preserved = []
    for kind, end in [('candidate', args.focused), ('regression', args.full)]:
        for n in range(1, int(end)):
            preserved.append(suite('agent-adoption-' + kind + '-' + str(n).zfill(2)))
    for kind, end in [('ui', args.ui), ('native', args.native)]:
        for n in range(1, int(end)):
            path = DELIVERY / 'evidence' / ('agent-adoption-' + kind + '-' + str(n).zfill(2) + '.json')
            data = read(path)
            assert data['owned_database_shutdown'] and data['owned_web_preview_closed']
            for field in ('journey','raw_report','verifier','journey_verifier'):
                bound(data[field])
            preserved.append({**receipt(path), 'status': data['status']})
    diagnostics = []
    for n in ('01', '02'):
        diagnostic_path = DELIVERY / 'evidence' / ('agent-adoption-runtime-diagnostic-' + n + '.json')
        diagnostic = read(diagnostic_path)
        verifier = DELIVERY / 'evidence' / ('agent-adoption-runtime-diagnostic-' + n + '-verifier.mjs')
        assert digest(verifier) == diagnostic['verifier_sha256']
        if n == '01':
            assert diagnostic['status'] == 'failed' and diagnostic['tests_executed'] is False
        else:
            assert diagnostic['status'] == 'passed' and diagnostic['source_unchanged']
            assert diagnostic['counts']['tests'] == diagnostic['counts']['pass'] == 2
            assert digest(DELIVERY / 'evidence' / diagnostic['raw_report']) == diagnostic['raw_sha256']
            for f, h in diagnostic['source_files'].items():
                assert digest(PLATFORM / f) == h
        diagnostics.append({**receipt(diagnostic_path), 'status': diagnostic['status']})
    checkpoint = {'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Explicit customer version adoption and current actual Web, packaged frameless Desktop and native Side Panel subflows; all original acceptance remains open',
        'original_scope': {'requirements': 102, 'fully_accepted': 0, 'qualified_live_roles': 0, 'normative_openapi_sha256': OPENAPI_SHA},
        'prior_checkpoint': {'path': (HISTORY / 'requirements-alignment-progress.json').relative_to(ROOT).as_posix(), 'sha256': sha256(baseline_bytes).hexdigest(), 'source_commit': BASELINE},
        'focused': focused, 'full_platform_regression': full, 'web_browser': web, 'native_browser': native,
        'strict_contract': receipt(contract_path), 'native_artifacts': receipt(artifact_path), 'native_artifact_mirror': receipt(mirror_path), 'unedited_screenshot_copies': receipt(screenshots_path), 'initial_packaging_failure': receipt(initial_artifacts_path), 'native_upgrade': receipt(upgrade_path),
        'native_migration': {**receipt(migration_path), 'before': receipt(before_path), 'preserved_tables_per_database': 131},
        'documentation_contracts': receipt(doc_path), 'preserved_prior_attempts': preserved, 'runtime_diagnostics': diagnostics,
        'current_platform_sources': len(source_snapshot()), 'migration_065_sha256': digest(PLATFORM / 'migrations/065-explicit-agent-adoption.sql'),
        'remaining': ['Per-request internal gateway authorization and limits', 'Other original API and business acceptance cases', 'All original TC/NFR/G01-G10, live roles, production configuration, signing and installation acceptance']}
    if args.write:
        HISTORY.mkdir(parents=True, exist_ok=True)
        for f in ('requirements-alignment-progress.json','controlled-capability-checkpoint.json'):
            raw = git(ROOT,'show',BASELINE + ':docs/quality/' + f)
            target = HISTORY / f
            if target.exists(): assert target.read_bytes() == raw
            else: target.write_bytes(raw)
        updated = json.loads(baseline_bytes)
        updated['at'] = checkpoint['at']
        updated['explicit_agent_adoption_verification'] = checkpoint
        updated['evidence_currentness_policy'] = 'Stage54 executes current backend suites, strict adoption contract, actual built Web and new packaged Desktop/native Side Panel; other historical receipts keep their original source scope.'
        updated['evidence']['platform_regression_stage53'] = prior_full
        updated['evidence']['platform_regression'] = full
        updated['evidence']['agent_adoption_candidates'] = focused
        updated['evidence']['agent_adoption_web'] = web
        updated['evidence']['agent_adoption_native'] = native
        updated['evidence']['agent_adoption_contract'] = receipt(contract_path)
        updated['evidence']['agent_adoption_migrations'] = checkpoint['native_migration']
        updated['evidence']['documentation_contracts_stage54'] = receipt(doc_path)
        repair = {'cluster': 'explicit_agent_version_adoption', 'verified_subflow': '默认助手、专家设置与本人会话的模型/强度/费率限时比较、明确确认、会话权限、并发及幂等保护；实际 Web、无边框打包 Desktop 和原生右侧栏入口，旧任务保持原版本和价格。', 'evidence': ['agent_adoption_candidates','platform_regression','agent_adoption_web','agent_adoption_native','agent_adoption_contract','agent_adoption_migrations'], 'implementation_docs': ['technical/54-explicit-agent-version-adoption.md']}
        for item in updated['requirements']:
            if item['requirement_id'] in ('REQ-036','REQ-039','REQ-045','REQ-062','REQ-064','REQ-079','REQ-099'):
                item.setdefault('verified_repairs', []).append(repair)
                item['finding'] = '用户显式采用及实际三端对应子流程已验证；其余原始综合条件继续逐项验收。'
        assert updated['fully_accepted_requirements'] == baseline['fully_accepted_requirements'] == 0
        assert updated['qualified_live_roles'] == baseline['qualified_live_roles'] == 0
        for old, item in zip(baseline['requirements'], updated['requirements']):
            for key in ('requirement_id','requirement','acceptance_case','acceptance_conditions','original_finding','assessment'):
                assert old.get(key) == item.get(key)
        updated['summary'] = dict(Counter(x['assessment'] for x in updated['requirements']))
        for repository in updated['repositories']:
            directory = DEV / repository['name']
            repository['head'] = git(directory,'rev-parse','HEAD').decode().strip()
            repository['dirty'] = bool(git(directory,'status','--porcelain').strip())
            repository['source_hashes_scope'] = 'Historical audit source snapshot; stage54 executed current manifests are in explicit_agent_adoption_verification'
        for name, value in [('agent-adoption-checkpoint.json',checkpoint),('requirements-alignment-progress.json',updated)]:
            raw = (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
            if name == 'requirements-alignment-progress.json' and b'\r\n' in baseline_bytes:
                raw = raw.replace(b'\n', b'\r\n')
            (ROOT / 'docs/quality' / name).write_bytes(raw)
    print(json.dumps({'status':'passed','focused_tests':focused['counts']['tests'],'platform_tests':full['counts']['tests'],'web_checks':web['checks'],'native_checks':native['checks'],'original_requirements':102,'fully_accepted':0,'written':args.write}))


if __name__ == '__main__':
    main()
