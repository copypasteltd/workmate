"""Bind the six committed repositories to the reviewed generated-video release."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'


def main():
    checkpoint_file = ROOT / 'docs/quality/generated-video-checkpoint.json'
    checkpoint = read(checkpoint_file)
    assert checkpoint['status'] == 'verified_generated_video_subflow'
    for name, value in checkpoint['source_files'].items():
        assert digest(DEV / name) == value, name
    audit_file = ROOT / 'docs/quality/generated-video-docs-audit-01.json'
    audit = read(audit_file)
    assert audit['status'] == 'passed' and audit['original_requirement_records_unchanged'] == 102
    assert digest(checkpoint_file) == audit['checkpoint']['sha256']
    assert digest(ROOT / 'docs/tools/audit_generated_video_docs.py') == audit['verifier_sha256']
    credential_file = ROOT / 'docs/quality/desktop-browser-staged-credentials-07.json'
    credential = read(credential_file)
    assert credential['status'] == 'passed' and credential['staged_files_checked'] > 0
    assert digest(ROOT / 'docs/tools/scan_desktop_browser_staged_credentials.py') == credential['verifier_sha256']
    whitespace_file = ROOT / 'docs/quality/desktop-browser-whitespace-07.json'
    whitespace = read(whitespace_file)
    assert whitespace['status'] == 'passed' and whitespace['source_and_readme_whitespace_issues'] == 0
    assert whitespace['raw_bytes_changed'] is False
    assert digest(ROOT / 'docs/tools/record_desktop_browser_whitespace.py') == whitespace['verifier_sha256']
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        names = [value.decode('utf-8') for value in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if value]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                values = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                attributes = {values[i + 1].decode(): values[i + 2].decode() for i in range(0, len(values) - 1, 3)}
                assert attributes['text'] in ['set', 'auto'] and attributes['eol'] == 'lf' and attributes['filter'] == 'unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                normalizations.append({'path': (repo / name).relative_to(DEV).as_posix(), 'transformation': 'declared_git_crlf_to_lf_only',
                                       'qualified_working_sha256': sha256(disk).hexdigest(), 'committed_blob_sha256': sha256(blob).hexdigest()})
            checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local, 'directory': repo.relative_to(ROOT).as_posix(),
                           'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(), 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                           'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ['README.md', 'README.en.md']],
                           'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    output = ROOT / 'docs/quality/workmate-publication.json'
    old = read(output)
    archive = ROOT / 'docs/quality/history/stage80-previous-publication.json'
    assert not archive.exists()
    proofs = {(item['repository'], item['path']): item for item in old['proofs']}
    names = {item['report'] for item in checkpoint['qualification_scopes']}
    patterns = {'generated-video-*', 'desktop-execution-control-24*', 'desktop-execution-control-25*', 'desktop-execution-control-26*', 'desktop-execution-control-27*', 'desktop-local-ui-34*', 'desktop-local-ui-35*', 'desktop-local-ui-36*', 'desktop-local-ui-37*', 'extension-chat-1[0-9]*'}
    patterns.update(Path(item['report']).stem + '*' for item in checkpoint['qualification_scopes'])
    for pattern in sorted(patterns):
        names.update(file.relative_to(DELIVERY).as_posix() for file in (DELIVERY / 'evidence').glob(pattern) if file.is_file())
    for name in sorted(names):
        proofs[('delivery', name)] = {'repository': 'delivery', 'path': name, 'sha256': digest(DELIVERY / name),
                                    'url': 'https://github.com/copypasteltd/workmate/blob/delivery/' + name}
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'previous_plan_sha256': digest(output),
              'scope': checkpoint['scope'], 'components': components,
              'source_bindings_checked': {'current_files': len(checkpoint['source_files']), 'qualification_scopes': checkpoint['qualification_scopes']},
              'latest_component_committed_files_checked': checked, 'latest_component_committed_files_equal_disk': checked - len(normalizations),
              'declared_git_line_ending_normalizations': normalizations, 'unique_committed_blobs_read': len(cache),
              'committed_blob_read_mode': 'Batch Git verification with exact disk bytes or the declared CRLF-to-LF transformation only',
              'preserved_regression_cases': 874, 'full_regression_cases': checkpoint['platform_tests']['tests'],
              'recording_scope': 'Legacy media retain their historical scope. The current stage-80 checkpoint binds actual screenshots/GIF/MP4 separately; no old capture is relabeled as current.',
              'generated_video': {'checkpoint': checkpoint_file.relative_to(ROOT).as_posix(), 'checkpoint_sha256': digest(checkpoint_file),
                                  'documentation_audit': {'path': audit_file.relative_to(ROOT).as_posix(), 'sha256': digest(audit_file)},
                                  'precommit_credentials': {'path': credential_file.relative_to(ROOT).as_posix(), 'sha256': digest(credential_file)},
                                  'raw_whitespace': {'path': whitespace_file.relative_to(ROOT).as_posix(), 'sha256': digest(whitespace_file)},
                                  'selected': checkpoint['selected'], 'screenshots': len(checkpoint['screenshots']), 'recordings': len(checkpoint['recordings']),
                                  'original_complete_acceptance': 'not_proven', 'TC_019': 'not_completed', 'live_company_video_provider': 'not_qualified'},
              'brand_production': {**old['brand_production'], 'source_scope': 'Historical stage-79 proof retained. Current stage-80 full tests and packaged Desktop rerun the bounded brand flow.'},
              'business_quality': {**old['business_quality'], 'source_scope': 'Historical proof retained; current full tests and actual Desktop/native Side Panel rerun the bounded quality flow.'},
              'desktop_native_browser_and_layout': {**old['desktop_native_browser_and_layout'], 'source_scope': 'Historical proof retained; current packaged journey reruns the actual browser and all three OS window layouts.'},
              'client_direction': {**old['client_direction'], 'current_direction_review': {'path': checkpoint_file.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_file), 'new_extension_ui_run': True}, 'complete_Desktop_operation_parity': 'pending'},
              'acceptance_baseline': checkpoint['original_acceptance'], 'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__))}
    archive.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'committed_files': checked, 'sources': len(checkpoint['source_files']), 'proofs': len(proofs)}))


if __name__ == '__main__':
    main()
