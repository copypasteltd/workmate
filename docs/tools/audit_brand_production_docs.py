"""Verify current bilingual documentation, archived definitions and actual media."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import unquote

from audit_workmate_publication import BASE, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
OUTPUT = ROOT / 'docs/quality/brand-production-docs-audit-01.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not OUTPUT.exists(), 'Never replace previous audit evidence'
    checkpoint_path = ROOT / 'docs/quality/brand-production-checkpoint.json'
    checkpoint = read(checkpoint_path)
    assert checkpoint['status'] == 'verified_fixed_brand_production_subflow'
    assert checkpoint['platform_tests']['pass'] == 874
    assert digest(ROOT / 'docs/tools/record_brand_production.py') == checkpoint['verifier_sha256']
    for name, checksum in checkpoint['source_files'].items():
        assert digest(DEV / name) == checksum, name
    for item in checkpoint['documentation_media']:
        assert digest(DEV / item['source']) == digest(ROOT / item['path']) == item['sha256']
    manifest_path = ROOT / 'docs/quality/brand-production-documentation-refresh.json'
    manifest = read(manifest_path)
    assert manifest['readmes'] == 14 and len(manifest['files']) == 39
    for item in manifest['files']:
        assert digest(ROOT / item['archive']) == item['before_sha256'], item['archive']
        assert digest(ROOT / item['path']) == item['after_sha256'], item['path']
    archive = ROOT / 'docs/quality/history/before-stage79-docs'
    before = read(archive / 'docs/quality/requirements-alignment-progress.json')
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(before['requirements']) == len(progress['requirements']) == 102
    for previous, current in zip(before['requirements'], progress['requirements'], strict=True):
        for field in ['requirement_id', 'requirement', 'acceptance_case', 'acceptance_conditions', 'acceptance_case_execution']:
            assert previous[field] == current[field], (previous['requirement_id'], field)
    assert progress['summary'] == {'partial_verified': 82, 'completion_not_proven': 20}
    assert progress['fully_accepted_requirements'] == 0
    assert all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
    test_plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    assert test_plan.read_text(encoding='utf-8').startswith((archive / test_plan.relative_to(ROOT)).read_text(encoding='utf-8'))
    links = 0
    current_media_links = 0
    media_hashes = {item['sha256'] for item in checkpoint['documentation_media']}
    for branch, repo in MAP.items():
        base = repo / 'docs' if branch == 'docs' else repo
        for name in ['README.md', 'README.en.md']:
            file = base / name
            text = file.read_text(encoding='utf-8')
            assert len(text) > 2500 and '\ufffd' not in text
            assert text.count('<!-- brand-production-stage79 -->') == 1
            current = text.split('<details>', 1)[0]
            assert '874' in current and 'Codex' in current
            assert '82' in current and '20' in current
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
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'bilingual_readmes': 14, 'readme_links_checked': links, 'current_media_links_checked': current_media_links,
        'archived_document_files': 39, 'original_requirement_records_unchanged': 102,
        'source_bindings_checked': len(checkpoint['source_files']),
        'checkpoint': {'path': checkpoint_path.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_path)},
        'documentation_refresh': {'path': manifest_path.relative_to(ROOT).as_posix(), 'sha256': digest(manifest_path)},
        'scope': 'Current documentation bytes, actual unchanged screenshots/recordings, local and cross-branch README targets, all original acceptance definitions and unclosed gates. Not full product or production acceptance.',
        'verifier_sha256': digest(Path(__file__)),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: result[key] for key in ['status', 'bilingual_readmes', 'readme_links_checked', 'current_media_links_checked', 'original_requirement_records_unchanged']}))


if __name__ == '__main__':
    main()
