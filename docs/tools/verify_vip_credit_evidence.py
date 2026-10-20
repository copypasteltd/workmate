"""Verify exact bounded combination proof, including failed attempts and old rows."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
EVIDENCE = DEV / 'copypaste-delivery/evidence'


def load(file):
    return json.loads(file.read_bytes())


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def history():
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=EVIDENCE.parent, text=True).split('\0'))
    archives = []
    for name, count in [('stage48-before-vip-credit-combination', 535),
                        ('vip-credit-ui-missing-tenant-context', 9),
                        ('vip-credit-ui-wrong-user-page', 9),
                        ('vip-credit-before-route-inventory', 579),
                        ('vip-credit-fixture-namespace-before', 2),
                        ('vip-credit-clone-first', 5),
                        ('vip-credit-clone-path', 3),
                        ('vip-credit-native-binding', 1)]:
        manifest = EVIDENCE / name / 'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count
        for entry in entries:
            file = (ROOT / entry['archived']).resolve()
            assert file.is_relative_to(EVIDENCE.resolve()) and sha(file) == entry['sha256']
            assert file.relative_to(EVIDENCE.parent).as_posix() in tracked
        archives.append({'manifest': manifest.relative_to(ROOT).as_posix(), 'sha256': sha(manifest), 'files': count})
    failed_checkout = load(EVIDENCE / 'vip-credit-clone-first/byte-integrity.json')
    assert failed_checkout['owned_temporary_clones_removed'] is True
    assert failed_checkout['checks'][-1]['status'] == 'failed'
    assert 'admin-payment-evidence-record.png' in failed_checkout['checks'][-1]['detail']
    long_path = load(EVIDENCE / 'vip-credit-clone-path/byte-integrity.json')
    assert long_path['owned_temporary_clones_removed'] is True
    assert long_path['checks'][-1]['status'] == 'failed'
    assert 'Filename too long' in long_path['checks'][-1]['detail']
    # Phase 49 kept the phase 48 installer bytes. Phase 50 now rebuilds actual
    # clients, so bind that historical claim to its exact archived receipt.
    phase49 = load(EVIDENCE / 'stage49-before-finance/archive-map.json')
    def phase49_file(source):
        item = next(e for e in phase49['files'] if e['source'] == source)
        file = ROOT / item['archived']
        assert sha(file) == item['sha256']
        return file
    native = load(phase49_file('dev/copypaste-delivery/evidence/native-surfaces-artifacts.json'))
    prior_native = load(EVIDENCE / 'vip-credit-native-binding/artifacts-before.json')
    assert native['artifacts'] == prior_native['artifacts']
    assert native['desktop_archive'] == prior_native['desktop_archive']
    assert native['repositories'] == prior_native['repositories'] and native['at'] == prior_native['at']
    assert native['native_artifacts_rebuilt'] is False
    assert native['validation_refresh_verifier_sha256'] == sha(DEV / 'copypaste-delivery/scripts/refresh-native-surface-validation.mjs')
    assert sha(phase49_file('dev/copypaste-delivery/' + native['validation']['path'])) == native['validation']['sha256']
    assert len(native['validation_history']) == 1
    assert native['validation_history'][0]['sha256'] == prior_native['validation']['sha256']
    assert sha(DEV / 'copypaste-delivery' / native['validation_history'][0]['path']) == prior_native['validation']['sha256']
    initial = EVIDENCE / 'vip-credit-platform-targeted-initial.log'
    raw = initial.read_text(encoding='utf-8')
    assert re.search(r'^# pass 12\s*$', raw, re.M) and re.search(r'^# fail 2\s*$', raw, re.M)
    candidate = EVIDENCE / 'vip-credit-platform-candidate-03.log'
    raw = candidate.read_text(encoding='utf-8')
    assert re.search(r'^# pass 36\s*$', raw, re.M) and re.search(r'^# fail 0\s*$', raw, re.M)
    assert (EVIDENCE / 'vip-credit-candidate-03-migration-060.sql').read_bytes() == (DEV / 'copypaste-platform/migrations/060-atomic-vip-credit-combinations.sql').read_bytes()

    before_path, after_path = EVIDENCE / 'vip-credit-migrations-before.json', EVIDENCE / 'vip-credit-migrations.json'
    before, after = load(before_path), load(after_path)
    verifier = DEV / 'copypaste-delivery/scripts/qa-vip-credit-migrations.mjs'
    assert before['phase'] == 'before_060' and after['phase'] == 'after_060_before_API_restart'
    assert before['status'] == after['status'] == 'passed'
    assert before['verifier_sha256'] == after['verifier_sha256'] == sha(verifier)
    assert {d['database'] for d in before['databases']} == {d['database'] for d in after['databases']} == {'copypaste', 'copypaste_test'}
    for path in [before_path, after_path]:
        assert sha(path) == sha(ROOT / 'docs/quality' / path.name)
    for d in after['databases']:
        old = next(o for o in before['databases'] if o['database'] == d['database'])
        assert len(d['migrations']) == 60 and len(old['migrations']) == 59
        assert d['migrations'][:-1] == old['migrations']
        assert len(d['original']) == 119 and d['original'] == old['original']
        assert d['original_facts_unchanged'] and d['applied_checksums_unchanged']
        assert d['complete_pre_upgrade_row_snapshot'] and d['read_only']
        assert len(d['guards']) == 5
        assert d['privileges'] == {'app_read': False, 'control_insert': True, 'app_check': False, 'control_check': True}
        assert len(d['original_migration_bytes']) == 59
        for name, digest in d['original_migration_bytes'].items():
            current = DEV / 'copypaste-platform/migrations' / name
            assert sha(current) == digest
            original = subprocess.check_output(['git', 'show', d['original_migration_source_commit'] + ':migrations/' + name], cwd=DEV / 'copypaste-platform')
            assert hashlib.sha256(original).hexdigest() == digest
        for migration in d['migrations']:
            if migration['version'] <= 15:
                assert migration['source_sha256'] is None
            else:
                assert sha(next((DEV / 'copypaste-platform/migrations').glob(f"{migration['version']:03d}-*.sql"))) == migration['source_sha256']

    spec_path = ROOT / 'docs/contracts/openapi.json'
    spec = load(spec_path)
    fixture_path = DEV / 'copypaste-platform/contracts/admin-vip-credit-schemas.json'
    fixture = load(fixture_path)
    assert fixture_path.read_bytes() == (ROOT / 'docs/contracts/admin-vip-credit-schemas.json').read_bytes()
    assert fixture['normative_source_sha256'] == sha(spec_path)
    assert set(fixture['schemas']) == {'VipCreditCommand', 'AdminVipGrantCreate', 'AdminFeeGift', 'AdminPositiveMoney', 'Money', 'AdminPreview', 'AdminOperation'}
    for name, definition in fixture['schemas'].items():
        if name != 'VipCreditCommand':
            assert definition == spec['components']['schemas'][name]
    captured = load(EVIDENCE / 'admin-vip-credit-contract-samples.json')
    assert len(captured['samples']) == 4
    requests = []
    for item in captured['samples']:
        definitions = {**spec['components']['schemas'], **fixture['schemas']}
        schema = {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$ref': '#/components/schemas/' + item['schema'], 'components': {'schemas': definitions}}
        value = item.get('request', item.get('response'))
        errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value))
        assert not errors, [e.message for e in errors]
        if 'request' in item:
            assert item['schema'] == 'VipCreditCommand'
            requests.append(item)
    assert len(requests) == 1

    ui = load(EVIDENCE / 'admin-vip-credit.json')
    assert ui['status'] == 'passed' and ui['errors'] == [] and len(ui['checks']) == 9
    assert all(c['status'] == 'passed' for c in ui['checks'])
    assert ui['source_unchanged'] and len(ui['source_files']) == 814
    assert ui['browser_closed'] and not ui['user_browser_tabs_touched']
    assert ui['owned_sessions_closed'] and ui['owned_admin_principals_disabled']
    assert ui['model_calls'] == ui['external_payments'] == 0
    for source, digest in ui['source_files'].items():
        actual = (DEV / source).resolve()
        assert actual.is_relative_to(DEV.resolve()) and sha(actual) == digest
    captures = load(EVIDENCE / 'admin-vip-credit-screenshots.json')
    copies = load(ROOT / 'docs/quality/vip-credit-screenshot-provenance.json')
    assert len(captures['screenshots']) == len(copies['files']) == 12
    assert captures['source_files'] == ui['source_files'] and captures['browser_closed']
    assert copies['report_sha256'] == sha(EVIDENCE / 'admin-vip-credit.json')
    assert copies['capture_report_sha256'] == sha(EVIDENCE / 'admin-vip-credit-screenshots.json')
    for capture in captures['screenshots']:
        assert sha(ROOT / capture['file']) == capture['sha256']
        copy = next(c for c in copies['files'] if c['source'] == capture['file'])
        assert sha(ROOT / copy['documentation']) == capture['sha256'] == copy['sha256']
    readme_copies = load(ROOT / 'docs/quality/vip-credit-readme-screenshots.json')['files']
    assert len(readme_copies) == 4
    for item in readme_copies:
        assert sha(ROOT / item['source']) == sha(ROOT / item['target']) == item['sha256']
    readme_images = 0
    for repository in ['platform', 'web', 'admin', 'extension', 'desktop', 'delivery']:
        checkout = DEV / ('copypaste-' + repository)
        for name in ['README.md', 'README.en.md']:
            guide = checkout / name
            for link in re.findall(r'!\[[^\]]*\]\(([^)]+)\)', guide.read_text(encoding='utf-8')):
                if link.startswith(('https://', 'http://', 'data:')):
                    continue
                target = (guide.parent / link).resolve()
                assert target.is_relative_to(checkout.resolve()) and target.is_file(), (guide, link)
                readme_images += 1
    return {'archives': archives, 'initial_failed_test_log': {'path': initial.relative_to(ROOT).as_posix(), 'sha256': sha(initial)},
            'candidate': {'path': candidate.relative_to(ROOT).as_posix(), 'sha256': sha(candidate), 'tests': 36},
            'migration': {'before': before_path.relative_to(ROOT).as_posix(), 'before_sha256': sha(before_path),
                          'after': after_path.relative_to(ROOT).as_posix(), 'after_sha256': sha(after_path),
                          'databases': 2, 'unchanged_original_tables_per_database': 119},
            'original_schema_responses': 3, 'supplemental_command_requests': 1,
            'ui_checks': 9, 'unedited_screenshots': 12,
            'independent_readme_guides': 12, 'repository_local_image_references': readme_images,
            'scope': 'Bounded same-transaction explicit VIP plus gift proof only; no original REQ/TC or production gate is fully accepted by this increment'}


if __name__ == '__main__':
    result = history()
    (ROOT / 'docs/quality/vip-credit-verification.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'archives': len(result['archives']), 'ui_checks': result['ui_checks'],
                      'original_schema_responses': result['original_schema_responses'],
                      'supplemental_command_requests': result['supplemental_command_requests']}))
