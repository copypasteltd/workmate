"""Bind controlled native updates to exact source archives and real UI evidence."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import re
import shutil
import subprocess
from hashlib import sha256
from record_cloud_events import ROOT, DEV, L, Q, COMPONENTS, read, digest, ref, write, checked

CP = Q / 'desktop-updates-checkpoint.json'
RUNBOOK = 'technical/116-desktop-updates.md'
MARKER = '<!-- desktop-updates-stage116 -->'


def record(core, native, ui, clients):
    selected = [L / f'evidence/desktop-updates-{scope}-{attempt}.json'
                for scope, attempt in [('core', core), ('native', native), ('ui', ui), ('clients', clients)]]
    backend, local, browser, builds = [checked(p) for p in selected]
    for value in [backend, local, browser, builds]:
        assert value['status'] == 'passed' and value['owned_database_shutdown']
        assert all(c['exit_code'] == 0 for c in value['checks'])
    for value in [backend, local, builds]:
        assert value['verifier_sha256'] == digest(L / 'scripts/run-desktop-updates-v1.mjs')
    assert browser['verifier_sha256'] == digest(L / 'scripts/run-desktop-updates-ui-v1.mjs')
    assert browser['journey_verifier_sha256'] == digest(L / 'scripts/qa-desktop-updates-ui-v1.ts')
    assert browser['owned_preview_closed'] and len(builds['checks']) == 13
    counts = {'backend': next(c['counts'] for c in backend['checks'] if c['name'] == 'backend'),
              **{c['name']: c['counts'] for c in local['checks'] if 'counts' in c}}
    for count in counts.values():
        assert count['tests'] == count['pass'] > 0
        assert all(count[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    command = next(c['args'] for c in backend['checks'] if c['name'] == 'backend')
    assert {a for a in command if a.startswith('tests/')} == {
        'tests/' + name + '.test.ts' for name in
        ['desktop-updates', 'client-content', 'admin-identities', 'migrations', 'auth-contract', 'native-recovery']}
    tap = (L / next(c['raw_report']['path'] for c in backend['checks'] if c['name'] == 'backend')).read_text('utf-8')
    assert re.search(r'^ok \d+ - native encrypted backup restores signed publication and exact installer bytes, resets only incomplete upload parts\r?$', tap, re.M)
    jp = L / browser['journey']['path']
    assert digest(jp) == browser['journey']['sha256']
    journey = read(jp)
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 4 and len(journey['screenshots']) == 5
    assert len(journey['recordings']) == 2 and len(journey['layouts']) == 5
    assert all(journey[k] for k in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed'])
    for layout in journey['layouts']:
        assert not layout['document_horizontal'] and not layout['root_horizontal']
        assert layout['visible_vertical_rails'] == 0
        if layout['label'].startswith('Desktop'): assert layout['root_top'] == 40
    for movie in journey['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
    sources = {}
    for p, value in zip(selected, [backend, local, browser, builds]):
        assert value['source_files'] == backend['source_files'], p
        archive = p.with_suffix('').with_name(p.stem + '-sources')
        for name, expected in value['source_files'].items():
            assert digest(DEV / name) == digest(archive / name) == expected, name
            sources['dev/' + name] = expected
    contract = ROOT / 'docs/contracts/desktop-updates.openapi.json'
    mirror = DEV / 'copypaste-platform/contracts/desktop-updates-schemas.json'
    assert read(contract)['x-runtime-schema-sha256'] == digest(mirror)
    assert read(contract)['components']['schemas'] == read(mirror)['schemas']
    assert len(read(contract)['paths']) == 6
    sources[contract.relative_to(ROOT).as_posix()] = digest(contract)
    assert (DEV / 'copypaste-platform/src/desktop-update-contract.ts').read_bytes() == (DEV / 'copypaste-desktop/src/desktop-update-contract.ts').read_bytes()
    previous = read(Q / 'cloud-events-checkpoint.json')
    for name, expected in previous['source_files'].items():
        if name.startswith('dev/copypaste-platform/migrations/'): assert sources[name] == expected, name
    for row in journey['screenshots'] + [f for m in journey['recordings'] for f in m['files']]:
        assert digest(DEV / row['path']) == row['sha256']
    package_path = L / 'evidence/desktop-updates-package-02.json'
    package = read(package_path)
    assert package['status'] == 'passed' and package['source_unchanged']
    assert package['source_files'] == backend['source_files']
    assert not package['installer_executed'] and not package['company_signed']
    assert package['verifier_sha256'] == digest(ROOT / 'docs/tools/record_desktop_updates_package_v2.py')
    assert digest(L / package['raw_report']['path']) == package['raw_report']['sha256']
    assert package['packaged']['version'] == '0.6.0'
    assert package['packaged']['native_helper_manifest']['source_sha256'] == digest(DEV / 'copypaste-desktop/src/update-installer-host.cs')
    for artifact in package['packaged']['artifacts']:
        assert digest(ROOT / artifact['path']) == artifact['sha256']
    original = read(Q / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts = []
    for p in sorted((L / 'evidence').glob('desktop-updates-*-??.json')):
        value = checked(p)
        attempts.append({**ref(p), 'status': value['status'], 'error': value.get('error')})
    prior = Q / 'history/stage116-previous-publication.json'
    assert not prior.exists()
    shutil.copyfile(Q / 'workmate-publication.json', prior)
    prep = L / '.data/preparation/desktop-updates-116/receipt.json'
    dest = Q / 'history/stage116-before-desktop-updates/receipt.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    assert not dest.exists()
    shutil.copyfile(prep, dest)
    write(CP, dict(at=datetime.now(timezone.utc).isoformat(), stage=116,
        status='verified_controlled_desktop_updates',
        scope='Windows x64 native Desktop update controller and MFA-separated Admin release operations: offline Ed25519 canonical signed manifests, monotonic encrypted journal, exact signer and native WinVerifyTrust, bounded resumable chunks, channel CAS, withdrawal and controlled rollback, local-operation admission/checkpoints, fixed-argument locked installer handoff, encrypted backup/isolated restore. Native PostgreSQL, Electron, Windows trust and pinned Codex are real. Synthetic accounts/model and inert signed Node fixture; no company-signed installed-product upgrade, macOS, live-model or full-product acceptance.',
        source_files=dict(sorted(sources.items())), selected_core=ref(selected[0]), selected_native=ref(selected[1]),
        selected_ui=ref(selected[2]), client_builds=ref(selected[3]), counts=counts, build_checks=13,
        journey=ref(jp), actual_ui_checks=4, screenshots=journey['screenshots'], recordings=journey['recordings'], layouts=journey['layouts'],
        attempts=attempts, new_migrations=['127-desktop-updates.sql'], retained_stage115=ref(Q / 'cloud-events-checkpoint.json'),
        previous_publication=ref(prior), baseline=ref(dest), api_contract=ref(contract),
        native_codex=local['native_codex'], product_version='0.6.0', installer_executed=False,
        development_package=ref(package_path),
        company_signed_upgrade_qualified=False, original_requirements_modified=False,
        fully_accepted_requirements=0, qualified_live_roles=0, live_provider_qualified=False,
        verifier_sha256=digest(Path(__file__))))
    print(json.dumps({'status': 'verified_controlled_desktop_updates', 'counts': counts, 'sources': len(sources), 'ui': 4}))


DETAILS = {
    'platform': (
        'Apply migration 127; SQL001–126 stay byte-identical. Configure DESKTOP_UPDATE_PUBLIC_KEYS and DESKTOP_UPDATE_MIN_SEQUENCE with public trust only. Existing administrators obtain the separate read/stage/publish global permissions through the documented enrolled-super-admin CLI, which revokes old admin sessions. Stage an offline-signed manifest with a reason, upload canonical 4 MiB chunks, finalize the exact hash, then publish against the exact channel revision and manifest digest. Public clients receive only current valid signed heads and their fixed hash artifact. Encrypted native backup now preserves ready/published installers and channel state; isolated restore clears incomplete upload parts.',
        '执行新增迁移 127，SQL001–126 字节不变。DESKTOP_UPDATE_PUBLIC_KEYS 与 DESKTOP_UPDATE_MIN_SEQUENCE 只配置公钥信任。旧管理员经文档中的已注册全局 super admin 命令取得独立 read／stage／publish 权限，并撤销旧会话。填写原因暂存离线签名清单、上传规范 4 MiB 块、校验完整摘要，再以频道版本和清单摘要发布。公开接口只提供当前有效签名头和固定哈希文件。原生加密备份涵盖已完成安装包及频道状态；隔离恢复清除未完成上传的分块记录。'),
    'admin': (
        'Open Desktop releases with MFA within ten minutes and global desktop release permissions. Choose stable/preview, paste the offline-signed JSON and staging reason, select its matching installer and upload or resume. Review version, expiry, rollout, full file/certificate hashes and channel revision; publication requires its own permission, confirmation and reason. Publish a higher signed withdrawal or an exact previously published artifact under a higher signed rollback sequence. The dashboard never receives private signing keys, never forces an installation and retains immutable publication history.',
        '在十分钟内 MFA 及全局发布权限下打开 Desktop 发布。选择 stable／preview，输入离线签名 JSON 和暂存原因，选择匹配安装包并上传或继续上传。核对版本、期限、分批比例、文件／证书完整摘要及频道版本；发布须有独立权限、勾选确认和原因。撤回使用更高序号签名清单；回滚选择曾发布的完全相同文件并使用新序号签名。后台不接收私钥、不强制安装，保留不可变历史。'),
    'desktop': (
        'Desktop 0.6.0: click the custom title-bar update icon before login, or Updates in account settings. Check → download → native verification → locally confirm installation. The main process verifies canonical Ed25519 metadata, version/rollout/expiry and an encrypted monotonic sequence journal; streams the fixed company-origin artifact; checks full SHA-256, Windows certificate chain and exact signing certificate. Installation admits no new local work, requires all agent/schedule/program/browser checkpoints, rechecks the current head and uses a locked native helper with fixed arguments and an explicit commit handshake. Development/portable builds download and verify but require manual installation. Build production installers with npm run package:release, explicit public trust/minimum sequence and company signing credentials; unsigned release packaging fails closed. Never substitute the inert signed test binary for a product installer. Existing local Codex and customer-controlled full permission remain in place.',
        'Desktop 0.6.0：登录前可点击自绘标题栏更新图标，登录后也能在账户设置进入。检查→下载→原生验证→本机确认安装。主进程验证 Ed25519 规范清单、版本／分批／期限及加密单调序号；流式下载公司同源固定文件，核验完整 SHA-256、Windows 证书链及精确签署证书。安装时关闭新本机操作入口，等待 Agent／计划／程序／浏览器检查点，再核对当前发布，以锁定原生助手、固定参数和明确提交握手安装。开发／可携版本可下载验证，安装需手动进行。正式安装包使用 npm run package:release，显式提供公钥／最低序号和公司签名凭据；未签名正式打包直接失败。惰性测试文件不能替代产品安装包。本机 Codex 与客户可主动授予的完整权限继续保留。'),
    'web': (
        'This release adds the company Desktop update service and Admin operations. Web continues to use company-cloud Codex and requires no Desktop installation. It does not silently install native software or gain local file access; screenshots below identify the affected Desktop/Admin surfaces.',
        '本次新增公司 Desktop 更新服务和后台发布操作。Web 继续使用公司云端 Codex，无须安装 Desktop。不会静默安装本机软件或取得本机文件权限；下方截图明确展示本次受影响的 Desktop／Admin 界面。'),
    'extension': (
        'The native right Chrome Side Panel retains chat, customer-selected files and cloud Codex execution. Desktop updates are managed by the Desktop main process and Admin; the extension cannot download or run installers through its bridge. The cross-product screenshots below show those release surfaces.',
        '原生 Chrome 右侧 Side Panel 保留对话、客户选取文件及云端 Codex 执行。Desktop 更新由 Desktop 主进程和后台管理，扩展桥接不能下载或启动安装程序。下方跨产品截图展示对应发布界面。'),
    'delivery': (
        'Reproduce with node scripts/run-desktop-updates-v1.mjs NN core|native|clients and node scripts/run-desktop-updates-ui-v1.mjs NN, using a new two-digit attempt each time. The suites bind exact source archives, raw TAP, native trust and real Electron/Admin recordings, then close owned native PostgreSQL/browser/Electron services. Preserve failed attempts and executed verifiers. The signed Node fixture is downloaded/verified but never installed or executed. Docker, WSL and other virtualization are prohibited.',
        '使用 node scripts/run-desktop-updates-v1.mjs NN core|native|clients 及 node scripts/run-desktop-updates-ui-v1.mjs NN 复现，每次使用新的两位尝试编号。套件绑定准确源码、原始 TAP、原生信任检查及真实 Electron／Admin 录制，结束关闭自建原生 PostgreSQL／浏览器／Electron 服务。保留失败尝试和已执行核查脚本。签名 Node 夹具仅下载与校验，绝不安装或执行。禁止 Docker、WSL 和其他虚拟化。')}


def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    changes, copies = [], []
    media = cp['screenshots'] + [f for m in cp['recordings'] for f in m['files']]
    diagram = '```mermaid\nflowchart LR\n  Sign[Offline signed release] --> Admin[Global MFA release review]\n  Admin --> Head[Versioned company channel]\n  Head --> Desktop[Local Desktop verification]\n  Desktop --> Trust[Hash and Windows signer trust]\n  Trust --> Confirm[Customer confirmation]\n  Confirm --> Idle[Local work checkpoints]\n  Idle --> Helper[Locked native installer handoff]\n```\n'
    counts = cp['counts']
    numbers = f"{counts['backend']['tests']} backend + {counts['desktop-unit']['tests']} Desktop + {counts['native-codex']['tests']} native Codex checks; 13 builds; 4 real UI flows; 5 layouts; 2 GIF/MP4 pairs"
    for component in ['docs'] + COMPONENTS:
        folder = ROOT / 'docs' if component == 'docs' else DEV / ('copypaste-' + component)
        chosen = media if component in ['docs', 'delivery'] else [r for r in media if r['path'].startswith('copypaste-' + ('admin' if component == 'platform' else component) + '/')]
        if not chosen: chosen = [cp['screenshots'][2], *cp['recordings'][1]['files']]
        for row in chosen:
            src = DEV / row['path']
            relative = ('design/implementation/' if component == 'docs' else 'media/') + 'desktop-updates-' + Path(row['path']).parts[0] + '__' + src.name
            dst = folder / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            assert not dst.exists()
            shutil.copyfile(src, dst)
            assert digest(dst) == row['sha256']
            copies.append({'source': src.relative_to(ROOT).as_posix(), 'target': dst.relative_to(ROOT).as_posix(), 'sha256': digest(dst)})
        for name in ['README.md', 'README.en.md']:
            p = folder / name
            old = p.read_bytes()
            assert MARKER.encode() not in old
            title, body = old.split(b'\n', 1)
            en = name.endswith('.en.md')
            text = MARKER + '\n' + ('Controlled Desktop updates now connect Admin release operations, signed downloads and local installation admission.\n\n' if en else '已接通 Desktop 受控更新：后台发布、签名下载及本机安装准入。\n\n')
            if component in DETAILS: text += DETAILS[component][0 if en else 1] + '\n\n'
            text += ('Validation: ' if en else '验证：') + numbers + '.\n\n'
            text += ('Real Windows trust and Electron; synthetic accounts/models and an inert signed test file. Company-signed installed-product upgrades, macOS and complete product/live-model acceptance remain unqualified.\n\n' if en else 'Windows 信任检查与 Electron 为实际运行；账户／模型及惰性签名文件为测试夹具。公司签名安装版本的完整升级、macOS、完整产品与真实模型验收仍未证明。\n\n')
            prefix = '' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text += '[Runbook / 方案](' + prefix + RUNBOOK + ') · [Evidence / 证据](' + prefix + 'quality/desktop-updates-checkpoint.json)\n\n' + diagram + '\n'
            for row in chosen:
                target = ('design/implementation/' if component == 'docs' else 'media/') + 'desktop-updates-' + Path(row['path']).parts[0] + '__' + Path(row['path']).name
                text += ('![Actual Desktop/Admin update UI / 实际更新界面](' + target + ')' if Path(row['path']).suffix in ['.png', '.gif'] else '[Actual interaction video / 实际交互视频](' + target + ')') + '\n\n'
            p.write_bytes(title + b'\n\n' + text.encode() + body)
            changes.append({'path': p.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(p)})
    progress_path = Q / 'requirements-alignment-progress.json'
    old = progress_path.read_bytes()
    progress = read(progress_path)
    progress['controlled_desktop_updates'] = {'checkpoint': ref(CP), 'counts': counts, 'actual_ui_flows': 4, 'company_signed_upgrade_qualified': False, 'original_requirements_modified': False, 'full_acceptance': 'not_proven'}
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    changes.append({'path': progress_path.relative_to(ROOT).as_posix(), 'before_sha256': sha256(old).hexdigest(), 'after_sha256': digest(progress_path)})
    for en in [False, True]:
        p = ROOT / ('docs/changes/2026-10-28-controlled-desktop-updates' + ('.en' if en else '') + '.md')
        assert not p.exists()
        p.write_text(('# Controlled Desktop updates\n\n' if en else '# Desktop 受控更新\n\n') +
            (DETAILS['desktop'][0 if en else 1]) + '\n\n' + numbers + '.\n\n' +
            ('Native Windows verification is real. Company-signed installed-app upgrade and full-product/live-model acceptance remain unqualified. Original failed attempts are retained.\n\n' if en else '原生 Windows 验证为实际运行。公司签名已安装版本升级、完整产品和真实模型验收仍未证明，原始失败尝试完整保留。\n\n') +
            '[Runbook / 方案](../' + RUNBOOK + ') · [Evidence / 证据](../quality/desktop-updates-checkpoint.json)\n', encoding='utf-8', newline='\n')
    write(Q / 'desktop-updates-documentation-refresh.json', {'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})


def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit, unquote
    cp, refresh = read(CP), read(Q / 'desktop-updates-documentation-refresh.json')
    assert cp['verifier_sha256'] == refresh['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items(): assert digest(ROOT / name) == expected, name
    for row in refresh['changes']: assert digest(ROOT / row['path']) == row['after_sha256']
    for row in refresh['media_copies']: assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    links, decoded, parser = 0, [], MarkdownIt()
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            p = folder / name
            body = p.read_text('utf-8')
            assert MARKER in body
            for token in parser.parse(body):
                for child in token.children or []:
                    target = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if target and not urlsplit(target).scheme and not target.startswith('#'):
                        assert (p.parent / unquote(urlsplit(target).path)).exists(), (p, target)
                        links += 1
    for movie in cp['recordings']:
        for row in movie['files']:
            p = DEV / row['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', str(p)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(p), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip()
            decoded.append(row)
    original = read(Q / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(Q / 'requirements-alignment-progress.json')
    assert progress['requirements'] == original['requirements'] and progress['gates'] == original['gates']
    write(Q / 'desktop-updates-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'decoded_recordings': decoded, 'original_matrix_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--core', default='02')
    parser.add_argument('--native', default='03')
    parser.add_argument('--ui', default='02')
    parser.add_argument('--clients', default='01')
    args = parser.parse_args()
    if args.action == 'record': record(args.core, args.native, args.ui, args.clients)
    elif args.action == 'sync': sync()
    else: audit()
