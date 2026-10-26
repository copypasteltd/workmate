"""Bind previously ignored historical logs and verify committed proof reachability."""
from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import git, digest, read

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / 'docs/quality'


def reference(p):
    return {'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)}


def main():
    manifest = QUALITY / 'workmate-publication.json'
    previous = QUALITY / 'history/stage102-before-log-reachability'
    assert not previous.exists()
    value = read(manifest)
    checkpoint = read(QUALITY / 'client-content-checkpoint.json')
    for name, expected in checkpoint['source_files'].items():
        assert digest(ROOT / name) == expected, name
    delivery = ROOT / 'dev/copypaste-delivery'
    investigation = delivery / '.data/publication/fbe6dbc3-5040-4f57-8e66-ae88e0a1338b'
    logs = read(investigation / 'historical-log-review.json')
    assert logs['status'] == 'passed' and len(logs['files']) == 190
    credential_file = QUALITY / 'desktop-browser-staged-credentials-44.json'
    whitespace_file = QUALITY / 'client-content-whitespace-02.json'
    for file, tool in [(credential_file, 'scan_desktop_browser_staged_credentials.py'),
                       (whitespace_file, 'record_client_content_whitespace.py')]:
        review = read(file)
        assert review['status'] == 'passed'
        assert review['verifier_sha256'] == digest(ROOT / 'docs/tools' / tool)
    components = value['components']
    repositories = {'docs': ROOT}
    for row in components:
        repo = ROOT / row['directory']
        assert not git(repo, 'status', '--porcelain'), row['branch']
        row['commit'] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        row['tree'] = git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip()
        repositories[row['branch']] = repo
    cache, checked = {}, 0
    grouped = defaultdict(list)
    for row in value['proofs']:
        grouped[row['repository']].append(row)
    normalizations = {r['path']: r for r in value['declared_git_line_ending_normalizations']}
    normalized = []
    for branch, rows in grouped.items():
        repo = repositories[branch]
        blobs = committed_blobs(repo, [r['path'] for r in rows], cache)
        for row in rows:
            actual = sha256(blobs[row['path']]).hexdigest()
            if actual != row['sha256']:
                name = row['path'] if branch == 'docs' else repo.relative_to(ROOT / 'dev').as_posix() + '/' + row['path']
                declared = normalizations.get(name)
                assert declared and declared['qualified_working_sha256'] == row['sha256']
                assert declared['committed_blob_sha256'] == actual, (branch, row['path'])
                normalized.append({'repository': branch, 'path': row['path'], **declared})
            checked += 1
        print(json.dumps({'repository': branch, 'committed_proofs_verified': len(rows)}), flush=True)
    log_blobs = committed_blobs(delivery, [r['path'] for r in logs['files']], cache)
    for row in logs['files']:
        assert digest(delivery / row['path']) == sha256(log_blobs[row['path']]).hexdigest() == row['sha256']
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'finding': '190 historical evidence .log files were excluded by *.log although publication plans referenced their URLs. Earlier working-file checks did not establish Git reachability.',
        'correction': 'Only the 190 explicitly referenced and digest-reviewed original log files were added. Their committed bytes match the original manifest. Product and qualification sources remain unchanged.',
        'original_publication_manifest_sha256': digest(manifest), 'checkpoint': reference(QUALITY / 'client-content-checkpoint.json'),
        'historical_logs': logs['files'], 'committed_proof_files_checked': checked,
        'missing': 0, 'mismatched': 0, 'unique_committed_blobs_read': len(cache),
        'declared_line_ending_normalizations': normalized,
        'reviews': [reference(credential_file), reference(whitespace_file)],
        'components': components, 'verifier_sha256': digest(Path(__file__))}
    output = QUALITY / 'client-content-reachability-repair.json'
    with output.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write('\n')
    previous.mkdir()
    (previous / 'publication.json').write_bytes(manifest.read_bytes())
    value['at'] = report['at']
    value['previous_plan_sha256'] = digest(manifest)
    value['publication_reachability'] = reference(output)
    value['publication_reachability_verifier'] = reference(Path(__file__))
    additions = [output, Path(__file__), previous / 'publication.json', credential_file, whitespace_file,
                 ROOT / 'docs/changes/2026-10-26-evidence-publication.md',
                 ROOT / 'docs/changes/2026-10-26-evidence-publication.en.md']
    value['proofs'].extend({'repository': 'docs', 'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p),
        'url': 'https://github.com/copypasteltd/workmate/blob/docs/' + p.relative_to(ROOT).as_posix()} for p in additions)
    value['verifier_sha256'] = digest(Path(__file__))
    manifest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'ready_for_remote_verification', 'committed_proofs_checked': checked,
        'historical_logs_added': len(logs['files']), 'proofs': len(value['proofs'])}))


if __name__ == '__main__':
    main()
