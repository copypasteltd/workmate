"""Revise the publication plan using newly qualified canonical-task sources.

The previous stage's accepted local proof is retained, never relabeled as a run
against changed backend sources. The Git publisher independently verifies remote
ancestry and actual remote commit IDs after this plan has been committed.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
BRANCHES = {'platform': 'backend', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}

def digest(file):
    return sha256(file.read_bytes()).hexdigest()

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def git(repo, *args, check=True):
    return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), *args], capture_output=True, check=check)

def main():
    parser = argparse.ArgumentParser()
    for name in ('regression', 'focused', 'clients', 'native', 'media'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--local-native', required=True)
    args = parser.parse_args()
    for value in vars(args).values():
        assert re.fullmatch(r'\d{2}', value)
    evidence = DELIVERY / 'evidence'
    names = [f'canonical-task-regression-{args.regression}.json', f'canonical-task-integration-{args.focused}.json',
             f'paid-input-clients-{args.clients}.json', f'paid-input-native-{args.native}.json', f'workmate-media-{args.media}.json']
    full, focused, clients, native, media = [read(evidence / name) for name in names]
    local_name = f'local-codex-native-{args.local_native}.json'
    local = read(evidence / local_name)
    assert local['status'] == 'passed' and local['scope'] == 'native_supervisor_integration_only'
    assert local['counts'] == {'tests': 9, 'pass': 9, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert local['source_unchanged'] and digest(DELIVERY / local['raw_report']) == local['raw_sha256']
    for report in (full, focused, clients, native, media):
        assert report['status'] == 'passed'
    for report in (full, focused):
        assert report['counts']['pass'] == report['counts']['tests'] > 0
        assert all(report['counts'][k] == 0 for k in ('fail', 'cancelled', 'skipped', 'todo'))
        assert report['source_unchanged'] and report['owned_database_shutdown'] and report['fixture_cleanup']
        assert digest(DELIVERY / report['raw_report']['path']) == report['raw_report']['sha256']
    assert full['test_files'] == ['tests/*.test.ts']
    old_tap = (evidence / 'paid-input-regression-02.tap').read_text(encoding='utf-8')
    new_tap = (DELIVERY / full['raw_report']['path']).read_text(encoding='utf-8')
    tests = lambda text: re.findall(r'^\s*# Subtest: (.+)$', text, re.M)
    old_names, new_names = tests(old_tap), tests(new_tap)
    assert len(old_names) == 782 and len(new_names) == full['counts']['tests']
    assert not (Counter(old_names) - Counter(new_names)), 'Previously retained regression case is missing'
    assert full['counts']['tests'] >= 802
    assert len(clients['checks']) == 13 and all(c['exit_code'] == 0 for c in clients['checks'])
    assert native['counts'] == {'checks': 32, 'errors': 0}
    assert native['owned_database_shutdown'] and native['owned_web_preview_closed'] and native['owned_admin_preview_closed']
    assert len(media['recordings']) == 4 and len(media['screenshots']) == 11
    checked = {}
    for name, report, resolve in (
        ('full_platform', full, lambda p: DEV / 'copypaste-platform' / p),
        ('focused_platform', focused, lambda p: DEV / 'copypaste-platform' / p),
        ('client_checks', clients, lambda p: DEV / ('copypaste-' + p.split('/', 1)[0]) / p.split('/', 1)[1]),
        ('native_journey', native, lambda p: ROOT / p if p.startswith('docs/') else DEV / p),
        ('local_supervisor', local, lambda p: DEV / 'copypaste-desktop' / p),
    ):
        assert report['source_unchanged']
        for file, expected in report['source_files'].items():
            assert digest(resolve(file)) == expected, 'Recorded source changed: ' + file
        checked[name] = len(report['source_files'])
    components, exceptions, bytes_checked = [], [], 0
    for component, branch in BRANCHES.items():
        repo = DEV / ('copypaste-' + component)
        assert git(repo, 'status', '--porcelain').stdout == b'', 'Commit reviewed component first: ' + component
        commit = git(repo, 'rev-parse', 'HEAD').stdout.decode().strip()
        local_branch = git(repo, 'branch', '--show-current').stdout.decode().strip()
        assert local_branch in {branch, 'codex/' + branch}
        changes = [p.decode() for p in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').stdout.split(b'\0') if p]
        for file in changes:
            assert git(repo, 'show', 'HEAD:' + file).stdout == (repo / file).read_bytes()
            bytes_checked += 1
        whitespace = git(repo, 'show', '--format=', '--check', 'HEAD', check=False)
        assert not whitespace.stderr
        excluded = set()
        if whitespace.returncode:
            assert component == 'delivery'
            for line in whitespace.stdout.decode().splitlines():
                # Only observed original raw diagnostics are exempt, after
                # checking their retained report's exact byte digest. Source
                # files and arbitrary snapshots never receive this exception.
                match = re.fullmatch(r'(evidence/(?:paid-input-native-(?:07|08|09|10)\.log|canonical-task-integration-(?:01|02)\.tap|local-codex-native-07\.tap)):(\d+): (trailing whitespace\.|new blank line at EOF\.)', line)
                if match:
                    file, number, message = match.groups()
                    original_report = read(repo / (file.rsplit('.', 1)[0] + '.json'))
                    original = original_report['raw_report']
                    original_path = original['path'] if isinstance(original, dict) else original
                    original_sha = original['sha256'] if isinstance(original, dict) else original_report['raw_sha256']
                    assert original_path == file and original_sha == digest(repo / file)
                    exceptions.append({'path': 'dev/copypaste-delivery/' + file, 'line': int(number), 'message': message, 'sha256': original_sha})
                    excluded.add(file)
                else:
                    assert line.startswith('+') and excluded, 'Unexpected source whitespace diagnostic'
            assert excluded
            clean = git(repo, 'show', '--format=', '--check', 'HEAD', '--', '.', *(':(exclude)' + f for f in sorted(excluded)))
            assert not clean.stdout and not clean.stderr
        else:
            assert not whitespace.stdout
        components.append({'component': component, 'branch': branch, 'local_branch': local_branch,
            'directory': repo.relative_to(ROOT).as_posix(), 'commit': commit,
            'tree': git(repo, 'rev-parse', 'HEAD^{tree}').stdout.decode().strip(),
            'readmes': [{'path': n, 'sha256': digest(repo / n)} for n in ('README.md', 'README.en.md')],
            'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    syntax = subprocess.run(['node', '--check', 'scripts/publish-workmate.mjs'], cwd=DELIVERY, capture_output=True, check=True)
    assert not syntax.stdout and not syntax.stderr
    output = ROOT / 'docs/quality/workmate-publication.json'
    previous = digest(output)
    proofs = [{'repository': 'delivery', 'path': 'evidence/' + n, 'sha256': digest(evidence / n),
               'url': 'https://github.com/copypasteltd/workmate/blob/delivery/evidence/' + n}
              for n in names + [f'paid-input-native-{args.native}-journey.json', local_name]]
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'ready_for_remote_verification',
        'previous_plan_sha256': previous, 'scope': 'Canonical-task repair, CLIENT01 direction correction and an independent native Desktop supervisor. Full/focused backend and actual cloud/file-bridge client/media compatibility checks remain distinct from native supervisor tests. Electron local-Agent consent/billing and Extension conversation redesign remain pending. Successful publisher receipt and remote SHA checks establish publication.',
        'remote': 'git@github.com:copypasteltd/workmate.git', 'documentation_branches': ['docs', 'main'],
        'documentation_commit_rule': 'Both documentation branches publish this final docs checkout.',
        'components': components, 'media_attempt': args.media, 'client_attempt': args.clients,
        'source_bindings_checked': checked, 'latest_component_committed_files_equal_disk': bytes_checked,
        'preserved_regression_cases': len(old_names), 'full_regression_cases': full['counts']['tests'],
        'recording_scope': media['scope'], 'proofs': proofs, 'preserved_raw_whitespace_exceptions': exceptions,
        'client_direction': {'amendment': 'CLIENT01', 'document': 'docs/requirements/03-client-execution-amendment.md',
            'native_supervisor': 'docs/quality/local-codex-supervisor-checkpoint.json',
            'native_counts': local['counts'], 'complete_Desktop_and_Extension_acceptance': 'pending'},
        'source_and_markdown_whitespace_issues': 0,
        'acceptance_baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial': 81, 'unproven': 21,
            'fully_accepted': 0, 'all_NFR_and_G01_G10_preserved': True},
        'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'source_bindings': checked,
        'preserved_tests': len(old_names), 'full_tests': full['counts']['tests'], 'raw_whitespace_exceptions': len(exceptions)}))

if __name__ == '__main__':
    main()
