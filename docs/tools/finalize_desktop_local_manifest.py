"""Bind committed components and the bounded local Desktop product qualification."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
MAP = {'platform': 'backend', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def digest(file):
    return sha256(file.read_bytes()).hexdigest()

def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), *args], stderr=subprocess.PIPE)

def main():
    output = ROOT / 'docs/quality/workmate-publication.json'
    previous = digest(output)
    old = read(output)
    checkpoint = read(ROOT / 'docs/quality/desktop-local-execution-checkpoint.json')
    assert checkpoint['status'] == 'verified_native_desktop_product_subset'
    chosen = checkpoint['selected']
    names = [f'desktop-execution-control-{chosen["control"]}.json', f'local-codex-native-{chosen["native"]}.json', f'desktop-local-ui-{chosen["ui"]}.json', f'desktop-local-ui-{chosen["ui"]}-journey.json']
    bindings = {}
    for index, name in enumerate(names[:3]):
        report = read(DELIVERY / 'evidence' / name)
        assert report['status'] == 'passed' and report['source_unchanged']
        for source, expected in report['source_files'].items():
            relative = ('copypaste-desktop/' + source) if index == 1 else source
            assert digest(DEV / relative) == expected, relative
        bindings[name] = len(report['source_files'])
    for item in checkpoint['screenshots'] + checkpoint['media']['files']:
        assert digest(DEV / item['path']) == item['sha256']
    components, checked, line_endings = [], 0, []
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert git(repo, 'status', '--porcelain') == b'', component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in (branch, 'codex/' + branch)
        head = git(repo, 'rev-parse', 'HEAD').decode().strip()
        for raw in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0'):
            if raw:
                name = raw.decode()
                blob, disk = git(repo, 'show', 'HEAD:' + name), (repo / name).read_bytes()
                if blob != disk:
                    # Keep the qualified working bytes untouched. Git's declared
                    # text normalization is the only permitted difference, and
                    # retain both hashes instead of claiming byte equality.
                    raw = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                    attributes = {raw[i + 1].decode(): raw[i + 2].decode() for i in range(0, len(raw) - 1, 3)}
                    assert attributes['text'] in ('set', 'auto') and attributes['eol'] == 'lf', name
                    assert attributes['filter'] == 'unspecified', name
                    assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                    line_endings.append({'path': (repo / name).relative_to(DEV).as_posix(),
                                         'transformation': 'declared_git_crlf_to_lf_only', 'attributes': attributes,
                                         'qualified_working_sha256': sha256(disk).hexdigest(),
                                         'committed_blob_sha256': sha256(blob).hexdigest(),
                                         'qualified_working_bytes': len(disk), 'committed_blob_bytes': len(blob),
                                         'crlf_pairs': disk.count(b'\r\n')})
                checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local, 'directory': repo.relative_to(ROOT).as_posix(),
                           'commit': head, 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                           'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ('README.md', 'README.en.md')],
                           'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'previous_plan_sha256': previous,
              'scope': 'Desktop local product execution, native consent contract, owned native processes/files, same-thread follow-up, server admission/ledger and cloud compatibility; model responses and native dialog decisions explicitly synthetic. Complete role/client/product acceptance remains pending.',
              'components': components, 'source_bindings_checked': bindings,
              'latest_component_committed_files_checked': checked,
              'latest_component_committed_files_equal_disk': checked - len(line_endings),
              'declared_git_line_ending_normalizations': line_endings,
              'recording_scope': 'New packaged Desktop local-agent captures bind desktop-local-execution-checkpoint.json. Old four-client workmate-media-10 and Extension chat captures retain their historical source/backend scopes.',
              'desktop_local_execution': {'checkpoint': 'docs/quality/desktop-local-execution-checkpoint.json', 'selected': chosen,
                                          'control_tests': checkpoint['control_tests']['tests'], 'unit_tests': 37, 'native_tests': 10, 'native_ui_checks': 7},
              'client_direction': {**old['client_direction'], 'previous_native_supervisor': old['client_direction']['native_supervisor'],
                                   'native_supervisor': 'docs/quality/desktop-local-execution-checkpoint.json', 'native_counts': checkpoint['native_tests'],
                                   'desktop_local_product_subset': 'verified_with_synthetic_model_and_native_dialog_decisions', 'complete_Desktop_and_Extension_acceptance': 'pending'},
              'proofs': old['proofs'] + [{'repository': 'delivery', 'path': 'evidence/' + name, 'sha256': digest(DELIVERY / 'evidence' / name),
                                         'url': 'https://github.com/copypasteltd/workmate/blob/delivery/evidence/' + name} for name in names],
              'verifier_sha256': digest(Path(__file__))}
    result['extension_chat'] = {**old['extension_chat'], 'scope_note': 'Extension source unchanged; its earlier backend integration receipt retains the original source. New server tests verify Extension can still enqueue cloud work.'}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'source_bindings': bindings,
                      'committed_files': checked, 'declared_git_line_ending_normalizations': len(line_endings)}))

if __name__ == '__main__':
    main()
