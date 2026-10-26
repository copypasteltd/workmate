"""Bind profile-specific customer capability states to actual regression evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
from markdown_it import MarkdownIt
from urllib.parse import unquote, urlsplit
from record_platform_integration import ROOT, DEV, QUALITY, DELIVERY, COMPONENTS, read, digest, ref, write, git, checked_report

CP = QUALITY / 'capability-inventory-checkpoint.json'
BASE = QUALITY / 'platform-integration-checkpoint.json'
PRODUCTION = 'dev/copypaste-platform/src/capability-releases.ts'
TEST = 'dev/copypaste-platform/tests/capability-inventory.test.ts'
RUNNER = 'dev/copypaste-delivery/scripts/run-capability-inventory.mjs'
DESIGN = '107-profile-specific-capability-inventory.md'
SCOPE = 'Customer capability inventory matches each implemented protocol and its own verification flag; signed pagination expires when the resolved state changes. Actual scoped Fastify routes through injection, native Codex publication regression and immutable task binding; synthetic accounts/models. No new UI or live quality acceptance.'


def record(negative, positive):
    baseline = read(BASE)
    assert baseline['status'] == 'verified_platform_integration'
    old_path = DELIVERY / f'evidence/capability-inventory-inventory-{negative}.json'
    new_path = DELIVERY / f'evidence/capability-inventory-core-{positive}.json'
    old, new = checked_report(old_path), checked_report(new_path)
    assert old['status'] == 'failed' and old['source_unchanged'] and old['owned_database_shutdown']
    assert old['counts']['tests'] == 4 and old['counts']['fail'] == 3 and old['counts']['pass'] == 1
    assert new['status'] == 'passed' and new['source_unchanged'] and new['owned_database_shutdown']
    assert new['counts']['tests'] == new['counts']['pass'] > 4
    assert all(new['counts'][k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    assert set(new['test_files']) == {'tests/capability-inventory.test.ts', 'tests/capability-releases.test.ts', 'tests/capability-bindings.test.ts'}
    assert new['native_codex']['explicit_bin_and_test_bin'] and not new['native_codex']['path_fallback']
    sources = {**baseline['source_files'], **{'dev/' + n: h for n, h in new['source_files'].items()}}
    changed = sorted(n for n in baseline['source_files'] if baseline['source_files'][n] != sources[n])
    assert changed == [PRODUCTION], changed
    assert sorted(set(sources) - set(baseline['source_files'])) == [TEST]
    assert old['source_files'][PRODUCTION.removeprefix('dev/')] == baseline['source_files'][PRODUCTION]
    assert old['source_files'][TEST.removeprefix('dev/')] == new['source_files'][TEST.removeprefix('dev/')]
    frozen = DELIVERY / f'evidence/capability-inventory-core-{positive}-verifier.mjs'
    assert frozen.read_bytes() == (ROOT / RUNNER).read_bytes()
    sources[RUNNER] = digest(frozen)
    for name, expected in sources.items(): assert digest(ROOT / name) == expected, name
    attempts = []
    for path in sorted((DELIVERY / 'evidence').glob('capability-inventory-*-??.json')):
        value = checked_report(path)
        assert value['source_unchanged'] and value['owned_database_shutdown']
        attempts.append({**ref(path), 'status': value['status']})
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    original = read(QUALITY / 'history/stage96-before-solution-packages/receipt.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 107, 'status': 'verified_capability_inventory',
        'scope': SCOPE, 'source_files': dict(sorted(sources.items())), 'production_changes': changed,
        'selected_negative': ref(old_path), 'selected_positive': ref(new_path), 'tests': new['counts']['tests'],
        'test_files': new['test_files'], 'attempts': attempts, 'retained_stage106': ref(BASE),
        'retained_full_tests': baseline['backend_tests'], 'retained_full_counts': baseline['full_counts'], 'retained_continuation_counts': baseline['continuation_counts'], 'full_regression_rerun': False,
        'screenshots': baseline['screenshots'], 'recordings': baseline['recordings'],
        'media_scope': 'Retained actual Stage106 media with original source/time; not a new UI recording.',
        'new_migrations': [], 'new_routes': [], 'not_validated': ['new_UI_acceptance', 'live_model_quality', 'complete_product_acceptance'],
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_capability_inventory', 'tests': new['counts']['tests'], 'sources': len(sources)}))


def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    archive = QUALITY / 'history/stage107-documents'
    archive.mkdir()
    changes = []
    def change(path, body):
        component = next((c for c in COMPONENTS if path.is_relative_to(DEV / ('copypaste-' + c))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = path.relative_to(repo).as_posix()
        before = git(repo, 'show', 'HEAD:' + name)
        assert path.read_bytes().replace(b'\r\n', b'\n') == before.replace(b'\r\n', b'\n')
        saved = archive / (component or 'docs') / name
        saved.parent.mkdir(parents=True, exist_ok=True); saved.write_bytes(before)
        path.write_bytes(body)
        changes.append({'path': path.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(path)})
    description = {}
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            en = name.endswith('.en.md')
            design = 'technical/' + DESIGN if folder == ROOT / 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/' + DESIGN
            text = '<!-- capability-inventory-stage107 -->\n\n'
            text += ('Video, speech and transcription now use their exact implemented protocols and independent verification flags in the customer capability inventory. Changed availability expires the signed page cursor. Revoked versions, mismatched protocols, tenant scope and task execution authorization remain checked.\n\n' if en else '用户能力目录现按视频、配音、转写各自的已实现协议和核验标志显示状态；状态变化使旧签名分页失效。撤销版本、协议匹配、租户范围与任务执行授权继续逐项校验。\n\n')
            text += (f'The repaired capability suites passed {cp["tests"]} actual checks. The original failing reproduction is retained. The Stage106 complete backend attempt and its unchanged-source runtime replay are retained, including one unattributed timeout in the full attempt. This increment reruns the affected capability suites. Models/accounts remain synthetic, with no live professional-quality claim.\n\n' if en else f'相关能力回归通过 {cp["tests"]} 项实际检查，保留修复前的失败复现。保留阶段 106 的完整后端批次及原文件恢复复查，包括整批中的一项未归因超时；本轮重跑受影响的能力相关检查。模型和账号仍是假数据，不据此宣称真实模型业务质量。\n\n')
            text += ('Reproduce in Delivery: `node scripts/run-capability-inventory.mjs <new-two-digit-attempt> core`. The customer API correction adds no page. Screenshots and GIF/MP4 below retain their actual Stage106 recording and source scope.\n\n' if en else '在 Delivery 重现：`node scripts/run-capability-inventory.mjs <新的两位编号> core`。本轮 API 修复不新增页面；下方截图及 GIF／MP4 保留阶段 106 实际录制及其源码范围。\n\n')
            description[en] = text
            text += f'[Design / 方案]({design})\n\n'
            path = folder / name; title, body = path.read_bytes().split(b'\n', 1)
            change(path, title + b'\n\n' + text.encode() + body)
    note = f'\n\n**阶段 107 / Stage 107：** 用户能力目录按各协议独立判定视频／音频状态，状态变化使旧分页失效；相关 {cp["tests"]} 项实际检查通过。阶段 106 的完整基线及实际页面录制继续保留。见[方案与证据](../technical/{DESIGN})。\n\n'
    for name in ['modules/04-marketing-production.md', 'quality/01-test-and-acceptance-plan.md', 'governance/04-git-branches-and-publication.md']:
        path = ROOT / 'docs' / name
        title, body = path.read_bytes().split(b'\n', 1); change(path, title + b'\n' + note.encode() + body)
    path = QUALITY / 'requirements-alignment-progress.json'; progress = read(path)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['capability_inventory'] = {'checkpoint': ref(CP), 'tests': cp['tests'], 'full_acceptance': 'not_proven'}
    change(path, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode())
    for en in [False, True]:
        path = ROOT / ('docs/changes/2026-10-27-capability-inventory' + ('.en' if en else '') + '.md')
        assert not path.exists()
        path.write_text(('# Profile-specific capability inventory\n\n' if en else '# 视频与音频能力目录状态\n\n') + description[en] + f'[Design / 方案](../technical/{DESIGN}) · [Evidence / 证据](../quality/capability-inventory-checkpoint.json)\n', encoding='utf-8', newline='\n')
    write(QUALITY / 'capability-inventory-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_scope': cp['media_scope'], 'verifier_sha256': digest(Path(__file__))})


def audit():
    cp = read(CP); refresh = read(QUALITY / 'capability-inventory-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256'] and digest(ROOT / row['archive']) == row['before_sha256']
    baseline = read(BASE)
    assert ref(BASE) == cp['retained_stage106'] and read(QUALITY / 'platform-integration-docs-audit-01.json')['status'] == 'passed'
    for row in baseline['screenshots'] + [f for m in baseline['recordings'] for f in m['files']]: assert digest(DEV / row['path']) == row['sha256']
    parser, links = MarkdownIt(), 0
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            path = folder / name; body = path.read_text(encoding='utf-8')
            assert '<!-- capability-inventory-stage107 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):
                        assert (path.parent / unquote(urlsplit(value).path)).exists(), (path, value)
                        links += 1
    write(QUALITY / 'capability-inventory-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'retained_media_rehashed': 25, 'new_media': 0, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'retained_media': 25}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--negative', default='01'); parser.add_argument('--positive', default='01')
    args = parser.parse_args()
    {'record': lambda: record(args.negative, args.positive), 'sync': sync, 'audit': audit}[args.action]()
