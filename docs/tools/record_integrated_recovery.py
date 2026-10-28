"""Bind the complete platform regression and actual attachment recovery to final source bytes."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
import re
import shutil
import subprocess
from record_cloud_events import ROOT, DEV, L, Q, COMPONENTS, read, digest, ref, write, checked

CP = Q / 'integrated-recovery-checkpoint.json'
RUNBOOK = 'technical/120-integrated-regression-and-attachment-recovery.md'
MARKER = '<!-- integrated-recovery-stage120 -->'
COUNTERS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']


def raw_counts(p, value):
    row = value['raw_report']
    raw = L / row['path']
    assert digest(raw) == row['sha256'], raw
    body = raw.read_text(encoding='utf-8')
    if value.get('verification_mode') == 'source_bound_complete_inventory_v2':
        index = json.loads(body)
        assert index['format'] == value['verification_mode']
        assert index['test_files'] == value['test_files']
        def evidence(row):
            assert not Path(row['path']).is_absolute() and '..' not in Path(row['path']).parts
            target = L / row['path']
            assert target.resolve().is_relative_to(L.resolve()) and digest(target) == row['sha256'], target
            return read(target)
        plan = evidence(index['plan'])
        assert plan['test_files'] == value['test_files'] and plan['source_files'] == value['source_files']
        assert plan['verifier_sha256'] == value['verifier_sha256']
        epochs = {}
        for row in index['epochs']:
            closed = evidence(row)
            assert closed['status'] == 'passed' and closed['native_port_closed']
            epoch = evidence(closed['epoch'])
            assert epoch['plan_sha256'] == index['plan']['sha256'] and epoch['id'] not in epochs
            if closed['mode'] == 'actual_child_exit':
                assert not closed['database_started'] or closed['database_exit'] == 0
            else:
                assert closed['mode'] == 'interrupted_owners_observed_gone' and closed['owner_gone']
                for recovered in closed['verified_fixture_recovery']:
                    receipt = evidence(recovered['cleanup'])
                    assert receipt['status'] == 'passed' and receipt['workers_exited'] and receipt['actual_filesystem_checked']
            epochs[epoch['id']] = (epoch, closed)
        rows = [evidence(row) for row in index['file_receipts']]
        assert [row['test_file'] for row in rows] == value['test_files']
        total = {k: 0 for k in COUNTERS}
        for row in rows:
            assert row['status'] == 'passed' and row['exit_code'] == 0 and row['source_unchanged']
            assert row['source_fingerprint'] == plan['source_fingerprint'] and row['verifier_sha256'] == value['verifier_sha256']
            assert row['args'] == ['--env-file=.env', 'scripts/run-tests-owned.mjs', row['test_file']]
            epoch, closed = epochs[row['epoch']]
            assert row['test_file'] in epoch['files']
            if closed['mode'] == 'actual_child_exit':
                assert closed['database_exit'] == 0 and all(check['exit_code'] == 0 for check in closed['checks'])
            tap_path = L / row['raw_report']['path']
            assert digest(tap_path) == row['raw_report']['sha256']
            tap = tap_path.read_text(encoding='utf-8')
            counts = {}
            for k in COUNTERS:
                matches = re.findall(r'^# ' + k + r' (\d+)\r?$', tap, re.M)
                assert len(matches) == 1
                counts[k] = int(matches[0])
            passing(counts)
            assert counts == row['counts']
            matches = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', tap, re.M)
            assert len(matches) == 1 and json.loads(matches[0]) == row['fixture_cleanup']
            assert row['fixture_cleanup']['exit_code'] == 0
            cleanup = evidence(row['fixture_cleanup_report'])
            assert row['fixture_cleanup_report']['sha256'] == row['fixture_cleanup']['sha256']
            assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
            assert all(item['reclaimed'] for item in cleanup['results'])
            for k in COUNTERS: total[k] += counts[k]
        assert total == index['counts'] == value['counts']
        return total
    counts = {k: int(re.findall(r'^# ' + k + r' (\d+)\r?$', body, re.M)[0]) for k in COUNTERS}
    assert counts == value['counts'], p
    return counts


def archive(p, value):
    verifier = p.parent / (p.stem + '-verifier.mjs')
    expected = value.get('verifier_sha256') or value.get('verifier', {}).get('sha256')
    if verifier.exists(): assert expected and digest(verifier) == expected, verifier
    for name, expected in value.get('source_files', {}).items():
        assert digest(p.parent / (p.stem + '-sources') / name) == expected, (p, name)
    for name, expected in value.get('root_sources', {}).items():
        assert digest(p.parent / (p.stem + '-root-sources') / name) == expected, (p, name)


def passing(counts):
    assert counts['tests'] > 0 and counts['tests'] == counts['pass']
    assert all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])


def record(full, extension, ui, clients, client_units):
    selected = [L / f'evidence/integrated-recovery-{name}-{attempt}.json'
                for name, attempt in [('full', full), ('extension', extension), ('ui', ui), ('clients', clients)]]
    backend, units, browser, builds = [checked(p) for p in selected]
    for p, value in zip(selected, [backend, units, browser, builds]):
        assert value['status'] == 'passed' and value['owned_database_shutdown'], p
        assert all(c['exit_code'] == 0 for c in value.get('checks', [])), p
        archive(p, value)
    assert 'candidate_worktree' not in backend, 'The selected complete regression must run in the delivered backend repository'
    assert backend['scope'] == 'all_platform_test_files'
    runner = 'run-integrated-recovery-full-v2.mjs' if backend.get('verification_mode') == 'source_bound_complete_inventory_v2' else 'run-integrated-recovery-full-v1.mjs'
    assert backend['verifier_sha256'] == digest(L / 'scripts' / runner)
    test_files = ['tests/' + p.name for p in sorted((DEV / 'copypaste-platform/tests').glob('*.test.ts')) if re.fullmatch(r'[a-z0-9-]+\.test\.ts', p.name)]
    assert backend['test_files'] == test_files and len(test_files) >= 109
    full_counts = raw_counts(selected[0], backend)
    passing(full_counts)
    for value in [units, builds]:
        assert value['verifier_sha256'] == digest(L / 'scripts/run-integrated-recovery-v1.mjs')
    counts = {c['name']: c['counts'] for c in units['checks'] if 'counts' in c}
    assert counts['extension-unit']['tests'] == 63 and counts['proof-format']['tests'] == 1
    for value in counts.values(): passing(value)
    assert len(builds['checks']) == 13
    client_unit_path = L / f'evidence/integrated-recovery-client-units-{client_units}.json'
    client_unit = checked(client_unit_path)
    assert client_unit['status'] == 'passed' and client_unit['owned_database_shutdown']
    assert client_unit['verifier_sha256'] == digest(L / 'scripts/run-integrated-recovery-client-units-v1.mjs')
    archive(client_unit_path, client_unit)
    client_counts = {c['name']: c['counts'] for c in client_unit['checks'] if 'counts' in c}
    assert set(client_counts) == {'web-unit', 'admin-unit', 'desktop-unit', 'delivery-unit'}
    for value in client_counts.values(): passing(value)
    for check in client_unit['checks']:
        assert check['exit_code'] == 0
        if 'counts' not in check: continue
        names = [v for v in check['args'] if v.startswith('tests/')]
        expected = ['tests/' + p.name for p in sorted((DEV / check['cwd'] / 'tests').iterdir()) if re.fullmatch(r'[a-z0-9.-]+\.test\.(ts|mjs)', p.name)]
        assert names == expected, check['name']
    assert browser['verifier']['sha256'] == digest(L / 'scripts/run-integrated-recovery-ui-v1.mjs')
    assert browser['journey_verifier']['sha256'] == digest(L / 'scripts/qa-integrated-recovery-ui-v1.ts')
    journey_path = L / browser['journey']['path']
    assert digest(journey_path) == browser['journey']['sha256']
    journey = read(journey_path)
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 7 and len(journey['screenshots']) == 9
    assert len(journey['recordings']) == 2 and len(journey['layouts']) == 6
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed', 'provider_closed'])
    assert browser['owned_preview_closed'] and browser['compiled_unchanged']
    assert len(journey['actual_private_reads']) == 3 and all(r['actual_tool_output'] for r in journey['actual_private_reads'])
    for layout in journey['layouts']: assert not layout['horizontal'] and layout['confirm_visible'] and layout['cancel_visible']
    for movie in journey['recordings']: assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
    sources = {'dev/' + name: expected for name, expected in builds['source_files'].items()}
    for value in [units, browser]: assert value['source_files'] == builds['source_files'], 'Selected client checks must bind final source bytes'
    for name, expected in client_unit['source_files'].items(): assert sources['dev/' + name] == expected, name
    for name, expected in backend['source_files'].items():
        key = 'dev/' + name
        if key in sources: assert sources[key] == expected, name
        sources[key] = expected
    for value in [units, builds]:
        for name, expected in value['root_sources'].items():
            if name in sources: assert sources[name] == expected
            sources[name] = expected
    for name, expected in sources.items(): assert digest(ROOT / name) == expected, name
    native_application_path = L / 'evidence/integrated-recovery-native-browser-application-02.json'
    native_application = read(native_application_path)
    assert native_application['status'] == 'applied'
    assert native_application['verifier_sha256'] == digest(ROOT / 'docs/tools/apply_integrated_browser_recovery_v2.py')
    assert len(native_application['changes']) == 4
    prior_native_path = L / native_application['previous_application']['path']
    assert digest(prior_native_path) == native_application['previous_application']['sha256']
    prior_native = read(prior_native_path)
    assert prior_native['status'] == 'applied' and prior_native['verifier_sha256'] == digest(ROOT / 'docs/tools/apply_integrated_browser_recovery.py')
    next_preimages = {row['path']: row['before_sha256'] for row in native_application['changes']}
    for row in prior_native['changes']: assert next_preimages[row['path']] == row['after_sha256']
    for row in native_application['changes']:
        assert sources['dev/copypaste-platform/' + row['path']] == row['after_sha256']
    for row in native_application['qualified_native_browser_attempts']:
        report_path = L / row['path']; original = read(report_path); folder = report_path.parent
        assert digest(report_path) == row['sha256'] and digest(folder / 'raw.tap') == row['raw_sha256'] == original['raw_sha256']
        assert digest(folder / 'verifier.mjs') == row['verifier_sha256']
        assert original['source_unchanged'] and original['counts'] == row['counts']
        for name, expected in original['source_files'].items(): assert digest(folder / 'sources' / name) == expected
    retained = read(Q / 'extension-folder-checkpoint.json')
    for name, expected in retained['source_files'].items():
        if name.startswith(('dev/copypaste-desktop/', 'dev/copypaste-web/', 'dev/copypaste-admin/')):
            assert sources[name] == expected, name
    for row in journey['screenshots'] + [f for movie in journey['recordings'] for f in movie['files']]:
        assert digest(DEV / row['path']) == row['sha256']
    previous = Q / 'history/stage120-previous-publication.json'
    assert not previous.exists()
    shutil.copyfile(Q / 'workmate-publication.json', previous)
    baseline = Q / 'history/stage120-before-integrated-recovery/receipt.json'
    baseline.parent.mkdir(parents=True, exist_ok=True)
    assert not baseline.exists()
    shutil.copyfile(L / '.data/preparation/integrated-recovery-120/receipt.json', baseline)
    original = read(Q / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    attempts = []
    for p in sorted((L / 'evidence').glob('integrated-recovery-*-??.json')):
        value = read(p)
        if 'source_files' not in value: continue
        checked(p); archive(p, value)
        if 'counts' in value and 'raw_report' in value and 'test_files' in value: raw_counts(p, value)
        attempts.append({**ref(p), 'status': value['status'], 'error': value.get('error'), 'counts': value.get('counts')})
    interruption_path = L / 'evidence/integrated-recovery-full-04-interruption.json'
    interruption = read(interruption_path)
    assert interruption['status'] == 'interrupted_not_qualified' and interruption['test_exit'] is None and interruption['counts'] is None
    assert digest(L / interruption['raw_report']['path']) == interruption['raw_report']['sha256']
    assert digest(L / interruption['verifier']['path']) == interruption['verifier']['sha256']
    for name, expected in interruption['source_files'].items(): assert digest(L / interruption['source_archive'] / name) == expected
    inventory_attempts = []
    for plan_path in sorted((L / 'evidence').glob('integrated-recovery-full-??-plan.json')):
        prefix = str(plan_path).removesuffix('-plan.json')
        plan = read(plan_path)
        for name, expected in plan['source_files'].items(): assert digest(Path(prefix + '-sources') / name) == expected
        assert digest(Path(prefix + '-verifier.mjs')) == plan['verifier_sha256']
        folder = Path(prefix + '-runs')
        inventory_attempts.append({'plan': ref(plan_path), 'epochs': [ref(p) for p in sorted((folder / 'epochs').glob('*.json'))], 'file_attempts': [ref(p) for p in sorted((folder / 'files').glob('*.json'))], 'raw_reports': [ref(p) for p in sorted(folder.rglob('*')) if p.suffix in ['.tap', '.log']], 'final_report': ref(Path(prefix + '.json')) if Path(prefix + '.json').exists() else None})
    diagnostic_path = L / 'evidence/cloud-preview-diagnostic-01.json'
    diagnostic = checked(diagnostic_path)
    assert diagnostic['scope'] == 'single_program_browser_diagnostic_no_qualification'
    assert diagnostic['status'] == 'passed' and diagnostic['owned_database_shutdown'] and diagnostic['source_unchanged']
    archive(diagnostic_path, diagnostic)
    assert raw_counts(diagnostic_path, diagnostic)['tests'] == 5
    diagnostic_archive = {'report': ref(diagnostic_path), 'raw_report': ref(L / diagnostic['raw_report']['path']),
                          'verifier': ref(diagnostic_path.with_name(diagnostic_path.stem + '-verifier.mjs')),
                          'preloader': ref(L / 'evidence/cloud-preview-diagnostic-01-preload.mjs'),
                          'source_files': diagnostic['source_files']}
    scope = (f"All {len(test_files)} current backend test files: {full_counts['tests']} executed and passed with zero failures, cancellations or skips; "
             f"{sum(c['tests'] for c in client_counts.values())} Web/Admin/Desktop/Delivery unit checks, "
             "63 Extension unit checks, seven adversarial proof-reader cases, thirteen client build/type checks, seven actual native right Chrome SIDE_PANEL flows, "
             "six layouts, nine PNGs and two actual wall-clock GIF/MP4 pairs. Extension 0.5.2 recovers ordinary-attachment preflight, selection capacity and tiny-file sizes "
             "without reading or uploading unconfirmed folder files. Backend 0.5.1 admits only the complete matching SQL001–128 schema before API or worker startup, "
             "seeding or paid work; missing migrations and future versions fail closed while restored-environment fences remain enforced. Historical SQL101/102/103 upgrades, "
             "SQL120/121/122 function identities/prepared callers, current route coverage and removed acceptance receipts are requalified. The native browser host durably persists independent ownership before launch; reclamation survives interrupted mutable telemetry and still requires both owners gone and an empty job. Telemetry writes are coalesced without slowing cancellation; navigation and strict sandbox observation share the remaining caller budget, including a real finite page loading beyond five seconds. Shutdown has a separate bounded six-second cleanup window with matching native hard deadline; real exit code and verified empty-job cleanup remain required. Actual native PostgreSQL and pinned "
             "cloud Codex; model decisions/accounts/source files are synthetic. Original complete-product, live-provider and signed-installation acceptance remains unproven.")
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 120, 'status': 'verified_integrated_recovery', 'scope': scope,
               'source_files': dict(sorted(sources.items())), 'selected_core': ref(selected[0]), 'extension_units': ref(selected[1]),
               'selected_ui': ref(selected[2]), 'client_builds': ref(selected[3]), 'full_counts': full_counts, 'backend_test_files': test_files,
               'client_units': ref(client_unit_path), 'client_unit_counts': client_counts,
               'native_browser_application': ref(native_application_path),
               'counts': counts, 'proof_reader_adversarial_cases': 7, 'build_checks': 13, 'journey': ref(journey_path), 'actual_ui_checks': 7,
               'screenshots': journey['screenshots'], 'recordings': journey['recordings'], 'layouts': journey['layouts'], 'actual_private_reads': journey['actual_private_reads'],
               'attempts': attempts, 'interrupted_full_run': ref(interruption_path), 'durable_inventory_attempts': inventory_attempts,
               'scoped_preview_diagnostic': diagnostic_archive,
               'previous_publication': ref(previous), 'baseline': ref(baseline), 'retained_stage119': ref(Q / 'extension-folder-checkpoint.json'),
               'recording_scope': 'Actual native Chrome right SIDE_PANEL attachment preflight recovery, precise nonempty-byte display, 19-file selection replacement, explicit private folder uploads, post-commit completion-response-loss retry, explicit Send and three actual native cloud Codex private file reads. Synthetic company model/customer/files.',
               'product_version': '0.5.2', 'backend_version': '0.5.1', 'live_provider_qualified': False, 'original_requirements_modified': False,
               'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_integrated_recovery', 'full_counts': full_counts, 'sources': len(sources), 'actual_ui': 7}))


DETAILS = {
    'extension': ('Extension 0.5.2 keeps browser-selected folder contents unread until explicit confirmation. Folder review now explains existing pending/failed attachment blockers inside the modal, disables only unchecked items at the 19-file limit, and displays nonempty small files in bytes. Remove the failed ordinary attachment or let its upload finish, then confirm; uncheck one file to select another. Retry retains exact private receipts and explicit Send remains separate.', 'Extension 0.5.2 在明确确认前继续只核对浏览器资料夹元数据。弹窗内显示已有附件待上传／失败的具体原因与恢复步骤；19 档已满时仅禁用未选项，取消一个勾选即可替换；小文件显示准确字节。先等已有附件完成或移除失败项，再确认上传，失败重试沿用精确私人回执，最后另按发送。'),
    'platform': ('Backend 0.5.1 exercises the complete current test inventory against an owned native PostgreSQL instance. API and worker entry require the complete SQL001–128 sequence before seeding or paid work. Missing tables or migrations report SCHEMA_UPGRADE_REQUIRED; a newer database reports SCHEMA_VERSION_UNSUPPORTED. Restored-environment state and database-marker fences remain enforced. Historical audio upgrade tests seed the actual old schema directly, preserve SQL101/102/103 boundaries and prepared SQL120/121/122 callers, and start current HTTP only after all forward migrations. Removed receipts return 410 without repeating paid work. The route inventory explicitly includes native pairing, update, event, budget and recovery operations. The native host flushes an exclusive immutable owner file before launch. Reclamation survives missing mutable telemetry, requires both owners gone and an independently empty job, and retains live-owner deletion protection.', 'Backend 0.5.1 以独占原生 PostgreSQL 执行当前全部后端测试。API 与 Worker 在播种或付费工作前要求完整 SQL001–128；缺表或缺迁移报 SCHEMA_UPGRADE_REQUIRED，高于当前版本的数据库报 SCHEMA_VERSION_UNSUPPORTED；恢复状态和数据库隔离标记仍独立检查。音频升级测试直接建立真实旧库资料，保留 SQL101／102／103 边界和 SQL120／121／122 预编译调用，完成所有前向迁移后才启动新版 HTTP。已移除回执返回 410，付费任务不重建；路由清单补齐原生配对、更新、事件、广告预算及恢复端点。原生宿主在启动前独占写入并刷盘独立身份记录；可变回执丢失后仍可回收，且继续要求两个拥有者退出、独立确认 Job 为空，保留存活拥有者的删除保护。'),
    'desktop': ('Desktop remains at 0.7.1 with customer-local Codex, explicit revocable full permission, frameless controls, no Electron menu and hidden layout scrollbars. Its production source is unchanged in this increment and its current type/build checks are repeated with the other clients.', 'Desktop 保留 0.7.1、本机 Codex、客户明确可撤回的完整权限、无边框和无 Electron 菜单，并保留既有滚动条约束。本轮不更改其生产源码，与其余各端一起重新执行当前类型／构建检查。'),
    'web': ('Web continues to host cloud Codex and browser identity/PKCE authorization. Extension verification uses the real sign-in page and private project context. Web production source is unchanged and is rebuilt with the current clients.', 'Web 继续承载云端 Codex 与浏览器登录／PKCE 授权。Extension 验证使用真实登录页及私人专案上下文。Web 生产源码本轮未变，并纳入当前全端构建。'),
    'admin': ('Existing Admin MFA, user/content visibility, fee and VIP policies remain in force. The complete backend run includes these controls; no additional customer-content permission is granted by this attachment recovery. Admin production source is unchanged and is rebuilt.', '现有 Admin MFA、用户／内容可见范围、费用及 VIP 规则继续生效，并纳入完整后端回归。附件恢复不额外授予后台客户内容权限。Admin 生产源码本轮未变，并重新构建。'),
    'delivery': ('Run run-integrated-recovery-full-v2.mjs NN MAX_FILES for durable per-file backend receipts and resume the same immutable source inventory; run-integrated-recovery-v1.mjs NN extension|clients for Extension units and client builds; run-integrated-recovery-client-units-v1.mjs NN for all current Web/Admin/Desktop/Delivery unit files; run-integrated-recovery-ui-v1.mjs NN for the actual Chrome journey. Each attempt uses a fresh number and exact source archives; database-backed runs own and clean up their native database. publish-workmate-v3.mjs --push checks all historical proofs in bounded shards and atomically verifies eight nonforce refs. Failed reports and executed verifiers remain immutable.', '以全新编号启动 run-integrated-recovery-full-v2.mjs NN MAX_FILES，逐文件保存真实退出状态并在相同源码下续跑完整后端清单；run-integrated-recovery-v1.mjs NN extension|clients 检查 Extension 单元及各端构建；run-integrated-recovery-client-units-v1.mjs NN 枚举 Web／Admin／Desktop／Delivery 当前全部单元文件；run-integrated-recovery-ui-v1.mjs NN 检查真实 Chrome 流程。每轮归档精确源码，数据库流程使用自有原生数据库并清理。publish-workmate-v3.mjs --push 核查全部历史切片 proof，并原子非强推核对八个分支。失败报告和执行过的校验器保持原样。')}



def sync():
    cp = read(CP); assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    archive = Q / 'history/stage120-previous-documents'
    media = cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]
    numbers = f"{cp['full_counts']['tests']} backend checks in {len(cp['backend_test_files'])} files + {sum(c['tests'] for c in cp['client_unit_counts'].values())} Web/Admin/Desktop/Delivery unit checks + 63 Extension checks + 7 adversarial proof-reader cases; 13 builds; 7 actual UI flows; 6 layouts; 9 PNGs and 2 GIF/MP4 pairs"
    diagram = '```mermaid\nflowchart LR\n  Pick[Browser folder picker] --> Review[Review selected relative paths]\n  Review --> Confirm[Customer confirms upload]\n  Confirm --> Private[Private files and JSON index]\n  Private --> Retry[Exact unfinished upload retry]\n  Retry --> Private\n  Private --> Send[Customer sends message]\n  Send --> Codex[Company cloud Codex]\n```\n'
    for component in ['docs'] + COMPONENTS:
        folder = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
        chosen = media if component in ['docs', 'delivery', 'extension'] else [cp['screenshots'][1], *cp['recordings'][0]['files']]
        for row in chosen:
            relative = ('design/implementation/' if component == 'docs' else 'media/') + 'integrated-recovery-' + Path(row['path']).name
            target = folder / relative; target.parent.mkdir(parents=True, exist_ok=True); assert not target.exists(); shutil.copyfile(DEV / row['path'], target)
            assert digest(target) == row['sha256']; copies.append({'source': 'dev/' + row['path'], 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
        for name in ['README.md', 'README.en.md']:
            p = folder / name; old = p.read_bytes(); assert MARKER.encode() not in old
            saved = archive / component / name; saved.parent.mkdir(parents=True, exist_ok=True); assert not saved.exists(); saved.write_bytes(old)
            title, body = old.split(b'\n', 1); en = name.endswith('.en.md')
            text = MARKER + '\n' + ('Extension attachment recovery and the complete backend regression are qualified below.\n\n' if en else '本轮完成附件恢复及当前完整后端回归验证。\n\n')
            if component in DETAILS: text += DETAILS[component][0 if en else 1] + '\n\n'
            text += ('Validation: ' if en else '验证：') + numbers + '.\n\n'
            text += ('Actual native Chrome right Side Panel, OTP/PKCE, native PostgreSQL and pinned cloud Codex; synthetic customer/files/model decisions. Original full-product and live-provider acceptance remain unproven. Screens below show the Extension; they do not claim new pages on other clients.\n\n' if en else 'Chrome 原生右侧栏、OTP／PKCE、原生 PostgreSQL 和固定版本云端 Codex 为真实运行；客户／文件／模型决策为假数据。原始完整产品及真实供应商验收继续保留；下方为 Extension 界面，不代表其他端新增页面。\n\n')
            prefix = '' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text += '[Runbook / 方案](' + prefix + RUNBOOK + ') · [Evidence / 证据](' + prefix + 'quality/integrated-recovery-checkpoint.json)\n\n' + diagram + '\n'
            for row in chosen:
                target = ('design/implementation/' if component == 'docs' else 'media/') + 'integrated-recovery-' + Path(row['path']).name
                text += ('![Actual Extension folder import / 实际右侧栏资料夹导入](' + target + ')' if Path(row['path']).suffix in ['.png', '.gif'] else '[Actual interaction video / 实际交互录屏](' + target + ')') + '\n\n'
            p.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    for name in ['docs/technical/01-architecture-and-stack.md', 'docs/technical/12-implementation-and-repositories.md', 'docs/modules/07-web-extension-desktop.md', 'docs/quality/04-implementation-acceptance.md', 'docs/quality/01-test-and-acceptance-plan.md', 'docs/governance/04-git-branches-and-publication.md']:
        p = ROOT / name; old = p.read_bytes(); saved = archive / name; saved.parent.mkdir(parents=True, exist_ok=True); assert not saved.exists(); saved.write_bytes(old)
        title, body = old.split(b'\n', 1); text = MARKER + '\nExtension 0.5.2 补齐附件阻塞恢复、选择容量和准确字节提示；当前完整后端回归、历史升级边界、回执作废和实际路由清单独立验证。发布使用 V3 切片 proof 核查及八分支非强推。详见 [方案](../technical/120-integrated-regression-and-attachment-recovery.md) 与 [准确证据](../quality/integrated-recovery-checkpoint.json)。\n\n'
        p.write_bytes(title + b'\n\n' + text.encode() + body); changes.append({'path': name, 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q / 'requirements-alignment-progress.json'; old = progress_path.read_bytes(); progress = read(progress_path)
    (archive / 'requirements-alignment-progress.json').write_bytes(old)
    progress['integrated_regression_and_recovery'] = {'checkpoint': ref(CP), 'actual_ui_flows': 7, 'full_backend_counts': cp['full_counts'], 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n'); changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT / ('docs/changes/2026-10-28-selected-integrated-recoveries' + ('.en' if en else '') + '.md')
        text = ('# Integrated backend regression and attachment recovery\n\n' if en else '# 完整后端回归与附件恢复\n\n') + DETAILS['extension'][0 if en else 1] + '\n\n' + DETAILS['delivery'][0 if en else 1] + '\n\n' + numbers + '.\n\n[Runbook / 方案](../' + RUNBOOK + ') · [Evidence / 证据](../quality/integrated-recovery-checkpoint.json)\n'
        assert not p.exists(); p.write_text(text, encoding='utf-8', newline='\n')
    write(Q / 'integrated-recovery-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q / 'integrated-recovery-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for n, h in cp['source_files'].items(): assert digest(ROOT / n) == h, n
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    links, decoded, parser = 0, [], MarkdownIt()
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            p = folder / name; body = p.read_text('utf-8'); assert MARKER in body
            for token in parser.parse(body):
                for child in token.children or []:
                    target = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if target and not urlsplit(target).scheme and not target.startswith('#'): assert (p.parent / unquote(urlsplit(target).path)).exists(), (p, target); links += 1
    for movie in cp['recordings']:
        for row in movie['files']:
            p = DEV / row['path']; probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(p)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(p), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True); assert not result.stderr.strip(); decoded.append(row)
    original, progress = read(Q / 'history/stage96-before-solution-packages/receipt.json'), read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    write(Q / 'integrated-recovery-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    for name in ['full', 'extension', 'ui', 'clients', 'client_units']: parser.add_argument('--' + name.replace('_', '-'), dest=name)
    args = parser.parse_args()
    if args.action == 'record':
        assert all(re.fullmatch(r'\d{2}', getattr(args, name) or '') for name in ['full', 'extension', 'ui', 'clients', 'client_units'])
        record(args.full, args.extension, args.ui, args.clients, args.client_units)
    elif args.action == 'sync': sync()
    else: audit()
