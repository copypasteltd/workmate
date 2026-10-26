"""Bind actual cloud execution, exact sources and bilingual delivery documentation."""
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
    chosen = {k: 'evidence/cloud-program-' + k + '-' + getattr(args, k) + '.json' for k in ['core', 'ui']}
    reports = {k: read(DELIVERY / v) for k, v in chosen.items()}
    sources, scopes = {}, []
    for kind, value in reports.items():
        assert value['status'] == 'passed' and value['source_unchanged'], kind
        for name, expected in value['source_files'].items():
            path = DEV / name
            assert digest(path) == expected, path
            relative = path.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == expected, relative
            sources[relative] = expected
        scopes.append({'kind': kind, **ref(DELIVERY / chosen[kind]), 'source_files': len(value['source_files'])})
        for key in ['raw_report', 'verifier', 'journey_verifier', 'journey']:
            if key in value:
                assert digest(DELIVERY / value[key]['path']) == value[key]['sha256'], key
    core, ui = (reports[k] for k in ['core', 'ui'])
    assert core['counts'] == {'tests': 83, 'pass': 83, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert core['owned_database_shutdown'] and len(core['test_files']) == 10 and core['test_exit'] == 0
    assert ui['packaged_unchanged'] and ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(v['reclaimed'] for v in ui['fixture_cleanup']['results'])
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 4
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['provider_calls'] == 7 and journey['task']['execution_location'] == 'cloud'
    assert journey['task']['status'] == 'succeeded' and int(journey['task']['charged_micros']) > 0
    assert len(journey['screenshots']) == 3 and journey['media']['distinct_frames'] > 1
    assert journey['media']['skipped_capture_errors'] == 0
    for row in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / row['path']) == row['sha256']
    assert all(row['edited'] is False for row in journey['screenshots'])
    prior = read(QUALITY / 'preset-specialists-checkpoint.json')
    baseline = read(ROOT / prior['preservation']['receipt']['path'])
    assert len(baseline['published_files']) == 646
    for name, expected in baseline['published_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in prior['new_migrations']:
        assert digest(ROOT / row['path']) == row['sha256']
    contract = 'dev/copypaste-platform/contracts/solution-packages-v1.schema.json'
    assert digest(ROOT / contract) == prior['source_files'][contract]
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts, raw, archived = [], [], 0
    for path in sorted((DELIVERY / 'evidence').glob('cloud-program-*')):
        if not path.is_file():
            continue
        raw.append(ref(path))
        if re.fullmatch(r'cloud-program-(core|ui)-\d{2}\.json', path.name):
            result = read(path)
            row = {**ref(path), 'machine_status': result['status'], 'selected': path in [DELIVERY / v for v in chosen.values()]}
            if path.name == 'cloud-program-ui-01.json':
                row['delivery_visual_selection'] = 'not_selected: checks-en captured above checks; compact-zh captured loading; replaced by ui-02'
            if path.name == 'cloud-program-ui-02.json':
                row['delivery_visual_selection'] = 'not_selected: expanded-output screenshot exposed duplicate keyed siblings after refresh; fixed and retested in ui-03'
            attempts.append(row)
            if '-core-' in path.name:
                archive = path.with_name(path.stem + '-sources')
                for name, expected in result['source_files'].items():
                    assert digest(archive / name) == expected, archive / name
                    archived += 1
    guardian = DEV / 'copypaste-platform/.data/cloud-program-host/manifest.json'
    native = read(guardian)
    assert native['source_sha256'] == digest(DEV / 'copypaste-platform/src/cloud-program-host.cs')
    assert native['sha256'] == digest(guardian.with_name('cloud-program-host.exe'))
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'stage': 99, 'status': 'verified_scoped_cloud_program_execution',
        'scope': 'Actual single-process pinned Node execution through cloud Codex company tools, exact-source failed/passed checks, authorized receipt downloads and authenticated Web UI. Ten related suites; synthetic provider and credit. Full product and professional-role acceptance remain unproven.',
        'selected': chosen, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'ui_checks': 4,
        'execution': journey['task'], 'provider_calls': 7, 'screenshots': journey['screenshots'], 'recordings': [journey['media']],
        'packaged': ui['packaged'], 'cloud_guardian': native, 'all_attempts': attempts, 'raw_evidence': raw,
        'exact_archived_source_files': archived,
        'new_migrations': [ref(DEV / 'copypaste-platform/migrations/115-cloud-program-receipts.sql')],
        'preservation': {'receipt': prior['preservation']['receipt'], 'published_files': 646, 'published_migrations': 114,
                         'prior_checkpoint': ref(QUALITY / 'preset-specialists-checkpoint.json'), 'original_requirements': 102, 'original_gates_unchanged': True},
        'visual_review': {'selected': 'ui-' + args.ui, 'reviewed_unedited_screenshots': 3, 'observations': ['Current pass and stale failure both visible', 'Actual output and download controls visible; single panel after automatic refresh', '390-pixel Chinese dark page contains loaded records without horizontal overflow']},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    write_new(QUALITY / 'cloud-program-checkpoint.json', result)
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'attempts': len(attempts), 'archived': archived}))


