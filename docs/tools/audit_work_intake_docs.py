"""Read-only check of current Web evidence, original requirements and bilingual delivery."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref
from audit_folder_work_docs import FIELDS, BRANCHES, targets


def main():
    output = ROOT / 'docs/quality/work-intake-docs-audit-01.json'
    assert not output.exists()
    checkpoint_file = ROOT / 'docs/quality/work-intake-checkpoint.json'
    cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_web_intake_and_submission_recovery'
    assert cp['ui_checks'] == 14 and cp['client_unit_tests'] == 195
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    assert cp['verifier_sha256'] == digest(ROOT / 'docs/tools/record_work_intake.py')
    for row in cp['qualification_scopes']:
        report = DELIVERY / row['report']
        assert digest(report) == row['sha256'] and read(report)['status'] == 'passed'
    for row in cp['raw_evidence']: assert digest(ROOT / row['path']) == row['sha256']
    refresh_file = ROOT / 'docs/quality/work-intake-documentation-refresh.json'
    refresh = read(refresh_file)
    assert refresh['status'] == 'passed' and refresh['readmes'] == 6 and len(refresh['files']) == 11
    assert refresh['checkpoint']['sha256'] == digest(checkpoint_file)
    assert refresh['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_work_intake_docs.py')
    assert read(ROOT / 'docs/quality/history/stage89-current-documents/receipt.json') == refresh
    for row in refresh['files']:
        assert digest(ROOT / row['path']) == row['after_sha256'], row['path']
        assert digest(ROOT / row['archive']) == row['before_sha256'], row['archive']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for key, count in (('published_migrations', 103), ('published_contracts', 532)):
        assert len(baseline[key]) == count
        for name, expected in baseline[key].items(): assert digest(ROOT / name) == expected, name
    initial = ROOT / 'docs/quality/history/stage89-before-work-intake/receipt.json'
    for row in read(initial)['files']: assert digest(ROOT / row['archive']) == row['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert len(progress['requirements']) == 102 and progress['summary'] == {'partial_verified': 86, 'completion_not_proven': 16}
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == progress['summary']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    assert len(progress['gates']) == 10 and all(row['full_acceptance'] == 'not_proven' for row in progress['gates'])
    assert progress['current_source_qualification']['stage'] == 89
    for row in progress['requirements']:
        if row['requirement_id'] in ('REQ-003', 'REQ-007', 'REQ-009', 'REQ-035', 'REQ-046'):
            assert row['verified_repairs'][-1]['cluster'] == 'scoped_web_first_work_and_recovery'
            assert row['acceptance_case_execution'] == 'not_completed'
    for name in ('2026-10-25-goal-gap-summary.md', '2026-10-25-goal-gap-assessment.md'):
        text = (ROOT / 'docs/quality' / name).read_text(encoding='utf-8-sig')
        assert set(re.findall(r'^\| (GAP-\d{2}) \|', text, re.M)) == {f'GAP-{i:02}' for i in range(1, 27)}
        assert '评估更新：阶段 89。' in text and '十二' in text
    assessment = (ROOT / 'docs/quality/2026-10-25-goal-gap-assessment.md').read_text(encoding='utf-8-sig')
    assert set(re.findall(r'^\| (REQ-\d{3}) \|', assessment, re.M)) == {row['requirement_id'] for row in progress['requirements']}
    review_file = ROOT / 'docs/quality/work-intake-media-review-01.json'
    media = read(review_file)
    assert media['status'] == 'passed' and media['checkpoint']['sha256'] == digest(checkpoint_file)
    assert media['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_work_intake_media.py')
    expected = {row['path']: row['sha256'] for recording in cp['recordings'] for row in recording['files']}
    assert len(expected) == 4 and len(cp['screenshots']) == 12
    for recording in media['recordings']:
        for row in recording['files']:
            assert row['fully_decoded'] and row['decoded_frames'] > 1
            assert digest(DEV / row['path']) == row['sha256'] == expected[row['path']]
    for row in cp['screenshots']: assert digest(DEV / row['path']) == row['sha256']
    assert all(read(DELIVERY / f'evidence/work-intake-ui-{attempt:02}.json')['status'] == 'failed' for attempt in range(1, 5))
    # Stage88 native Desktop product bytes remain valid; its full cross-repo
    # source snapshot is deliberately not relabelled current after Web changes.
    retained = read(ROOT / 'docs/quality/local-programs-checkpoint.json')
    native = {name: expected for name, expected in retained['source_files'].items() if name.startswith('dev/copypaste-desktop/')}
    assert native and all(digest(ROOT / name) == expected for name, expected in native.items())
    readmes = [ROOT / 'docs' / name for name in ('README.md', 'README.en.md')]
    readmes += [DEV / ('copypaste-' + component) / name for component in BRANCHES.values() for name in ('README.md', 'README.en.md')]
    parser, links = MarkdownIt('commonmark'), Counter()
    for file in readmes:
        text = file.read_text(encoding='utf-8-sig')
        assert len(text) > 2500 and '```mermaid' in text
        assert re.search(r'[\u4e00-\u9fff]', text) if file.name == 'README.md' else len(re.findall(r'[A-Za-z]{3,}', text)) > 200
        if file.parent in (ROOT / 'docs', DEV / 'copypaste-web', DELIVERY):
            assert 'work-intake-stage89' in text and '195' in text and '14' in text
            assert 'first-work.gif' in text and 'submission-recovery.gif' in text
        repo = ROOT if file.parent == ROOT / 'docs' else file.parent
        for target in targets(parser.parse(text)):
            parsed = urlsplit(target)
            if parsed.netloc == 'github.com' and parsed.path.startswith('/copypasteltd/workmate/'):
                parts = unquote(parsed.path).split('/')
                if len(parts) > 5 and parts[3] in ('tree', 'blob') and parts[4] in BRANCHES:
                    destination = DEV / ('copypaste-' + BRANCHES[parts[4]]) / '/'.join(parts[5:])
                    assert destination.exists(), (str(file), target)
                    links['mapped_github_targets_resolved_locally'] += 1
                else: links['external_not_fetched'] += 1
            elif parsed.scheme or parsed.netloc: links['external_not_fetched'] += 1
            elif parsed.path:
                destination = (file.parent / unquote(parsed.path)).resolve()
                assert destination.is_relative_to(repo) and destination.exists(), (str(file), target)
                links['independent_repository_local_targets'] += 1
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint_file),
        'source_files_checked': len(cp['source_files']), 'bilingual_readmes': len(readmes), 'readmes': [ref(file) for file in readmes],
        'documentation_refresh': ref(refresh_file), 'refreshed_readmes': 6, 'refreshed_files_exact': len(refresh['files']),
        'original_requirement_records_unchanged': 102, 'migrations_byte_preserved': 103, 'contracts_byte_preserved': 532,
        'acceptance': {'partial': 86, 'completion_not_proven': 16, 'fully_accepted': 0, 'qualified_roles': 0},
        'media_review': ref(review_file), 'decoded_recordings': 2, 'decoded_files': 4, 'screenshots': 12,
        'visual_review': ref(ROOT / 'docs/design/implementation/work-intake-visual-review.md'),
        'failed_attempts_retained': [1, 2, 3, 4], 'retained_desktop_product_files': len(native),
        'links': dict(links), 'scope': 'Current bounded Web evidence and local mapped Markdown targets; historical native/full-platform suites are not rerun or relabelled current; external links and fragment anchors are not fetched.',
        'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'sources': len(cp['source_files']), 'readmes': len(readmes), 'refreshed_files': len(refresh['files']), 'links': sum(links.values())}))


if __name__ == '__main__': main()
