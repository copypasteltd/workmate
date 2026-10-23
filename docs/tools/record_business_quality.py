"""Bind versioned business-quality evidence to the final, unchanged sources."""
from datetime import datetime, timezone
from pathlib import Path
from hashlib import sha256
import json
import re
import subprocess
from record_desktop_browser import batch_cases

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/business-quality-checkpoint.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def unchanged_published_contract(repo, name):
    command = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
    commit = subprocess.check_output(command + ['rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    before = subprocess.check_output(command + ['show', commit + ':' + name], cwd=repo)
    current = (repo / name).read_bytes()
    assert before == current, (name, 'Preserve each previously published contract independently')
    return {'commit': commit, 'path': name, 'sha256': sha256(current).hexdigest(), 'published_bytes_unchanged': True}


def bound(item):
    file = (DELIVERY / item['path']).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item['sha256']
    return file


def main():
    assert not OUTPUT.exists(), 'Retain earlier checkpoint bytes'
    files = {
        'platform': 'evidence/desktop-execution-control-21.json',
        'desktop': 'evidence/desktop-local-ui-31.json',
        'web_admin': 'evidence/quality-ui-07.json',
        'extension': 'evidence/extension-chat-07.json',
        'native_supervisor': 'evidence/local-codex-native-22.json',
    }
    reports = {key: read(DELIVERY / file) for key, file in files.items()}
    refresh_path = ROOT / 'docs/quality/business-quality-migration-assertion-refresh.json'
    refresh = read(refresh_path)
    before = (ROOT / refresh['archive']).read_bytes()
    after = (DEV / refresh['path']).read_bytes()
    assert sha256(before).hexdigest() == refresh['before_sha256']
    assert sha256(after).hexdigest() == refresh['after_sha256']
    assert before.count(b'      94,') == 2 and before.replace(b'      94,', b'      95,') == after
    assert reports['platform']['source_files'][refresh['path']] == refresh['after_sha256']
    source, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        if 'owned_database_shutdown' in report:
            assert report['owned_database_shutdown'], key
        for field in ['raw_report', 'raw_log', 'verifier', 'journey_verifier']:
            if isinstance(report.get(field), dict):
                bound(report[field])
        if isinstance(report.get('raw_report'), str):
            assert digest(DELIVERY / report['raw_report']) == report['raw_sha256']
        entries = report['source_files']
        if key == 'native_supervisor':
            entries = {'copypaste-desktop/' + name: value for name, value in entries.items()}
        differences = []
        for name, value in entries.items():
            current = digest(DEV / name)
            if current != value:
                assert key in ['desktop', 'web_admin'] and name == refresh['path']
                assert value == refresh['before_sha256'] and current == refresh['after_sha256']
                differences.append({'path': name, 'executed_sha256': value, 'current_sha256': current,
                                    'reason': 'Only two migration test expected-version assertions, 94 to 95; no runtime/UI/harness change. Fresh full-platform qualification covers the updated test.',
                                    'review': refresh_path.relative_to(ROOT).as_posix()})
            assert name not in source or source[name] == current
            source[name] = current
        scopes.append({'scope': key, 'path': files[key], 'sha256': digest(DELIVERY / files[key]),
                       'source_files': len(entries), 'later_source_differences': differences,
                       'execution': 'retained proof with all 57 bound source files unchanged' if key == 'native_supervisor' else
                                    'stage-78 execution retained with one explicitly reviewed non-runtime test-only difference' if differences else 'fresh stage-78 execution'})
    full = reports['platform']
    index = read(bound(full['raw_report']))
    plan = read(bound(index['plan']))
    previous = batch_cases(read(DELIVERY / 'evidence/desktop-execution-control-19-index.json'))
    current = batch_cases(index)
    assert sum(previous.values()) == 851 and not previous - current
    assert sum(current.values()) == full['counts']['tests'] == full['counts']['pass']
    assert len(plan['files']) == 67 and len(plan['batches']) == 17
    native = read(bound(reports['desktop']['journey']))
    extension = read(bound(reports['extension']['journey']))
    web_admin = reports['web_admin']['journey']
    web_prefix = Path(files['web_admin']).with_suffix('')
    assert read(DELIVERY / (str(web_prefix) + '-journey.json')) == web_admin
    assert digest(DELIVERY / (str(web_prefix) + '-verifier.mjs')) == digest(DELIVERY / 'scripts/run-quality-ui.mjs')
    assert digest(DELIVERY / (str(web_prefix) + '-journey-verifier.ts')) == digest(DELIVERY / 'scripts/qa-quality-ui.ts')
    assert len(native['checks']) == 26 and native['status'] == 'passed'
    assert any('versioned customer changes/acceptance' in value for value in native['checks'])
    assert all(native[key] for key in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed', 'native_browser_fixture_closed'])
    assert len(web_admin['checks']) == 4 and len(web_admin['media']) == 2
    assert all(web_admin[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert reports['web_admin']['owned_previews_closed'] and reports['web_admin']['compiled_unchanged']
    assert extension['status'] == 'passed' and len(extension['checks']) >= 8
    assert all(extension[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert reports['extension']['owned_preview_closed'] and reports['extension']['compiled_unchanged']
    assert len(reports['native_supervisor']['source_files']) == 57
    assert reports['native_supervisor']['counts']['tests'] == reports['native_supervisor']['counts']['pass'] == 17
    packaged = reports['desktop']['packaged']
    candidate = (DELIVERY / packaged['executable']).resolve()
    assert candidate.is_relative_to(DEV / 'copypaste-desktop/.data/local-candidates') and candidate.is_file()
    assert digest(candidate.parent / 'resources/app.asar') == packaged['app_asar_sha256']
    assert digest(candidate.parent / 'resources/local-codex/codex.exe') == packaged['native_binary_sha256']
    raw = bound(reports['desktop']['raw_report']).read_text(encoding='utf-8')
    assert 68 in [int(v) for v in re.findall(r'^# tests (\d+)\r?$', raw, re.M)]
    screenshots = native['screenshots'] + web_admin['screenshots'] + extension['screenshots']
    media = [native['media'], native['native_browser_media'], *web_admin['media'], extension['media']]
    for item in screenshots:
        assert not item['edited'] and digest(DEV / item['path']) == item['sha256']
    for recording in media:
        assert recording['skipped_capture_errors'] == 0 and recording['distinct_frames'] > 1
        for item in recording['files']:
            assert digest(DEV / item['path']) == item['sha256']
    baseline = ROOT / 'docs/quality/history/before-desktop-browser-sources/copypaste-platform'
    migrations = sorted((baseline / 'migrations').glob('*.sql'))
    assert len(migrations) == 94
    for file in migrations:
        assert digest(file) == digest(DEV / 'copypaste-platform/migrations' / file.name)
    original = ROOT / 'docs/contracts/openapi.json'
    original_contracts = {
        'authoritative': unchanged_published_contract(ROOT, 'docs/contracts/openapi.json'),
        'runtime_catalog': unchanged_published_contract(DEV / 'copypaste-platform', 'catalog/openapi.json'),
        'relationship': 'Pre-existing authoritative contract and derived runtime catalog are different files; both retain their own published bytes. This stage does not claim they are identical.'}
    assert digest(ROOT / 'docs/contracts/business-quality-openapi.json') == digest(DEV / 'copypaste-platform/contracts/business-quality-openapi.json')
    routes = read(DEV / 'copypaste-platform/contracts/implemented-routes.json')['routes']
    assert len(routes) == 434
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(progress['requirements']) == 102 and progress['fully_accepted_requirements'] == 0
    assert progress['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    assert all(g['full_acceptance'] == 'not_proven' for g in progress['gates'])
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'stage': 78,
        'status': 'verified_versioned_customer_review_and_scoped_quality_subflow',
        'scope': 'Current-version customer review, independent reported human effort, observed fixed-version reuse, company task-service cost and scoped Admin metadata; actual Web, native Desktop and Chrome Side Panel interactions. Explicit model and business/customer fixtures.',
        'selected': files, 'qualification_scopes': scopes, 'source_files': source,
        'platform_tests': full['counts'], 'client_unit_tests': 68, 'packaged_desktop_checks': 26,
        'native_supervisor_tests': reports['native_supervisor']['counts'],
        'web_admin_checks': 4, 'extension_checks': len(extension['checks']),
        'inventory': {'files': 67, 'batches': 17, 'index': full['raw_report'], 'plan': index['plan']},
        'original_regression': {'previous_cases_preserved': 851, 'new_cases': sum(current.values()) - 851},
        'migration_integrity': {'001_through_094': 'all 94 original byte copies unchanged', 'new': '095-business-delivery-quality.sql'},
        'original_openapi_sha256': digest(original), 'http_routes': 434, 'new_quality_operations': 6,
        'original_contracts': original_contracts,
        'packaged': reports['desktop']['packaged'], 'screenshots': screenshots, 'recordings': media,
        'documentation_media': [],
        'original_acceptance': {'requirements': 102, 'acceptance_cases': 102, 'partial': 81, 'unproven': 21, 'fully_accepted': 0, 'G01_G10': 'not_proven'},
        'visual_review': {'desktop': 'Actual 800x600 human input visible and focused; composer/receipt retained, hidden rails. Brand-styled role/permission/budget controls.',
                          'web_admin': 'Actual review, project aggregate and scoped Admin pages after CSS transitions. Attempt06 dark still captured a transition and remains historical.'},
        'historical_evidence': {'standalone_browser': 'Stage77 desktop-browser-16 is historical; seven bound source files changed. New packaged journey reruns its bounded native-browser scenario, without claiming a new full standalone-browser run.'},
        'migration_assertion_refresh': {'path': refresh_path.relative_to(ROOT).as_posix(), 'sha256': digest(refresh_path),
                                       'note': refresh['interpretation']},
        'limits': ['TC-056: three categories of ten real representative tasks, manual baselines and blind review remain unrun',
                   'Service cost excludes refund offsets, external services and labor; no ROI or retention inference',
                   '18 role admissions and 29 Skills are not full professional acceptance',
                   'Live providers, complete Codex Desktop/OS parity and production gates remain unproven',
                   'Native dialog decisions and customer feedback are explicit fixtures; no physical touchpad-hardware claim'],
        'verifier_sha256': digest(Path(__file__)),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], 'sources': len(source), 'platform_tests': full['counts']['tests']}))


if __name__ == '__main__':
    main()
