"""Publish the measured paid-input delivery with explicit local fixture scope."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
MARKER = 'stage66-current-paid-inputs'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def prepend(path, content):
    original = path.read_text(encoding='utf-8')
    start, end = '<!-- ' + MARKER + ':start -->', '<!-- ' + MARKER + ':end -->'
    block = start + '\n' + content.strip() + '\n' + end
    if start in original:
        original = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda _: block, original, count=1, flags=re.S)
    else:
        first, separator, rest = original.partition('\n')
        assert separator and first.startswith('# '), path
        original = first + '\n\n' + block + '\n' + rest
    path.write_text(original, encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'native', 'upgrade'):
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(args, key)) for key in ('integration', 'full', 'clients', 'native', 'upgrade'))
    runs = {key: read(DELIVERY / f'evidence/paid-input-{kind}-{getattr(args, key)}.json') for key, kind in (('integration', 'integration'), ('full', 'regression'), ('clients', 'clients'), ('native', 'native'), ('upgrade', 'upgrade'))}
    assert all(run['status'] == 'passed' for run in runs.values())
    native = read(DELIVERY / runs['native']['journey']['path'])
    assert native['status'] == 'passed' and len(native['checks']) >= 32
    focused, total, checks = runs['integration']['counts']['pass'], runs['full']['counts']['pass'], len(native['checks'])
    zh = f'''## 补资料后继续原来的付费工作（阶段 66）

已经完成且用量明确的 Codex 回合，现在可以请求用户补充获准文件或现有营销连接。模型只描述缺口，用户明确选择资料；同一任务保留原会话、原生线程、原预算预留及累计用量，重新检查权限、来源和容量后继续。不会因为补资料而另建一笔任务预留。最多八轮、三十二项资料依赖；未知外部结果保留核对状态。

完成的事务工具保存不可改写回执，续接时先检查当前授权、输出及来源，再复用相同操作结果。代码包还比较实际源文件清单和摘要，源码变化后生成新包。等待补资料期间取消，仍结算已知用量；未知用量不当成免费。Web、Desktop 和 Side Panel 区分“已记录用量”和“已结算费用”，也区分首次调用前等待与已付费回合后的等待。

三端在同一任务自动刷新时保留用户的资料选择；实际检查等待至少两次任务刷新响应后再确认。切换工作范围或当前读取被拒绝时，移除旧任务内容及输入控件。首轮发现表单重建问题的失败记录和当时包保留，新包在独立目录中构建。

验证：平台 **{total}/{total}**，保留此前全部 **765 项**命名测试；定向 **{focused}/{focused}**，六仓库 **13 项**检查通过。实际 Codex 子进程恢复原线程、工具及历史，并验证完成文件复用和单次累计结算；模型 API 响应为用户授权的模拟数据。原生客户端旅程 **{checks} 项**通过，Web、打包 Desktop 和真正原生 Side Panel 的补资料操作使用明确标注的模拟模型回合夹具。

Desktop 采用无边框窗口、自绘拖动区及最小化/最大化/关闭按钮，无 Electron 默认或 Alt 菜单。扩展点击工具栏打开 Chrome 原生 Side Panel，默认右侧并遵循浏览器偏好；没有 action popup。新安装包、便携包及侧栏 ZIP 为未签名的 localhost 预览，尚未验收实际安装、签名、商店发布或正式模型服务。

两库原生 SQL087→091 核对原 169 张公共表的完整旧字段行摘要、迁移字节、所有权及 RLS；只显式扩展容量领取函数并增加检查点/工具回执守卫。新列回填为零或空值，两张执行事实表为空，不补造历史。开发和脚本位于 D 盘 `dev/`，主文档位于 `docs/`；禁用本地 Docker/WSL/虚拟化。

仅使用 Codex，全部 AI 请求经过公司内部 OpenAI 兼容服务器。原 102 项需求及全部 TC/NFR/G01–G10 继续保留：81 项局部验证、21 项未证明完成、0 项完整验收。完整规范 TaskDTO/任务创建接口、任意执行中暂停、未知副作用恢复、所有独立角色业务及生产验收继续跟踪。'''
    en = f'''## Continue the original paid task after providing inputs (stage 66)

A completed, fully measured Codex turn can now request authorized files or existing marketing connections. The model describes the gap and the user selects the resources. The same task retains its conversation, native thread, original budget hold and cumulative usage, then rechecks current permissions, sources and capacity before continuing. Input requests are bounded to eight rounds and thirty-two dependencies. Unknown external results remain subject to reconciliation.

Completed transactional tools retain immutable receipts. A later turn reuses matching results only after current authorization, output and source checks. Source packages also compare the actual file manifest and hashes, so changed sources produce a new package. Cancellation during an input wait settles measured spend; unknown usage is never treated as free. Web, Desktop and Side Panel distinguish recorded usage from settled charges and initial input waits from waits after a paid turn.

All three clients retain explicit input selections during refreshes of the same task. Native checks observe at least two actual task responses before confirmation. Workspace changes or denied current reads clear prior task content and input controls. The first failed form-remount journey and its packages remain intact; corrected packages use a separate directory.

Validation: **{total}/{total} Platform tests**, preserving all **765 prior named tests**; **{focused}/{focused} focused tests** and **13 checks across six repositories**. Actual Codex child processes restore the original thread, tools and history and verify completed-file reuse and one cumulative settlement, using authorized synthetic API responses. **{checks} native journey checks** cover Web, packaged Desktop and the actual native Side Panel. Their input-selection journeys use explicitly identified synthetic model-turn fixtures.

Desktop is frameless, with custom dragging and minimize/maximize/close buttons and no Electron default or Alt menu. Clicking the extension toolbar opens Chrome's native Side Panel, right by default while respecting browser preferences; there is no action popup. New Setup/Portable files and the Side Panel ZIP are unsigned localhost previews. Installation, signing, store publication and production model services remain unqualified.

Native SQL087→091 preserves complete original-field row digests for all 169 prior public tables, migration bytes, ownership and RLS. Only the declared capacity claim changes; checkpoint/tool-receipt guards are added. New columns start at zero/null and both execution-fact tables start empty, without invented history. Code and scripts live in the D-drive dev directory; main documentation lives in docs. No local Docker, WSL or virtualization is used.

Codex is the only kernel. All AI calls use the company internal OpenAI-compatible gateway. All 102 original requirements and TC/NFR/G01–G10 remain: 81 partially verified, 21 without proven completion, zero fully accepted. Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, complete independent role workflows and production acceptance remain open.'''
    diagram = '''```mermaid
flowchart LR
  Run[Paid task] --> Gap[Completed measured input request]
  Gap --> User[Human selects authorized inputs]
  User --> Check[Same task / original hold / source and capacity checks]
  Check --> Resume[Resume original Codex thread]
  Resume --> Run
  Run --> Settle[One cumulative settlement]
```'''
    intros = {
        'platform': ('后台保存付费回合检查点、累计用量和已完成工具回执，并复用现有登录、权限、来源和资金守卫。', 'The Backend stores paid-turn checkpoints, cumulative usage and completed-tool receipts using existing identity, permission, source and financial guards.'),
        'web': ('Web 工作台支持在原任务中补资料，并分别展示累计记录用量及已结算费用。', 'The Web workspace supports same-task input selection and separately labels recorded usage and settled charges.'),
        'admin': ('管理后台继续通过既有细分权限、范围、版本与审计约束任务及费用操作；取消等待中的付费工作保留已知用量。', 'Admin retains granular permissions, scope, version and audit requirements; cancelling a waiting paid task preserves measured spend.'),
        'desktop': ('Windows 客户端已重新打包，保留无边框及自绘窗口控制，并支持付费任务补资料。', 'The Windows client is repackaged with frameless custom window controls and paid-task input selection.'),
        'extension': ('Chrome MV3 使用真正原生 Side Panel，支持查看并解决原任务的付费资料请求。', 'Chrome MV3 uses the actual native Side Panel to display and resolve paid input requests on the original task.'),
        'delivery': ('交付验证保留修复前、中间失败及最终回执，绑定源码、原始报告、实际截图和自有资源回收。', 'Delivery preserves pre-fix, intermediate failure and final receipts, binding source, raw reports, actual screenshots and owned resource cleanup.'),
    }
    shots = {
        'desktop': ('assets/screenshots/paid-input-native-' + args.native + '-paid-input-en.png', '无边框 Desktop 的付费资料请求 / Frameless Desktop paid input request'),
        'web': ('assets/screenshots/paid-input-native-' + args.native + '-paid-input-en.png', 'Web 原任务补资料 / Web same-task input request'),
        'extension': ('assets/screenshots/paid-input-native-' + args.native + '-paid-input-en.png', 'Chrome 原生右侧栏补资料 / Chrome native Side Panel input request'),
    }
    for repo, (intro_zh, intro_en) in intros.items():
        directory = DEV / ('copypaste-' + repo)
        image = ''
        if repo in shots:
            file, label = shots[repo]
            assert (directory / file).is_file()
            image = '\n\n![' + label + '](' + file + ')'
        zh_links = '\n\n[实现说明](../../docs/technical/66-paid-native-input-checkpoints.md) · [执行绑定](../../docs/quality/paid-input-checkpoint.json) · [新客户端产物](../../docs/quality/paid-input-artifacts.json)'
        en_links = '\n\n[Implementation](../../docs/technical/66-paid-native-input-checkpoints.md) · [Evidence binding](../../docs/quality/paid-input-checkpoint.json) · [Current client artifacts](../../docs/quality/paid-input-artifacts.json)'
        prepend(directory / 'README.md', intro_zh + '\n\n' + zh + zh_links + '\n\n' + diagram + image)
        prepend(directory / 'README.en.md', intro_en + '\n\n' + en + en_links + '\n\n' + diagram + image)
    status = f'''阶段 66 将已完成且明确计量的 Codex 回合接入原任务补资料续接，保留原线程、预算及累计费用，并检查已完成工具输出及来源。平台 **{total}/{total}**、定向 **{focused}/{focused}**、六仓库 13 项检查和原生旅程 **{checks} 项**通过，原 765 项命名测试保留。原生补资料 UI 使用明确模拟回合；实际 Codex 子进程另以模拟 API 验证。Desktop 无边框及无默认/Alt 菜单、Chrome 原生右侧栏均由新打包产物实际检查。原 102 项需求、TC/NFR/G01–G10 及 81/21/0 状态保留。见[实现细则](technical/66-paid-native-input-checkpoints.md)、[绑定回执](quality/paid-input-checkpoint.json)和[新客户端预览](quality/paid-input-artifacts.json)。签名安装、商店和生产服务尚未验收；下方旧阶段记录保留当时范围。'''
    for file in ('docs/README.md', 'docs/DELIVERY.md'):
        prepend(ROOT / file, status)
    prepend(ROOT / 'docs/quality/02-requirements-traceability.md', '阶段 66 为 REQ-009/044/069 记录已完成且用量明确的原生回合补资料续接，见[绑定回执](paid-input-checkpoint.json)和[实现说明](../technical/66-paid-native-input-checkpoints.md)。原 102 项需求、全部 TC/NFR/G01–G10、原验收字段与发现保持，完整产品验收数仍为 0。')
    prepend(ROOT / 'docs/quality/09-implementation-alignment-audit.md', f'阶段 66 的局部修复为同一付费任务/线程补资料续接、单笔预留、累计费用及有效已完成操作复用。平台 {total}/{total}、定向 {focused}/{focused}、原生旅程 {checks} 项通过；模拟数据与 UI 回合夹具明确标注。见[绑定回执](paid-input-checkpoint.json)。原发现和全部验收门槛继续保留，不把本轮实现认作完整产品验收。')
    for file in ('13-persistent-agents-conversations-memory.md', '31-task-controls-and-native-continuation.md', '65-conversation-content-source-lineage.md'):
        prepend(ROOT / 'docs/technical' / file, '后续[阶段 66](66-paid-native-input-checkpoints.md)接入已完成且明确计量的付费原生回合补资料续接，保留原任务/线程/预算并累计结算。[当前绑定回执](../quality/paid-input-checkpoint.json)记录验证范围；下方旧阶段说明保留历史范围。任意执行中暂停、未知外部动作恢复和完整规范任务接口仍继续跟踪。')
    prepend(ROOT / 'docs/technical/30-native-window-and-browser-sidepanel.md', f'阶段 66 以重新构建的 Windows 包和真实 Chrome Side Panel 执行 **{checks} 项**原生旅程，检查无边框、自绘按钮、无 Electron/Alt 菜单、工具栏原生右侧栏及补资料流程。见[客户端产物](../quality/paid-input-artifacts.json)和[绑定范围](../quality/paid-input-checkpoint.json)。补资料 UI 使用明确模拟回合；实际 Codex 子进程续接由后台专项另行验证。')
    technical = ROOT / 'docs/technical/66-paid-native-input-checkpoints.md'
    text = technical.read_text(encoding='utf-8').replace('执行计数及完整绑定待实际回归完成后发布。', '实际执行及完整绑定见[当前回执](../quality/paid-input-checkpoint.json)。')
    technical.write_text(text, encoding='utf-8', newline='\n')
    prepend(technical, f'当前回归：平台 **{total}/{total}**，保留原全部 **765 项**命名测试；定向 **{focused}/{focused}**，六仓库 **13 项**检查和原生旅程 **{checks} 项**通过。Web、Desktop 与真正 Side Panel 的补资料 UI 使用明确模拟回合，实际 Codex 子进程另以模拟 Responses API 验证。两库 SQL087→091 保留原 169 张表旧字段摘要，新增列零/空值、执行事实表为空。见[绑定回执](../quality/paid-input-checkpoint.json)和[客户端产物](../quality/paid-input-artifacts.json)。')
    print(json.dumps({'status': 'passed', 'readmes': 12, 'full': total, 'focused': focused, 'native_checks': checks, 'fully_accepted_requirements': 0}))


if __name__ == '__main__':
    main()
