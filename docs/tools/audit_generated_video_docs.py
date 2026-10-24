"""Check current docs, complete original definitions and actual linked media."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import unquote

from audit_workmate_publication import BASE, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
OUTPUT = ROOT / 'docs/quality/generated-video-docs-audit-01.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not OUTPUT.exists()
    checkpoint_file = ROOT / 'docs/quality/generated-video-checkpoint.json'
    checkpoint = read(checkpoint_file)
    assert checkpoint['status'] == 'verified_generated_video_subflow'
    assert digest(ROOT / 'docs/tools/record_generated_video.py') == checkpoint['verifier_sha256']
    for name, value in checkpoint['source_files'].items():
        assert digest(DEV / name) == value, name
    for item in checkpoint['documentation_media']:
        assert digest(DEV / item['source']) == digest(ROOT / item['path']) == item['sha256']
    manifest_file = ROOT / 'docs/quality/generated-video-documentation-refresh.json'
    manifest = read(manifest_file)
    assert manifest['readmes'] == 14 and len(manifest['files']) == 40
    assert manifest['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_generated_video_docs.py')
    for item in manifest['files']:
        assert digest(ROOT / item['archive']) == item['before_sha256'], item['archive']
        assert digest(ROOT / item['path']) == item['after_sha256'], item['path']
    archive = ROOT / 'docs/quality/history/before-stage80-docs'
    before = read(archive / 'docs/quality/requirements-alignment-progress.json')
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(before['requirements']) == len(progress['requirements']) == 102
    for old, new in zip(before['requirements'], progress['requirements'], strict=True):
        for field in ['requirement_id', 'requirement', 'acceptance_case', 'acceptance_conditions', 'acceptance_case_execution']:
            assert old[field] == new[field], (old['requirement_id'], field)
    assert progress['summary'] == {'partial_verified': 83, 'completion_not_proven': 19}
    assert progress['fully_accepted_requirements'] == 0 and progress['nfr_full_acceptance'] == before['nfr_full_acceptance']
    assert all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
    test_plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    assert test_plan.read_bytes().startswith((archive / test_plan.relative_to(ROOT)).read_bytes())
    links = current_media_links = 0
    media_hashes = {item['sha256'] for item in checkpoint['documentation_media']}
    visual = checkpoint['visual_review_record']
    visual_file = ROOT / visual['path']
    assert digest(visual_file) == visual['sha256']
    visual_links = 0
    for target in re.findall(r'\[[^\]]*\]\(([^)\n]+\.png)\)', visual_file.read_text(encoding='utf-8')):
        image = (visual_file.parent / target).resolve()
        assert image.is_relative_to(ROOT / 'docs/design/implementation')
        assert digest(image) in media_hashes
        visual_links += 1
    assert visual_links == 6
    refreshed = checkpoint['migration_test_inventory_refresh']
    assert digest(ROOT / refreshed['path']) == refreshed['sha256']
    refreshed_skills = checkpoint['skill_test_inventory_refresh']
    assert digest(ROOT / refreshed_skills['path']) == refreshed_skills['sha256']
    requalification = checkpoint['reviewed_platform_requalification']
    assert digest(ROOT / requalification['path']) == requalification['sha256']
    assert read(ROOT / requalification['path'])['failed_attempt_counted_as_passed'] is False
    normalization = checkpoint['recording_normalization']
    assert digest(ROOT / normalization['path']) == normalization['sha256']
    assert read(ROOT / normalization['path'])['raw_evidence_modified'] is False
    for branch, repo in MAP.items():
        for name in ['README.md', 'README.en.md']:
            file = (repo / 'docs' if branch == 'docs' else repo) / name
            text = file.read_text(encoding='utf-8')
            assert len(text) > 2500 and '\ufffd' not in text
            assert text.count('<!-- generated-video-stage80 -->') == 1
            current = text.split('<details>', 1)[0]
            assert str(checkpoint['platform_tests']['pass']) in current and 'Codex' in current
            assert all(value in current for value in ['83', '19', '102', 'SQL097'])
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', re.sub(r'`{3}.*?`{3}', '', text, flags=re.S)):
                target = target.strip('<>')
                if target.startswith(BASE):
                    part = target[len(BASE):]
                    if part.startswith('tree/'):
                        assert part[5:] in {*MAP, 'main'}
                        continue
                    assert part.startswith('blob/'), target
                    target_branch, destination = part[5:].split('/', 1)
                    assert target_branch in {*MAP, 'main'}
                    local = MAP.get(target_branch, ROOT) / unquote(destination.split('#')[0])
                elif re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
                    continue
                else:
                    local = (file.parent / unquote(target.split('#')[0])).resolve()
                    assert local.is_relative_to(repo), target
                assert local.is_file(), (branch, name, target)
                links += 1
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', current):
                if target.endswith(('.png', '.gif', '.mp4')):
                    assert digest((file.parent / target).resolve()) in media_hashes
                    current_media_links += 1
    assert current_media_links == 42
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'bilingual_readmes': 14,
              'readme_links_checked': links, 'current_media_links_checked': current_media_links,
              'visual_review_links_checked': visual_links, 'migration_test_inventory_refresh_checked': True,
              'archived_document_files': len(manifest['files']), 'original_requirement_records_unchanged': 102,
              'source_bindings_checked': len(checkpoint['source_files']),
              'checkpoint': {'path': checkpoint_file.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_file)},
              'documentation_refresh': {'path': manifest_file.relative_to(ROOT).as_posix(), 'sha256': digest(manifest_file)},
              'scope': 'Current bilingual usage, actual captures, complete original acceptance definitions, NFR and unclosed gates; not complete product or production acceptance.',
              'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: result[key] for key in ['status', 'bilingual_readmes', 'readme_links_checked', 'current_media_links_checked']}))


if __name__ == '__main__':
    main()
