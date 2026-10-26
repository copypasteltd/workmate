"""Bind repaired product behavior to complete regression and actual client evidence."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
from hashlib import sha256
import argparse
import json
import shutil
import subprocess
from markdown_it import MarkdownIt
from urllib.parse import unquote, urlsplit
from record_live_private_views import ROOT, DEV, QUALITY, DELIVERY, COMPONENTS, read, digest, ref, write, git

CP = QUALITY / 'platform-integration-checkpoint.json'
SCOPE = 'Explicit selected private file versions remain usable across private tasks without exposing other private files; native cloud HTTP checks await actual application readiness; private workflow confirmation clears on denied reads or source loss; strict Desktop tool admission matches the actual pinned native schema representation. Synthetic models/accounts; real Codex, native execution, PostgreSQL and client interaction.'


def checked_report(path):
    value = read(path)
    for name, expected in value.get('source_files', {}).items():
        assert digest(DELIVERY / 'evidence' / (path.stem + '-sources') / name) == expected, (path, name)
    for key in ['raw_report', 'raw_log', 'journey']:
        item = value.get(key)
        if item and 'sha256' in item:
            target = DELIVERY / item['path']
            assert digest(target) == item['sha256']
    return value


def record(ui, core, full, probe, wire, continuation):
    ui_path = DELIVERY / f'evidence/workflow-view-ui-{ui}.json'
    full_path = DELIVERY / f'evidence/platform-integration-full-{full}.json'
    # A fresh full run includes all repair suites. Reuse that actual run rather
    # than rerunning already covered files only to manufacture a second receipt.
    core_path = full_path if core == 'full' else DELIVERY / f'evidence/platform-integration-core-{core}.json'
    selected = [checked_report(p) for p in [ui_path, core_path, full_path]]
    for value in selected:
        assert value['source_unchanged'] and value['owned_database_shutdown']
    assert selected[0]['status'] == 'passed'
    assert selected[0]['compiled_unchanged'] and selected[0]['owned_previews_closed']
    for value in selected[1:]:
        counts = value['counts']
        assert value['status'] == 'failed' and counts == {'tests': 1230, 'pass': 1229, 'fail': 0, 'cancelled': 1, 'skipped': 0, 'todo': 0}
        assert value['native_codex']['explicit_bin_and_test_bin'] and not value['native_codex']['path_fallback']
        assert value['native_codex']['configured_version_matches_binary'] and value['native_codex']['observed_version'] == 'codex-cli 0.163.0-alpha.11'
    assert len(selected[2]['test_files']) == 97
    continuation_path = DELIVERY / f'evidence/runtime-continuation-{continuation}.json'
    resumed = checked_report(continuation_path)
    assert resumed['status'] == 'passed' and resumed['source_unchanged'] and not resumed['database_started'] and resumed['owned_database_shutdown']
    assert resumed['test_files'] == ['tests/runtime.test.ts']
    assert resumed['counts'] == {'tests': 2, 'pass': 2, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert resumed['source_files'] == selected[2]['source_files']
    full_log = (DELIVERY / selected[2]['raw_report']['path']).read_text(encoding='utf-8')
    focused_log = (DELIVERY / resumed['raw_report']['path']).read_text(encoding='utf-8')
    name = 'real Codex persists and resumes a thread with restored tools, history, profile checks and incremental usage'
    assert full_log.count('not ok 975 - ' + name) == 1 and 'test timed out after 120000ms' in full_log
    assert 'ok 1 - ' + name in focused_log and 'not ok ' not in focused_log
    frozen_runner = DELIVERY / f'evidence/runtime-continuation-{continuation}-verifier.mjs'
    assert frozen_runner.read_bytes() == (DELIVERY / 'scripts/run-runtime-continuation.mjs').read_bytes()
    journey = read(DELIVERY / f'evidence/workflow-view-ui-{ui}-journey.json')
    assert journey['status'] == 'passed' and len(journey['checks']) == 11
    assert all(journey[k] for k in ['browser_closed', 'panel_closed', 'api_closed', 'fixture_closed'])
    assert len(journey['screenshots']) == 15 and len(journey['media']) == 5
    for item in journey['screenshots'] + [item for movie in journey['media'] for item in movie['files']]:
        assert digest(DEV / item['path']) == item['sha256'], item['path']
    assert len(journey['executions']) == 2 and all(e['native_codex'] and e['synthetic_model'] and e['reservation_count'] == 1 and int(e['charged_micros']) > 0 for e in journey['executions'])
    sources, ui_test_deltas = {}, []
    for value in selected[1:]:
        for name, expected in value['source_files'].items():
            path = 'dev/' + name
            assert digest(ROOT / path) == expected, path
            assert path not in sources or sources[path] == expected, path
            sources[path] = expected
    for name, expected in selected[0]['source_files'].items():
        path, actual = 'dev/' + name, digest(DEV / name)
        if actual != expected:
            assert name == 'copypaste-platform/tests/audio-production.test.ts', name
            archive = DELIVERY / f'evidence/workflow-view-ui-{ui}-sources' / name
            before, after = archive.read_bytes(), (DEV / name).read_bytes()
            newline = b'\r\n' if b'\r\n' in before else b'\n'
            marker = newline.join([b'    for (;;) {', b'      const waiting = (await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity'])
            replacement = newline.join([b'    for (;;) {', b'      // This owner keeps the heartbeat transaction open. Refresh its statistics', b'      // snapshot so each poll can observe a newly blocked recovery connection.', b'      await owner.query("SELECT pg_stat_clear_snapshot()");', b'      const waiting = (await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity'])
            assert before.count(marker) == 1 and after == before.replace(marker, replacement)
            assert sources[path] == actual
            ui_test_deltas.append({'path': path, 'archived_ui_sha256': expected, 'current_fully_tested_sha256': actual,
                'archive': ref(archive), 'change': 'Refresh PostgreSQL activity snapshot only in a concurrency test; no runtime, UI, assertion or deadline change.',
                'qualification': ref(full_path)})
        else:
            assert path not in sources or sources[path] == expected, path
            sources[path] = expected
    sources['dev/copypaste-delivery/scripts/run-runtime-continuation.mjs'] = digest(frozen_runner)
    attempts = []
    for pattern in ['platform-full-*.json', 'platform-integration-*.json', 'workflow-view-ui-*.json', 'runtime-continuation-*.json', 'api-readiness-*.json', 'native-tool-wire-*.json']:
        for path in sorted((DELIVERY / 'evidence').glob(pattern)):
            value = read(path)
            if 'source_files' not in value and not path.name.startswith('native-tool-wire-'):
                continue
            if not path.name.startswith(('api-readiness-', 'native-tool-wire-')):
                checked_report(path)
            passed = value.get('receipt', {}).get('passed') or (value.get('accepted') and value.get('turn_status') == 'completed' and not value.get('error'))
            attempts.append({**ref(path), 'status': value.get('status', 'passed' if passed else 'failed')})
    first = read(DELIVERY / 'evidence/platform-full-01.json')
    assert first['status'] == 'failed' and first['source_unchanged'] and first['owned_database_shutdown']
    negative = read(DELIVERY / 'evidence/api-readiness-01.json')
    positive_path = DELIVERY / f'evidence/api-readiness-{probe}.json'
    positive = read(positive_path)
    assert not negative['receipt']['passed'] and 'HTTP_REQUEST_TIMEOUT' in negative['receipt']['check_result']['error']
    assert positive['receipt']['passed'] and len(positive['receipt']['check_result']['checks']) == 2
    assert negative['application_sha256'] == positive['application_sha256']
    for name, expected in positive['source_files'].items():
        assert digest(DEV / 'copypaste-platform' / name) == expected
    wire_path = DELIVERY / f'evidence/native-tool-wire-{wire}.json'
    native_wire = read(wire_path)
    before_wire = read(DELIVERY / 'evidence/native-tool-wire-03.json')
    assert before_wire['turn_status'] == 'completed' and not before_wire['accepted'] and not before_wire['error']
    assert {f['name'] for f in before_wire['failures']} == {'effect_render', 'request_input', 'video_project_edit', 'video_project_queue'}
    assert native_wire['accepted'] and native_wire['turn_status'] == 'completed' and not native_wire['error'] and not native_wire['request_error']
    assert native_wire['native_closed'] and native_wire['server_closed'] and not native_wire['diagnostic_oneof_to_anyof']
    assert native_wire['runtime_version'] == '0.163.0-alpha.11' and native_wire['paid_provider_calls'] == 0 and native_wire['company_tools'] == 23
    assert {'copypaste', 'copypaste_browser', 'copypaste_programs'}.issubset({n['name'] for n in native_wire['namespaces']})
    for name, expected in native_wire['qualified_sources'].items():
        assert sources['dev/' + name] == expected and digest(DEV / name) == expected
    previous = read(QUALITY / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == previous['requirements'] and progress['gates'] == previous['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    for name, expected in first['source_files'].items():
        if name.startswith('copypaste-platform/migrations/'):
            assert digest(DEV / name) == expected
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 106, 'status': 'verified_platform_integration',
        'scope': SCOPE, 'source_files': dict(sorted(sources.items())),
        'selected_ui': ref(ui_path), 'selected_core': ref(core_path), 'selected_full': ref(full_path),
        'repair_qualification_scope': 'Actual selected full regression includes all related repair suites; its unrelated continuation timeout is retained with an unchanged-source focused replay' if core == 'full' else 'Actual separate focused regression',
        'ui_test_observation_deltas': ui_test_deltas,
        'backend_tests': selected[2]['counts']['tests'], 'backend_test_files': 97,
        'full_counts': selected[2]['counts'], 'complete_batch_passed': False, 'selected_continuation': ref(continuation_path), 'continuation_counts': resumed['counts'],
        'runtime_timeout': 'The complete run cancelled one existing real-Codex continuation test at 120 seconds. The same unmodified file passed both checks independently; no source or deadline change. Cause remains unattributed. This is not a completely green single-batch run.',
        'ui_checks': journey['checks'], 'attempts': attempts, 'startup_reproduction': ref(positive_path), 'native_schema_reproduction': ref(wire_path),
        'screenshots': journey['screenshots'], 'recordings': journey['media'], 'native_executions': journey['executions'],
        'new_migrations': [], 'preservation': {'requirements': 102, 'cases': 102, 'original_requirement_and_gate_arrays_unchanged': True},
        'not_validated': ['live_model_quality', 'complete_product_acceptance', 'new_desktop_UI_acceptance'],
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_platform_integration', 'backend_tests': selected[2]['counts']['tests'], 'ui_checks': 11, 'sources': len(sources)}))


def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    archive = QUALITY / 'history/stage106-documents'
    archive.mkdir()
    changes, copies = [], []
    def change(path, body):
        component = next((c for c in COMPONENTS if path.is_relative_to(DEV / ('copypaste-' + c))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = path.relative_to(repo).as_posix()
        before = git(repo, 'show', 'HEAD:' + name)
        assert path.read_bytes().replace(b'\r\n', b'\n') == before.replace(b'\r\n', b'\n')
        saved = archive / (component or 'docs') / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(before)
        path.write_bytes(body)
        changes.append({'path': path.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(path)})
    movie = next(m for m in cp['recordings'] if m['name'] == 'workflow-view-withdrawal')
    shot = next(s for s in cp['screenshots'] if 'workflow-recovered-fresh-consent' in s['path'])
    selected = [shot, *movie['files']]
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for item in selected:
            source = DEV / item['path']; target = folder / 'assets/screenshots' / ('integration-' + source.name)
            assert not target.exists()
            target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
        for name in ['README.md', 'README.en.md']:
            en = name.endswith('.en.md')
            design = 'technical/106-selected-inputs-and-runtime-readiness.md' if folder == ROOT / 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/106-selected-inputs-and-runtime-readiness.md'
            text = '<!-- platform-integration-stage106 -->\n\n'
            text += ('Explicitly selected private file versions now remain usable by subsequent private tasks while unselected files stay isolated. Replaced/revoked inputs still stop execution. Native cloud HTTP checks wait for actual application readiness before starting each request deadline. Web clears a private workflow confirmation after a denied read or source withdrawal.\n\n' if en else '明确选中的私有文件版本现可用于后续私有任务，未选中的文件继续隔离；版本被替换或来源撤回仍会停止执行。云端 HTTP 检查等待应用实际就绪后再开始请求计时。Web 在读取被拒绝或来源撤回后关闭私有流程确认，恢复后要求重新确认。\n\n')
            text += ('Desktop strict tool admission now matches the pinned native schema compaction and preserved array constraints; altered or duplicate declarations remain denied. The actual local native request carries all 23 media tools plus browser/program namespaces.\n\n' if en else 'Desktop 严格工具校验已兼容固定原生版本的结构压缩和数组约束，篡改及重复声明继续拒绝；实际本机请求验证了全部 23 个媒体工具和浏览器／本机程序工具。\n\n')
            text += (f'The complete 97-file backend run executed {cp["backend_tests"]} tests: 1,229 passed and one existing continuation test timed out/cancelled. Both checks in that unchanged runtime file passed independently; the timeout cause remains unattributed. Eleven actual client journeys, 15 screenshots and five GIF/MP4 pairs are retained. Models/accounts are synthetic; Codex, native execution and database operations are actual. Historical failures and exact source copies are retained. Desktop remains customer-local Codex; Extension retains its native right Side Panel and authorized uploads.\n\n' if en else f'完整执行 97 个后端文件共 {cp["backend_tests"]} 项：1,229 项通过，一项原有会话恢复检查超时取消；未修改该文件或期限的独立复查两项通过，首次超时原因尚未确定。另通过 11 项实际客户端流程，保留 15 张截图、五组 GIF／MP4。模型和账号为假数据，Codex、原生执行与数据库操作均实际运行。保留首轮失败及确切源码。Desktop 保持客户本机 Codex，Extension 保持原生右侧栏与获准上传。\n\n')
            text += ('Reproduce from the Delivery checkout: `node scripts/run-platform-integration.mjs <new-two-digit-attempt> full`, then `node scripts/run-workflow-view-ui.mjs <new-two-digit-attempt>`. Prepare the pinned Desktop runtime first with `npm run runtime:prepare` in Desktop. The complete runner checks the binary hash and observed version, sets all four native/cloud test variables and owns its native PostgreSQL. Every attempt retains its original evidence.\n\n' if en else '完整核查在 Delivery 仓库运行：`node scripts/run-platform-integration.mjs <新的两位编号> full`，再运行 `node scripts/run-workflow-view-ui.mjs <新的两位编号>`。首次在 Desktop 运行 `npm run runtime:prepare` 准备固定运行时；完整启动器核对二进制摘要和实际版本，配置四项测试变量并管理其原生 PostgreSQL。每个编号保留原始证据。\n\n')
            if folder == DEV / 'copypaste-platform':
                text += ('For standalone backend `npm test`, explicitly configure `CODEX_BIN`, `COPYPASTE_LOCAL_CODEX_BIN` and `COPYPASTE_LOCAL_CODEX_TEST_BIN` to the approved native executable and set `CODEX_VERSION` to its actual `0.163.0-alpha.11` version. Its SHA-256 must match `src/desktop-runtime.ts`. Keep production cloud runtime configuration separate from this test process.\n\n' if en else '独立运行后端 `npm test` 时，显式将 `CODEX_BIN`、`COPYPASTE_LOCAL_CODEX_BIN`、`COPYPASTE_LOCAL_CODEX_TEST_BIN` 设置为经核验的原生可执行文件，并将 `CODEX_VERSION` 设置为其实际版本 `0.163.0-alpha.11`；SHA-256 必须匹配 `src/desktop-runtime.ts`。这些是测试进程配置，生产云端运行时可独立配置。\n\n')
            gif = next(s for s in movie['files'] if s['path'].endswith('.gif')); mp4 = next(s for s in movie['files'] if s['path'].endswith('.mp4'))
            text += f'[Design / 方案]({design})\n\n![Actual recovered private workflow](assets/screenshots/integration-{Path(shot["path"]).name})\n\n![Actual private workflow source withdrawal](assets/screenshots/integration-{Path(gif["path"]).name})\n\n[Actual interaction MP4](assets/screenshots/integration-{Path(mp4["path"]).name})\n\n'
            path = folder / name; title, body = path.read_bytes().split(b'\n', 1)
            change(path, title + b'\n\n' + text.encode() + body)
    note = f'\n\n**阶段 106 / Stage 106：** 已修复明确选中的私有文件跨任务读取、原生 API 检查启动就绪和私有流程确认失效；97 个后端文件共 {cp["backend_tests"]} 项执行，1,229 通过、一项超时取消；原文件独立复查两项通过，保留未归因超时。11 项实际跨端流程通过。旧版本、费用与权限边界保留；模型／账号仍是假数据。见[实现与证据](../technical/106-selected-inputs-and-runtime-readiness.md)。\n\n'
    for name in ['requirements/01-srs.md', 'modules/07-web-extension-desktop.md', 'modules/06-connectors-workflows.md', 'quality/01-test-and-acceptance-plan.md', 'governance/04-git-branches-and-publication.md']:
        path = ROOT / 'docs' / name; title, body = path.read_bytes().split(b'\n', 1)
        change(path, title + b'\n' + note.encode() + body)
    path = QUALITY / 'requirements-alignment-progress.json'; progress = read(path)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['platform_integration'] = {'checkpoint': ref(CP), 'backend_tests': cp['backend_tests'], 'backend_test_files': 97, 'full_counts': cp['full_counts'], 'continuation_counts': cp['continuation_counts'], 'complete_batch_passed': False, 'ui_checks': 11, 'full_acceptance': 'not_proven'}
    change(path, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode())
    for en in [False, True]:
        path = ROOT / ('docs/changes/2026-10-27-platform-integration' + ('.en' if en else '') + '.md')
        assert not path.exists()
        readme = (ROOT / 'docs' / ('README.en.md' if en else 'README.md')).read_text(encoding='utf-8')
        description = readme.split('<!-- platform-integration-stage106 -->\n\n', 1)[1].split('[Design / 方案]')[0]
        path.write_text(('# Selected inputs and native readiness\n\n' if en else '# 私有输入授权与原生应用就绪\n\n') + description + '[Design / 方案](../technical/106-selected-inputs-and-runtime-readiness.md) · [Evidence / 证据](../quality/platform-integration-checkpoint.json)\n', encoding='utf-8', newline='\n')
    write(QUALITY / 'platform-integration-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    cp = read(CP); refresh = read(QUALITY / 'platform-integration-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256'] and digest(ROOT / row['archive']) == row['before_sha256']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    for row in cp['screenshots']: assert digest(DEV / row['path']) == row['sha256'] and row['edited'] is False
    decoded = []
    for movie in cp['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
        for row in movie['files']:
            path = DEV / row['path']
            assert digest(path) == row['sha256'] and path.stat().st_size == row['bytes']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(path)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(path), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip(); decoded.append(row)
    parser, links = MarkdownIt(), 0
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            path = folder / name; body = path.read_text(encoding='utf-8')
            assert '<!-- platform-integration-stage106 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):
                        assert (path.parent / unquote(urlsplit(value).path)).exists(), (path, value)
                        links += 1
    write(QUALITY / 'platform-integration-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'fully_decoded_recordings': decoded, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--ui', default='03'); parser.add_argument('--core', default='full'); parser.add_argument('--full', default='01'); parser.add_argument('--probe', default='02'); parser.add_argument('--wire', default='06'); parser.add_argument('--continuation', default='01')
    args = parser.parse_args()
    {'record': lambda: record(args.ui, args.core, args.full, args.probe, args.wire, args.continuation), 'sync': sync, 'audit': audit}[args.action]()
