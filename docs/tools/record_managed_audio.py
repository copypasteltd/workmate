"""Bind managed audio releases to frozen code, actual tests and browser evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import shutil
import subprocess
from markdown_it import MarkdownIt
from urllib.parse import unquote, urlsplit
from record_platform_integration import ROOT, DEV, QUALITY, DELIVERY, COMPONENTS, read, digest, ref, write, git, checked_report

CP = QUALITY / 'managed-audio-checkpoint.json'
BASE = QUALITY / 'capability-inventory-checkpoint.json'
DESIGN = '108-managed-audio-capabilities.md'
SCOPE = 'Immutable speech/transcription configurations, durable platform-funded native protocol verification, bounded grants, shared budgets/capacity, no original-POST replay, independent publication/rollback and frozen customer task prices. Actual Admin browser and background Worker; explicitly synthetic accounts/models and original protocol tones. No live voice, transcription or Cantonese qualification.'


def source_path(name):
    return name if name.startswith('docs/') else 'dev/' + name


def record(core, ui, build):
    baseline = read(BASE)
    assert baseline['status'] == 'verified_capability_inventory'
    core_path = DELIVERY / f'evidence/managed-audio-core-{core}.json'
    ui_path = DELIVERY / f'evidence/managed-audio-capability-ui-{ui}.json'
    backend, browser = checked_report(core_path), checked_report(ui_path)
    build_path = DELIVERY / f'evidence/managed-audio-build-{build}.json'
    packaged = checked_report(build_path)
    negative_path = DELIVERY / 'evidence/managed-audio-build-01.json'
    negative = checked_report(negative_path)
    assert packaged['status'] == 'passed' and packaged['source_unchanged'] and packaged['test_exit'] == 0
    assert negative['status'] == 'failed' and negative['source_unchanged'] and negative['test_exit'] == 1
    assert packaged['compiled'] == negative['compiled'], 'The compiled JS is unchanged; the correction bundles missing assets'
    assert 'ENOENT' in (DELIVERY / negative['raw_log']['path']).read_text(encoding='utf-8')
    assert packaged['result']['compiled_runtime'] and packaged['result']['unrelated_owned_cwd'] and not packaged['result']['source_ts_loader']
    assert len(packaged['result']['probes']) == 2 and all(p['fully_decoded'] for p in packaged['result']['probes'])
    build_name = 'copypaste-platform/scripts/copy-cloud-check-bootstrap.mjs'
    before_build = DELIVERY / f'evidence/managed-audio-core-{core}-sources' / build_name
    after_build = DEV / build_name
    addition = ('\n// Protocol references are runtime dependencies of the compiled audio verifier.\n'
        'const audio = path.join(root, "dist/assets/audio");\n'
        'await mkdir(audio, { recursive: true });\n'
        'for (const file of ["LICENSE.txt", "protocol-tone-v1.wav", "protocol-tone-v1.mp3"]) {\n'
        '  await copyFile(path.join(root, "assets/audio", file), path.join(audio, file));\n}\n').encode()
    assert after_build.read_bytes().replace(b'\r\n', b'\n') == before_build.read_bytes().replace(b'\r\n', b'\n') + addition
    assert negative['source_files'][build_name] == backend['source_files'][build_name] == digest(before_build)
    assert packaged['source_files'][build_name] == browser['source_files'][build_name] == digest(after_build)
    assert (DELIVERY / f'evidence/managed-audio-build-{build}-verifier.mjs').read_bytes() == (DELIVERY / 'scripts/probe-managed-audio-build.mjs').read_bytes()
    for value in [backend, browser]:
        assert value['status'] == 'passed' and value['source_unchanged'] and value['owned_database_shutdown']
    counts = backend['counts']
    assert counts['tests'] == counts['pass'] > 18 and all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    assert len(backend['test_files']) == 12
    assert backend['native_codex']['explicit_bin_and_test_bin'] and not backend['native_codex']['path_fallback']
    admin = backend['admin_unit']; assert admin['exit_code'] == 0
    assert admin['counts'] == {'tests': 6, 'pass': 6, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert digest(DELIVERY / admin['raw_report']['path']) == admin['raw_report']['sha256']
    assert browser['compiled_unchanged'] and browser['owned_preview_closed']
    journey_path = DELIVERY / f'evidence/managed-audio-capability-ui-{ui}-journey.json'
    journey = read(journey_path)
    assert journey == browser['journey'] and journey['status'] == 'passed' and len(journey['checks']) == 8
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed', 'provider_closed'])
    assert len(journey['screenshots']) == 10 and len(journey['media']) == 3
    sources = dict(baseline['source_files'])
    qualified = {}
    for report in [backend, browser, packaged]:
        for name, expected in report['source_files'].items():
            path = source_path(name)
            if path in qualified and qualified[path] != expected:
                assert name == build_name and qualified[path] == digest(before_build) and expected == digest(after_build), path
            qualified[path] = expected
    for name, frozen in [('scripts/run-managed-audio.mjs', f'evidence/managed-audio-core-{core}-verifier.mjs'),
                         ('scripts/run-managed-audio-capability-ui.mjs', f'evidence/managed-audio-capability-ui-{ui}-verifier.mjs'),
                         ('scripts/qa-managed-audio-capability-ui.ts', f'evidence/managed-audio-capability-ui-{ui}-journey-verifier.ts'),
                         ('scripts/probe-managed-audio-build.mjs', f'evidence/managed-audio-build-{build}-verifier.mjs')]:
        assert (DELIVERY / name).read_bytes() == (DELIVERY / frozen).read_bytes()
        qualified['dev/copypaste-delivery/' + name] = digest(DELIVERY / name)
    sources.update(qualified)
    for name, expected in sources.items(): assert digest(ROOT / name) == expected, name
    migrations = {n: h for n, h in baseline['source_files'].items() if n.startswith('dev/copypaste-platform/migrations/')}
    assert len(migrations) == 120 and all(sources[n] == h for n, h in migrations.items())
    original_contract = ROOT / 'docs/contracts/capability-releases.openapi.json'
    current_contract = ROOT / 'docs/contracts/managed-audio-capabilities.openapi.json'
    assert read(current_contract)['x-historical-contract']['sha256'] == digest(original_contract)
    for row in journey['screenshots'] + [f for movie in journey['media'] for f in movie['files']]:
        assert digest(DEV / row['path']) == row['sha256'], row['path']
    attempts = []
    for pattern in ['managed-audio-audio-??.json', 'managed-audio-core-??.json', 'managed-audio-capability-ui-??.json', 'managed-audio-build-??.json']:
        for path in sorted((DELIVERY / 'evidence').glob(pattern)):
            value = checked_report(path)
            assert value['source_unchanged']
            attempts.append({**ref(path), 'status': value['status'], 'test_exit': value.get('test_exit', value.get('journey_exit'))})
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    original = read(QUALITY / 'history/stage96-before-solution-packages/receipt.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 108, 'status': 'verified_managed_audio', 'scope': SCOPE,
        'source_files': dict(sorted(sources.items())), 'selected_positive': ref(core_path), 'selected_ui': ref(ui_path),
        'journey': ref(journey_path), 'tests': counts['tests'], 'counts': counts, 'admin_tests': admin['counts'],
        'compiled_build_probe': ref(build_path), 'compiled_build_negative': ref(negative_path),
        'post_core_asset_packaging_correction': {'path': 'dev/' + build_name, 'core_archive': ref(before_build),
            'current_sha256': digest(after_build), 'qualification': ref(build_path),
            'scope': 'Exact additive copy of the two original audio protocol fixtures and their license into dist/assets/audio; no runtime JS, SQL, API, test assertion or deadline changes.'},
        'test_files': backend['test_files'], 'actual_ui_checks': len(journey['checks']), 'attempts': attempts,
        'screenshots': journey['screenshots'], 'recordings': journey['media'],
        'new_migrations': [ref(ROOT / 'dev/copypaste-platform/migrations/121-managed-audio-capabilities.sql')],
        'new_routes': ['POST /v1/admin/capability-releases/validations/:validation/audio-cancellations'],
        'retained_stage107': ref(BASE), 'retained_stage106': baseline['retained_stage106'],
        'retained_full_counts': baseline['retained_full_counts'], 'retained_continuation_counts': baseline['retained_continuation_counts'],
        'full_regression_rerun': False, 'not_validated': ['live_voice_quality', 'transcription_accuracy', 'Cantonese_quality',
            'external_evidence_reconciliation_of_unknown_audio_costs', 'complete_product_acceptance'],
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_managed_audio', 'backend_tests': counts['tests'], 'admin_tests': 6, 'actual_ui': 8, 'sources': len(sources)}))


def sync():
    cp = read(CP); assert cp['verifier_sha256'] == digest(Path(__file__))
    archive = QUALITY / 'history/stage108-documents'; archive.mkdir()
    changes, copies = [], []
    def change(path, body):
        component = next((c for c in COMPONENTS if path.is_relative_to(DEV / ('copypaste-' + c))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = path.relative_to(repo).as_posix(); before = git(repo, 'show', 'HEAD:' + name)
        assert path.read_bytes().replace(b'\r\n', b'\n') == before.replace(b'\r\n', b'\n')
        saved = archive / (component or 'docs') / name; saved.parent.mkdir(parents=True, exist_ok=True); saved.write_bytes(before)
        path.write_bytes(body)
        changes.append({'path': path.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(),
                        'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(path)})
    speech = next(r for r in cp['screenshots'] if r['path'].endswith('speech-completed-en.png'))
    trans = next(r for r in cp['screenshots'] if r['path'].endswith('transcription-formats-and-timestamps-en.png'))
    movie = next(r for r in cp['recordings'] if r['name'] == 'audio-configuration-and-background-resume')
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        media = {}
        for row in [speech, trans, *movie['files']]:
            source = DEV / row['path']
            target = folder / 'assets/verification/managed-audio-108' / source.name
            assert not target.exists(); target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
            assert digest(target) == row['sha256']
            media[source.suffix if source.suffix in ['.gif', '.mp4'] else 'speech' if row == speech else 'transcription'] = target.relative_to(folder).as_posix()
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256']})
        for name in ['README.md', 'README.en.md']:
            en = name.endswith('.en.md')
            design = 'technical/' + DESIGN if folder == ROOT / 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/' + DESIGN
            text = '<!-- managed-audio-stage108 -->\n\n'
            text += ('Admin now manages immutable speech and transcription model releases: fixed voices/locales and exact rates, durable platform-funded protocol checks, actual background progress, stop controls, independent publication and historical rollback. Existing customer work retains its original model and rates; customer audio authorization remains separate.\n\n' if en else '后台已接通语音与转录模型发版：固定声音、语言与精确费率，平台预算支付的持久验证，实际后台进度、停止、独立审批和历史回滚。已有客户工作保留原模型及费率，音讯使用仍需客户独立授权。\n\n')
            text += (f'{cp["tests"]} affected backend checks, six Admin form/money checks and eight actual browser flows passed. A real crashed processor after POST retains the original unknown operation without resubmission. Actual Admin screenshots and GIF/MP4 below show this shared control flow; previous client-specific captures retain their original scope. Models/accounts and audio replies are explicitly synthetic.\n\n' if en else f'本轮通过 {cp["tests"]} 项相关后端检查、6 项后台表单／金额检查和 8 项实际浏览器流程。真实子进程在 POST 后崩溃的用例确认原操作保留为不明且不会重发。下方为实际后台公共控制流程截图及 GIF／MP4，各端此前截图保留原范围。模型、账号和音讯回应明确使用假数据。\n\n')
            text += ('The build now bundles its original audio reference files and license. The compiled verifier loads and fully decodes both formats from an unrelated working directory; the original missing-file failure is retained.\n\n' if en else '编译流程已补齐原创音讯验证素材及许可证；已从另一工作目录调用编译后的执行器，读取并完整解码两种格式，原始素材缺失记录予以保留。\n\n')
            text += ('Native decoding and timestamp structure do not qualify voice, transcription accuracy or Cantonese quality. Unknown audio costs still require external evidence. Stage106 retains its one unattributed full-run timeout and the passing unchanged two-case replay; this increment is the affected regression, not a new complete-product acceptance.\n\n' if en else '原生解码与时间段结构不代表真实音质、转录准确度或粤语品质验收；不明音讯费用仍需外部证据。阶段 106 的整批一项未归因超时及原文件独立两项通过均保留，本轮按改动范围回归，不改写成完整产品验收。\n\n')
            text += f'[Design / 方案]({design}) · [MP4]({media[".mp4"]})\n\n'
            text += f'![Actual Admin speech verification / 实际后台语音验证]({media["speech"]})\n\n![Actual transcription formats / 实际转录格式]({media["transcription"]})\n\n![Actual background continuation / 实际后台继续执行]({media[".gif"]})\n\n'
            if folder.name == 'copypaste-delivery':
                text += 'Reproduce / 重现：`node scripts/run-managed-audio.mjs <new-two-digit-attempt> core`；`node scripts/run-managed-audio-capability-ui.mjs <new-two-digit-attempt>`。\n\n'
            path = folder / name; title, body = path.read_bytes().split(b'\n', 1); change(path, title + b'\n\n' + text.encode() + body)
    note = f'\n\n**阶段 108 / Stage 108：** 后台语音／转录不可变发版、平台预算持久验证、独立审批／回滚及原始不明 POST 不重发已接通；{cp["tests"]} 项后端、6 项后台单元及 8 项实际页面流程通过，明确假模型。见[方案及证据](../technical/{DESIGN})。原完整验收与未归因超时保留。\n\n'
    for name in ['modules/04-marketing-production.md', 'modules/08-usage-billing-admin.md', 'quality/01-test-and-acceptance-plan.md', 'governance/04-git-branches-and-publication.md']:
        path = ROOT / 'docs' / name
        assert path.is_file(), name
        title, body = path.read_bytes().split(b'\n', 1); change(path, title + b'\n' + note.encode() + body)
    path = QUALITY / 'requirements-alignment-progress.json'; progress = read(path); progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['managed_audio'] = {'checkpoint': ref(CP), 'backend_tests': cp['tests'], 'admin_unit': 6, 'actual_ui': 8, 'full_acceptance': 'not_proven'}
    change(path, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode())
    for en in [False, True]:
        path = ROOT / ('docs/changes/2026-10-27-managed-audio' + ('.en' if en else '') + '.md')
        text = ('# Managed audio releases\n\nSpeech and transcription configurations now use durable platform-funded protocol checks and independent publication/rollback, while existing tasks retain their exact model and prices. The actual processor-crash test retains an unknown original POST without resubmission.\n\n' if en else '# 后台语音与转录发版\n\n语音与转录配置已接入平台预算持久验证和独立审批／回滚，已有任务保留原模型、费率与授权范围。真实执行器在 POST 后崩溃的用例保留原不明操作，不会自动重发。\n\n')
        text += f'{cp["tests"]} backend checks / 后端检查；6 Admin unit checks / 后台单元检查；8 actual browser flows / 实际页面流程。\n\n'
        text += 'Compiled audio references and license are bundled and both formats fully decode from an unrelated working directory; the original ENOENT is preserved. / 编译版素材及许可证已完整打包，两种格式均从另一工作目录加载并完整解码；原 ENOENT 记录保留。\n\n'
        text += 'Synthetic accounts/models and original tones; no live voice/accuracy/Cantonese qualification. Unknown audio fees still need external evidence. The historical full-run timeout remains unattributed. / 明确假模型与原创测试音讯，不据此宣称真实音质、准确度或粤语验收；不明音讯费用仍需外部证据，历史整批超时保留未归因结论。\n\n'
        text += f'[Design / 方案](../technical/{DESIGN}) · [Evidence / 证据](../quality/managed-audio-checkpoint.json)\n'
        assert not path.exists(); path.write_text(text, encoding='utf-8', newline='\n')
    write(QUALITY / 'managed-audio-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    cp, refresh = read(CP), read(QUALITY / 'managed-audio-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256'] and digest(ROOT / row['archive']) == row['before_sha256']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    for row in cp['screenshots']: assert row['edited'] is False and digest(DEV / row['path']) == row['sha256']
    decoded = []
    for movie in cp['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
        for row in movie['files']:
            path = DEV / row['path']; assert digest(path) == row['sha256'] and path.stat().st_size == row['bytes']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(path)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(path), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip(); decoded.append(row)
    parser, links = MarkdownIt(), 0
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            path = folder / name; body = path.read_text(encoding='utf-8'); assert '<!-- managed-audio-stage108 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):
                        assert (path.parent / unquote(urlsplit(value).path)).exists(), (path, value); links += 1
    write(QUALITY / 'managed-audio-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP),
        'bilingual_readmes': 14, 'local_readme_links': links, 'fully_decoded_recordings': decoded,
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--core', default='01'); parser.add_argument('--ui', default='01'); parser.add_argument('--build', default='02'); args = parser.parse_args()
    {'record': lambda: record(args.core, args.ui, args.build), 'sync': sync, 'audit': audit}[args.action]()