def sync():
    checkpoint = QUALITY / 'cloud-program-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_cloud_program_execution'
    archive = QUALITY / 'history/stage99-documents'
    archive.mkdir()
    changes, copies = [], []

    def change(path, content):
        component = next((v for v in COMPONENTS if path.is_relative_to(DEV / ('copypaste-' + v))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = path.relative_to(repo).as_posix()
        before = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'show', 'HEAD:' + name], cwd=repo)
        backup = archive / (component or 'docs') / name
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(before)
        path.write_bytes(content)
        changes.append({'path': path.relative_to(ROOT).as_posix(), 'archive': backup.relative_to(ROOT).as_posix(), 'before_sha256': sha256(before).hexdigest(), 'before_source': 'published_git_blob', 'after_sha256': digest(path)})

    folders = [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]
    for folder in folders:
        if folder == DEV / 'copypaste-web':
            continue
        for item in cp['screenshots'] + [v for row in cp['recordings'] for v in row['files']]:
            source, target = DEV / item['path'], folder / 'assets/screenshots' / Path(item['path']).name
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists()
            shutil.copyfile(source, target)
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
    roles = {
        'docs': ('本次交付连接云端执行、确切源码、检查回执及页面。', 'This delivery connects cloud execution, exact source, check receipts and the task page.'),
        'platform': ('后端新增原生执行守护、公司工具、来源复查和受权记录 API。', 'The backend adds a native guardian, a company tool, source rechecks and authorized receipt APIs.'),
        'web': ('Web 任务页展示通过、失败和过期检查，可展开输出并下载确切版本。', 'Web task pages show passed, failed and stale checks, expandable output and exact-version downloads.'),
        'admin': ('Admin 沿用现有企业、来源、文件和权限管理；下图实际来自用户端 Web 联调。', 'Admin retains existing tenant, source, asset and permission controls; the evidence below shows the actual customer Web integration.'),
        'desktop': ('Desktop 继续在客户本机运行 Codex；共享任务记录组件已独立构建，下图实际来自 Web 云端任务。', 'Desktop continues customer-local Codex execution. The shared check component was independently built; the evidence below shows an actual Web cloud task.'),
        'extension': ('Extension 保持原生右侧面板及文件上传到云端的职责；下图为相应的实际 Web 云端任务。', 'Extension keeps its native right Side Panel and authorized file-upload role; the evidence below shows the corresponding actual Web cloud task.'),
        'delivery': ('交付脚本核查真实 Codex、原生 Node、PostgreSQL、浏览器下载及自身进程清理。', 'Delivery scripts verify actual Codex, native Node, PostgreSQL, browser downloads and owned-process cleanup.')}
    for folder in folders:
        component = folder.name.removeprefix('copypaste-') if folder != ROOT / 'docs' else 'docs'
        for name in ['README.md', 'README.en.md']:
            path = folder / name
            english = name.endswith('.en.md')
            cpurl = 'quality/cloud-program-checkpoint.json' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-program-checkpoint.json'
            design = 'technical/99-cloud-program-execution.md' if component == 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/99-cloud-program-execution.md'
            text = '<!-- cloud-program-stage99 -->\n\n'
            text += ('Cloud Codex can now run actual pinned Node programs, built-in tests and syntax checks. Exact-source receipts retain failures, mark results stale after source changes, and accompany matching code packages. ' if english else '云端 Codex 现可实际运行固定 Node 程序、内置测试及语法检查。检查回执绑定确切源码、保留失败、标记代码变更，并随匹配源码打包交付。') + roles[component][int(english)] + '\n\n'
            text += ('Usage: approve an eligible cloud task and its budget, let Codex write and check the code, inspect Software checks, expand output, then download execution files or the full record. The Windows-only native boundary has no network or child processes; arbitrary npm dependencies and the other three cloud development tools remain unavailable.\n\n' if english else '使用：批准具有工具授权的云端任务及预算，由 Codex 写入和检查源码，在「软件检查记录」查看结果、展开输出并下载执行文件或完整记录。当前为 Windows 原生执行边界，禁止网络和子进程；任意 npm 依赖及另外三个云端开发工具仍未开放。\n\n')
            text += ('Verified: 83 related checks across ten suites and four actual authenticated Web journey checks. Synthetic provider responses and credit; actual Codex, native execution and downloads. ' if english else '验证：十个相关测试文件的 83 项检查及 4 项实际登录 Web 流程通过。模型响应和额度为假数据；Codex、原生执行和下载均真实。') + '[Evidence / 证据](' + cpurl + ') · [Design and limits / 方案与边界](' + design + ').\n\n'
            text += '```mermaid\nflowchart LR\n A[Authorized cloud task] --> B[Codex writes exact source]\n B --> C[Native Node check]\n C --> D[Source-bound receipt and files]\n D --> E[Task UI and matching code package]\n```\n\n'
            for row in [cp['screenshots'][0], cp['screenshots'][2]]:
                text += '![Actual Web software checks / 实际 Web 软件检查](assets/screenshots/' + Path(row['path']).name + ')\n\n'
            for ext in ['.gif', '.mp4']:
                item = next(v for v in cp['recordings'][0]['files'] if v['path'].endswith(ext))
                text += ('![Actual Web interaction / 实际 Web 交互]' if ext == '.gif' else '[Actual interaction MP4 / 实际交互录像]') + '(assets/screenshots/' + Path(item['path']).name + ')\n\n'
            raw = path.read_bytes()
            marker = b'<!-- preset-specialists-stage98 -->'
            assert marker in raw
            change(path, raw.replace(marker, text.encode('utf-8') + marker, 1))
    path = QUALITY / 'requirements-alignment-progress.json'
    progress = read(path)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['cloud_program_execution'] = {'checkpoint': ref(checkpoint), 'current_sources': True, 'core_tests': 83, 'ui_checks': 4, 'synthetic_model': True, 'full_acceptance': 'not_proven'}
    change(path, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    note = '\n\n## 阶段 99 云端程序检查 / Stage 99 cloud program checks\n\n云端 Codex 新增固定 Node 程序、内置测试及语法检查工具。原生 AppContainer/单进程 Job 限制网络、文件和进程；超时、取消及宿主中断须实际清理。回执绑定确切源码，失败及旧版本不可冒充当前通过。Web 显示实际输出、版本状态和下载；Desktop 保持客户本机执行。83 项相关测试与 4 项登录 Web 流程使用假模型和额度，实际运行 Codex、原生程序及 PostgreSQL。\n\nCloud Codex can run pinned Node programs, built-in tests and syntax checks inside a native AppContainer and single-process Job. Receipts bind exact source; failures and stale versions cannot become current passes. Web exposes output and authorized downloads. Desktop remains customer-local. The 83 related tests and four Web journey checks use synthetic model responses and credit with actual Codex, native execution and PostgreSQL.\n\n[Design / 设计](../technical/99-cloud-program-execution.md) · [Evidence / 证据](../quality/cloud-program-checkpoint.json). Original requirement and gate decisions remain unchanged; the other three cloud development tools and full professional acceptance remain unproven.\n\n'
    for name in ['docs/requirements/01-srs.md', 'docs/modules/02-agents-tasks-memory.md', 'docs/quality/01-test-and-acceptance-plan.md', 'docs/governance/04-git-branches-and-publication.md', 'docs/technical/01-architecture-and-stack.md']:
        path = ROOT / name
        title, body = path.read_bytes().split(b'\n', 1)
        change(path, title + b'\n' + note.encode('utf-8') + body)
    for english in [False, True]:
        path = ROOT / ('docs/changes/2026-10-26-cloud-program' + ('.en' if english else '') + '.md')
        title = '# Actual cloud software checks and source-bound delivery' if english else '# 云端实际程序检查与源码绑定交付'
        path.write_text(title + '\n' + note, encoding='utf-8', newline='\n')
    write_new(archive / 'receipt.json', {'files': changes})
    write_new(QUALITY / 'cloud-program-documentation-refresh.json', {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'documents': len(changes), 'media_copies': len(copies)}))


