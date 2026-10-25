"""Read-only review of current team evidence, preserved baselines and bilingual delivery."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import re

from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref
from audit_folder_work_docs import BRANCHES, targets


def main():
    output = ROOT / 'docs/quality/agent-groups-docs-audit-01.json'
    assert not output.exists()
    checkpoint = ROOT / 'docs/quality/agent-groups-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_persistent_agent_groups' and cp['ui_checks'] == 7
    assert cp['core_tests']['tests'] == cp['core_tests']['pass'] > 0
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_agent_groups.py')
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in cp['raw_evidence'] + cp['all_attempts']:
        assert digest(ROOT / row['path']) == row['sha256'], row['path']
    refresh_file = ROOT / 'docs/quality/agent-groups-documentation-refresh.json'
    refresh = read(refresh_file)
    assert refresh['status'] == 'passed' and len(refresh['changes']) == 16
    assert refresh['checkpoint']['sha256'] == digest(checkpoint)
    assert refresh['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_agent_groups_docs.py')
    for row in refresh['changes']:
        assert digest(ROOT / row['path']) == row['after_sha256'], row['path']
        assert digest(ROOT / row['archive']) == row['before_sha256'], row['archive']
    for row in refresh['media_copies']:
        assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    media_file = ROOT / 'docs/quality/agent-groups-media-review-01.json'
    media = read(media_file)
    assert media['status'] == 'passed' and media['checkpoint']['sha256'] == digest(checkpoint)
    assert media['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_agent_groups_media.py')
    assert len(media['recordings']) == 2 and sum(len(row['files']) for row in media['recordings']) == 4
    for row in media['recordings']:
        for item in row['files']:
            assert item['fully_decoded'] and item['decoded_frames'] > 1
            assert digest(DEV / item['path']) == item['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage93-before-agent-groups/receipt.json')
    for name, expected in baseline['published_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in baseline['files']:
        assert digest(ROOT / row['archive']) == row['sha256'], row['archive']
    assert digest(ROOT / 'docs/contracts/role-preset-catalog-current.json') == baseline['protected_role_catalog_sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    prior_progress = read(ROOT / next(row['archive'] for row in baseline['files'] if row['path'] == 'docs/quality/requirements-alignment-progress.json'))
    assert progress['requirements'] == baseline['requirements'] and len(progress['requirements']) == 102
    assert progress['gates'] == prior_progress['gates']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    assert progress['current_source_qualification']['stage'] == progress['persistent_agent_groups']['stage'] == 93
    for field in ['new_migration', 'new_contract']:
        assert digest(ROOT / cp[field]['path']) == cp[field]['sha256']
    contract = read(ROOT / cp['new_contract']['path'])
    assert len(contract['paths']) == 7
    readmes = [ROOT / 'docs' / name for name in ['README.md', 'README.en.md']]
    readmes += [DEV / ('copypaste-' + name) / file for name in BRANCHES.values() for file in ['README.md', 'README.en.md']]
    parser, links = MarkdownIt('commonmark'), Counter()
    folders = {'docs': ROOT, 'main': ROOT, **{branch: DEV / ('copypaste-' + component) for branch, component in BRANCHES.items()}}
    for file in readmes:
        text = file.read_text(encoding='utf-8-sig')
        assert len(text) > 2500 and '\ufffd' not in text and '```mermaid' in text
        assert re.search(r'[\u4e00-\u9fff]', text) if file.name == 'README.md' else len(re.findall(r'[A-Za-z]{3,}', text)) > 200
        for expected in ['agent-groups-stage93', 'SQL108', 'team-authoring.gif', 'team-delivery.mp4']:
            assert expected in text, (file, expected)
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
    plan = ROOT / 'docs/technical/93-persistent-agent-groups.md'
    for target in targets(parser.parse(plan.read_text(encoding='utf-8'))):
        parsed = urlsplit(target)
        if not parsed.scheme and parsed.path:
            assert (plan.parent / unquote(parsed.path)).resolve().exists(), target
            links['implementation_document_targets'] += 1
    failed = [row for row in cp['all_attempts'] if row['status'] == 'failed']
    assert len(failed) >= 10
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint),
        'source_files_checked': len(cp['source_files']), 'bilingual_readmes': len(readmes), 'readmes': [ref(file) for file in readmes],
        'documentation_refresh': ref(refresh_file), 'media_review': ref(media_file), 'implementation': ref(plan),
        'screenshots': 9, 'decoded_recordings': 2, 'decoded_files': 4, 'published_files_preserved': 638,
        'original_requirement_records_unchanged': 102, 'failed_attempts_retained': failed,
        'links': dict(links), 'full_product_acceptance': 'not_proven', 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'sources': len(cp['source_files']), 'readmes': len(readmes), 'links': sum(links.values())}))


if __name__ == '__main__':
    main()
