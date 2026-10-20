"""Verify bounded REQ-095 repairs without closing the original complete TC."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
EVIDENCE = DELIVERY / 'evidence'
PLATFORM = DEV / 'copypaste-platform'


def load(path):
    return json.loads(path.read_bytes())


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def history():
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=DELIVERY, text=True).split('\0'))
    archives = []
    for name, count in [('stage50-before-support', 654), ('support-ui-initial', 2), ('support-ui-missing-browser', 2), ('support-ui-before-preferences', 7), ('support-ui-before-theme', 7), ('support-ui-before-row-locator', 10), ('support-before-route-inventory', 299), ('support-session-cleanup-failure', 11), ('support-session-cleanup-retry-failure', 11), ('support-documentation-initial', 2)]:
        manifest = EVIDENCE / name / 'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count, name
        for item in entries:
            file = (ROOT / item['archived']).resolve()
            assert file.is_relative_to(EVIDENCE) and sha(file) == item['sha256']
            assert file.relative_to(DELIVERY).as_posix() in tracked, file
        archives.append({'path': manifest.relative_to(ROOT).as_posix(), 'sha256': sha(manifest), 'files': count})
    cleanup_archive = load(EVIDENCE / 'support-session-cleanup-failure/archive-map.json')['files']
    failed_session = load(ROOT / next(v['archived'] for v in cleanup_archive if v['source'].endswith('/auth-recovery-current.json')))
    assert failed_session['status'] == 'failed' and len(failed_session['checks']) == 12
    assert failed_session['errors'] == ['Desktop cleanup: Owned Desktop required forced cleanup; graceful shutdown was not verified']
    assert failed_session['source_unchanged'] and failed_session['owned_credentials_cleared']
    assert all(failed_session[k] for k in ['browser_closed', 'desktop_closed', 'extension_closed'])
    prior = load(EVIDENCE / 'support-before-route-inventory/archive-map.json')['files']
    by_source = {v['source']: ROOT / v['archived'] for v in prior}
    previous = load(by_source['dev/copypaste-delivery/evidence/alignment-platform.json'])
    assert previous['counts'] == {'tests':424,'pass':424,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert sha(by_source['dev/copypaste-delivery/evidence/alignment-platform.tap']) == previous['sha256']
    assert previous['source_files']['contracts/implemented-routes.json'] == sha(by_source['dev/copypaste-platform/contracts/implemented-routes.json'])
    sql = PLATFORM / 'migrations/062-controlled-support-scopes.sql'
    assert sha(sql) == '2421c4b252c84ae2cb54d2b3a84681af66dcdf247fc0ea1099a23144f02baed7'
    for attempt, passed, failed in [('01', 29, 2), ('02', 33, 0)]:
        report = load(EVIDENCE / f'support-candidate-{attempt}.json')
        raw = EVIDENCE / report['raw_report'].removeprefix('evidence/')
        text = raw.read_text(encoding='utf-8')
        assert sha(raw) == report['raw_sha256'] and report['owned_database_shutdown']
        assert re.search(fr'^# pass {passed}\s*$', text, re.M) and re.search(fr'^# fail {failed}\s*$', text, re.M)
        assert (EVIDENCE / f'support-candidate-{attempt}-062.sql').read_bytes() == sql.read_bytes()
        assert report['status'] == ('passed' if failed == 0 else 'failed')
        if attempt == '02':
            for source, digest in report['source_files'].items():
                assert sha(PLATFORM / source) == digest, source
    before, after = [load(EVIDENCE / name) for name in ['support-migrations-before.json', 'support-migrations.json']]
    original_verifier = EVIDENCE / 'support-migration-verifier-original.mjs'
    assert before['verifier_sha256'] == after['verifier_sha256'] == sha(original_verifier) == 'b37e37d96ac2ca4f725ed9f18b2386f0ad775f4187facf2daad6f00fd2293597'
    # The verifier was formatted after the upgrade. The exact source used for
    # both original receipts is retained; verify that current changes are only
    # the installed formatter's output rather than relabelling old evidence.
    script = "import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';const r=createRequire(" + json.dumps((PLATFORM / 'package.json').as_uri()) + ");const p=r('prettier');process.stdout.write(await p.format(await readFile(" + json.dumps(str(original_verifier)) + ",'utf8'),{parser:'babel'}));"
    formatted = subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT)
    assert formatted == (DELIVERY / 'scripts/qa-support-migrations.mjs').read_bytes()
    assert before['status'] == after['status'] == 'passed'
    assert before['phase'] == 'before_062' and after['phase'] == 'after_062_before_API_restart'
    assert {d['database'] for d in after['databases']} == {'copypaste', 'copypaste_test'}
    for db in after['databases']:
        old = next(d for d in before['databases'] if d['database'] == db['database'])
        assert len(db['migrations']) == 62 and len(old['migrations']) == 61 and db['migrations'][:-1] == old['migrations']
        assert len(db['original']) == 122 and db['original'] == old['original']
        assert db['original_facts_unchanged'] and db['applied_checksums_unchanged']
        assert db['new_records'] == {'grants': 0, 'contexts': 0}
        assert len(db['guards']) == 3 and len(db['rls']) == 2
        assert all(v['relrowsecurity'] and v['relforcerowsecurity'] for v in db['rls'])
        assert db['privileges'] == {'app_grants_read': False, 'app_contexts_read': False, 'control_insert': True, 'control_context_update': False, 'app_check': False, 'control_check': True}
        for filename, digest in db['original_migration_bytes'].items():
            assert sha(PLATFORM / 'migrations' / filename) == digest
    report = load(EVIDENCE / 'support-ui.json')
    assert report['status'] == 'passed' and not report['errors'] and len(report['checks']) == 8
    assert report['source_unchanged'] and len(report['source_files']) == 816
    assert report['browser_closed'] and report['owned_credentials_revoked'] and not report['user_tabs_touched']
    assert report['verifier_sha256'] == sha(DELIVERY / 'scripts/qa-support-ui.ts')
    for source, digest in report['source_files'].items():
        file = (DEV / source).resolve()
        assert file.is_relative_to(DEV) and sha(file) == digest, source
    specification = ROOT / 'docs/contracts/openapi.json'
    spec = load(specification)
    fixture = PLATFORM / 'contracts/admin-support-schemas.json'
    assert fixture.read_bytes() == (ROOT / 'docs/contracts' / fixture.name).read_bytes()
    contract = load(fixture)
    assert contract['source_sha256'] == sha(specification) == '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
    assert all(schema == spec['components']['schemas'][name] for name, schema in contract['schemas'].items())
    schema = {'components': {'schemas': contract['schemas']}}
    assert len(report['samples']) == 4
    for sample in report['samples']:
        errors = list(Draft202012Validator({**schema, '$ref': '#/components/schemas/' + sample['schema']}, format_checker=FormatChecker()).iter_errors(sample['response']))
        assert not errors, [e.message for e in errors]
    copies = load(ROOT / 'docs/quality/support-screenshot-provenance.json')
    assert copies['report_sha256'] == sha(EVIDENCE / 'support-ui.json')
    assert len(report['screenshots']) == len(copies['files']) == 9
    for image in copies['files']:
        assert sha(ROOT / image['source']) == sha(ROOT / image['documentation']) == image['sha256'] and image['unedited']
    for image in copies['readme_copies']:
        assert sha(ROOT / image['source']) == sha(ROOT / image['target']) == image['sha256']
    for name in ['support-ui.json', 'support-migrations-before.json', 'support-migrations.json']:
        assert (EVIDENCE / name).read_bytes() == (ROOT / 'docs/quality' / name).read_bytes()
    archive = load(EVIDENCE / 'stage50-before-support/archive-map.json')
    old_receipt = next(v for v in archive['files'] if v['source'] == 'dev/copypaste-delivery/evidence/native-surfaces-artifacts.json')
    for artifact in load(ROOT / old_receipt['archived'])['artifacts']:
        old_path = artifact['path'].replace('/release/frameless/', '/release/frameless-stage50/').replace('/release/sidepanel/', '/release/sidepanel-stage50/')
        assert sha(DEV / old_path) == artifact['sha256']
    return {'scope': 'Bounded controlled read-only support only; all original REQ/TC, NFR and production gates remain tracked', 'archives': archives, 'candidate_tests': 33, 'support_tests': 14, 'native_upgrade_databases': 2, 'unchanged_original_tables_per_database': 122, 'actual_ui_checks': 8, 'strict_response_checks': 4, 'strict_normative_endpoint_responses': 3, 'extracted_session_dto_checks': 1, 'unedited_screenshots': 9, 'source_files': 816, 'migration_verifier_exact_snapshot_sha256': sha(original_verifier), 'current_formatted_verifier_sha256': sha(DELIVERY / 'scripts/qa-support-migrations.mjs'), 'complete_TC_095_acceptance': 'not_claimed'}


if __name__ == '__main__':
    result = history()
    (ROOT / 'docs/quality/support-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({k: v for k, v in result.items() if k not in {'scope', 'archives'}}))
