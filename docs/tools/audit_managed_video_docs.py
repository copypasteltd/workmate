"""Audit current bilingual docs, raw archives and unchanged original acceptance."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import unquote

from audit_workmate_publication import BASE, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
OUTPUT = ROOT / 'docs/quality/managed-video-docs-audit-01.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not OUTPUT.exists()
    checkpoint_file = ROOT / 'docs/quality/managed-video-checkpoint.json'
    checkpoint = read(checkpoint_file)
    assert checkpoint['status'] == 'verified_managed_video_subflow'
    assert checkpoint['verifier_sha256'] == digest(ROOT / 'docs/tools/record_managed_video.py')
    for name, value in checkpoint['source_files'].items():
        assert digest(ROOT / name) == value, name
    for name in ['upgrade_review', 'harness_repair_review', 'media_review', 'visual_review', 'route_inventory']:
        item = checkpoint[name]
        assert digest(ROOT / item['path']) == item['sha256'], name
    manifest_file = ROOT / 'docs/quality/managed-video-documentation-refresh.json'
    manifest = read(manifest_file)
    assert manifest['readmes'] == 14 and manifest['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_managed_video_docs.py')
    for item in manifest['files']:
        assert digest(ROOT / item['archive']) == item['before_sha256'], item['archive']
        assert digest(ROOT / item['path']) == item['after_sha256'], item['path']
    before = read(ROOT / 'docs/quality/history/before-stage81-docs/docs/quality/requirements-alignment-progress.json')
    after = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(before['requirements']) == len(after['requirements']) == 102
    for old, new in zip(before['requirements'], after['requirements'], strict=True):
        for name in ['requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'acceptance_case_execution', 'assessment']:
            assert old[name] == new[name], (old['requirement_id'], name)
    assert before['gates'] == after['gates'] and before['nfr_full_acceptance'] == after['nfr_full_acceptance']
    assert after['summary'] == {'partial_verified': 83, 'completion_not_proven': 19} and after['fully_accepted_requirements'] == 0
    plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    assert plan.read_bytes().startswith((ROOT / 'docs/quality/history/before-stage81-docs' / plan.relative_to(ROOT)).read_bytes())
    media_hashes = {item['sha256'] for item in checkpoint['documentation_media']}
    for item in checkpoint['documentation_media']:
        assert digest(DEV / item['source']) == digest(ROOT / item['path']) == item['sha256']
    media_review_file = ROOT / 'docs/quality/managed-video-media-review.json'
    media_review = read(media_review_file)
    assert media_review['status'] == 'passed' and media_review['raw_media_modified'] is False
    assert media_review['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_managed_video_media.py')
    assert len(media_review['recordings']) == 3 and all(row['capture_errors'] == 0 for row in media_review['recordings'])
    visual_file = ROOT / 'docs/quality/managed-video-visual-review.md'
    visual_links = 0
    for target in re.findall(r'\[[^\]]*\]\(([^)\n]+\.png)\)', visual_file.read_text(encoding='utf-8')):
        file = (visual_file.parent / target).resolve()
        assert file.is_relative_to(ROOT / 'docs/design/implementation') and digest(file) in media_hashes
        visual_links += 1
    assert visual_links == 6
    links = current_media = 0
    for branch, repo in MAP.items():
        for name in ['README.md', 'README.en.md']:
            file = (repo / 'docs' if branch == 'docs' else repo) / name
            text = file.read_text(encoding='utf-8')
            assert len(text) > 2500 and '\ufffd' not in text and text.count('<!-- managed-video-stage81 -->') == 1
            top = text.split('<details>', 1)[0]
            assert all(value in top for value in ['SQL098', 'Codex', '83', '19', '102', str(checkpoint['platform_tests']['tests'])])
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', re.sub(r'`{3}.*?`{3}', '', text, flags=re.S)):
                target = target.strip('<>')
                if target.startswith(BASE):
                    rest = target[len(BASE):]
                    if rest.startswith('tree/'):
                        assert rest[5:] in {*MAP, 'main'}
                        continue
                    assert rest.startswith('blob/'), target
                    target_branch, destination = rest[5:].split('/', 1)
                    assert target_branch in {*MAP, 'main'}
                    actual = MAP.get(target_branch, ROOT) / unquote(destination.split('#')[0])
                elif re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
                    continue
                else:
                    actual = (file.parent / unquote(target.split('#')[0])).resolve()
                    assert actual.is_relative_to(repo)
                assert actual.is_file(), (branch, name, target)
                links += 1
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', top):
                if target.endswith(('.png', '.gif', '.mp4')):
                    assert digest((file.parent / target).resolve()) in media_hashes
                    current_media += 1
    assert current_media == 42
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'bilingual_readmes': 14,
        'readme_links_checked': links, 'current_media_links_checked': current_media, 'visual_review_links_checked': visual_links,
        'archived_document_files': len(manifest['files']), 'original_requirement_records_unchanged': 102,
        'original_acceptance_case_definitions_unchanged': True, 'original_nfr_and_gate_records_unchanged': True,
        'source_bindings_checked': len(checkpoint['source_files']),
        'checkpoint': {'path': checkpoint_file.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_file)},
        'documentation_refresh': {'path': manifest_file.relative_to(ROOT).as_posix(), 'sha256': digest(manifest_file)},
        'visual_review': {'path': visual_file.relative_to(ROOT).as_posix(), 'sha256': digest(visual_file)},
        'media_review': {'path': media_review_file.relative_to(ROOT).as_posix(), 'sha256': digest(media_review_file)},
        'scope': 'Bounded managed-video workflow and current docs; original complete product acceptance remains open.',
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: report[key] for key in ['status', 'bilingual_readmes', 'readme_links_checked', 'current_media_links_checked']}))


if __name__ == '__main__':
    main()
