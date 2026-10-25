"""Read-only validation of current scoped analysis delivery and bilingual documentation."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref
from audit_folder_work_docs import FIELDS, BRANCHES, targets


def main():
    output = ROOT / 'docs/quality/analysis-roles-docs-audit-01.json'
    assert not output.exists()
    checkpoint_file = ROOT / 'docs/quality/analysis-roles-checkpoint.json'; cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_analysis_role_delivery' and cp['core_tests']['tests'] == cp['core_tests']['pass'] == 68 and cp['ui_checks'] == 11
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_analysis_roles.py')
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for item in cp['raw_evidence']: assert digest(ROOT / item['path']) == item['sha256']
    refresh_file = ROOT / 'docs/quality/analysis-roles-documentation-refresh.json'; refresh = read(refresh_file)
    assert refresh['status'] == 'passed' and refresh['checkpoint']['sha256'] == digest(checkpoint_file)
    assert refresh['verifier_sha256'] == digest(ROOT / 'docs/tools/repair_analysis_catalog_snapshot.py')
    for key in ['first_documentation_write', 'first_documentation_writer', 'future_writer', 'legacy_catalog_restored', 'catalog_snapshot']:
        assert digest(ROOT / refresh[key]['path']) == refresh[key]['sha256']
    for item in refresh['changes']:
        assert digest(ROOT / item['path']) == item['after_sha256'] and digest(ROOT / item['archive']) == item['before_sha256']
    for item in refresh['media_copies']: assert digest(ROOT / item['source']) == digest(ROOT / item['target']) == item['sha256']
    media_file = ROOT / 'docs/quality/analysis-roles-media-review-01.json'; media = read(media_file)
    assert media['status'] == 'passed' and media['checkpoint']['sha256'] == digest(checkpoint_file)
    assert media['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_analysis_media.py')
    assert sum(len(row['files']) for row in media['recordings']) == 4
    for row in media['recordings']:
        for item in row['files']: assert item['fully_decoded'] and item['decoded_frames'] > 1 and digest(DEV / item['path']) == item['sha256']
    for attempt in range(1, 7): assert read(DELIVERY / f'evidence/analysis-roles-core-{attempt:02}.json')['status'] == ('passed' if attempt == 5 else 'failed')
    for attempt in range(1, 4): assert read(DELIVERY / f'evidence/analysis-role-ui-{attempt:02}.json')['status'] == 'failed'
    original = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, total in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(original[field]) == total
        for name, expected in original[field].items(): assert digest(ROOT / name) == expected, name
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == original['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    assert progress['current_source_qualification']['stage'] == progress['analysis_role_delivery']['stage'] == 90
    catalog = read(DEV / 'copypaste-platform/catalog/role-preset-catalog.json')
    assert catalog == read(ROOT / 'docs/contracts/role-preset-catalog-analysis-1.1.0.json')
    assert len(catalog['roles']) == 18 and catalog['minimum_qualified_roles'] == 12
    old_catalog = read(ROOT / 'docs/quality/history/stage90-before-analysis-roles/dev__copypaste-platform__catalog__role-preset-catalog.json.snapshot')
    history = read(DEV / 'copypaste-platform/catalog/role-preset-history.json')
    for role in old_catalog['roles']:
        current = next(row for row in catalog['roles'] if row['role_key'] == role['role_key'])
        if role['role_key'] in ['information-design', 'marketing-analyst']:
            assert current['version'] == '1.1.0' and role in history
        else: assert current == role
    readmes = [ROOT / 'docs' / name for name in ['README.md', 'README.en.md']]
    readmes += [DEV / ('copypaste-' + component) / name for component in BRANCHES.values() for name in ['README.md', 'README.en.md']]
    parser, links = MarkdownIt('commonmark'), Counter()
    folders = {'docs': ROOT, 'main': ROOT, **{branch: DEV / ('copypaste-' + component) for branch, component in BRANCHES.items()}}
    for file in readmes:
        text = file.read_text(encoding='utf-8-sig')
        assert len(text) > 2500 and '```mermaid' in text
        assert re.search(r'[\u4e00-\u9fff]', text) if file.name == 'README.md' else len(re.findall(r'[A-Za-z]{3,}', text)) > 200
        if file.parent in [ROOT / 'docs', DEV / 'copypaste-platform', DEV / 'copypaste-web', DELIVERY]:
            for value in ['analysis-roles-stage90', '68', '11', 'SQL104', 'analysis-report-review.gif', 'analysis-role-work.mp4']: assert value in text
        repo = ROOT if file.parent == ROOT / 'docs' else file.parent
        for target in targets(parser.parse(text)):
            parsed = urlsplit(target)
            if parsed.netloc == 'github.com' and parsed.path.startswith('/copypasteltd/workmate/'):
                parts = unquote(parsed.path).split('/')
                if len(parts) > 5 and parts[3] in ['blob', 'tree'] and parts[4] in folders:
                    assert folders[parts[4]].joinpath(*parts[5:]).exists(), (file, target)
                    links['mapped_github_targets_resolved_locally'] += 1
            elif not parsed.scheme and not parsed.netloc and parsed.path:
                destination = (file.parent / unquote(parsed.path)).resolve()
                assert destination.is_relative_to(repo) and destination.exists(), (file, target)
                links['independent_repository_local_targets'] += 1
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint_file), 'source_files_checked': len(cp['source_files']),
        'bilingual_readmes': len(readmes), 'readmes': [ref(file) for file in readmes], 'documentation_refresh': ref(refresh_file), 'media_review': ref(media_file),
        'screenshots': 10, 'decoded_recordings': 2, 'decoded_files': 4, 'original_requirement_records_unchanged': 102, 'original_migrations_preserved': 103,
        'historical_contracts_preserved': 532, 'old_skill_packages_preserved': cp['old_skill_packages_preserved'], 'links': dict(links),
        'failed_attempts_retained': {'core': [1, 2, 3, 4, 6], 'ui': [1, 2, 3]}, 'full_product_acceptance': 'not_proven', 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'sources': len(cp['source_files']), 'readmes': len(readmes), 'links': sum(links.values())}))


if __name__ == '__main__': main()
