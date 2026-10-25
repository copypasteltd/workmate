"""Reproduce real README URL resolution and bind the corrected publication audit."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from audit_workmate_publication import BASE, MAP, ROOT, git, readme_target_file
from record_folder_work import digest, read, ref


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--finalize', action='store_true')
    args = parser.parse_args()
    output = ROOT / 'docs/quality/work-intake-publication-url-check-01.json'
    if not args.finalize:
        assert not output.exists()
        links, query_links = [], []
        for branch, repo in MAP.items():
            for name in ('README.md', 'README.en.md'):
                file = repo / ('docs/' + name if branch == 'docs' else name)
                text = re.sub(r'\x60{3}.*?\x60{3}', '', file.read_text(encoding='utf-8'), flags=re.S)
                for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', text):
                    target = target.strip('<>')
                    local = readme_target_file(repo, file, target)
                    if local is not None:
                        assert local.is_file(), (str(file), target)
                        row = {'readme': file.relative_to(ROOT).as_posix(), 'target': target, 'resolved': local.relative_to(ROOT).as_posix()}
                        links.append(row)
                        if '?raw=true' in target: query_links.append(row)
        assert len(query_links) == 22
        repo, file = MAP['web'], MAP['web'] / 'README.md'
        assert readme_target_file(repo, file, 'README.md?raw=true#top') == file
        assert readme_target_file(repo, file, BASE + 'blob/web/README.md?raw=true#top') == file
        assert readme_target_file(repo, file, BASE + 'blob/web/a%3Fb%20c.png?raw=true') == repo / 'a?b c.png'
        assert readme_target_file(repo, file, BASE + 'tree/web?tab=readme#top') is None
        assert readme_target_file(repo, file, 'https://example.invalid/other?raw=true') is None
        for target in ('../README.md?raw=true', BASE + 'blob/web/%2e%2e/README.md?raw=true'):
            try: readme_target_file(repo, file, target)
            except AssertionError: pass
            else: raise AssertionError('Repository traversal must remain rejected')
        archive = ROOT / 'docs/quality/history/stage89-before-publication-link-fix/receipt.json'
        for row in read(archive)['files']: assert digest(ROOT / row['archive']) == row['sha256']
        failed = ROOT / read(archive)['files'][2]['archive']
        assert read(failed)['status'] == 'failed' and read(failed)['checks'] == [] and read(failed)['remote_after'] == {}
        result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'scope': 'Actual current README mapped paths plus query/fragment/encoded-name/traversal cases. Full Git-history publication audit still runs separately.',
            'readmes': 14, 'resolved_local_links': len(links), 'query_links': query_links, 'query_and_boundary_cases': 7,
            'auditor': ref(ROOT / 'docs/tools/audit_workmate_publication.py'), 'failed_publication': ref(failed), 'exact_preimages': ref(archive),
            'verifier_sha256': digest(Path(__file__))}
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        print(json.dumps({'status': 'passed', 'readmes': 14, 'resolved_links': len(links), 'query_links': 22, 'boundary_cases': 7}))
        return
    proof = read(output)
    assert proof['status'] == 'passed' and proof['verifier_sha256'] == digest(Path(__file__))
    assert proof['auditor']['sha256'] == digest(ROOT / proof['auditor']['path'])
    manifest = ROOT / 'docs/quality/workmate-publication.json'
    old = read(manifest)
    assert 'publication_link_parsing' not in old
    checkpoint = read(ROOT / 'docs/quality/work-intake-checkpoint.json')
    for name, expected in checkpoint['source_files'].items(): assert digest(ROOT / name) == expected, name
    for component in old['components']:
        repo = ROOT / component['directory']
        assert not git(repo, 'status', '--porcelain')
        assert git(repo, 'rev-parse', 'HEAD').decode().strip() == component['commit']
    reviews = {}
    for name in ('desktop-browser-staged-credentials-21.json', 'desktop-browser-whitespace-20.json', 'archive-link-audit-10.json'):
        file = ROOT / 'docs/quality' / name
        assert read(file)['status'] == 'passed'
        reviews[name] = ref(file)
    original = ROOT / 'docs/quality/history/stage89-before-publication-link-fix/docs__quality__workmate-publication.json.snapshot'
    assert manifest.read_bytes() == original.read_bytes()
    result = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'previous_plan_sha256': digest(manifest),
        'publication_link_parsing': {'status': 'verified_scoped_url_resolution', 'check': ref(output), 'reviews': reviews,
            'change': ref(ROOT / 'docs/changes/2026-10-25-publication-links.md'), 'previous_manifest': ref(original),
            'product_sources_unchanged': True, 'full_history_and_remote_status': 'requires_separate_final_publisher_receipt'},
        'verifier_sha256': digest(Path(__file__))}
    manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'components': len(result['components']), 'product_sources_unchanged': True}))


if __name__ == '__main__': main()
