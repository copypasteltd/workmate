"""Bind the six committed components to the current brand and layout proof."""
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
    checkpoint_path = ROOT / 'docs/quality/brand-production-checkpoint.json'
    checkpoint = read(checkpoint_path)
    assert checkpoint['status'] == 'verified_fixed_brand_production_subflow'
    for name, expected in checkpoint['source_files'].items():
        assert digest(DEV / name) == expected, name
    for item in checkpoint['documentation_media']:
        assert digest(DEV / item['source']) == digest(ROOT / item['path']) == item['sha256']
    audit_path = ROOT / 'docs/quality/brand-production-docs-audit-01.json'
    audit = read(audit_path)
    assert audit['status'] == 'passed' and audit['original_requirement_records_unchanged'] == 102
    assert digest(checkpoint_path) == audit['checkpoint']['sha256']
    assert digest(ROOT / 'docs/tools/audit_brand_production_docs.py') == audit['verifier_sha256']
    credential_path = ROOT / 'docs/quality/desktop-browser-staged-credentials-05.json'
    credential = read(credential_path)
    assert credential['status'] == 'passed' and credential['staged_files_checked'] > 0
    assert digest(ROOT / 'docs/tools/scan_desktop_browser_staged_credentials.py') == credential['verifier_sha256']
    whitespace_path = ROOT / 'docs/quality/desktop-browser-whitespace-06.json'
    whitespace = read(whitespace_path)
    assert whitespace['status'] == 'passed' and whitespace['source_and_readme_whitespace_issues'] == 0
    assert whitespace['raw_bytes_changed'] is False
    assert digest(ROOT / 'docs/tools/record_desktop_browser_whitespace.py') == whitespace['verifier_sha256']
    for item in whitespace['raw_files']:
        repo = ROOT if item['repository'] == 'docs' else DEV / ('copypaste-' + item['repository'])
        assert digest(repo / item['path']) == item['sha256']
    components, normalizations, checked, cache = [], [], 0, {}
    for component, branch in MAP.items():
        repo = DEV / ('copypaste-' + component)
        assert not git(repo, 'status', '--porcelain'), component
        local = git(repo, 'branch', '--show-current').decode().strip()
        assert local in [branch, 'codex/' + branch]
        names = [raw.decode('utf-8') for raw in git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if raw]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                values = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', name).split(b'\0')
                attributes = {values[i + 1].decode(): values[i + 2].decode() for i in range(0, len(values) - 1, 3)}
                assert attributes['text'] in ['set', 'auto'] and attributes['eol'] == 'lf' and attributes['filter'] == 'unspecified'
                assert b'\0' not in disk and b'\r\n' in disk and blob == disk.replace(b'\r\n', b'\n'), name
                normalizations.append({'path': (repo / name).relative_to(DEV).as_posix(), 'transformation': 'declared_git_crlf_to_lf_only', 'qualified_working_sha256': sha256(disk).hexdigest(), 'committed_blob_sha256': sha256(blob).hexdigest()})
            checked += 1
        components.append({'component': component, 'branch': branch, 'local_branch': local,
                           'directory': repo.relative_to(ROOT).as_posix(), 'commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                           'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                           'readmes': [{'path': name, 'sha256': digest(repo / name)} for name in ['README.md', 'README.en.md']],
                           'branch_url': 'https://github.com/copypasteltd/workmate/tree/' + branch})
    output = ROOT / 'docs/quality/workmate-publication.json'
    old = read(output)
    archive = ROOT / 'docs/quality/history/stage79-previous-publication.json'
    assert not archive.exists()
    proofs = {(item['repository'], item['path']): item for item in old['proofs']}
    patterns = ['brand-library-ui-02*', 'brand-production-*', 'desktop-execution-control-23*',
                'desktop-local-ui-33*', 'quality-ui-08*', 'extension-chat-09*']
    evidence_names = {item['report'] for item in checkpoint['qualification_scopes']}
    for pattern in patterns:
        evidence_names.update(file.relative_to(DELIVERY).as_posix() for file in (DELIVERY / 'evidence').glob(pattern) if file.is_file())
    for name in sorted(evidence_names):
        proofs[('delivery', name)] = {'repository': 'delivery', 'path': name, 'sha256': digest(DELIVERY / name), 'url': 'https://github.com/copypasteltd/workmate/blob/delivery/' + name}
    result = {
        **old, 'at': datetime.now(timezone.utc).isoformat(), 'previous_plan_sha256': digest(output),
        'scope': checkpoint['scope'], 'components': components,
        'source_bindings_checked': {'current_files': len(checkpoint['source_files']), 'qualification_scopes': checkpoint['qualification_scopes']},
        'latest_component_committed_files_checked': checked, 'latest_component_committed_files_equal_disk': checked - len(normalizations),
        'declared_git_line_ending_normalizations': normalizations, 'unique_committed_blobs_read': len(cache),
        'committed_blob_read_mode': 'Batch Git object verification with exact working bytes or explicitly declared CRLF-to-LF normalization',
        'preserved_regression_cases': 861, 'full_regression_cases': checkpoint['platform_tests']['tests'],
        'recording_scope': 'The four legacy workmate-media-10 captures keep their original historical scope. Current stage-79 actual screenshots and seven recordings bind the brand-production checkpoint separately; no historical capture is relabeled as current.',
        'brand_production': {
            'checkpoint': checkpoint_path.relative_to(ROOT).as_posix(), 'checkpoint_sha256': digest(checkpoint_path),
            'documentation_audit': {'path': audit_path.relative_to(ROOT).as_posix(), 'sha256': digest(audit_path)},
            'precommit_credentials': {'path': credential_path.relative_to(ROOT).as_posix(), 'sha256': digest(credential_path)},
            'raw_whitespace': {'path': whitespace_path.relative_to(ROOT).as_posix(), 'sha256': digest(whitespace_path)},
            'selected': checkpoint['selected'], 'screenshots': 61, 'recordings': 7,
            'original_complete_acceptance': 'not_proven', 'TC_056_real_business_acceptance': 'not_run',
        },
        'business_quality': {**old['business_quality'], 'source_scope': 'Historical stage78 checkpoint retained; current stage79 platform and actual Web/Admin08/Desktop33/Extension09 rerun the bounded quality flow.'},
        'desktop_native_browser_and_layout': {**old['desktop_native_browser_and_layout'], 'source_scope': 'Historical stage77 checkpoint retained; current Desktop33 reruns native browser and all three real window layout scenarios.'},
        'client_direction': {**old['client_direction'], 'current_direction_review': {'path': checkpoint_path.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_path), 'new_extension_ui_run': True}, 'complete_Desktop_operation_parity': 'pending'},
        'acceptance_baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial': 82, 'unproven': 20, 'fully_accepted': 0, 'all_NFR_and_G01_G10_preserved': True},
        'proofs': list(proofs.values()), 'verifier_sha256': digest(Path(__file__)),
    }
    archive.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(components), 'committed_files': checked, 'sources': len(checkpoint['source_files']), 'proofs': len(proofs)}))


if __name__ == '__main__':
    main()
