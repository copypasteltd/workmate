"""Bind committed components and the new Extension proof; retain earlier scopes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
MAP = {'platform': 'backend', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def digest(file):
    return sha256(file.read_bytes()).hexdigest()

def git(repo, *args, check=True):
    return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), *args], capture_output=True, check=check)

def main():
    output = ROOT / 'docs/quality/workmate-publication.json'
    previous = digest(output)
    old = read(output)
    checkpoint = read(ROOT / 'docs/quality/extension-chat-checkpoint.json')
    attempt = checkpoint['selected_attempt']
    assert checkpoint['extension_tests'] == {'tests': 32, 'pass': 32, 'fail': 0, 'skipped': 0}
    current = read(DELIVERY / f'evidence/extension-chat-{attempt}.json')
    assert current['status'] == 'passed' and current['source_unchanged'] and current['compiled_unchanged']
    assert current['owned_database_shutdown'] and current['counts'] == {'checks': 7, 'errors': 0}
    assert current['fixture_cleanup']['status'] == 'passed'
    for file, expected in current['source_files'].items():
        assert digest(DEV / file) == expected, file
    for key in ('raw_report', 'verifier', 'journey_verifier', 'journey', 'fixture_cleanup'):
        proof = current[key]
        assert digest(DELIVERY / proof['path']) == proof['sha256']
    bindings = {'extension_native_cloud_conversation': len(current['source_files'])}
    for name, folder in [('canonical-task-regression-01.json', 'copypaste-platform'), ('local-codex-native-09.json', 'copypaste-desktop')]:
        retained = read(DELIVERY / 'evidence' / name)
        assert retained['status'] == 'passed' and retained['source_unchanged']
        for file, expected in retained['source_files'].items():
            assert digest(DEV / folder / file) == expected, file
        bindings[name] = len(retained['source_files'])
    assert read(DELIVERY / 'evidence/canonical-task-regression-01.json')['counts']['tests'] == 802
    components, exceptions, checked = [], list(old['preserved_raw_whitespace_exceptions']), 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert git(repo, 'status', '--porcelain').stdout == b'', component
        assert git(repo, 'branch', '--show-current').stdout.decode().strip() in (branch, 'codex/' + branch)
        head = git(repo, 'rev-parse', 'HEAD').stdout.decode().strip()
        for file in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').stdout.split(b'\0'):
            if not file:
                continue
            name = file.decode()
            assert git(repo, 'show', 'HEAD:' + name).stdout == (repo / name).read_bytes(), name
            checked += 1
        whitespace = git(repo, 'show', '--format=', '--check', 'HEAD', check=False)
        excluded = set()
        if whitespace.returncode:
            assert component == 'delivery'
            for line in whitespace.stdout.decode().splitlines():
                match = re.fullmatch(r'(evidence/extension-chat-(\d{2})\.log):(\d+): (trailing whitespace\.|new blank line at EOF\.)', line)
                if match:
                    file, number, row, message = match.groups()
                    raw = read(repo / f'evidence/extension-chat-{number}.json')['raw_report']
                    assert raw['path'] == file and digest(repo / file) == raw['sha256']
                    exceptions.append({'path': 'dev/copypaste-delivery/' + file, 'line': int(row), 'message': message, 'sha256': raw['sha256']})
                    excluded.add(file)
                else:
                    assert line.startswith('+') and excluded, line
            remaining = git(repo, 'show', '--format=', '--check', 'HEAD', '--', '.', *(':(exclude)' + p for p in sorted(excluded)))
            assert not remaining.stdout and not remaining.stderr
        components.append({'component': component, 'branch': branch, 'local_branch': git(repo, 'branch', '--show-current').stdout.decode().strip(),
            'directory': repo.relative_to(ROOT).as_posix(), 'commit': head, 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').stdout.decode().strip(),
            'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ('README.md', 'README.en.md')],
            'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'previous_plan_sha256': previous,
        'scope': 'Extension native cloud conversations and immutable message attachments verified with synthetic model turns. Unchanged Platform full regression and Desktop independent supervisor retain their source scopes; Desktop local-Agent product integration remains pending.',
        'components': components, 'source_bindings_checked': bindings, 'latest_component_committed_files_equal_disk': checked,
        'recording_scope': 'Four-client workmate-media-10 remains historical. New Extension chat captures are separately bound to extension-chat-checkpoint.json.',
        'extension_chat': {'checkpoint': 'docs/quality/extension-chat-checkpoint.json', 'attempt': attempt, 'tests': 32, 'native_checks': 7},
        'preserved_raw_whitespace_exceptions': exceptions, 'verifier_sha256': digest(Path(__file__))}
    result['client_direction'] = {**old['client_direction'], 'extension_conversation_subset': 'verified_with_synthetic_model_turns', 'complete_Desktop_and_Extension_acceptance': 'pending'}
    names = [f'extension-chat-{attempt}.json', f'extension-chat-{attempt}-journey.json']
    result['proofs'] = old['proofs'] + [{'repository': 'delivery', 'path': 'evidence/' + name, 'sha256': digest(DELIVERY / 'evidence' / name), 'url': 'https://github.com/copypasteltd/workmate/blob/delivery/evidence/' + name} for name in names]
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'source_bindings': bindings, 'committed_files': checked}))

if __name__ == '__main__':
    main()
