"""Bind committed components to scoped business-method qualification before publication."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'


def ref(file):
    return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}


def main():
    output = ROOT / 'docs/quality/workmate-publication.json'
    previous = ROOT / 'docs/quality/history/stage96-previous-publication.json'
    assert not previous.exists()
    checkpoint = ROOT / 'docs/quality/solution-packages-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_solution_packages'
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    audit_file = ROOT / 'docs/quality/solution-packages-docs-audit-01.json'
    audit = read(audit_file)
    assert audit['status'] == 'passed' and audit['bilingual_readmes'] == 14
    assert audit['checkpoint']['sha256'] == digest(checkpoint)
    assert audit['verifier_sha256'] == digest(ROOT / 'docs/tools/audit_solution_packages_docs.py')
    reviews = {}
    for name, verifier in [
        ('desktop-browser-staged-credentials-32.json', 'scan_desktop_browser_staged_credentials.py'),
        ('desktop-browser-whitespace-30.json', 'record_solution_packages_whitespace.py'),
        ('archive-link-audit-18.json', 'audit_archive_links.py'),
        ('solution-packages-media-review-01.json', 'inspect_solution_packages_media.py'),
    ]:
        file = ROOT / 'docs/quality' / name
        value = read(file)
        assert value['status'] == 'passed' and value['verifier_sha256'] == digest(ROOT / 'docs/tools' / verifier)
        reviews[name] = ref(file)
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        names = [item.decode('utf-8') for item in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if item]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                values = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                attrs = {values[i + 1].decode(): values[i + 2].decode() for i in range(0, len(values) - 1, 3)}
                assert attrs['text'] in ['set', 'auto'] and attrs['eol'] == 'lf' and attrs['filter'] == 'unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                normalizations.append({'path': (repo / name).relative_to(DEV).as_posix(), 'transformation': 'declared_git_crlf_to_lf_only',
                    'qualified_working_sha256': sha256(disk).hexdigest(), 'committed_blob_sha256': sha256(blob).hexdigest()})
            checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local,
            'directory': repo.relative_to(ROOT).as_posix(), 'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
            'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ['README.md', 'README.en.md']],
            'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    old = read(output)
    proofs = {(row['repository'], row['path']): row for row in old['proofs']}

    def proof(file, repository, repo):
        name = file.relative_to(repo).as_posix()
        proofs[(repository, name)] = {'repository': repository, 'path': name, 'sha256': digest(file),
            'url': 'https://github.com/copypasteltd/workmate/blob/' + repository + '/' + name}

    for repository, repo in [('delivery', DELIVERY), ('backend', DEV / 'copypaste-platform')]:
        for pattern in ['solution-packages-core-*', 'solution-packages-ui-*', 'solution-packages-native-*']:
            for file in (repo / 'evidence').glob(pattern):
                if file.is_file():
                    proof(file, repository, repo)
    for item in cp['screenshots'] + [v for row in cp['recordings'] for v in row['files']]:
        file = DEV / item['path']
        component = file.relative_to(DEV).parts[0].removeprefix('copypaste-')
        proof(file, MAP[component], DEV / ('copypaste-' + component))
    refresh = read(ROOT / 'docs/quality/solution-packages-documentation-refresh.json')
    for item in refresh['media_copies']:
        file = ROOT / item['target']
        if file.is_relative_to(DEV):
            component = file.relative_to(DEV).parts[0].removeprefix('copypaste-')
            proof(file, MAP[component], DEV / ('copypaste-' + component))
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert progress['summary'] == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'ready_for_remote_verification',
        'previous_plan_sha256': digest(output), 'scope': cp['scope'], 'components': components,
        'source_bindings_checked': {'current_files': len(cp['source_files']), 'qualification_scopes': cp['qualification_scopes']},
        'latest_component_committed_files_checked': checked,
        'latest_component_committed_files_equal_disk': checked - len(normalizations),
        'declared_git_line_ending_normalizations': normalizations, 'unique_committed_blobs_read': len(cache),
        'committed_blob_read_mode': 'Exact disk bytes or explicitly declared CRLF-to-LF transformation only',
        'current_full_platform_regression_rerun': False,
        'full_regression_scope': 'Stage96 reruns nine related integration suites including versioned business solutions, source history, editable design, templates, local execution, private teams and workflows, plus 45 Desktop unit checks and two actual local Codex probes. Historical whole-product/client snapshots retain their original scope.',
        'recording_scope': 'Two actual Web review/retry/acceptance and target-copy/rebinding GIF and MP4 pairs, fully decoded. Eight browser checks across Web and Admin, thirteen screenshots and two native cloud Codex trials. Synthetic model/account data. New packaged Desktop method-library visuals remain unproven.',
        'solution_packages': {'checkpoint': ref(checkpoint), 'documentation_audit': ref(audit_file),
            'reviews': reviews, 'selected': cp['selected'], 'core_tests': cp['core_tests'], 'ui_checks': 8,
            'screenshots': 13, 'recordings': 2, 'fully_decoded_recording_files': 4, 'desktop_unit_tests': cp['desktop_unit_tests'], 'native_tests': cp['native_tests'],
            'new_migrations': cp['new_migrations'], 'original_complete_acceptance': 'not_proven'},
        'team_history': {**old['team_history'], 'evidence_scope': 'Historical stage94 browser evidence; stage96 reruns related private-team integration cases.'},
        'acceptance_baseline': {**old['acceptance_baseline'], 'requirements': 102, 'acceptance_cases': 102,
            'partial': 86, 'unproven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__))}
    with previous.open('xb') as stream:
        stream.write(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'committed_files': checked,
                      'sources': len(cp['source_files']), 'proofs': len(proofs)}))


if __name__ == '__main__':
    main()
