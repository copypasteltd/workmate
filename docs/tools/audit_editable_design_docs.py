"""Verify scoped design evidence, immutable inputs, bilingual documentation and actual media."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import re
from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref
from audit_folder_work_docs import FIELDS, BRANCHES, targets


def main():
    output = ROOT / 'docs/quality/editable-design-docs-audit-01.json'; assert not output.exists()
    checkpoint = ROOT / 'docs/quality/editable-design-checkpoint.json'; cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_editable_design' and cp['core_tests']['tests'] == cp['core_tests']['pass'] == 93 and cp['ui_checks'] == 8
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_editable_design.py')
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for item in cp['raw_evidence']: assert digest(ROOT / item['path']) == item['sha256']
    refresh_file = ROOT / 'docs/quality/editable-design-documentation-refresh.json'; refresh = read(refresh_file)
    assert refresh['status'] == 'passed' and refresh['checkpoint']['sha256'] == digest(checkpoint)
    assert refresh['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_editable_design_docs.py') and len(refresh['changes']) == 11
    for item in refresh['changes']: assert digest(ROOT / item['path']) == item['after_sha256'] and digest(ROOT / item['archive']) == item['before_sha256']
    for item in refresh['media_copies']: assert digest(ROOT / item['source']) == digest(ROOT / item['target']) == item['sha256']
    media_file = ROOT / 'docs/quality/editable-design-media-review-01.json'; media = read(media_file)
    assert media['status'] == 'passed' and media['checkpoint']['sha256'] == digest(checkpoint)
    assert media['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_editable_design_media.py')
    assert len(media['recordings']) == 2 and sum(len(row['files']) for row in media['recordings']) == 4
    for row in media['recordings']:
        for item in row['files']: assert item['fully_decoded'] and item['decoded_frames'] > 1 and digest(DEV / item['path']) == item['sha256']
    assert read(DELIVERY / 'evidence/editable-design-ui-01.json')['status'] == 'failed'
    for attempt in [3, 4, 5]:
        capture_failure = read(DELIVERY / f'evidence/editable-design-ui-{attempt:02}.json')
        assert capture_failure['status'] == 'failed' and capture_failure['journey']['status'] == 'passed'
        assert any(row['skipped_capture_errors'] for row in capture_failure['journey']['media'])
    assert read(DELIVERY / 'evidence/editable-design-core-06.json')['status'] == 'failed'
    first = read(DELIVERY / 'evidence/editable-design-core-01.json')
    assert first['status'] == 'passed' and cp['selected']['core'] != 'evidence/editable-design-core-01.json'
    for collection in ['stage92-before-editable-design', 'stage92-before-font-weight-fix', 'stage92-before-native-design']:
        archive = ROOT / 'docs/quality/history' / collection
        for item in read(archive / 'receipt.json')['files']: assert digest(ROOT / item['archive']) == item['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, total in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(baseline[field]) == total
        for name, expected in baseline[field].items(): assert digest(ROOT / name) == expected, name
    for prior in ['analysis-roles-checkpoint.json', 'cloud-workflows-checkpoint.json']:
        item = read(ROOT / 'docs/quality' / prior)['new_migration']; assert digest(ROOT / item['path']) == item['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    assert progress['current_source_qualification']['stage'] == progress['editable_design_roles']['stage'] == 92
    catalog = read(DEV / 'copypaste-platform/catalog/role-preset-catalog.json')
    assert catalog == read(ROOT / 'docs/contracts/role-preset-catalog-editable-design-1.1.0.json')
    assert len(catalog['roles']) == 18 and catalog['minimum_qualified_roles'] == 12
    archive = ROOT / 'docs/quality/history/stage92-before-editable-design'
    old = read(archive / 'dev__copypaste-platform__catalog__role-preset-catalog.json.snapshot')
    history = read(DEV / 'copypaste-platform/catalog/role-preset-history.json')
    for role in old['roles']:
        current = next(row for row in catalog['roles'] if row['role_key'] == role['role_key'])
        if role['role_key'] in ['brand-visual', 'presentation']: assert current['version'] == '1.1.0' and role in history
        else: assert current == role
    old_packages = read(archive / 'dev__copypaste-platform__catalog__skill-packages.json.snapshot'); assert len(old_packages) == 37
    for item in old_packages: assert digest(DEV / 'copypaste-platform' / item['path']) == item['sha256']
    font_dir = DEV / 'copypaste-platform/assets/fonts/copypaste-sans-tc'; fonts = read(font_dir / 'source.json')
    assert fonts['source_sha256'] == '864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f'
    assert [item['weight'] for item in fonts['files']] == [400, 700]
    for item in fonts['files']: assert digest(font_dir / item['file']) == item['sha256']
    readmes = [ROOT / 'docs' / name for name in ['README.md', 'README.en.md']]
    readmes += [DEV / ('copypaste-' + component) / name for component in BRANCHES.values() for name in ['README.md', 'README.en.md']]
    parser, links = MarkdownIt('commonmark'), Counter()
    folders = {'docs': ROOT, 'main': ROOT, **{branch: DEV / ('copypaste-' + component) for branch, component in BRANCHES.items()}}
    for file in readmes:
        text = file.read_text(encoding='utf-8-sig'); assert len(text) > 2500 and '```mermaid' in text and '\ufffd' not in text
        assert re.search(r'[\u4e00-\u9fff]', text) if file.name == 'README.md' else len(re.findall(r'[A-Za-z]{3,}', text)) > 200
        if file.parent in [ROOT / 'docs', DEV / 'copypaste-platform', DEV / 'copypaste-web', DEV / 'copypaste-desktop', DELIVERY]:
            for value in ['editable-design-stage92', 'Ninety-three' if file.name.endswith('.en.md') else '93', 'SQL106', 'SQL107', 'editable-design-review.gif', 'editable-design-work.mp4', 'PowerPoint', 'CopyPaste Sans TC']: assert value in text, (file, value)
        repo = ROOT if file.parent == ROOT / 'docs' else file.parent
        for target in targets(parser.parse(text)):
            parsed = urlsplit(target)
            if parsed.netloc == 'github.com' and parsed.path.startswith('/copypasteltd/workmate/'):
                parts = unquote(parsed.path).split('/')
                if len(parts) > 5 and parts[3] in ['blob', 'tree'] and parts[4] in folders:
                    assert folders[parts[4]].joinpath(*parts[5:]).exists(), (file, target)
                    links['mapped_github_targets_resolved_locally'] += 1
            elif not parsed.scheme and not parsed.netloc and parsed.path:
                target_file = (file.parent / unquote(parsed.path)).resolve()
                assert target_file.is_relative_to(repo) and target_file.exists(), (file, target)
                links['independent_repository_local_targets'] += 1
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint), 'source_files_checked': len(cp['source_files']),
        'bilingual_readmes': len(readmes), 'readmes': [ref(file) for file in readmes], 'documentation_refresh': ref(refresh_file), 'media_review': ref(media_file),
        'screenshots': 16, 'decoded_recordings': 2, 'decoded_files': 4, 'original_requirement_records_unchanged': 102, 'original_migrations_preserved': 105,
        'historical_contracts_preserved': 532, 'old_skill_packages_preserved': 37, 'links': dict(links),
        'failed_ui_attempts_retained': [1, 3, 4, 5], 'superseded_font_appearance': ['editable-design-core-01', 'editable-design-ui-01'], 'full_product_acceptance': 'not_proven', 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'sources': len(cp['source_files']), 'readmes': len(readmes), 'links': sum(links.values())}))


if __name__ == '__main__': main()