def audit():
    checkpoint = QUALITY / 'cloud-program-checkpoint.json'
    cp = read(checkpoint)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected, name
    refresh = read(QUALITY / 'cloud-program-documentation-refresh.json')
    assert refresh['checkpoint']['sha256'] == digest(checkpoint) and len(refresh['changes']) == 20
    for row in refresh['changes']:
        assert digest(ROOT / row['path']) == row['after_sha256']
        assert digest(ROOT / row['archive']) == row['before_sha256']
    for row in refresh['media_copies']:
        assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    decoded = []
    for row in cp['recordings'][0]['files']:
        path = DEV / row['path']
        value = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', str(path)]))
        frames = int(value['streams'][0]['nb_read_frames'])
        assert frames > 1 and float(value['format']['duration']) > 1
        result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
        assert not result.stderr.strip(), result.stderr
        decoded.append({**row, 'fully_decoded': True, 'decoded_frames': frames, 'probe': value})
    md, links = MarkdownIt(), 0
    readmes = [ROOT / 'docs' / n for n in ['README.md', 'README.en.md']] + [DEV / ('copypaste-' + c) / n for c in COMPONENTS for n in ['README.md', 'README.en.md']]
    for path in readmes:
        body = path.read_text(encoding='utf-8')
        assert '<!-- cloud-program-stage99 -->' in body and '```mermaid' in body
        for token in md.parse(body):
            for child in token.children or []:
                value = child.attrGet('href') if child.type == 'link_open' else child.attrGet('src') if child.type == 'image' else None
                if value and not urlsplit(value).scheme and not value.startswith('#'):
                    assert (path.parent / unquote(urlsplit(value).path)).resolve().exists(), (path, value)
                    links += 1
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    baseline = read(ROOT / cp['preservation']['receipt']['path'])
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    write_new(QUALITY / 'cloud-program-docs-audit-01.json', {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint), 'bilingual_readmes': len(readmes), 'source_files': len(cp['source_files']), 'local_links': links, 'recordings': decoded, 'original_requirements_unchanged': True, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': len(readmes), 'links': links, 'fully_decoded_media': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--core', default='05')
    parser.add_argument('--ui', default='03')
    args = parser.parse_args()
    if args.action == 'record':
        record(args)
    elif args.action == 'sync':
        sync()
    else:
        audit()
