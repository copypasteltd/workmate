"""Bind committed client content implementation and exact native-client evidence."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
QUALITY = ROOT / 'docs/quality'


def ref(p):
    return {'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)}


def main():
    output = QUALITY / 'workmate-publication.json'
    previous = QUALITY / 'history/stage102-previous-publication.json'
    assert not previous.exists()
    checkpoint = QUALITY / 'client-content-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_client_content'
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    audit_file = QUALITY / 'client-content-docs-audit-01.json'
    audit = read(audit_file)
    assert audit['status'] == 'passed' and audit['bilingual_readmes'] == 14
    assert audit['checkpoint']['sha256'] == digest(checkpoint)
    assert audit['verifier_sha256'] == digest(ROOT / 'docs/tools/record_client_content.py')
    assert len(audit['recordings']) == 8 and all(v['fully_decoded'] for v in audit['recordings'])
    assert len(audit['screenshots']) == 8
    reviews = {}
    for filename, verifier in [
        ('desktop-browser-staged-credentials-43.json', 'scan_desktop_browser_staged_credentials.py'),
        ('client-content-whitespace-01.json', 'record_client_content_whitespace.py'),
        ('archive-link-audit-26.json', 'audit_archive_links.py'),
    ]:
        p = QUALITY / filename
        value = read(p)
        assert value['status'] == 'passed'
        assert value['verifier_sha256'] == digest(ROOT / 'docs/tools' / verifier)
        reviews[filename] = ref(p)
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        names = [v.decode('utf-8') for v in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if v]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                raw = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                attrs = {raw[i + 1].decode(): raw[i + 2].decode() for i in range(0, len(raw) - 1, 3)}
                assert attrs['text'] in ['set', 'auto'] and attrs['eol'] == 'lf' and attrs['filter'] == 'unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                normalizations.append({'path': (repo / name).relative_to(DEV).as_posix(),
                    'transformation': 'declared_git_crlf_to_lf_only',
                    'qualified_working_sha256': sha256(disk).hexdigest(),
                    'committed_blob_sha256': sha256(blob).hexdigest()})
            checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local,
            'directory': repo.relative_to(ROOT).as_posix(),
            'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
            'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'readmes': [{'path': n, 'sha256': digest(repo / n)} for n in ['README.md', 'README.en.md']],
            'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    old = read(output)
    proofs = {(v['repository'], v['path']): v for v in old['proofs']}

    def proof(p, branch, repo):
        name = p.relative_to(repo).as_posix()
        proofs[(branch, name)] = {'repository': branch, 'path': name, 'sha256': digest(p),
            'url': 'https://github.com/copypasteltd/workmate/blob/' + branch + '/' + name}

    def component_proof(p):
        if p.is_relative_to(DEV):
            component = p.relative_to(DEV).parts[0].removeprefix('copypaste-')
            proof(p, MAP[component], DEV / ('copypaste-' + component))
        else:
            proof(p, 'docs', ROOT)

    delivery = DEV / 'copypaste-delivery'
    for p in (delivery / 'evidence').glob('client-content-*'):
        if p.is_file():
            proof(p, 'delivery', delivery)
        else:
            for child in p.rglob('*'):
                if child.is_file():
                    proof(child, 'delivery', delivery)
    # Retain media from failed attempts as well as the selected successful journey.
    for attempt in cp['all_attempts']:
        report = read(ROOT / attempt['path'])
        if not report.get('journey'):
            continue
        journey = read(delivery / report['journey']['path'])
        rows = journey.get('screenshots', []) + [v for movie in journey.get('recordings', []) if movie for v in movie['files']]
        for row in rows:
            p = DEV / row['path']
            assert digest(p) == row['sha256'], p
            component_proof(p)
    refresh = read(QUALITY / 'client-content-documentation-refresh.json')
    for row in refresh['media_copies']:
        component_proof(ROOT / row['target'])
    for name in ['client-content-checkpoint.json', 'client-content-documentation-refresh.json', 'client-content-docs-audit-01.json']:
        proof(QUALITY / name, 'docs', ROOT)
    for name in ['record_client_content.py', 'record_client_content_whitespace.py',
                 'finalize_client_content_manifest.py', 'archive_client_content_attempt.py', 'write_client_content_contract.py']:
        proof(ROOT / 'docs/tools' / name, 'docs', ROOT)
    for name in ['technical/102-client-content-releases.md', 'contracts/client-content-openapi.json',
                 'changes/2026-10-26-client-content.md', 'changes/2026-10-26-client-content.en.md']:
        proof(ROOT / 'docs' / name, 'docs', ROOT)
    for folder in ['stage102-documents', 'stage102-before-final-format']:
        for p in (QUALITY / 'history' / folder).rglob('*'):
            if p.is_file():
                proof(p, 'docs', ROOT)
    for row in cp['new_migrations']:
        proof(ROOT / row['path'], 'backend', DEV / 'copypaste-platform')
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['summary'] == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'ready_for_remote_verification',
        'previous_plan_sha256': digest(output), 'scope': cp['scope'], 'components': components,
        'source_bindings_checked': {'current_files': len(cp['source_files']), 'qualification_scopes': cp['qualification_scopes']},
        'latest_component_committed_files_checked': checked,
        'latest_component_committed_files_equal_disk': checked - len(normalizations),
        'declared_git_line_ending_normalizations': normalizations, 'unique_committed_blobs_read': len(cache),
        'committed_blob_read_mode': 'Exact qualified bytes, or explicitly declared text CRLF-to-LF transformation only',
        'current_full_platform_regression_rerun': False,
        'full_regression_scope': f"Stage102 reruns five related backend suites ({cp['core_tests']['pass']} checks), ten Desktop bridge/file checks, and seven actual Admin/Web/packaged Desktop/native Chrome Side Panel journey checks. Historical whole-product qualification retains its original scope.",
        'recording_scope': 'Actual email/onboarding, MFA publication, selected recipient preview, browser PKCE, packaged frameless local workspace, native right Side Panel, literal-text rendering, complete baseline retention, historical rollback, Chinese/dark compact layouts and sign-out clearing. Eight unedited PNGs and four actual GIF/MP4 pairs; synthetic accounts/copy and zero model calls.',
        'client_content_releases': {'checkpoint': ref(checkpoint), 'documentation_audit': ref(audit_file), 'reviews': reviews,
            'selected': cp['selected'], 'core_tests': cp['core_tests'], 'ui_checks': 7, 'screenshots': 8,
            'recordings': 4, 'fully_decoded_recording_files': 8, 'packaged_desktop': cp['packaged_desktop'],
            'new_migrations': cp['new_migrations'], 'original_complete_acceptance': 'not_proven'},
        'acceptance_baseline': {**old['acceptance_baseline'], 'requirements': 102, 'acceptance_cases': 102,
            'partial': 86, 'unproven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__))}
    previous.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'sources': len(cp['source_files']), 'proofs': len(proofs)}))


if __name__ == '__main__':
    main()
