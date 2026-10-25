"""Bind final component commits to the scoped stage91 private cloud workflow qualification."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV, DELIVERY = ROOT / 'dev', ROOT / 'dev/copypaste-delivery'
def ref(file): return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}


def main():
    output = ROOT / 'docs/quality/workmate-publication.json'
    previous = ROOT / 'docs/quality/history/stage91-previous-publication.json'
    assert not previous.exists()
    checkpoint_file = ROOT / 'docs/quality/cloud-workflows-checkpoint.json'; cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_private_cloud_workflows'
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    audit_file = ROOT / 'docs/quality/cloud-workflows-docs-audit-01.json'; audit = read(audit_file)
    assert audit['status'] == 'passed' and audit['bilingual_readmes'] == 14
    assert audit['checkpoint']['sha256'] == digest(checkpoint_file)
    assert audit['verifier_sha256'] == digest(ROOT / 'docs/tools/audit_cloud_workflow_docs.py')
    reports = {}
    for name, verifier in [('desktop-browser-staged-credentials-23.json', 'scan_desktop_browser_staged_credentials.py'),
                           ('desktop-browser-whitespace-22.json', 'record_desktop_browser_whitespace.py'),
                           ('archive-link-audit-12.json', 'audit_archive_links.py'), ('cloud-workflows-media-review-01.json', 'inspect_cloud_workflow_media.py')]:
        file = ROOT / 'docs/quality' / name; value = read(file)
        assert value['status'] == 'passed' and value['verifier_sha256'] == digest(ROOT / 'docs/tools' / verifier)
        reports[name] = ref(file)
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        names = [name.decode('utf-8') for name in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if name]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                attrs_raw = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                attrs = {attrs_raw[i + 1].decode(): attrs_raw[i + 2].decode() for i in range(0, len(attrs_raw) - 1, 3)}
                assert attrs['text'] in ['set', 'auto'] and attrs['eol'] == 'lf' and attrs['filter'] == 'unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                normalizations.append({'path': (repo / name).relative_to(DEV).as_posix(), 'transformation': 'declared_git_crlf_to_lf_only',
                    'qualified_working_sha256': sha256(disk).hexdigest(), 'committed_blob_sha256': sha256(blob).hexdigest()})
            checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local, 'directory': repo.relative_to(ROOT).as_posix(),
            'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(), 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ['README.md', 'README.en.md']],
            'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    old = read(output); proofs = {(row['repository'], row['path']): row for row in old['proofs']}
    for pattern in ['cloud-workflows-core-*', 'cloud-workflow-ui-*']:
        for file in (DELIVERY / 'evidence').glob(pattern):
            if file.is_file():
                name = file.relative_to(DELIVERY).as_posix()
                proofs[('delivery', name)] = {'repository': 'delivery', 'path': name, 'sha256': digest(file), 'url': 'https://github.com/copypasteltd/workmate/blob/delivery/' + name}
    for item in cp['screenshots'] + [item for row in cp['recordings'] for item in row['files']]:
        file = DEV / item['path']; name = file.relative_to(DEV / 'copypaste-web').as_posix()
        proofs[('web', name)] = {'repository': 'web', 'path': name, 'sha256': digest(file), 'url': 'https://github.com/copypasteltd/workmate/blob/web/' + name}
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(progress['requirements']) == 102 and progress['summary'] == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'ready_for_remote_verification', 'previous_plan_sha256': digest(output),
        'scope': cp['scope'], 'components': components, 'source_bindings_checked': {'current_files': len(cp['source_files']), 'qualification_scopes': cp['qualification_scopes']},
        'latest_component_committed_files_checked': checked, 'latest_component_committed_files_equal_disk': checked - len(normalizations),
        'declared_git_line_ending_normalizations': normalizations, 'unique_committed_blobs_read': len(cache), 'committed_blob_read_mode': 'Exact disk bytes or explicitly declared CRLF-to-LF transformation only',
        'current_full_platform_regression_rerun': False, 'full_regression_scope': 'Stage91 verifies 55 relevant private cloud workflow, connected native workflow, analysis role, schedule and template cases; earlier complete platform/client snapshots retain their historical scope.',
        'recording_scope': 'Two current actual Web/native Codex/workflow approval/download/revision GIF/MP4 pairs, fully decoded. The model/account data is explicitly synthetic. Earlier client recordings retain their original scope.',
        'private_cloud_workflows': {'checkpoint': ref(checkpoint_file), 'documentation_audit': ref(audit_file), 'reviews': reports, 'selected': cp['selected'],
            'core_tests': cp['core_tests'], 'ui_checks': 8, 'screenshots': 10, 'recordings': 2, 'fully_decoded_files': 4, 'roles': cp['roles'], 'new_migration': cp['new_migration'], 'original_complete_acceptance': 'not_proven'},
        'work_intake': {**old['work_intake'], 'evidence_scope': 'Historical stage89 Web first-work fixture; client product bytes remain exact, but its full cross-repository snapshot is historical after stage91 backend/delivery changes.'},
        'local_programs': {**old['local_programs'], 'evidence_scope': 'Historical stage88 Desktop product qualification. Unchanged Desktop product bytes retain that scope; the complete cross-repository/backend snapshot is historical.'},
        'acceptance_baseline': {**old['acceptance_baseline'], 'requirements': 102, 'acceptance_cases': 102, 'partial': 86, 'unproven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__))}
    with previous.open('xb') as stream: stream.write(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'committed_files': checked, 'sources': len(cp['source_files']), 'proofs': len(proofs)}))


if __name__ == '__main__': main()
