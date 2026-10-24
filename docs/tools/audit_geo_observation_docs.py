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
OUTPUT = ROOT / 'docs/quality/geo-observation-docs-audit-01.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not OUTPUT.exists()
    checkpoint_file = ROOT / 'docs/quality/geo-observation-checkpoint.json'
    checkpoint = read(checkpoint_file)
    assert checkpoint['status'] == 'verified_reproducible_geo_observation_subflow'
    assert checkpoint['verifier_sha256'] == digest(ROOT / 'docs/tools/record_geo_observations.py')
    for name, value in checkpoint['source_files'].items():
        assert digest(ROOT / name) == value, name
    for name in ['media_review', 'visual_review', 'route_inventory', 'complete_route_inventory', 'route_inventory_repair', 'migration_expectation_review', 'native_encoding_review']:
        item = checkpoint[name]
        assert digest(ROOT / item['path']) == item['sha256'], name
    review = read(ROOT / checkpoint['migration_expectation_review']['path'])
    replacements = {'migrations.test.ts': (b'\n      99,', b'\n      100,', 2),
        'creative-feedback.test.ts': (b'await runMigrations(client, "098 to confirmed creative feedback");', b'await runMigrations(client, "098 to confirmed creative feedback", { throughVersion: 99 });', 1)}
    assert review['status'] == 'verified_test_fixture_updates_only' and review['literal_changes'] == 3
    assert len(review['test_updates']) == len(replacements)
    for item in review['test_updates']:
        before_migration_test = (ROOT / item['before']['archive']).read_bytes()
        assert digest(ROOT / item['before']['archive']) == item['before']['sha256']
        old_literal, new_literal, count = replacements[Path(item['test_file']).name]
        assert before_migration_test.count(old_literal) == count
        assert (ROOT / item['test_file']).read_bytes() == before_migration_test.replace(old_literal, new_literal)
    assert review['product_source_changes'] == review['removed_or_weakened_assertions'] == 0
    assert digest(ROOT / 'docs/tools/repair_geo_migration_expectations.py') == review['verifier_sha256']
    assert digest(ROOT / review['failed_batch']['path']) == review['failed_batch']['sha256']
    assert all(v['current_runtime_source_exact'] for v in checkpoint['qualification_scopes'])
    assert next(v for v in checkpoint['qualification_scopes'] if v['scope'] == 'platform')['current_source_exact']
    encoding = read(ROOT / checkpoint['native_encoding_review']['path'])
    assert encoding['status'] == 'verified_encoding_wait_only'
    assert encoding['product_source_changes'] == encoding['functional_assertions_removed_or_changed'] == encoding['recording_assertions_removed_or_changed'] == 0
    before = (ROOT / encoding['failed_source_archive']['archive']).read_bytes()
    route_receipt = read(ROOT / 'docs/quality/history/stage83-geo-desktop-attempt-46/receipt.json')
    route_source = next(v for v in route_receipt['files'] if v['source'] == 'copypaste-delivery/scripts/qa-desktop-local.ts')
    after = (ROOT / route_source['archive']).read_bytes()
    assert sha256(before).hexdigest() == encoding['failed_source_archive']['sha256']
    assert sha256(after).hexdigest() == encoding['current_verifier_sha256']
    assert before.replace(b'phase("finish actual recording and encode", () => finishingRecording.stop(), 60000)', b'phase("finish actual recording and encode", () => finishingRecording.stop(), 180000)') == after
    current = (DEV / 'copypaste-delivery/scripts/qa-desktop-local.ts').read_bytes()
    anchor = b'  creativeFeedbackMedia = await exerciseCreativeFeedback('
    restored = b'  await page.evaluate(() => { location.hash = "/app/local"; });\r\n  await page.getByRole("heading", { name: "Your local workmate", exact: true }).waitFor();\r\n'
    assert after.count(anchor) == 1 and after.replace(anchor, restored + anchor) == current
    manifest_file = ROOT / 'docs/quality/geo-observation-documentation-refresh.json'
    manifest = read(manifest_file)
    assert manifest['readmes'] == 14 and manifest['verifier_sha256'] == digest(ROOT / 'docs/tools/sync_geo_observation_docs.py')
    for item in manifest['files']:
        assert digest(ROOT / item['archive']) == item['before_sha256'], item['archive']
        assert digest(ROOT / item['path']) == item['after_sha256'], item['path']
    before = read(ROOT / 'docs/quality/history/before-stage83-docs/docs/quality/requirements-alignment-progress.json')
    after = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert len(before['requirements']) == len(after['requirements']) == 102
    for old, new in zip(before['requirements'], after['requirements'], strict=True):
        for name in ['requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'acceptance_case_execution', 'assessment']:
            assert old[name] == new[name], (old['requirement_id'], name)
    assert before['gates'] == after['gates'] and before['nfr_full_acceptance'] == after['nfr_full_acceptance']
    assert after['summary'] == {'partial_verified': 83, 'completion_not_proven': 19} and after['fully_accepted_requirements'] == 0
    plan = ROOT / 'docs/quality/01-test-and-acceptance-plan.md'
    assert plan.read_bytes().startswith((ROOT / 'docs/quality/history/before-stage83-docs' / plan.relative_to(ROOT)).read_bytes())
    media_hashes = {item['sha256'] for item in checkpoint['documentation_media']}
    for item in checkpoint['documentation_media']:
        assert digest(DEV / item['source']) == digest(ROOT / item['path']) == item['sha256']
    media_review_file = ROOT / 'docs/quality/geo-observation-media-review.json'
    media_review = read(media_review_file)
    assert media_review['status'] == 'passed' and media_review['raw_media_modified'] is False
    assert media_review['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_geo_observation_media.py')
    assert len(media_review['recordings']) == 4 and all(row['capture_errors'] == 0 for row in media_review['recordings'])
    visual_file = ROOT / 'docs/quality/geo-observation-visual-review.md'
    visual_links = 0
    for target in re.findall(r'\[[^\]]*\]\(([^)\n]+\.png)\)', visual_file.read_text(encoding='utf-8')):
        file = (visual_file.parent / target).resolve()
        assert file.is_relative_to(ROOT / 'docs/design/implementation') and digest(file) in media_hashes
        visual_links += 1
    assert visual_links >= 4
    links = current_media = 0
    for branch, repo in MAP.items():
        for name in ['README.md', 'README.en.md']:
            file = (repo / 'docs' if branch == 'docs' else repo) / name
            text = file.read_text(encoding='utf-8')
            assert len(text) > 2500 and '\ufffd' not in text and text.count('<!-- geo-observation-stage83 -->') == 1
            top = text.split('<details>', 1)[0]
            assert all(value in top for value in ['SQL100', 'Codex', '83', '19', '102', str(checkpoint['platform_tests']['tests'])])
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
    assert current_media == 56
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'bilingual_readmes': 14,
        'readme_links_checked': links, 'current_media_links_checked': current_media, 'visual_review_links_checked': visual_links,
        'archived_document_files': len(manifest['files']), 'original_requirement_records_unchanged': 102,
        'original_acceptance_case_definitions_unchanged': True, 'original_nfr_and_gate_records_unchanged': True,
        'performance_and_capacity_acceptance': 'not_proven',
        'source_bindings_checked': len(checkpoint['source_files']),
        'checkpoint': {'path': checkpoint_file.relative_to(ROOT).as_posix(), 'sha256': digest(checkpoint_file)},
        'documentation_refresh': {'path': manifest_file.relative_to(ROOT).as_posix(), 'sha256': digest(manifest_file)},
        'visual_review': {'path': visual_file.relative_to(ROOT).as_posix(), 'sha256': digest(visual_file)},
        'media_review': {'path': media_review_file.relative_to(ROOT).as_posix(), 'sha256': digest(media_review_file)},
        'scope': 'Bounded reproducible GEO and native-layout workflow; original complete product acceptance remains open.',
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: report[key] for key in ['status', 'bilingual_readmes', 'readme_links_checked', 'current_media_links_checked']}))


if __name__ == '__main__':
    main()
