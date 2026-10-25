"""Publish bilingual usage and current team-history captures, preserving earlier document bytes."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil

from record_folder_work import ROOT, DEV, digest, read, ref


def main():
    output = ROOT / 'docs/quality/agent-group-history-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage94-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint = ROOT / 'docs/quality/agent-group-history-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_agent_group_history' and cp['ui_checks'] == 11
    review = read(ROOT / 'docs/quality/agent-group-history-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        target = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with target.open('xb') as stream: stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(),
                        'before_sha256': digest(target), 'after_sha256': digest(file)})

    suffixes = ['history-pages.png', 'history-newest.png', 'history-directory.png',
                'history-responsive-375.png', 'completed.png']
    selected = [row for row in cp['screenshots'] if row['path'].endswith(tuple(suffixes))]
    selected += [item for row in cp['recordings'] if row['name'] in ['team-history', 'team-delivery'] for item in row['files']]
    assert len(selected) == 9
    for folder in [ROOT / 'docs/design/implementation'] + [DEV / ('copypaste-' + v) / 'assets/screenshots' for v in ['platform', 'admin', 'delivery']]:
        folder.mkdir(parents=True, exist_ok=True)
        for row in selected:
            original, target = DEV / row['path'], folder / Path(row['path']).name
            assert not target.exists() and digest(original) == row['sha256']
            shutil.copyfile(original, target)
            assert digest(target) == row['sha256']
            copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256']})
    count = cp['core_tests']['tests']
    cn = f'阶段 94 补齐团队、版本与本人运行的独立翻页，并修正随机 UUID 导致的“最近运行”顺序。浏览历史保留工作草稿，从旧页批准后回到最新运行，页外保存的团队保持选中；撤回游标和切换项目会阻断旧正文。{count} 项团队回归及 11 项实际浏览器检查通过。三次原生 Codex、三个私有文件和费用结算实际运行；模型和账户容量按要求为明确假数据。'
    en = f'Stage 94 completes independent team, version and private run pages and fixes newest-run ordering previously based on random UUIDs. History browsing preserves the draft, approval returns to the newest run, and a saved team outside the directory page remains selected. Withdrawn cursors and project switches fence stale bodies. All {count} team cases and 11 real browser checks pass, including three native Codex processes, private files and actual accounting with explicitly synthetic model/account capacity.'
    diagram = '```mermaid\nflowchart LR\n  A[Current project] --> B[Team directory pages]\n  B --> C[Fresh selected team]\n  C --> D[Independent version and private run pages]\n  D --> E[Preserved customer draft]\n  E --> F[Review and explicit approval]\n  F --> G[Newest actual run and original accounting]\n```\n'
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/94-agent-group-history.md'
    proof = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/agent-group-history-checkpoint.json'
    name_for = lambda suffix: next(Path(row['path']).name for row in selected if row['path'].endswith(suffix))
    folders = [('docs', ROOT / 'docs')] + [(v, DEV / ('copypaste-' + v)) for v in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
    for component, folder in folders:
        for name in ['README.md', 'README.en.md']:
            file = folder / name
            text = file.read_text(encoding='utf-8')
            assert '<!-- team-history-stage94 -->' not in text
            english = name.endswith('.en.md')
            section = '\n<!-- team-history-stage94 -->\n\n## ' + ('Team history and complete pagination' if english else '团队历史与完整翻页') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Select a project and team. Use Previous/Next teams to traverse the directory; saving and refreshing keep the current team even when it falls outside that page.\n'
                '2. Browse fixed versions and private runs independently. Pages contain at most 20 versions or eight actual runs, newest first by creation time with an exact database tie-breaker. Draft fields survive page changes and polling.\n'
                '3. Review and explicitly approve new work. Starting from an older page returns to the newest run; stopping releases known unused funds. History navigation creates no task, retry or charge.\n'
                '4. Withdrawn/expired/private cursor anchors return 404 and clear stale run bodies. Changing user, tenant or project discards late responses. SQL109 only adds a history index and preserves published migrations, contracts and Skills.\n\n' if english else
                '1. 登录并选择项目与团队，通过前后按钮访问完整目录；保存及刷新会保留当前团队，即使其不在当前目录页。\n'
                '2. 分别翻阅固定版本和本人私有运行。每页最多 20 个版本或 8 次运行，运行按实际创建时间及数据库精确边界排序；草稿不受历史翻页或轮询影响。\n'
                '3. 审阅并主动批准新工作。从旧页开始会回到最新运行；明确停止会释放已知未用费用。浏览历史不会创建任务、重试或收费。\n'
                '4. 撤回、过期或不属于本人的游标返回 404 并清空旧运行正文；切换用户、企业、项目会丢弃迟到响应。SQL109 仅增加历史索引，已发布迁移、契约和 Skill 保持原字节。\n\n')
            section += diagram + '\n'
            section += ('Desktop remains local Codex with customer-controlled permission; Extension remains a cloud-agent native side panel. These captures show Web cloud teams. Earlier source-wide qualification retains its original stage; this scoped regression is not a full product or live professional-quality acceptance.\n\n' if english else
                'Desktop 保持本机 Codex 及客户主动权限，Extension 保持云端 Agent 与原生右侧栏。此处素材展示 Web 云端团队。旧阶段的整套源码核查保留历史范围，本次专项回归不代表完整产品或真实专业质量验收。\n\n')
            section += f'[{"Implementation and usage" if english else "具体方案与使用"}]({plan}) · [{"Exact-source evidence" if english else "精确源码证据"}]({proof})\n\n'
            media = 'design/implementation/' if component == 'docs' else 'assets/screenshots/'
            if component in ['desktop', 'extension']:
                media = 'https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/'
            for suffix, label in [('history-pages.png', 'Actual independent history pages / 实际历史翻页'),
                                  ('history-directory.png', 'Actual saved team outside the page / 实际页外团队'),
                                  ('team-history.gif', 'Actual history, approval and selection / 实际翻页、批准与选择')]:
                section += f'![{label}]({media}{name_for(suffix)})\n\n'
            section += f'[375px]({media}{name_for("history-responsive-375.png")}) · [Newest run]({media}{name_for("history-newest.png")}) · [History MP4]({media}{name_for("team-history.mp4")}) · [Actual Codex delivery GIF]({media}{name_for("team-delivery.gif")}) · [Delivery MP4]({media}{name_for("team-delivery.mp4")})\n'
            text = text.replace('## 持久专业团队协作', '## 历史实现：持久专业团队（阶段 93）').replace('## Persistent professional teams', '## Earlier persistent team implementation (stage 93)')
            first = text.index('\n') + 1
            write(file, text[:first] + section + text[first:])
    file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 94, 'checkpoint': 'agent-group-history-checkpoint.json',
        'note': en + ' Earlier whole-source and full-platform qualifications retain historical scope.'}
    progress['team_history'] = {'stage': 94, 'checkpoint': 'agent-group-history-checkpoint.json',
        'core_tests': count, 'ui_checks': 11, 'native_codex_exercised_here': True,
        'synthetic_model': True, 'scope': cp['scope'], 'full_acceptance': 'not_proven'}
    write(file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    file = ROOT / 'docs/governance/04-git-branches-and-publication.md'
    write(file, file.read_text(encoding='utf-8') + '\n\n## 阶段 94 当前发布 / Current stage 94 publication\n\n'
        '先完成本次精确源码团队回归、实际翻页及原生 Codex 检查、媒体完整解码、双语文档和七仓库暂存核查，再提交各组件。使用 `finalize_agent_group_history_manifest.py` 绑定实际提交、检查点与证据，提交主文档后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远端 SHA。SQL109 只新增索引；既有用户授权持续有效，禁止强推。\n\n'
        'Stage 94 binds actual committed components with `finalize_agent_group_history_manifest.py` after current scoped regression, real browser/native Codex, full media decoding, bilingual documentation and staged review. Commit documentation and run the Delivery publisher to verify all eight remote refs. SQL109 adds only an index. Existing ordinary publication authorization persists; no force push. Earlier receipts retain historical scope.\n')
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-26-agent-group-history' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('# ' + ('Team history and complete pagination' if english else '团队历史与完整翻页') + '\n\n' + (en if english else cn) + '\n\n[Implementation / 方案](../technical/94-agent-group-history.md) · [Evidence / 验证](../quality/agent-group-history-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint),
        'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with (archive / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps({'files': changes}, ensure_ascii=False, indent=2) + '\n')
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 14, 'copied_media': len(copies)}))


if __name__ == '__main__':
    main()
