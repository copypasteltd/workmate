"""Bind selected-folder code, actual right Side Panel and retained publication history."""
from pathlib import Path
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
import shutil
import subprocess
from record_cloud_events import ROOT, DEV, L, Q, COMPONENTS, read, digest, ref, write, checked

CP = Q / 'extension-folder-checkpoint.json'
RUNBOOK = 'technical/119-extension-selected-folders.md'
MARKER = '<!-- extension-folder-stage119 -->'


def record(core, ui, clients):
    paths = [L / f'evidence/extension-folder-core-{core}.json', L / f'evidence/extension-folder-ui-{ui}.json', L / f'evidence/extension-folder-clients-{clients}.json']
    backend, browser, builds = [checked(p) for p in paths]
    for v in [backend, browser, builds]:
        assert v['status'] == 'passed' and v['owned_database_shutdown']
        assert all(c['exit_code'] == 0 for c in v['checks'])
    for v in [backend, builds]: assert v['verifier_sha256'] == digest(L / 'scripts/run-extension-folder-v1.mjs')
    assert browser['verifier']['sha256'] == digest(L / 'scripts/run-extension-folder-ui-v3.mjs')
    assert browser['journey_verifier']['sha256'] == digest(L / 'scripts/qa-extension-folder-v1.ts')
    counts = {c['name']: c['counts'] for c in backend['checks'] if 'counts' in c}
    assert counts['extension-unit']['tests'] == counts['extension-unit']['pass'] == 59
    assert counts['proof-format']['tests'] == counts['proof-format']['pass'] == 1
    assert counts['backend']['tests'] == counts['backend']['pass'] >= 20
    for c in counts.values(): assert all(c[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    assert len(builds['checks']) == 13
    journey_path = L / browser['journey']['path']; assert digest(journey_path) == browser['journey']['sha256']; journey = read(journey_path)
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 6 and len(journey['screenshots']) == 7 and len(journey['recordings']) == 2 and len(journey['layouts']) == 4
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed', 'provider_closed'])
    assert browser['owned_preview_closed'] and browser['compiled_unchanged']
    assert len(journey['actual_private_reads']) == 3 and all(r['actual_tool_output'] for r in journey['actual_private_reads'])
    for v in journey['layouts']: assert not v['horizontal'] and v['confirm_visible'] and v['cancel_visible']
    for movie in journey['recordings']: assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
    sources = {'dev/' + n: h for n, h in builds['source_files'].items()}
    for p, v in zip(paths, [backend, browser, builds]):
        assert v['source_files'] == builds['source_files'], 'Selected qualification must bind final code'
        archive = p.with_suffix('').with_name(p.stem + '-sources')
        for n, h in v['source_files'].items(): assert digest(archive / n) == h
    for n, h in backend['root_sources'].items():
        assert digest(ROOT / n) == h and digest(L / ('evidence/extension-folder-core-' + core + '-root-sources') / n) == h
        assert builds['root_sources'][n] == h
        sources[n] = h
    for n, h in sources.items(): assert digest(ROOT / n) == h, n
    retained = read(Q / 'native-pairing-checkpoint.json')
    for n, h in retained['source_files'].items():
        if n.startswith(('dev/copypaste-platform/', 'dev/copypaste-desktop/', 'dev/copypaste-web/', 'dev/copypaste-admin/')): assert sources[n] == h, n
    for row in journey['screenshots'] + [f for m in journey['recordings'] for f in m['files']]: assert digest(DEV / row['path']) == row['sha256']
    previous = Q / 'history/stage119-previous-publication.json'; assert not previous.exists(); shutil.copyfile(Q / 'workmate-publication.json', previous)
    baseline = Q / 'history/stage119-before-extension-folders/receipt.json'; baseline.parent.mkdir(parents=True, exist_ok=True); assert not baseline.exists(); shutil.copyfile(L / '.data/preparation/extension-folders-119/receipt.json', baseline)
    original = read(Q / 'history/stage96-before-solution-packages/receipt.json'); progress = read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    attempts = []
    for p in sorted((L / 'evidence').glob('extension-folder-*-??.json')):
        v = read(p)
        if 'source_files' in v: checked(p)
        attempts.append({**ref(p), 'status': v['status'], 'error': v.get('error')})
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 119, 'status': 'verified_selected_extension_folders',
        'scope': 'Extension 0.5.1 standalone browser folder selection in the genuine Chrome right SIDE_PANEL. Explicit metadata-only review, customer-selected files, relative-path JSON index, sequential private resumable uploads, exact completion-response-loss retry, verified bytes/versions, import locks, cancellation and account/workspace fences. Actual OTP/PKCE, native PostgreSQL, pinned native cloud Codex reading three real private sources, one reservation/cost; synthetic company model decisions, customers and source files. Lossless publication proof shards with fail-closed validation. Partial feature qualification; original full-product, live-provider and company-signed installed-product acceptance remain unproven.',
        'source_files': dict(sorted(sources.items())), 'selected_core': ref(paths[0]), 'selected_ui': ref(paths[1]), 'client_builds': ref(paths[2]),
        'counts': counts, 'proof_reader_adversarial_cases': 7, 'build_checks': 13, 'journey': ref(journey_path), 'actual_ui_checks': 6,
        'screenshots': journey['screenshots'], 'recordings': journey['recordings'], 'layouts': journey['layouts'], 'actual_private_reads': journey['actual_private_reads'],
        'attempts': attempts, 'previous_publication': ref(previous), 'baseline': ref(baseline), 'retained_stage118': ref(Q / 'native-pairing-checkpoint.json'),
        'retained_failure_notes': {'portguard': ref(Q / 'history/stage119-ui-portguard.json'), 'ui_01': 'V2 stopped before browser launch: the native database wrapper requires .data/native-qa/<UUID>. V3 uses the existing enforced directory contract. Original report, log and source archive are retained. No existing database or virtualized environment was used.'},
        'product_version': '0.5.1', 'live_provider_qualified': False, 'original_requirements_modified': False, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0,
        'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_selected_extension_folders', 'counts': counts, 'sources': len(sources), 'actual_ui': 6}))


