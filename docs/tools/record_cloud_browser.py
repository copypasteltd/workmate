"""Bind actual browser execution, immutable role releases and bilingual delivery."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import json
import re
import shutil
import subprocess

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
QUALITY = ROOT / 'docs/quality'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']
CHECKPOINT = QUALITY / 'cloud-browser-checkpoint.json'
SCOPE = ('Actual cloud Chromium interactions and PNG captures through Codex company tools, '
         'native renderer/job measurements, source-bound failed/repaired results, scoped screenshot '
         'reads and downloads, orphan reclamation and additive software Skill/role releases. '
         'Fourteen related suites and authenticated Web checks use synthetic provider responses '
         'and credit. Full product and professional-role acceptance remain unproven.')


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}


def write_new(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def record(args):
    selected = {kind: f'evidence/cloud-browser-{kind}-{getattr(args, kind)}.json' for kind in ['core', 'ui']}
    reports = {kind: read(DELIVERY / name) for kind, name in selected.items()}
    sources, scopes = {}, []
    for kind, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], kind
        for name, expected in report['source_files'].items():
            file = DEV / name
            assert digest(file) == expected, file
            relative = file.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == expected, relative
            sources[relative] = expected
        scopes.append({'kind': kind, **ref(DELIVERY / selected[kind]), 'source_files': len(report['source_files'])})
        for key in ['raw_report', 'verifier', 'journey_verifier', 'journey']:
            if report.get(key):
                assert digest(DELIVERY / report[key]['path']) == report[key]['sha256'], key
    core, ui = reports['core'], reports['ui']
    assert core['counts'] == {'tests': 113, 'pass': 113, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert core['test_exit'] == 0 and core['owned_database_shutdown'] and len(core['test_files']) == 14
    assert ui['packaged_unchanged'] and ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(v['reclaimed'] for v in ui['fixture_cleanup']['results'])
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 4
    assert all(journey[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['provider_calls'] == 6 and journey['task']['execution_location'] == 'cloud'
    assert journey['task']['status'] == 'succeeded' and int(journey['task']['charged_micros']) > 0
    assert len(journey['screenshots']) == 3 and journey['media']['distinct_frames'] > 1
    assert journey['media']['skipped_capture_errors'] == 0
    for row in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / row['path']) == row['sha256']
    assert all(row['edited'] is False for row in journey['screenshots'])
    prior = read(QUALITY / 'cloud-development-checkpoint.json')
    baseline = read(ROOT / prior['preservation']['receipt']['path'])
    assert len(baseline['published_files']) == 646
    for name, expected in baseline['published_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in prior['new_migrations']:
        assert digest(ROOT / row['path']) == row['sha256']
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts, raw, archived = [], [], 0
    for file in sorted((DELIVERY / 'evidence').glob('cloud-browser-*')):
        if not file.is_file():
            continue
        raw.append(ref(file))
        if re.fullmatch(r'cloud-browser-(core|ui)-\d{2}\.json', file.name):
            result = read(file)
            row = {**ref(file), 'machine_status': result['status'], 'selected': file in [DELIVERY / v for v in selected.values()]}
            if file.name == 'cloud-browser-core-01.json':
                row['not_selected_reason'] = 'Real compiled browser succeeded; probe export failed to create the nested sources directory. Preserved failure before the suite.'
            attempts.append(row)
            if '-core-' in file.name:
                archive = file.with_name(file.stem + '-sources')
                for name, expected in result['source_files'].items():
                    assert digest(archive / name) == expected, archive / name
                    archived += 1
    platform = DEV / 'copypaste-platform'
    host = platform / '.data/cloud-browser-host/manifest.json'
    native = read(host)
    contract = platform / 'contracts/cloud-browser-runtime.json'
    profile = read(contract)
    assert native['host_source_sha256'] == digest(platform / 'src/cloud-browser-host.cs')
    assert native['host_sha256'] == digest(host.with_name('cloud-browser-host.exe'))
    assert native['profile_sha256'] == digest(contract) and len(profile['files']) == 305
    clean_download = DELIVERY / 'evidence/cloud-browser-clean-download-01.json'
    fetched = read(clean_download)
    assert fetched['status'] == 'passed' and fetched['contract_sha256'] == digest(contract)
    assert fetched['files'] == 305 and fetched['browser_version'] == profile['browser_version']
    for item in profile['files']:
        file = host.parent / 'chromium' / item['path']
        assert file.stat().st_size == item['bytes'] and digest(file) == item['sha256']
    release_file = platform / 'catalog/software-toolchain-release-v1.json'
    release = read(release_file)
    assert len(release['roles']) == 6 and len(release['skill_packages']) == 4
    for package in release['skill_packages']:
        assert package['version'] == '1.1.0' and digest(platform / package['path']) == package['sha256']
    write_new(CHECKPOINT, {
        'at': datetime.now(timezone.utc).isoformat(), 'stage': 101, 'status': 'verified_scoped_cloud_browser',
        'scope': SCOPE, 'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'ui_checks': 4,
        'execution': journey['task'], 'provider_calls': 6, 'screenshots': journey['screenshots'], 'recordings': [journey['media']],
        'packaged': ui['packaged'], 'browser_guardian': native, 'browser_contract': ref(contract), 'clean_download': ref(clean_download),
        'software_release': {**ref(release_file), 'new_skills': 4, 'new_role_versions': 6, 'permissions_expanded': False},
        'all_attempts': attempts, 'raw_evidence': raw, 'exact_archived_source_files': archived,
        'new_migrations': [ref(platform / 'migrations/117-cloud-browser-preview.sql')],
        'preservation': {'receipt': prior['preservation']['receipt'], 'published_files': 646, 'published_migrations': 116,
                         'prior_checkpoint': ref(QUALITY / 'cloud-development-checkpoint.json'), 'original_requirements': 102, 'original_gates_unchanged': True},
        'visual_review': {'selected': 'ui-' + args.ui, 'reviewed_unedited_screenshots': 3,
                          'observations': ['Actual task screenshot loaded with named DOM assertions', 'Current pass and stale failure retained with exact-source downloads', '390px Chinese dark layout and dates checked for overflow']},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_scoped_cloud_browser', 'sources': len(sources), 'attempts': len(attempts), 'archived': archived}))


def sync():
    cp = read(CHECKPOINT)
    assert cp['status'] == 'verified_scoped_cloud_browser'
    archive = QUALITY / 'history/stage101-documents'
    archive.mkdir()
    changes, copies = [], []

    def change(file, content):
        component = next((v for v in COMPONENTS if file.is_relative_to(DEV / ('copypaste-' + v))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = file.relative_to(repo).as_posix()
        before = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'show', 'HEAD:' + name], cwd=repo)
        assert file.read_bytes() == before or file.read_bytes().replace(b'\r\n', b'\n') == before
        backup = archive / (component or 'docs') / name
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(before)
        file.write_bytes(content)
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': backup.relative_to(ROOT).as_posix(),
                        'before_sha256': sha256(before).hexdigest(), 'before_source': 'published_git_blob', 'after_sha256': digest(file)})

    folders = [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]
    for folder in folders:
        if folder == DEV / 'copypaste-web':
            continue
        for item in cp['screenshots'] + [v for recording in cp['recordings'] for v in recording['files']]:
            source = DEV / item['path']
            target = folder / 'assets/screenshots' / Path(item['path']).name
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists()
            shutil.copyfile(source, target)
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
    roles = {
        'docs': ('本次连接软件角色版本、云端页面执行、确切源码及用户可见证据。', 'This delivery connects software role versions, cloud page execution, exact source and customer-visible evidence.'),
        'platform': ('后端提供固定浏览器、原生进程守护、任务工具和私有截图接口。', 'The backend supplies the pinned browser, native process guardian, task tool and private screenshot APIs.'),
        'web': ('Web 任务详情可按需展开实际页面截图、断言和版本记录，并下载原图及源码。', 'Web task details lazily display the actual page screenshot, assertions and source versions with image/source downloads.'),
        'admin': ('Admin 继续使用企业、来源、用户和内容权限管理；下图来自实际用户端 Web 任务。', 'Admin uses tenant, source, user and content controls; the images below show an actual customer Web task.'),
        'desktop': ('Desktop 继续在客户本机运行 Codex；检查组件独立构建及打包，下图实际来自 Web 云端任务。', 'Desktop keeps customer-local Codex. Its check component was independently built and packaged; the images below show a Web cloud task.'),
        'extension': ('Extension 保持原生右侧面板和授权文件上传；下图来自对应的 Web 云端执行。', 'Extension retains the native right Side Panel and authorized uploads; the images below show the corresponding Web cloud execution.'),
        'delivery': ('验证脚本运行真实 Codex、Chromium、PostgreSQL 和下载，并核对任务自有进程回收。', 'The verifiers run actual Codex, Chromium, PostgreSQL and downloads and check owned-process cleanup.')}
    for folder in folders:
        component = folder.name.removeprefix('copypaste-') if folder != ROOT / 'docs' else 'docs'
        for name in ['README.md', 'README.en.md']:
            file = folder / name
            en = name.endswith('.en.md')
            checkpoint = 'quality/cloud-browser-checkpoint.json' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-browser-checkpoint.json'
            design = 'technical/101-cloud-browser-preview.md' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/101-cloud-browser-preview.md'
            text = '<!-- cloud-browser-stage101 -->\n\n'
            text += ('Cloud Codex now performs actual page interactions and DOM checks with a pinned native Chromium runtime, retaining a real screenshot and exact source. ' if en else '云端 Codex 现可使用固定的原生 Chromium 执行真实页面交互和 DOM 检查，保留实际截图及确切源码。') + roles[component][int(en)] + '\n\n'
            text += ('Usage: sign in, select an authorized software role and approve a cloud task/budget. Codex writes an HTML entry and local assets, executes named page checks, repairs failures and repeats. Expand Software checks to see the actual PNG and expected/actual values; download execution files or the matching source package. Four additive Skill packages and six role versions preserve historical approved bindings and do not expand permissions.\n\n' if en else '使用：登录并选择具有工具授权的软件角色，批准云端任务及预算。Codex 写入 HTML 和本地资源、执行具名检查，修复失败后重新执行。在「软件检查记录」展开实际 PNG 与预期/实际断言，下载执行文件或匹配源码包。新增四份 Skill 和六个角色版本，保留已批准任务的历史绑定，不扩大角色权限。\n\n')
            if component in ['platform', 'delivery']:
                text += ('Backend setup on Windows x64: `npm ci`, then `node scripts/setup-cloud-browser.mjs --download` for the first installation (or `--source <approved-folder>`); subsequently run setup without arguments to reverify. Build and run `node scripts/probe-cloud-browser.mjs --compiled`. Exact browser files, guardian and native renderer/job measurements are required.\n\n' if en else '后端 Windows x64 配置：`npm ci` 后首次执行 `node scripts/setup-cloud-browser.mjs --download`，或使用 `--source <approved-folder>`；已有运行目录不带参数重新核验。构建后运行 `node scripts/probe-cloud-browser.mjs --compiled`。必须通过浏览器文件、守护程序及原生 renderer/Job 测量。\n\n')
            text += ('Verified: 113 checks in fourteen related suites and four authenticated Web journey checks; actual Codex, browser and downloads, synthetic provider responses and credit. Static task preview and independent API/SQLite checks do not establish a combined deployed application, arbitrary npm/framework support, live professional quality or complete product acceptance. Chromium policy restrictions are separate from an OS-wide no-network guarantee. Earlier notes below keep their historical scope.\n\n' if en else '验证：十四个相关测试文件的 113 项检查及 4 项登录 Web 流程；Codex、浏览器和下载真实运行，模型响应和额度使用假数据。静态任务预览及独立 API/SQLite 检查不代表已连通部署应用、任意 npm/框架、真实模型专业质量或全产品验收。浏览器策略限制不等于操作系统级无网络保证。下方旧说明保留历史验证范围。\n\n')
            text += '[Evidence / 证据](' + checkpoint + ') · [Design, setup and limits / 方案、安装与边界](' + design + ').\n\n'
            text += '```mermaid\nflowchart LR\n A[Authorized cloud task] --> B[Codex writes exact source]\n B --> C[Native Chromium actions and assertions]\n C --> D[Actual PNG and version-bound receipt]\n D --> E[Scoped UI and downloads]\n B --> F[Repair failed source]\n F --> C\n```\n\n'
            for item in [cp['screenshots'][0], cp['screenshots'][2]]:
                text += '![Actual Web browser checks / 实际 Web 页面检查](assets/screenshots/' + Path(item['path']).name + ')\n\n'
            for ext in ['.gif', '.mp4']:
                item = next(v for v in cp['recordings'][0]['files'] if v['path'].endswith(ext))
                text += ('![Actual Web interaction / 实际 Web 交互]' if ext == '.gif' else '[Actual interaction MP4 / 实际交互录像]') + '(assets/screenshots/' + Path(item['path']).name + ')\n\n'
            raw = file.read_bytes()
            marker = b'<!-- cloud-development-stage100 -->'
            assert marker in raw
            change(file, raw.replace(marker, text.encode('utf-8') + marker, 1))
    progress_file = QUALITY / 'requirements-alignment-progress.json'
    progress = read(progress_file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['cloud_browser_execution'] = {'checkpoint': ref(CHECKPOINT), 'current_sources': True, 'core_tests': 113, 'ui_checks': 4, 'synthetic_model': True, 'full_acceptance': 'not_proven'}
    change(progress_file, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    note = ('\n\n## 阶段 101 实际云端页面检查 / Stage 101 actual cloud browser checks\n\n'
            '云端 Codex 新增实际 Chromium 页面交互、DOM 断言、原始截图及确切源码交付。固定原生运行时，在 Windows Job 内核对实际 renderer token，超时、取消及控制器异常退出后回收所属进程。页面使用独立来源 sandbox iframe、任务内资源和离线请求策略；不宣称 Chrome broker 具有操作系统级无网络权限。截图接口重新校验私有任务、来源与文件版本。新增四份 Skill 1.1.0 和六个软件角色 1.1.0，保留旧版本及权限边界。113 项相关测试和 4 项实际登录 Web 流程使用假模型与额度；Desktop 继续在客户本机运行 Codex，独立构建及打包。\n\n'
            'Cloud Codex performs actual page interactions, assertions and PNG capture against exact task source. Native Jobs and measured renderer restrictions accompany cancellation/orphan cleanup. Private screenshot reads recheck task/source/version access. Four new Skill packages and six role versions preserve historical bindings and permissions. The 113 related checks and four Web checks use synthetic model responses and credit. Desktop remains customer-local and is built and packaged independently.\n\n'
            '[Design / 设计](../technical/101-cloud-browser-preview.md) · [Evidence / 证据](../quality/cloud-browser-checkpoint.json). Static browser, API and SQLite checks remain independent; combined deployed applications, arbitrary packages, live role quality and full product acceptance require separate evidence. Original requirement and gate decisions remain unchanged.\n\n')
    for name in ['docs/requirements/01-srs.md', 'docs/modules/02-agents-tasks-memory.md', 'docs/quality/01-test-and-acceptance-plan.md', 'docs/governance/04-git-branches-and-publication.md', 'docs/technical/01-architecture-and-stack.md']:
        file = ROOT / name
        title, body = file.read_bytes().split(b'\n', 1)
        change(file, title + b'\n' + note.encode('utf-8') + body)
    for en in [False, True]:
        file = ROOT / ('docs/changes/2026-10-26-cloud-browser' + ('.en' if en else '') + '.md')
        title = '# Actual cloud browser checks and versioned software Skills' if en else '# 实际云端页面检查与软件 Skill 版本'
        with file.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write((title + '\n' + note).rstrip('\n') + '\n')
    write_new(archive / 'receipt.json', {'files': changes})
    write_new(QUALITY / 'cloud-browser-documentation-refresh.json', {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(CHECKPOINT), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'documents': len(changes), 'media_copies': len(copies)}))


def audit():
    cp = read(CHECKPOINT)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    refresh = read(QUALITY / 'cloud-browser-documentation-refresh.json')
    assert refresh['checkpoint']['sha256'] == digest(CHECKPOINT) and len(refresh['changes']) == 20
    for row in refresh['changes']:
        assert digest(ROOT / row['path']) == row['after_sha256'] and digest(ROOT / row['archive']) == row['before_sha256']
    for row in refresh['media_copies']:
        assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    decoded = []
    for row in cp['recordings'][0]['files']:
        file = DEV / row['path']
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', str(file)]))
        frames = int(probe['streams'][0]['nb_read_frames'])
        assert frames > 1 and abs(float(probe['format']['duration']) - cp['recordings'][0]['seconds']) <= .25
        result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(file), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
        assert not result.stderr.strip() and digest(file) == row['sha256']
        decoded.append({**row, 'fully_decoded': True, 'decoded_frames': frames, 'probe': probe})
    parser, links = MarkdownIt(), 0
    readmes = [ROOT / 'docs' / n for n in ['README.md', 'README.en.md']] + [DEV / ('copypaste-' + c) / n for c in COMPONENTS for n in ['README.md', 'README.en.md']]
    for file in readmes:
        body = file.read_text(encoding='utf-8')
        assert '<!-- cloud-browser-stage101 -->' in body and '```mermaid' in body
        for token in parser.parse(body):
            for child in token.children or []:
                value = child.attrGet('href') if child.type == 'link_open' else child.attrGet('src') if child.type == 'image' else None
                if value and not urlsplit(value).scheme and not value.startswith('#'):
                    assert (file.parent / unquote(urlsplit(value).path)).resolve().exists(), (file, value)
                    links += 1
    baseline = read(ROOT / cp['preservation']['receipt']['path'])
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    write_new(QUALITY / 'cloud-browser-docs-audit-01.json', {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(CHECKPOINT), 'bilingual_readmes': len(readmes), 'source_files': len(cp['source_files']), 'local_links': links, 'recordings': decoded, 'original_requirements_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': len(readmes), 'links': links, 'fully_decoded_media': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--core', default='02')
    parser.add_argument('--ui', default='01')
    args = parser.parse_args()
    if args.action == 'record':
        record(args)
    elif args.action == 'sync':
        sync()
    else:
        audit()
