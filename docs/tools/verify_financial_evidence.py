"""Check actual financial sources, failed attempts, upgrade and client proofs."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
EVIDENCE = DEV / 'copypaste-delivery/evidence'


def load(path):
    return json.loads(path.read_bytes())


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def history():
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=EVIDENCE.parent, text=True).split('\0'))
    archives = []
    for name, count in [('stage49-before-finance',603),('financial-ui-initial',7),
                        ('financial-ui-before-contrast',12),('financial-ui-missing-browser',4)]:
        manifest = EVIDENCE / name / 'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count
        for item in entries:
            path = (ROOT / item['archived']).resolve()
            assert path.is_relative_to(EVIDENCE.resolve()) and sha(path) == item['sha256']
            assert path.relative_to(EVIDENCE.parent).as_posix() in tracked
        archives.append({'path':manifest.relative_to(ROOT).as_posix(),'sha256':sha(manifest),'files':count})
    sql = DEV / 'copypaste-platform/migrations/061-durable-financial-notifications.sql'
    for attempt, passed, failed in [('01',35,3),('02',37,1),('03',38,0),('04',38,0)]:
        result = load(EVIDENCE / f'financial-candidate-{attempt}.json')
        raw = EVIDENCE / result['raw_report'].removeprefix('evidence/')
        text = raw.read_text(encoding='utf-8')
        assert sha(raw) == result['raw_sha256'] and result['owned_database_shutdown']
        assert re.search(fr'^# pass {passed}\s*$',text,re.M) and re.search(fr'^# fail {failed}\s*$',text,re.M)
        assert (EVIDENCE / f'financial-candidate-{attempt}-061.sql').read_bytes() == sql.read_bytes()
        if attempt == '04':
            assert result['status'] == 'passed' and result['exit_code'] == 0
            for source,digest in result['source_files'].items():
                historical = subprocess.check_output(['git','show','6bb2d3b1805dbe83d5b0e3dde1d4af5fc51cdd13:'+source],cwd=DEV/'copypaste-platform')
                assert hashlib.sha256(historical).hexdigest() == digest
    before = load(EVIDENCE / 'financial-migrations-before.json')
    after = load(EVIDENCE / 'financial-migrations.json')
    assert before['phase'] == 'before_061' and after['phase'] == 'after_061_before_API_restart'
    verifier = DEV / 'copypaste-delivery/scripts/qa-financial-migrations.mjs'
    assert before['verifier_sha256'] == after['verifier_sha256'] == sha(verifier)
    assert before['status'] == after['status'] == 'passed'
    assert {d['database'] for d in after['databases']} == {'copypaste','copypaste_test'}
    for path in [EVIDENCE/'financial-migrations-before.json',EVIDENCE/'financial-migrations.json']:
        assert path.read_bytes() == (ROOT / 'docs/quality' / path.name).read_bytes()
    for database in after['databases']:
        original = next(d for d in before['databases'] if d['database'] == database['database'])
        assert len(original['migrations']) == 60 and len(database['migrations']) == 61
        assert database['migrations'][:-1] == original['migrations']
        assert len(database['original']) == 120 and database['original'] == original['original']
        assert database['original_facts_unchanged'] and database['applied_checksums_unchanged']
        assert database['read_only'] and database['complete_pre_upgrade_row_snapshot']
        assert database['new_records'] == {'outbox':0,'notifications':0}
        assert len(database['guards']) == 7
        assert database['privileges'] == {'app_outbox_read':False,'app_notifications_read':False,'control_insert':True,'app_check':False,'control_check':True}
        assert len(database['rls']) == 2 and all(r['relrowsecurity'] and r['relforcerowsecurity'] for r in database['rls'])
        assert len(database['original_migration_bytes']) == 60
        for filename,digest in database['original_migration_bytes'].items():
            assert sha(DEV / 'copypaste-platform/migrations' / filename) == digest
            original_bytes = subprocess.check_output(['git','show',database['original_migration_source_commit']+':migrations/'+filename],cwd=DEV/'copypaste-platform')
            assert hashlib.sha256(original_bytes).hexdigest() == digest
        for migration in database['migrations']:
            if migration['version'] <= 15:
                assert migration['source_sha256'] is None
            else:
                assert sha(next((DEV/'copypaste-platform/migrations').glob(f"{migration['version']:03d}-*.sql"))) == migration['source_sha256']
    report = load(EVIDENCE / 'financial-ui.json')
    assert report['status'] == 'passed' and report['errors'] == [] and len(report['checks']) == 8
    assert report['source_unchanged'] and len(report['source_files']) == 817
    assert report['browser_closed'] and report['desktop_closed'] and report['extension_closed']
    assert report['owned_sessions_closed'] and report['owned_admin_principals_disabled'] and report['owned_native_credentials_cleared']
    assert report['artifacts_unchanged_after_run'] and not report['user_browser_tabs_touched']
    assert report['model_calls'] == report['external_payments'] == 0
    assert report['inspection']['financial_hint_contrast']['ratio'] >= 4.5
    for source,digest in report['source_files'].items():
        path = (DEV / source).resolve()
        assert path.is_relative_to(DEV.resolve()) and sha(path) == digest
    specification = ROOT / 'docs/contracts/openapi.json'
    spec = load(specification)
    fixture = DEV / 'copypaste-platform/contracts/financial-notification-schemas.json'
    assert fixture.read_bytes() == (ROOT / 'docs/contracts' / fixture.name).read_bytes()
    definitions = load(fixture)
    assert definitions['normative_source_sha256'] == sha(specification)
    assert definitions['schemas']['Money'] == spec['components']['schemas']['Money']
    captures = load(EVIDENCE / 'financial-ui-screenshots.json')
    copies = load(ROOT / 'docs/quality/financial-screenshot-provenance.json')
    assert captures['source_files'] == report['source_files']
    assert len(captures['screenshots']) == len(copies['files']) == 8
    assert copies['report_sha256'] == sha(EVIDENCE/'financial-ui.json')
    assert copies['capture_report_sha256'] == sha(EVIDENCE/'financial-ui-screenshots.json')
    for item in captures['screenshots']:
        assert sha(ROOT / item['file']) == item['sha256']
        copy = next(c for c in copies['files'] if c['source'] == item['file'])
        assert sha(ROOT / copy['documentation']) == item['sha256']
    samples = load(EVIDENCE / 'financial-ui-contract-samples.json')['samples']
    assert len(samples) == 4
    schema = {'$schema':'https://json-schema.org/draft/2020-12/schema',
              'components':{'schemas':{**spec['components']['schemas'],**definitions['schemas']}}}
    unknown = []
    for sample in samples:
        assert sample['schema'] == 'FinancialNotificationList' and sample['status'] == 200
        errors = list(Draft202012Validator({**schema,'$ref':'#/components/schemas/'+sample['schema']},format_checker=FormatChecker()).iter_errors(sample['response']))
        assert not errors,[e.message for e in errors]
        unknown.extend(n for n in sample['response']['items'] if n['event_type'] == 'refund.unknown')
    assert unknown and all(n['amount'] is None and n['requested_amount']['amount_micros'] == '60000000' for n in unknown)
    for item in load(ROOT/'docs/quality/financial-readme-screenshots.json')['files']:
        assert sha(ROOT/item['source']) == sha(ROOT/item['target']) == item['sha256']
    source_helpers = [DEV / repo / suffix for repo,suffix in [
        ('copypaste-web','src/financial-notice.ts'),('copypaste-extension','src/financial-notice.ts'),
        ('copypaste-desktop','renderer/src/financial-notice.ts')]]
    assert len({sha(p) for p in source_helpers}) == 1
    # Keep the old binaries that qualify the phase 49 historical native claim.
    archive49 = load(EVIDENCE/'stage49-before-finance/archive-map.json')
    old_receipt = next(e for e in archive49['files'] if e['source']=='dev/copypaste-delivery/evidence/native-surfaces-artifacts.json')
    for artifact in load(ROOT/old_receipt['archived'])['artifacts']:
        archived = artifact['path'].replace('/release/frameless/','/release/frameless-stage49/').replace('/release/sidepanel/','/release/sidepanel-stage49/')
        assert sha(DEV/archived) == artifact['sha256']
    return {'scope':'Bounded financial outbox, current recipient privacy and actual three-client workflows; all original REQ/TC and production gates remain separate',
            'archives':archives,'candidate_tests':38,'full_regression_tests':424,
            'native_upgrade_databases':2,'unchanged_original_tables_per_database':120,
            'actual_client_checks':8,'supplemental_financial_responses':4,'unedited_screenshots':8,
            'source_files':817,'unknown_is_null':True,'current_native_contrast_ratio':report['inspection']['financial_hint_contrast']['ratio']}


if __name__ == '__main__':
    result = history()
    (ROOT/'docs/quality/financial-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({k:v for k,v in result.items() if k not in {'archives','scope'}}))