DETAILS = {
    'extension': ('Extension 0.5.1 adds Folder next to Attach files. Choose a browser folder, review paths/checks, confirm upload, then return and Send a message. No Desktop/nativeMessaging is needed. Up to 19 files plus a JSON index in an empty composer, each nonempty file ≤5 MiB. Hidden/build paths start unchecked; empty/oversize files cannot be selected. Completed private uploads keep exact receipts through retry. Cancel clears this batch of unsent attachments; committed private uploads follow normal retention. Scope changes discard the old review/results.', 'Extension 0.5.1 在附件旁新增「资料夹」：浏览器选择、核对路径和勾选、确认上传，返回后输入讯息并发送。无需 Desktop／nativeMessaging。空白输入框最多 19 个非空文件（每档 ≤5 MiB）及一个 JSON 索引；隐藏／建置路径预设不选，空档和过大档不可选。失败沿用精确回执重试，取消移除本批待发送附件，已提交私人上传依正常生命周期保留；换范围清除旧核对及结果。'),
    'platform': ('The existing private-conversation upload endpoints and source authorization serve folder files and their index. Actual native cloud Codex reads the uploaded index and nested text files after explicit Send, with fixed input versions, one reservation and recorded cost. No server schema or migration changes in this increment. Existing tool MIME/size rules still apply.', '资料夹文件及索引沿用私人会话上传端点与来源权限。客户明确发送后，真实云端 Codex 读取上传索引及子目录文字文件，固定输入版本、建立单次预算预留并记录费用。本轮无服务端 schema／迁移变更，文件工具原有格式和大小规则继续生效。'),
    'desktop': ('Desktop stays at 0.7.1 and runs Codex on the customer computer with explicit revocable permissions, frameless controls and hidden layout rails. This browser-folder increment changes Extension code only; it does not claim a new Desktop screen, package or installation qualification.', 'Desktop 保留 0.7.1，由客户本机运行 Codex 并明确授予可撤回权限，保持无边框及布局滚动条约束。本轮资料夹功能更新 Extension 代码，不宣称新增 Desktop 页面、安装包或安装验收。'),
    'web': ('Web continues to provide hosted cloud Codex, identity/PKCE authorization and the authenticated private project context used by the Extension. Its production code is unchanged; the actual browser journey qualifies Extension folder import and cloud source reads.', 'Web 继续提供云端 Codex、登录／PKCE 授权与 Extension 使用的私人专案上下文。本轮 Web 生产代码未变；真实浏览器流程验证 Extension 资料夹导入及云端来源读取。'),
    'admin': ('Existing admin user, usage, fees, VIP and detailed scoped content permissions continue to govern these private uploads and tasks. This increment makes no new admin access grants or screen claim; current client builds remain checked.', '既有 admin 用户、消耗、费用、VIP 及细粒度内容权限继续约束私人上传与任务。本轮不新增后台访问授权或页面声明，并核查当前各端构建。'),
    'delivery': ('Use node scripts/run-extension-folder-v1.mjs NN core|clients and node scripts/run-extension-folder-ui-v3.mjs NN with fresh attempt numbers. Publication now uses node scripts/publish-workmate-v2.mjs --push: all historical proofs are retained in ≤20 MiB hash-bound shards, and every actual Git proof is verified before the atomic eight-ref nonforce push. Failed evidence/verifiers are immutable.', '以全新编号运行 run-extension-folder-v1.mjs NN core|clients 及 run-extension-folder-ui-v3.mjs NN。发布改用 publish-workmate-v2.mjs --push：全部历史 proof 保留于 ≤20 MiB 摘要绑定切片，在八分支原子非强推前核对每条真实 Git 对象。失败证据与执行过的校验器保持原样。')}


