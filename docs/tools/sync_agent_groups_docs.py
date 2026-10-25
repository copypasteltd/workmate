"""Refresh bilingual component usage and verified team media; retain prior document bytes."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil

from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref


def main():
    output = ROOT / 'docs/quality/agent-groups-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage93-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint = ROOT / 'docs/quality/agent-groups-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_persistent_agent_groups' and cp['ui_checks'] == 7
    review = read(ROOT / 'docs/quality/agent-groups-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        target = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with target.open('xb') as stream:
            stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(),
                        'before_sha256': digest(target), 'after_sha256': digest(file)})

    selected = [row for row in cp['screenshots'] if row['path'].endswith(('plan.png', 'completed.png', 'responsive-375.png'))]
    selected += [item for row in cp['recordings'] for item in row['files']]
    assert len(selected) == 7
    media_components = {'platform', 'web', 'admin', 'delivery'}
    for folder in [ROOT / 'docs/design/implementation'] + [DEV / ('copypaste-' + value) / 'assets/screenshots' for value in ['platform', 'admin', 'delivery']]:
        folder.mkdir(parents=True, exist_ok=True)
        for item in selected:
            original, target = DEV / item['path'], folder / Path(item['path']).name
            assert not target.exists() and digest(original) == item['sha256']
            shutil.copyfile(original, target)
            assert digest(target) == item['sha256']
            copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    count = cp['core_tests']['tests']
    cn = f'阶段 93 已实现 Web 持久专业团队：保存协调员及不同专业成员，固定版本，审阅完整 Brief、依赖与预算后由客户批准，真实 Codex 按受控并行执行，最后统一交付。{count} 项相关后端回归与 7 项实际浏览器检查通过。模型及账户容量为明确假数据；登录、原生 Codex 进程、公司工具、私有文件、预算和账本实际运行。'
    en = f'Stage 93 implements persistent Web teams with a coordinator, distinct specialists, frozen versions, customer-reviewed briefs/dependencies/budgets, bounded actual Codex execution and unified delivery. All {count} relevant backend cases and seven actual browser checks pass. Model/account capacity is explicitly synthetic; authentication, native Codex processes, company tools, private files, budgets and accounting actually run.'
    diagram = '```mermaid\nflowchart LR\n  A[Saved team and fixed versions] --> B[Brief, steps and dependencies]\n  B --> C[Free review and customer budget approval]\n  C --> D[Bounded actual member tasks]\n  D --> E[Coordinator reads completed results]\n  E --> F[Private delivery and per-task accounting]\n```\n'
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/93-persistent-agent-groups.md'
    proof = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/agent-groups-checkpoint.json'
    get_media = lambda suffix: next(Path(item['path']).name for item in selected if item['path'].endswith(suffix))
    folders = [('docs', ROOT / 'docs')] + [(value, DEV / ('copypaste-' + value)) for value in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
    for component, folder in folders:
        for name in ['README.md', 'README.en.md']:
            file = folder / name
            text = file.read_text(encoding='utf-8')
            assert '<!-- agent-groups-stage93 -->' not in text
            english = name.endswith('.en.md')
            section = '\n<!-- agent-groups-stage93 -->\n\n## ' + ('Persistent professional teams' if english else '持久专业团队协作') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Sign in and select a project. Create specialists in Your specialists, then save a coordinator and distinct members in Your teams. Team settings are project-shared; runs and files remain private to their customer.\n'
                        '2. Add the brief, step instructions, dependencies, individual caps and parallelism. Review the exact fixed member versions and full plan for free. Only the current customer can explicitly approve the budget and start.\n'
                        '3. Follow actual task links, member states, approved maximum, reserved funds and actual charges. The coordinator waits for all actual members to succeed, then reads their authorized outputs. Stop prevents new dispatch and preserves uncertain-cost reconciliation.\n'
                        '4. Team edits create immutable versions. A repeated request reuses its original run; a new execution needs a new review. Withdrawing a source blocks private derivatives. Admin body access, quarantine, restore and erasure retain independent scoped permissions and audit.\n\n' if english else
                        '1. 登录并选择项目，在「我的专家」建立实际助手，再在「我的团队」保存协调员和不同成员。设置在项目内共享，运行及文件对发起客户私有。\n'
                        '2. 填写 Brief、各步要求、依赖、独立预算及并行上限；先免费核对完整计划与固定成员版本，再由当前客户主动批准预算并开始。\n'
                        '3. 通过原任务链接查看成员状态、批准上限、当前预留和实际消耗。协调员等待全部成员真实成功后读取获准成果。停止阻断后续派发，未知费用继续对账。\n'
                        '4. 编辑建立不可变新版本，相同请求复用原运行，新执行需要重新审阅。来源撤回阻断私有衍生文件；后台正文、隔离、恢复和删除保留独立范围权限与审计。\n\n')
            section += diagram + '\n'
            section += ('Apply **SQL108** after SQL001–107. A team has one coordinator and up to seven distinct members, with 1–16 acyclic steps and 1–3 concurrent member slots bounded by actual plan capacity. At least two active task slots are required. Reviews expire after 15 minutes; runs have a two-hour deadline. Only each actual task allocation is reserved; the displayed total is a maximum, not another charge. Existing single-task conversation admission remains enforced.\n\n' if english else
                        '在 SQL001–107 后应用 **SQL108**。一个团队含一名协调员及最多七个不同成员，每次 1–16 个无环步骤、1–3 个受套餐实际容量限制的并行成员。至少需要两个活跃任务槽。审阅 15 分钟有效，运行最多两小时。仅预留实际任务自己的额度，显示的总上限不是额外收费；普通对话仍限制单一活跃任务。\n\n')
            section += ('Desktop keeps local Codex and customer-controlled full permission, frameless windows and no native Electron menus. This new team interface is cloud Web work; it is hidden in native Desktop. Extension remains a ChatGPT-style native right Side Panel for authorized uploads and cloud conversations. These recordings do not establish new native team interfaces, professional role quality, live providers or full product acceptance.\n\n' if english else
                        'Desktop 保持客户本机 Codex、客户主动授予的全权限、无边框和无 Electron 自带菜单。本次团队界面属于云端 Web，原生 Desktop 隐藏该入口。Extension 保持 ChatGPT 式原生右侧栏，负责获准文件上传与云端对话。下方录制不证明新增原生团队界面、角色专业质量、真实外部平台或完整产品验收。\n\n')
            if component == 'admin':
                section += ('Use Content to locate agent_groups / agent_group_runs. Listing does not grant body access. Quarantine cancels admitted work and releases known unused holds; restoring settings cannot restart a cancelled run or silently restore its private body. Permanent deletion removes online content while preserving financial/audit records.\n\n' if english else
                            '在 Content 查找 agent_groups / agent_group_runs。列表权限不包含正文权限；隔离取消已准入工作并释放确定未使用的预留，恢复设置不重启已取消运行或偷偷恢复私有正文；永久删除清除在线内容并保留财务和审计记录。\n\n')
            if component == 'delivery':
                section += f'```powershell\nnode scripts/run-agent-groups-checks.mjs {Path(cp["selected"]["core"]).stem.rsplit("-", 1)[1]} full\nnode scripts/run-agent-groups-ui.mjs {Path(cp["selected"]["ui"]).stem.rsplit("-", 1)[1]}\n```\n\n'
                section += ('Those recorded attempt IDs already exist. For a new run choose unused two-digit IDs; verifiers refuse to overwrite old evidence and close their own native PostgreSQL, preview processes and browser contexts.\n\n' if english else
                            '以上为已存在的验证编号；重新运行时选择未使用的两位编号。脚本拒绝覆盖旧证据，并关闭本次自建原生 PostgreSQL、预览进程及浏览器上下文。\n\n')
            section += f'[{"Implementation and API" if english else "方案与 API"}]({plan}) · [{"Exact-source evidence" if english else "源码绑定证据"}]({proof})\n\n'
            media = 'design/implementation/' if component == 'docs' else 'assets/screenshots/'
            if component not in media_components and component != 'docs':
                media = 'https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/'
            for tail, label in [('plan.png', 'Actual team plan / 实际团队计划'), ('completed.png', 'Actual completed run / 实际完成状态'), ('team-authoring.gif', 'Actual team creation and approval / 实际建立与批准')]:
                section += f'![{label}]({media}{get_media(tail)})\n\n'
            section += f'[375px]({media}{get_media("responsive-375.png")}) · [Delivery GIF]({media}{get_media("team-delivery.gif")}) · [Authoring MP4]({media}{get_media("team-authoring.mp4")}) · [Delivery MP4]({media}{get_media("team-delivery.mp4")})\n'
            text = text.replace('## 可编辑品牌稿与演示文稿交付', '## 历史验证：可编辑设计交付（阶段 92）').replace('## Editable brand and presentation delivery', '## Earlier editable design verification (stage 92)')
            first = text.index('\n') + 1
            write(file, text[:first] + section + text[first:])
    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(progress_file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 93, 'checkpoint': 'agent-groups-checkpoint.json',
        'note': en + ' Earlier whole-platform and client snapshots retain historical scope; this is not complete product acceptance.'}
    progress['persistent_agent_groups'] = {'stage': 93, 'checkpoint': 'agent-groups-checkpoint.json', 'core_tests': count,
        'ui_checks': 7, 'native_codex_exercised_here': True, 'synthetic_model': True, 'full_acceptance': 'not_proven',
        'scope': cp['scope'], 'source_files': len(cp['source_files']), 'requirement': 'REQ-066'}
    write(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    governance = ROOT / 'docs/governance/04-git-branches-and-publication.md'
    text = governance.read_text(encoding='utf-8')
    text += ('\n\n## 阶段 93 当前发布 / Current stage 93 publication\n\n'
             '使用 `finalize_agent_groups_manifest.py` 绑定实际已提交的六个组件、当前团队执行检查点、双语文档和媒体。先完成相关回归、实际浏览器检查、媒体解码和七仓库暂存核查，再提交组件，刷新主清单，提交主文档，最后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远程分支 SHA，docs 与 main 相同。既有常规同步授权持续有效，禁止强推。\n\n'
             'Stage 93 binds committed components with `finalize_agent_groups_manifest.py` after current scoped tests, browser evidence, complete media decoding and staged review. Commit components, refresh the manifest, commit docs, then run the Delivery publisher and verify all eight remote refs without force. Earlier stage tools retain historical scope. SQL108 is additive; original migrations, contracts, Skills and 102 requirement records remain unchanged.\n')
    write(governance, text)
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-26-agent-groups' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('# ' + ('Persistent professional teams' if english else '持久专业团队协作') + '\n\n' + (en if english else cn) + '\n\n[Implementation / 方案](../technical/93-persistent-agent-groups.md) · [Evidence / 验证](../quality/agent-groups-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint),
        'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with (archive / 'receipt.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps({'files': changes}, ensure_ascii=False, indent=2) + '\n')
    with output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 14, 'copied_media': len(copies)}))


if __name__ == '__main__':
    main()
