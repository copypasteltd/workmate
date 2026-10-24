"""Append the byte-preservation proof without changing product qualification scopes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from verify_geo_archive_byte_preservation import ROOT, git, read, digest


def main():
    proof_path = ROOT / 'docs/quality/geo-archive-byte-preservation-01.json'
    proof = read(proof_path)
    assert proof['status'] == 'passed_exact_byte_preservation'
    assert proof['working_original_bytes_changed'] is False and len(proof['restored_files']) == 18
    assert digest(ROOT / 'docs/tools/verify_geo_archive_byte_preservation.py') == proof['verifier_sha256']
    scan_path = ROOT / proof['initial_scan']['path']
    assert digest(scan_path) == proof['initial_scan']['sha256']
    for row in proof['restored_files']:
        data = (ROOT / row['path']).read_bytes()
        assert sha256(data).hexdigest() == row['original_working_sha256']
        assert git('show', ':' + row['path']) == data
    attribute = proof['generated_preservation_metadata']
    assert digest(ROOT / attribute['path']) == attribute['sha256']
    for item in proof['components_unchanged']:
        prefix = ['-C', str(ROOT / 'dev' / ('copypaste-' + item['component']))]
        assert git(*prefix, 'rev-parse', 'HEAD').decode().strip() == item['commit']
        assert not git(*prefix, 'status', '--porcelain')
    credentials = ROOT / 'docs/quality/desktop-browser-staged-credentials-11.json'
    whitespace = ROOT / 'docs/quality/desktop-browser-whitespace-11.json'
    credential_data, whitespace_data = read(credentials), read(whitespace)
    assert credential_data['status'] == 'passed' and credential_data['staged_files_checked'] > 0
    assert whitespace_data['status'] == 'passed' and whitespace_data['source_and_readme_whitespace_issues'] == 0
    assert whitespace_data['raw_bytes_changed'] is False
    assert digest(ROOT / 'docs/tools/scan_desktop_browser_staged_credentials.py') == credential_data['verifier_sha256']
    assert digest(ROOT / 'docs/tools/record_desktop_browser_whitespace.py') == whitespace_data['verifier_sha256']
    output = ROOT / 'docs/quality/workmate-publication.json'
    archive = ROOT / 'docs/quality/history/stage83-before-archive-byte-preservation-publication.json'
    assert not archive.exists()
    plan = read(output)
    assert 'archive_byte_preservation' not in plan['geo_observations']
    supplement = {'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Additive docs/main correction only: restore 18 already-hashed original CRLF quality/source-archive blobs and preserve future writes. JSON meanings, original acceptance states, product/runtime/test/media bytes and all six component commits remain unchanged.',
        'previous_publication_sha256': digest(output),
        'previous_publication_archive': archive.relative_to(ROOT).as_posix(),
        'proof': {'path': proof_path.relative_to(ROOT).as_posix(), 'sha256': digest(proof_path)},
        'initial_scan': {'path': scan_path.relative_to(ROOT).as_posix(), 'sha256': digest(scan_path)},
        'precommit_credentials': {'path': credentials.relative_to(ROOT).as_posix(), 'sha256': digest(credentials)},
        'raw_whitespace': {'path': whitespace.relative_to(ROOT).as_posix(), 'sha256': digest(whitespace)},
        'finalizer_sha256': digest(Path(__file__))}
    archive.write_bytes(output.read_bytes())
    plan['geo_observations']['archive_byte_preservation'] = supplement
    plan['at'] = supplement['at']
    output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'ready_for_remote_verification', 'restored_quality_files': 18,
                      'product_component_commits_unchanged': 6, 'product_tests_rerun': False}))


if __name__ == '__main__':
    main()
