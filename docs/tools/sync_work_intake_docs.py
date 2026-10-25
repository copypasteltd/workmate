"""Refresh bounded current Web documentation without rewriting historical evidence."""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref


def main():
    output = ROOT / 'docs/quality/work-intake-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage89-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint_file = ROOT / 'docs/quality/work-intake-checkpoint.json'
    checkpoint = read(checkpoint_file)
    assert checkpoint['status'] == 'verified_scoped_web_intake_and_submission_recovery'
    assert checkpoint['ui_checks'] == 14 and checkpoint['client_unit_tests'] == 195
    media_review = ROOT / 'docs/quality/work-intake-media-review-01.json'
    assert read(media_review)['status'] == 'passed'
    assert read(media_review)['checkpoint']['sha256'] == digest(checkpoint_file)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        before = file.read_bytes()
        archived = archive / 'files' / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        archived.parent.mkdir(parents=True, exist_ok=True)
        archived.write_bytes(before)
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archived.relative_to(ROOT).as_posix(),
                        'before_sha256': digest(archived), 'after_sha256': digest(file)})

    shots = checkpoint['screenshots']
    selected = [next(row for row in shots if label in row['path']) for label in ('restored-brief', 'actual-output-download', 'layout-800x600-zh-HK')]
    for row in selected:
        original = DEV / row['path']
        target = ROOT / 'docs/design/implementation' / ('work-intake-' + original.name)
        assert not target.exists()
        shutil.copyfile(original, target)
        assert digest(target) == row['sha256']
        copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256']})

    cn = ('阶段 89：Web 首次建项目、设计/分析/开发角色入口及按账户/企业/项目隔离的草稿；'
          '离线、过期重登、已提交后回包丢失、精确重试、原工作回执、晚到响应与记录移除均有实际浏览器检查。'
          '14 项浏览器检查和 195 项客户端单元通过；实际 Worker 交付与下载文件字节一致，同一请求只有一项任务、一份预留，结算 30 港币微额。'
          '回复内容为明确假数据，本 UI 测试未启动原生 Codex。完整登录/跨端矩阵、至少十二个合格角色、全部 102 项条件和 G01–G10 继续开放。')
    en = ('Stage 89 verifies Web first-work onboarding, design/analysis/development shortcuts and actor/tenant/project scoped tab drafts. '
          'Fourteen actual browser checks and 195 client unit tests pass, including offline handling, expired-session reauthentication, '
          'committed response loss, exact retries, receipts, late responses and removed results. Real Worker delivery/download bytes agree; '
          'the original request has one task, one reservation and a 30-micro-HKD settlement. Reply content is explicitly synthetic; '
          'this UI fixture does not launch native Codex. The full login/client matrix, twelve qualified professional roles, '
          'all 102 complete conditions and G01–G10 remain open.')
    plan_url = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/89-first-work-and-submission-recovery.md'
    cp_url = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/work-intake-checkpoint.json'

    for folder in (ROOT / 'docs', DEV / 'copypaste-web', DELIVERY):
        for name in ('README.md', 'README.en.md'):
            file = folder / name
            english = name == 'README.en.md'
            text = file.read_text(encoding='utf-8-sig').replace('<!-- local-programs-stage88 -->', '<!-- work-intake-stage89 -->')
            text = text.replace('阶段 88 当前增量：', '阶段 88 历史范围：').replace('Stage 88 verifies approved', 'Historical stage 88 verified approved')
            paragraphs = text.split('\n\n')
            paragraphs = [('Historical stage-86 platform/core/compatibility suites were not rerun. Stage-88 packaged Desktop and native Codex results remain historical; '
                           'Desktop, Admin, Extension and backend product sources are unchanged. Web and delivery now have separate stage-89 checks. '
                           'Synthetic content does not qualify professional quality. Owned browser/API/previews/test databases are closed; no virtualization.' if english else
                           '阶段 86 平台/核心/兼容套件本次未重跑，阶段 88 打包 Desktop 和原生 Codex 保留历史范围。Desktop/Admin/Extension/后端产品源码未变化；'
                           'Web 与交付工具使用独立阶段 89 检查。假内容不证明专业质量。自建浏览器、API、预览和测试数据库关闭，不使用虚拟化。')
                          if ('Web/Admin/Extension product sources are unchanged' in paragraph or 'Web/Admin/Extension 产品源未变化' in paragraph) else paragraph for paragraph in paragraphs]
            text = '\n\n'.join(paragraphs)
            heading = '## Product and boundaries' if english else '## 产品与边界'
            introduction = ('## Current first-work flow\n\n' + en + '\n\n'
                'Select a role, edit the brief and confirm the budget. Drafts survive modal closure/reload and same-account reauthentication in this tab. '
                'Explicit sign-out clears text. While a submission is unknown, retry the original request; review the accepted receipt before explicitly starting another task. '
                'New work waits for authorized projects to finish loading. Browser/tab loss and full ongoing-conversation recovery remain unqualified.\n\n' if english else
                '## 当前首项工作流程\n\n' + cn + '\n\n'
                '选择角色→填写目标和预算→明确提交→审阅及下载成果。当前分页中的草稿可在关闭表单、刷新和同账户重新验证后恢复；明确登出清除正文。'
                '未知提交只能重试原请求；确认后可查看原工作，明确“开始另一项工作”才创建新的任务。项目权限加载期间不能派发。关闭分页后的恢复及持续会话的完整恢复仍待验收。\n\n')
            text = text.replace(heading, introduction + heading, 1)
            text = text.replace('[当前源码检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/folder-work-checkpoint.json)', '[当前 Web 检查点](' + cp_url + ')')
            text = text.replace('[Current source checkpoint](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/folder-work-checkpoint.json)', '[Current Web checkpoint](' + cp_url + ')')
            text += '\n\n' + ('## Actual stage-89 interactions' if english else '## 阶段 89 实际交互') + '\n\n'
            text += ('[Implementation and limits]' if english else '[实现与边界]') + '(' + plan_url + ') · [Stage 89 checkpoint](' + cp_url + ')\n\n'
            text += '```mermaid\nflowchart LR\n  Login[Email sign in] --> Scope[Authorized project]\n  Scope --> Draft[Role and saved brief]\n  Draft --> Send[Original request identity]\n  Send -->|Unknown| Retry[Explicit exact retry]\n  Retry --> Send\n  Send --> Receipt[Original work receipt]\n  Receipt --> File[Review and download]\n```\n\n'
            for index, row in enumerate(selected):
                source = DEV / row['path']
                if folder == source.parents[2]:
                    target = source.relative_to(folder).as_posix()
                elif folder == ROOT / 'docs':
                    target = (ROOT / copies[index]['target']).relative_to(folder).as_posix()
                else:
                    target = 'https://github.com/copypasteltd/workmate/blob/web/' + source.relative_to(DEV / 'copypaste-web').as_posix() + '?raw=true'
                text += '![' + ('Actual Web interaction' if english else '实际 Web 交互') + '](' + target + ')\n\n'
            for recording in checkpoint['recordings']:
                for item in recording['files']:
                    source = DEV / item['path']
                    target = source.relative_to(folder).as_posix() if folder == DEV / 'copypaste-web' else 'https://github.com/copypasteltd/workmate/blob/web/' + source.relative_to(DEV / 'copypaste-web').as_posix() + '?raw=true'
                    text += ('![' + recording['name'] + '](' + target + ')' if source.suffix == '.gif' else '[MP4: ' + recording['name'] + '](' + target + ')') + '\n\n'
            write(file, text.rstrip() + '\n')

    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(progress_file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['work_intake_verification'] = {'stage': 89, 'checkpoint': 'work-intake-checkpoint.json', 'ui_checks': 14, 'client_unit_tests': 195,
        'scope': checkpoint['scope'], 'native_codex_exercised_here': False, 'full_acceptance': 'not_proven'}
    progress['current_source_qualification'] = {'stage': 89, 'checkpoint': 'work-intake-checkpoint.json',
        'note': en + ' Native Desktop evidence retains stage88 source scope; its full cross-repository snapshot is historical.'}
    for row in progress['requirements']:
        if row['requirement_id'] in ('REQ-003', 'REQ-007', 'REQ-009', 'REQ-035', 'REQ-046'):
            row.setdefault('verified_repairs', []).append({'cluster': 'scoped_web_first_work_and_recovery', 'verified_subflow': cn,
                'evidence': ['work_intake_verification'], 'implementation_docs': ['technical/89-first-work-and-submission-recovery.md']})
    write(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')

    for name in ('2026-10-25-goal-gap-summary.md', '2026-10-25-goal-gap-assessment.md'):
        file = ROOT / 'docs/quality' / name
        text = file.read_text(encoding='utf-8-sig')
        old_first = text.split('\n\n')[1]
        assert old_first.startswith('评估更新：阶段 88。')
        text = text.replace(old_first, '评估更新：阶段 89。' + cn + '\n\n[本次精确源码与实际检查点](work-intake-checkpoint.json)。原 26 组差异和全部原验收条件保持。\n\n阶段 88 历史证据：' + old_first.removeprefix('评估更新：阶段 88。').replace('阶段 88 当前增量', '阶段 88 限定增量').replace('当前源码绑定', '当时源码绑定').replace('当前通过证据', '历史通过证据'), 1)
        text = text.replace('最新判断见顶部阶段 88', '最新判断见顶部阶段 89')
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith('| GAP-01 |'):
                cells = line.split('|')
                cells[3] = ' 邀请/登录与设备授权；Web 首项提交、字段/项目草稿、过期重登、离线、精确重试、下载和单次结算已有阶段 89 实测 '
                cells[4] = ' 全部邀请/SSO/安装包入口、跨端及企业切换异常、关闭分页和持续会话完整恢复仍待验收 '
                lines[i] = '|'.join(cells)
        text = '\n'.join(lines).rstrip() + '\n'
        if name.endswith('summary.md'):
            text = text.replace('[当前源码检查点](folder-work-checkpoint.json)', '[当前 Web 源码检查点](work-intake-checkpoint.json)').replace('[媒体完整解码记录](folder-work-media-review-01.json)', '[当前录制完整解码记录](work-intake-media-review-01.json)')
        write(file, text)

    plan = ROOT / 'docs/technical/89-first-work-and-submission-recovery.md'
    text = plan.read_text(encoding='utf-8').replace('状态：实现已接入，当前实际运行结果以本阶段检查点为准。', '状态：14 项实际浏览器检查、195 项客户端单元通过，完整源码/媒体/资源关闭记录见[当前检查点](../quality/work-intake-checkpoint.json)。')
    text += '\n## 本次发现与修复\n\n实际失败记录保持原样：01 暴露过期重登后默认进入其他项目；02 暴露项目加载时点击新建丢失。现在仅从已验证账户恢复偏好，并与当前成员/项目权限取交集；项目尚未加载时禁用新建，事件监听在控件可交互前安装。03/04 分别暴露测试没有结束先前活动任务、取消夹具发出空 JSON 正文；修正夹具后重新检查，未放宽真实方案限制。后续失败记录如有，仍以原回执为准。\n'
    write(plan, text)
    change = ROOT / 'docs/changes/2026-10-25-work-intake.md'
    text = change.read_text(encoding='utf-8') + '\n' + cn + '\n\n' + en + '\n\n[当前证据](../quality/work-intake-checkpoint.json) · [媒体解码](../quality/work-intake-media-review-01.json)\n'
    write(change, text)
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint_file), 'readmes': 6,
              'files': changes, 'media_copies': copies, 'verifier_sha256': digest(Path(__file__))}
    (archive / 'receipt.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'readmes': 6, 'files': len(changes), 'media_copies': len(copies)}))


if __name__ == '__main__': main()
