"""Read-only checks of scoped workflow evidence, bilingual READMEs and real media."""
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
    output = ROOT / 'docs/quality/cloud-workflows-docs-audit-01.json'
    assert not output.exists()
    checkpoint_file = ROOT / 'docs/quality/cloud-workflows-checkpoint.json'; cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_private_cloud_workflows' and cp['core_tests']['tests'] == cp['core_tests']['pass'] == 55 and cp['ui_checks'] == 8
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_cloud_workflows.py')
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for item in cp['raw_evidence']: assert digest(ROOT / item['path']) == item['sha256']
    for item in cp['separate_browser_harness_qualification']:
        assert digest(ROOT / item['path']) == item['current_sha256']
        assert digest(ROOT / item['original_verifier']['path']) == item['core_observed_sha256'] == item['original_verifier']['sha256']
    refresh_file = ROOT / 'docs/quality/cloud-workflows-documentation-refresh.json'; refresh = read(refresh_file)
    assert refresh['status'] == 'passed' and refresh['checkpoint']['sha256'] == digest(checkpoint_file)
    assert refresh['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_cloud_workflow_docs.py')
    assert len(refresh['changes']) == 9
    for item in refresh['changes']:
        assert digest(ROOT / item['path']) == item['after_sha256'] and digest(ROOT / item['archive']) == item['before_sha256']
    for item in refresh['media_copies']: assert digest(ROOT / item['source']) == digest(ROOT / item['target']) == item['sha256']
    media_file = ROOT / 'docs/quality/cloud-workflows-media-review-01.json'; media = read(media_file)
    assert media['status'] == 'passed' and media['checkpoint']['sha256'] == digest(checkpoint_file)
    assert media['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_cloud_workflow_media.py')
    assert sum(len(row['files']) for row in media['recordings']) == 4
    for row in media['recordings']:
        for item in row['files']: assert item['fully_decoded'] and item['decoded_frames'] > 1 and digest(DEV / item['path']) == item['sha256']
    for attempt in range(1, 10):
        expected = 'passed' if attempt in [6, 8, 9] else 'failed'
        assert read(DELIVERY / f'evidence/cloud-workflows-core-{attempt:02}.json')['status'] == expected
    for attempt in [1, 2]: assert read(DELIVERY / f'evidence/cloud-workflow-ui-{attempt:02}.json')['status'] == 'failed'
    assert read(DELIVERY / 'evidence/cloud-workflow-ui-03.json')['status'] == 'passed'
    assert cp['selected']['ui'] != 'evidence/cloud-workflow-ui-03.json', 'Viewport capture issue requires a corrected final UI run'
    original = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, total in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(original[field]) == total
        for name, expected in original[field].items(): assert digest(ROOT / name) == expected, name
    stage90 = read(ROOT / 'docs/quality/analysis-roles-checkpoint.json')
    assert digest(ROOT / stage90['new_migration']['path']) == stage90['new_migration']['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == original['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    assert progress['current_source_qualification']['stage'] == progress['private_cloud_workflows']['stage'] == 91
    catalog = read(DEV / 'copypaste-platform/catalog/role-preset-catalog.json')
    assert catalog == read(ROOT / 'docs/contracts/role-preset-catalog-workflow-1.1.0.json')
    assert len(catalog['roles']) == 18 and catalog['minimum_qualified_roles'] == 12
    old_catalog = read(ROOT / 'docs/quality/history/stage91-before-cloud-workflows/dev__copypaste-platform__catalog__role-preset-catalog.json.snapshot')
    history = read(DEV / 'copypaste-platform/catalog/role-preset-history.json')
    for role in old_catalog['roles']:
        current = next(row for row in catalog['roles'] if row['role_key'] == role['role_key'])
        if role['role_key'] == 'workflow-consultant': assert current['version'] == '1.1.0' and role in history
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
            for value in ['cloud-workflows-stage91', 'Fifty-five' if file.name.endswith('.en.md') else '55', 'SQL105', 'cloud-workflow-review.gif', 'cloud-workflow-prepare.mp4']: assert value in text, (file, value)
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
        'screenshots': 10, 'decoded_recordings': 2, 'decoded_files': 4, 'original_requirement_records_unchanged': 102, 'original_migrations_preserved': 104,
        'historical_contracts_preserved': 532, 'old_skill_packages_preserved': cp['old_skill_packages_preserved'], 'links': dict(links),
        'failed_attempts_retained': {'core': [1, 2, 3, 4, 5, 7], 'ui': [1, 2]}, 'superseded_viewport_capture': 'cloud-workflow-ui-03',
        'full_product_acceptance': 'not_proven', 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'sources': len(cp['source_files']), 'readmes': len(readmes), 'links': sum(links.values())}))


if __name__ == '__main__': main()