def sync():
    cp = read(CP); assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    archive = Q / 'history/stage119-previous-documents'
    media = cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]
    numbers = f"{cp['counts']['backend']['tests']} backend + 59 Extension checks + 7 adversarial proof-reader cases; 13 builds; 6 actual UI flows; 4 layouts; 7 PNGs and 2 GIF/MP4 pairs"
    diagram = '```mermaid\nflowchart LR\n  Pick[Browser folder picker] --> Review[Review selected relative paths]\n  Review --> Confirm[Customer confirms upload]\n  Confirm --> Private[Private files and JSON index]\n  Private --> Retry[Exact unfinished upload retry]\n  Retry --> Private\n  Private --> Send[Customer sends message]\n  Send --> Codex[Company cloud Codex]\n```\n'
    for component in ['docs'] + COMPONENTS:
        folder = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
        chosen = media if component in ['docs', 'delivery', 'extension'] else [cp['screenshots'][1], *cp['recordings'][0]['files']]
        for row in chosen:
            relative = ('design/implementation/' if component == 'docs' else 'media/') + 'extension-folder-' + Path(row['path']).name
            target = folder / relative; target.parent.mkdir(parents=True, exist_ok=True); assert not target.exists(); shutil.copyfile(DEV / row['path'], target)
            assert digest(target) == row['sha256']; copies.append({'source': 'dev/' + row['path'], 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
        for name in ['README.md', 'README.en.md']:
            p = folder / name; old = p.read_bytes(); assert MARKER.encode() not in old
            saved = archive / component / name; saved.parent.mkdir(parents=True, exist_ok=True); assert not saved.exists(); saved.write_bytes(old)
            title, body = old.split(b'\n', 1); en = name.endswith('.en.md')
            text = MARKER + '\n' + ('Selected browser folders are available in Extension 0.5.1.\n\n' if en else 'Extension 0.5.1 已加入浏览器资料夹选择与核对上传。\n\n')
            if component in DETAILS: text += DETAILS[component][0 if en else 1] + '\n\n'
            text += ('Validation: ' if en else '验证：') + numbers + '.\n\n'
            text += ('Actual native Chrome right Side Panel, OTP/PKCE, native PostgreSQL and pinned cloud Codex; synthetic customer/files/model decisions. Original full-product and live-provider acceptance remain unproven. Screens below show the Extension; they do not claim new pages on other clients.\n\n' if en else 'Chrome 原生右侧栏、OTP／PKCE、原生 PostgreSQL 和固定版本云端 Codex 为真实运行；客户／文件／模型决策为假数据。原始完整产品及真实供应商验收继续保留；下方为 Extension 界面，不代表其他端新增页面。\n\n')
            prefix = '' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text += '[Runbook / 方案](' + prefix + RUNBOOK + ') · [Evidence / 证据](' + prefix + 'quality/extension-folder-checkpoint.json)\n\n' + diagram + '\n'
            for row in chosen:
                target = ('design/implementation/' if component == 'docs' else 'media/') + 'extension-folder-' + Path(row['path']).name
                text += ('![Actual Extension folder import / 实际右侧栏资料夹导入](' + target + ')' if Path(row['path']).suffix in ['.png', '.gif'] else '[Actual interaction video / 实际交互录屏](' + target + ')') + '\n\n'
            p.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    for name in ['docs/technical/01-architecture-and-stack.md', 'docs/technical/12-implementation-and-repositories.md', 'docs/modules/07-web-extension-desktop.md', 'docs/quality/04-implementation-acceptance.md', 'docs/quality/01-test-and-acceptance-plan.md', 'docs/governance/04-git-branches-and-publication.md']:
        p = ROOT / name; old = p.read_bytes(); saved = archive / name; saved.parent.mkdir(parents=True, exist_ok=True); assert not saved.exists(); saved.write_bytes(old)
        title, body = old.split(b'\n', 1); text = MARKER + '\nExtension 0.5.1 新增独立浏览器资料夹核对、私人会话可恢复上传及相对路径索引；客户另按发送后才调度云端 Codex。发布使用 V2 切片 proof 核查及八分支非强推。详见 [方案](../technical/119-extension-selected-folders.md) 与 [准确证据](../quality/extension-folder-checkpoint.json)。\n\n'
        p.write_bytes(title + b'\n\n' + text.encode() + body); changes.append({'path': name, 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q / 'requirements-alignment-progress.json'; old = progress_path.read_bytes(); progress = read(progress_path)
    (archive / 'requirements-alignment-progress.json').write_bytes(old)
    progress['extension_selected_folders'] = {'checkpoint': ref(CP), 'actual_ui_flows': 6, 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n'); changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT / ('docs/changes/2026-10-28-selected-extension-folders' + ('.en' if en else '') + '.md')
        text = ('# Selected browser folders\n\n' if en else '# Extension 资料夹核对导入\n\n') + DETAILS['extension'][0 if en else 1] + '\n\n' + DETAILS['delivery'][0 if en else 1] + '\n\n' + numbers + '.\n\n[Runbook / 方案](../' + RUNBOOK + ') · [Evidence / 证据](../quality/extension-folder-checkpoint.json)\n'
        assert not p.exists(); p.write_text(text, encoding='utf-8', newline='\n')
    write(Q / 'extension-folder-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q / 'extension-folder-documentation-refresh.json')
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
    write(Q / 'extension-folder-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['record', 'sync', 'audit'])
    for name, default in [('core', '01'), ('ui', '02'), ('clients', '01')]: parser.add_argument('--' + name, default=default)
    a = parser.parse_args()
    if a.action == 'record': record(a.core, a.ui, a.clients)
    elif a.action == 'sync': sync()
    else: audit()
