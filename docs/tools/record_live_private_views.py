"""Bind live private-view regression evidence and bilingual delivery documentation."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from collections import Counter
import argparse
import json
import shutil
import subprocess
from markdown_it import MarkdownIt
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
QUALITY = ROOT / 'docs/quality'
DELIVERY = DEV / 'copypaste-delivery'
CP = QUALITY / 'live-private-views-checkpoint.json'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']
SCOPE = 'Web private schedule views close on authoritative source loss or read failure; pending review refreshes readiness/expiry without replacing an editable method snapshot. Native Side Panel and customer-local Desktop boundaries are retained. Synthetic models/accounts; simulated HTTP403 is explicit.'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def ref(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
                                    'core.untrackedCache=false', *args], cwd=repo)


def record(ui):
    core_path = DELIVERY / 'evidence/cloud-schedule-core-07.json'
    ui_path = DELIVERY / f'evidence/private-view-ui-{ui}.json'
    core, report = read(core_path), read(ui_path)
    journey = report['journey']
    assert core['status'] == report['status'] == journey['status'] == 'passed'
    assert core['counts']['tests'] == core['counts']['pass'] == 78 and core['counts']['fail'] == 0
    assert len(journey['checks']) == 9 and not journey['errors']
    assert len(journey['screenshots']) == 11 and len(journey['media']) == 4
    assert all(journey[k] for k in ['browser_closed', 'panel_closed', 'api_closed', 'fixture_closed'])
    assert report['source_unchanged'] and report['compiled_unchanged']
    assert report['owned_database_shutdown'] and report['owned_previews_closed']
    assert len(journey['executions']) == 2 and all(e['native_codex'] and e['synthetic_model'] and e['reservation_count'] == 1 and int(e['charged_micros']) > 0 for e in journey['executions'])
    sources = {}
    for data in [core, report]:
        for name, expected in data['source_files'].items():
            assert digest(DEV / name) == expected, name
            key = 'dev/' + name
            assert key not in sources or sources[key] == expected
            sources[key] = expected
    previous_path = QUALITY / 'private-cloud-schedules-checkpoint.json'
    previous = read(previous_path)
    changed = sorted(name for name, value in previous['source_files'].items() if sources[name] != value)
    assert changed == ['dev/copypaste-web/src/cloud-schedules.tsx'], changed
    attempts = []
    for path in sorted((DELIVERY / 'evidence').glob('private-view-ui-??.json')):
        data = read(path)
        archive = path.with_name(path.stem + '-sources')
        for name, expected in data['source_files'].items():
            assert digest(archive / name) == expected, (path.name, name)
        attempts.append({**ref(path), 'status': data['status'], 'selected': path == ui_path})
    negative = read(DELIVERY / 'evidence/private-view-ui-01.json')
    assert negative['status'] == 'failed' and any('dialog' in e and 'hidden' in e for e in negative['journey']['errors'])
    assert negative['source_files']['copypaste-web/src/cloud-schedules.tsx'] == previous['source_files']['dev/copypaste-web/src/cloud-schedules.tsx']
    for item in journey['screenshots'] + [f for m in journey['media'] for f in m['files']]:
        assert digest(DEV / item['path']) == item['sha256']
    baseline = read(QUALITY / 'history/stage96-before-solution-packages/receipt.json')
    progress = read(QUALITY / 'requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    write(CP, {'at': datetime.now(timezone.utc).isoformat(), 'stage': 105,
               'status': 'verified_live_private_schedule_views', 'scope': SCOPE,
               'source_files': dict(sorted(sources.items())),
               'production_changes': changed, 'selected_ui': ref(ui_path), 'ui_checks': journey['checks'],
               'retained_backend_baseline': {**ref(core_path), 'tests': 78, 'rerun': False,
                                             'unchanged_backend_sources_rehashed': len(core['source_files'])},
               'previous_cloud_schedule_checkpoint': ref(previous_path),
               'attempts': attempts, 'screenshots': journey['screenshots'], 'recordings': journey['media'],
               'native_executions': journey['executions'], 'new_migrations': [],
               'preservation': {'requirements': 102, 'cases': 102, 'original_requirement_and_gate_arrays_unchanged': True},
               'not_validated': ['complete_product_acceptance', 'live_model_quality', 'new_desktop_behavior'],
               'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'verified_live_private_schedule_views', 'ui_checks': 9, 'sources': len(sources), 'backend_checks_reused': 78}))


def sync():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    archive = QUALITY / 'history/stage105-documents'
    archive.mkdir()
    changes, copies = [], []

    def change(path, text):
        component = next((c for c in COMPONENTS if path.is_relative_to(DEV / ('copypaste-' + c))), None)
        repo = DEV / ('copypaste-' + component) if component else ROOT
        name = path.relative_to(repo).as_posix()
        before = git(repo, 'show', 'HEAD:' + name)
        assert path.read_bytes().replace(b'\r\n', b'\n') == before.replace(b'\r\n', b'\n')
        saved = archive / (component or 'docs') / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(before)
        path.write_bytes(text)
        changes.append({'path': path.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': sha256(before).hexdigest(), 'after_sha256': digest(path)})

    selected = [s for s in cp['screenshots'] if any(k in s['path'] for k in ['denied-read-clears-editor', 'history-before-withdrawal', 'withdrawn-views-cleared'])]
    movie = next(m for m in cp['recordings'] if m['name'] == 'private-view-withdrawal')
    selected += movie['files']
    assert len(selected) == 5
    folders = [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]
    for folder in folders:
        for item in selected:
            source = DEV / item['path']
            target = folder / 'assets/screenshots' / ('live-views-' + source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            assert not target.exists()
            shutil.copyfile(source, target)
            copies.append({'source': source.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
        for name in ['README.md', 'README.en.md']:
            en = name.endswith('.en.md')
            design = 'technical/105-live-private-schedule-views.md' if folder == ROOT / 'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/105-live-private-schedule-views.md'
            text = '<!-- live-private-views-stage105 -->\n\n'
            text += ('Web now clears an already-open private schedule review, editor, action or history when an authoritative read loses access or removes the source. Normal polling preserves readable drafts and exact version confirmation; a recovered read does not reopen discarded private content. Pending immutable requests refresh readiness and expiry.\n\n' if en else 'Web 现已在读取失败或来源撤回时，清除已打开的私有计划确认、编辑、操作和历史弹窗。正常轮询保留仍可读取的草稿及精确版本确认；访问恢复后不会重新打开旧内容。待确认的不可变提案同步更新就绪与过期状态。\n\n')
            text += ('Nine actual cross-client journeys passed, including a real source quarantine without page reload and an explicitly simulated denied HTTP403 read. Eleven screenshots and four GIF/MP4 pairs are retained. The unchanged backend retains its 78-check baseline; those tests were not rerun. Synthetic model/accounts; no new Desktop qualification. Desktop remains customer-local Codex and Extension remains the native right cloud Side Panel with authorized file upload.\n\n' if en else '九项实际跨端流程通过，包含真实来源隔离后无需刷新清空弹窗，以及明确模拟的 HTTP403 拒绝读取。保留 11 张截图、4 组 GIF／MP4；后端源码未变，沿用既有 78 项检查基线，本轮未重复运行。模型与账号为假数据；不新增 Desktop 验收结论。Desktop 继续本机 Codex，Extension 保持原生右侧云端对话及获准文件上传。\n\n')
            shot = next(s for s in selected if 'history-before-withdrawal' in s['path'])
            gif = next(s for s in movie['files'] if s['path'].endswith('.gif'))
            mp4 = next(s for s in movie['files'] if s['path'].endswith('.mp4'))
            text += f'[Design / 方案]({design})\n\n![Actual Web private history](assets/screenshots/live-views-{Path(shot["path"]).name})\n\n![Actual Web source withdrawal, without reload](assets/screenshots/live-views-{Path(gif["path"]).name})\n\n[Actual Web interaction MP4](assets/screenshots/live-views-{Path(mp4["path"]).name})\n\n'
            path = folder / name
            title, body = path.read_bytes().split(b'\n', 1)
            change(path, title + b'\n\n' + text.encode() + body)
    note = '\n\n**阶段 105 / Stage 105：** 私有云端计划在来源撤回／读取失败时同步关闭已打开的私有弹窗；正常轮询保留可读草稿。九项实际跨端流程通过，含真实来源隔离无刷新与明确模拟的 HTTP403。后端未变，沿用旧 78 项检查基线；不扩大完整产品或 Desktop 验收。见[实现与证据](../technical/105-live-private-schedule-views.md)。\n\n'
    for name in ['requirements/01-srs.md', 'modules/07-web-extension-desktop.md', 'modules/06-connectors-workflows.md', 'quality/01-test-and-acceptance-plan.md', 'governance/04-git-branches-and-publication.md', 'technical/104-private-cloud-schedules.md']:
        path = ROOT / 'docs' / name
        title, body = path.read_bytes().split(b'\n', 1)
        local = note.replace('../technical/105-live-private-schedule-views.md', '105-live-private-schedule-views.md') if name.startswith('technical/') else note
        change(path, title + b'\n' + local.encode() + body)
    path = QUALITY / 'requirements-alignment-progress.json'
    progress = read(path)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['live_private_views'] = {'checkpoint': ref(CP), 'ui_checks': 9, 'backend_rerun': False, 'full_acceptance': 'not_proven'}
    change(path, (json.dumps(progress, ensure_ascii=False, indent=2) + '\n').encode())
    for en in [False, True]:
        path = ROOT / ('docs/changes/2026-10-26-live-private-views' + ('.en' if en else '') + '.md')
        assert not path.exists()
        path.write_text(('# Live private schedule views\n\nAn actual no-reload regression reproduced an inaccessible history remaining open. Web now clears private dialogs on source loss or failed reads while retaining readable drafts during polling. Pending request readiness/expiry refreshes. Nine cross-client journeys passed with synthetic models/accounts; HTTP403 is explicitly simulated, source quarantine is real. Backend sources retain the unchanged 78-check baseline. Eleven actual screenshots and four GIF/MP4 pairs are source-bound.\n\n' if en else '# 私有计划弹窗同步失效\n\n真实无刷新联调复现来源撤回后历史弹窗仍保留旧内容的问题。现已在来源撤回或读取失败时清除私有弹窗，并在正常轮询时保留可读草稿，同步待确认提案的就绪／过期状态。九项跨端流程通过，模型／账号为假数据，HTTP403 明确模拟，来源隔离为真实操作。后端未变，沿用既有 78 项检查基线。11 张实际截图和四组 GIF／MP4 绑定确切源码。\n\n') + '[Design / 方案](../technical/105-live-private-schedule-views.md) · [Evidence / 证据](../quality/live-private-views-checkpoint.json)\n', encoding='utf-8', newline='\n')
    write(archive / 'receipt.json', {'files': changes})
    write(QUALITY / 'live-private-views-documentation-refresh.json', {'status': 'passed', 'checkpoint': ref(CP), 'changes': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'documents': len(changes), 'media_copies': len(copies)}))


def audit():
    cp = read(CP)
    assert cp['verifier_sha256'] == digest(Path(__file__))
    for name, expected in cp['source_files'].items():
        assert digest(ROOT / name) == expected
    refresh = read(QUALITY / 'live-private-views-documentation-refresh.json')
    for row in refresh['changes']:
        assert digest(ROOT / row['path']) == row['after_sha256'] and digest(ROOT / row['archive']) == row['before_sha256']
    for row in refresh['media_copies']:
        assert digest(ROOT / row['source']) == digest(ROOT / row['target']) == row['sha256']
    decoded = []
    for movie in cp['recordings']:
        assert movie['distinct_frames'] > 1 and movie['skipped_capture_errors'] == 0
        for row in movie['files']:
            path = DEV / row['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', str(path)]))
            assert int(probe['streams'][0]['nb_read_frames']) > 1 and abs(float(probe['format']['duration']) - movie['seconds']) <= .25
            result = subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(path), '-map', '0:v:0', '-f', 'null', '-'], capture_output=True, check=True)
            assert not result.stderr.strip()
            decoded.append(row)
    parser, links = MarkdownIt(), 0
    for folder in [ROOT / 'docs'] + [DEV / ('copypaste-' + c) for c in COMPONENTS]:
        for name in ['README.md', 'README.en.md']:
            path = folder / name
            body = path.read_text(encoding='utf-8')
            assert '<!-- live-private-views-stage105 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value = child.attrGet('src') if child.type == 'image' else child.attrGet('href') if child.type == 'link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):
                        assert (path.parent / unquote(urlsplit(value).path)).exists(), (path, value)
                        links += 1
    write(QUALITY / 'live-private-views-docs-audit-01.json', {'status': 'passed', 'checkpoint': ref(CP), 'bilingual_readmes': 14, 'local_readme_links': links, 'fully_decoded_recordings': decoded, 'visual_review': 'Actual before/after private history, denied-read editor clearance and no horizontal overflow; CopyPaste styling retained.', 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': 'passed', 'readmes': 14, 'links': links, 'decoded': len(decoded)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['record', 'sync', 'audit'])
    parser.add_argument('--ui', default='03')
    args = parser.parse_args()
    {'record': lambda: record(args.ui), 'sync': sync, 'audit': audit}[args.action]()
