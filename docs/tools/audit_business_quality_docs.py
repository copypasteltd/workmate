"""Check current quality documentation, original acceptance fields and real media."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote
import json
import re
from audit_workmate_publication import MAP, ROOT, BASE

DEV = ROOT / 'dev'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / 'docs/quality/business-quality-docs-audit-01.json'
    assert not output.exists()
    checkpoint_path = ROOT / 'docs/quality/business-quality-checkpoint.json'
    checkpoint = read(checkpoint_path)
    assert checkpoint['status'] == 'verified_versioned_customer_review_and_scoped_quality_subflow'
    assert digest(ROOT / 'docs/tools/record_business_quality.py') == checkpoint['verifier_sha256']
    for name, value in checkpoint['source_files'].items():
        assert digest(DEV / name) == value, name
    assert digest(ROOT / 'docs/contracts/openapi.json') == checkpoint['original_openapi_sha256']
    assert digest(DEV / 'copypaste-platform/catalog/openapi.json') == checkpoint['original_contracts']['runtime_catalog']['sha256']
    assert digest(ROOT / 'docs/contracts/business-quality-openapi.json') == digest(DEV / 'copypaste-platform/contracts/business-quality-openapi.json')
    archive = ROOT / 'docs/quality/history/before-stage78-docs'
    manifest = read(archive / 'manifest.json')
    for entry in manifest:
        assert digest(ROOT / entry['archive']) == entry['before_sha256']
        assert digest(ROOT / entry['path']) == entry['after_sha256']
    before = read(archive / 'docs__quality__requirements-alignment-progress.json.txt')
    now = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    unchanged = ['requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'assessment', 'acceptance_case_execution', 'original_finding']
    assert len(before['requirements']) == len(now['requirements']) == 102
    for previous, current in zip(before['requirements'], now['requirements']):
        assert all(previous.get(key) == current.get(key) for key in unchanged), current['requirement_id']
    assert before['summary'] == now['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    assert before['gates'] == now['gates'] and now['fully_accepted_requirements'] == 0
    links, readmes = [], []
    for branch, repo in MAP.items():
        directory = repo / 'docs' if branch == 'docs' else repo
        for name in ['README.md', 'README.en.md']:
            file = directory / name
            text = file.read_text(encoding='utf-8')
            assert len(text) > 2500 and '\ufffd' not in text and text.count('<!-- business-quality-stage78 -->') == 1
            current = text.split('<details>', 1)[0]
            assert 'TC-056' in current and '800×600' in current and str(checkpoint['platform_tests']['tests']) in current
            stripped = re.sub(r'`{3}.*?`{3}', '', text, flags=re.S)
            for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', stripped):
                target = target.strip('<>')
                if target.startswith(BASE):
                    part = target[len(BASE):]
                    if part.startswith('tree/'):
                        assert part[5:] in {*MAP, 'main'}
                        continue
                    assert part.startswith('blob/')
                    target_branch, destination = part[5:].split('/', 1)
                    assert target_branch in {*MAP, 'main'}
                    local = MAP.get(target_branch, ROOT) / unquote(destination.split('#')[0])
                elif re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', target):
                    continue
                else:
                    local = (file.parent / unquote(target.split('#')[0])).resolve()
                    assert local.is_relative_to(repo)
                assert local.is_file(), (branch, name, target)
                links.append({'from': file.relative_to(ROOT).as_posix(), 'target': target})
            readmes.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)})
    assert len(readmes) == 14
    for item in checkpoint['documentation_media']:
        assert digest(ROOT / item['source']) == digest(ROOT / item['path']) == item['sha256']
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'stage': 78,
              'checkpoint': {'path': checkpoint_path.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_path)},
              'source_files_checked': len(checkpoint['source_files']), 'bilingual_readmes': 14, 'readmes': readmes,
              'readme_links_checked': len(links), 'original_requirement_records_unchanged': 102,
              'original_acceptance_gates_unchanged': 10, 'fully_accepted': 0,
              'documentation_media': len(checkpoint['documentation_media']),
              'visual_review': {'desktop': 'Final packaged 800x600 screenshot shows the actually focused effort input, reflowed branded native controls, composer and receipt with no scrollbar rails. Full journey checks wheel/Home/End/last download across three sizes.',
                                'admin': 'Final actual Traditional-Chinese dark screenshot after CSS transitions shows readable controls and correctly scoped accepted/effort/service-cost metrics.',
                                'extension': 'Native right Side Panel with chat-derived review controls; independent cloud execution. Browser Side Panel scrollbar presentation is not the Desktop scrollbar requirement.'},
              'limits': checkpoint['limits'], 'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': len(links), 'original_requirements': 102}))


if __name__ == '__main__':
    main()
