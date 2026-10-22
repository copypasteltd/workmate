"""Bind native supervisor evidence without accepting the complete Desktop UI."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / 'dev/copypaste-desktop'
DELIVERY = ROOT / 'dev/copypaste-delivery'
QUALITY = ROOT / 'docs/quality'

def digest(data):
    return sha256(data).hexdigest()

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def retain(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    if file.exists():
        assert file.read_bytes() == data, 'Refuse to overwrite retained evidence: ' + str(file)
    else:
        with file.open('xb') as stream:
            stream.write(data)

def write(file, value):
    retain(file, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.attempt)
    histories = []
    for number in range(1, int(args.attempt) + 1):
        stem = 'evidence/local-codex-native-' + f'{number:02}'
        file = DELIVERY / (stem + '.json')
        record = read(file)
        raw = (DELIVERY / record['raw_report']).read_bytes()
        assert digest(raw) == record['raw_sha256']
        assert digest((DELIVERY / (stem + '-verifier.mjs')).read_bytes()) == record['verifier_sha256']
        counts = {k: int(re.search(r'^# ' + k + r' (\d+)\r?$', raw.decode(), re.M)[1])
                  for k in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
        assert counts == record['counts'] and record['source_unchanged']
        for name, expected in record['source_files'].items():
            assert digest((DELIVERY / (stem + '-sources') / name).read_bytes()) == expected
        histories.append({'attempt': f'{number:02}', 'status': record['status'], 'counts': counts,
            'report': 'dev/copypaste-delivery/' + stem + '.json', 'sha256': digest(file.read_bytes()),
            'url': 'https://github.com/copypasteltd/workmate/blob/delivery/' + stem + '.json'})
    current_file = DELIVERY / ('evidence/local-codex-native-' + args.attempt + '.json')
    current = read(current_file)
    assert current['status'] == 'passed' and current['scope'] == 'native_supervisor_integration_only'
    assert current['counts'] == {'tests': 9, 'pass': 9, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    for file, expected in current['source_files'].items():
        assert digest((DESKTOP / file).read_bytes()) == expected, 'Current Desktop source changed: ' + file
    lock = read(DESKTOP / 'contracts/local-codex-runtime.json')
    assert current['runtime_version'] == lock['runtime_version']
    assert current['native_binary_sha256'] == lock['windows_x64_sha256']
    assert lock['schema_sources']['generator_version'] == lock['runtime_version']
    for name, expected in lock['schema_sources']['sha256'].items():
        assert digest((DESKTOP / 'contracts/codex' / name).read_bytes()) == expected
    for suffix in ('.json', '.tap'):
        name = 'local-codex-native-' + args.attempt + suffix
        retain(QUALITY / name, (DELIVERY / 'evidence' / name).read_bytes())

    # Keep the direction audit's actual source scope, including its old package
    # bytes. It remains a historical review rather than a rewritten fresh pass.
    audit = read(QUALITY / 'client-direction-audit.json')
    for name, entry in audit['source_hashes'].items():
        file = ROOT / name
        data = file.read_bytes()
        if digest(data) != entry['sha256']:
            relative = file.relative_to(ROOT / 'dev').parts
            repo = ROOT / 'dev' / relative[0]
            result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
                '-C', str(repo), 'show', 'HEAD:' + '/'.join(relative[1:])], capture_output=True, check=True)
            data = result.stdout
        assert digest(data) == entry['sha256'], 'Historical review bytes unavailable: ' + name
        retain(QUALITY / 'history/client-direction-review-20261022' / name, data)

    checkpoint = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'native_supervisor_verified_product_integration_pending',
        'amendment': 'CLIENT01', 'implementation_document': 'docs/technical/70-desktop-native-codex-supervisor.md',
        'latest_report': 'local-codex-native-' + args.attempt + '.json', 'counts': current['counts'],
        'report_sha256': digest(current_file.read_bytes()), 'source_files_checked': len(current['source_files']),
        'runtime_version': lock['runtime_version'], 'native_binary_sha256': lock['windows_x64_sha256'],
        'gateway': 'synthetic_authorized_company_Responses_fixture_real_native_Codex_and_filesystem',
        'permission_proof': ['full_access_actual_outside_workspace_existing_file_write', 'read_only_downgrade_actual_write_denied',
            'obsolete_grant_rejected_after_restart', 'revoked_session_stopped'],
        'history': histories, 'historical_direction_review_preserved': 'history/client-direction-review-20261022',
        'not_validated': current['not_validated'] + ['complete_workspace_write_approval_behavior',
            'browser_and_third_party_app_operation', 'OS_job_object_detached_process_cleanup', 'uncertain_checkpoint_reconciliation',
            'Extension_conversation_attachment_redesign', 'live_18_role_qualification'],
        'baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial_verified': 81, 'completion_not_proven': 21,
            'fully_accepted': 0, 'CLIENT01_Desktop_conditions': 8, 'CLIENT01_Extension_conditions': 6},
        'verifier_sha256': digest(Path(__file__).read_bytes())}
    write(QUALITY / 'local-codex-supervisor-checkpoint.json', checkpoint)
    progress_file = QUALITY / 'requirements-alignment-progress.json'
    progress = read(progress_file)
    original = [(r['requirement_id'], r['requirement'], r['acceptance_case'], r['acceptance_conditions'], r['assessment']) for r in progress['requirements']]
    assert len(original) == 102 and progress['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    assert 'desktop_native_supervisor' not in progress
    progress['desktop_native_supervisor'] = {'checkpoint': 'local-codex-supervisor-checkpoint.json',
        'sha256': digest((QUALITY / 'local-codex-supervisor-checkpoint.json').read_bytes()),
        'status': checkpoint['status'], 'original_requirement_acceptance_unchanged': True}
    assert original == [(r['requirement_id'], r['requirement'], r['acceptance_case'], r['acceptance_conditions'], r['assessment']) for r in progress['requirements']]
    progress_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    link = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md'
    count = 0
    for repo in [ROOT / 'docs', *(ROOT / 'dev' / ('copypaste-' + n) for n in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery'))]:
        for name in ('README.md', 'README.en.md'):
            file = repo / name
            text = file.read_text(encoding='utf-8')
            old = ('Desktop still uses cloud Codex with a restricted local file bridge; local Codex/full access is pending.' if '.en.' in name
                   else 'Desktop 仍是云端 Codex 与受限文件桥接，本机 Codex/完整权限待实现；')
            new = ('The Desktop product entry point still uses cloud Codex and a restricted file bridge. An independent native Codex supervisor passes nine real-native integration tests; Electron consent and billing integration remain pending.' if '.en.' in name
                   else 'Desktop 产品入口仍是云端 Codex 与受限文件桥接；独立本机 Codex supervisor 已通过 9 项原生集成测试，本机授权界面和费用接入待实现；')
            assert old in text
            text = text.replace(old, new, 1)
            assert '<!-- /client01-direction -->' in text
            note = ('Native supervisor scope, actual permission checks and remaining integration: [implementation details](' + link + ').' if '.en.' in name
                    else '本机 supervisor 的实现、实际权限测试与剩余产品接入见 [技术说明](' + link + ')。')
            text = text.replace('<!-- /client01-direction -->', note + '\n\n<!-- /client01-direction -->', 1)
            file.write_text(text, encoding='utf-8', newline='\n')
            count += 1
    print(json.dumps({'status': checkpoint['status'], 'native_tests': 9, 'retained_attempts': len(histories),
        'source_files': checkpoint['source_files_checked'], 'readmes': count}))

if __name__ == '__main__':
    main()
