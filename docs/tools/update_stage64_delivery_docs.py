"""Describe executed source fences while preserving earlier UI/package scopes."""
import argparse
from pathlib import Path

from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read
from update_stage63_delivery_docs import prepend as old_prepend
import update_stage63_delivery_docs


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'upgrade', 'recheck'):
        parser.add_argument('--' + key, required=True)
    a = parser.parse_args()
    runs = {key: read(DELIVERY / f'evidence/task-source-{kind}-{getattr(a, key)}.json')
            for key, kind in [('integration', 'integration'), ('full', 'regression'), ('clients', 'clients'), ('upgrade', 'upgrade')]}
    assert all(r['status'] == 'passed' for r in runs.values())
    assert read(ROOT / f'docs/quality/task-source-client-recheck-{a.recheck}.json')['status'] == 'passed'
    total, focused = runs['full']['counts']['pass'], runs['integration']['counts']['pass']
    update_stage63_delivery_docs.MARKER = 'stage64-current-report-task-source-fences'
    zh = f'''## 报告与任务历史的当前来源约束（阶段 64）

营销分析和原始 SEO 诊断的通用任务详情、项目任务列表、JSON 历史消息及两种 SSE 事件入口，现与专用报告共用当前来源约束。来源被隔离或到期后，已有事件流会在下一批读取时停止发送正文并关闭。恢复来源仍须通过当前企业、项目、私有所有者和登录身份检查；原有报告及历史事件保持不可变。

分析数据集、原始 CSV、报告产物与终态分析任务的保留期在清理前生效。过期分析输入会在创建任务和预留费用之前拒绝。来源锁等待正常任务更新后，还会重新核对用户权限版本，避免并发撤权后仍返回消息。

验证：平台完整 **{total}/{total}**，保留前阶段全部 **734 项**命名测试；新增定向 **{focused}/{focused}**，六仓库 **13 项**检查通过。使用实际 HTTP 事件流、Worker 保存的模型消息，以及真实锁定 Codex/内部模拟网关；AI 和业务数据继续按授权模拟。两库原生 SQL080→081 保留 **168 张**原公共表的全部行摘要、所有旧迁移和表所有者/RLS，仅更新两个报告访问函数。

**Desktop 无边框、无 Electron 默认菜单或 Alt 菜单**；扩展工具栏切换 **Chrome 原生 Side Panel**，默认右侧并遵循浏览器位置偏好。现有客户端、ASAR、扩展 ZIP 及阶段 63 预览包已只读核对。下方真实截图和原生检查保留其原后台版本范围，本阶段没有新增后台的浏览器/原生端旅程验收。安装、签名、商店发布和正式环境仍待完成。

仅使用 Codex，所有 AI 请求走公司内部 OpenAI 兼容服务器。原 102 项需求、全部 TC/NFR/G01–G10 保留；81 项局部验证、21 项未证明完成、0 项完整验收。'''
    en = f'''## Current source fences for reports and task history (stage 64)

Marketing analysis and original SEO audit task details, project lists, historical JSON messages and both SSE routes now share current source checks with their dedicated reports. When a source is quarantined or expires, an open stream stops emitting message bodies and closes at its next batch. Restoration still requires current workspace, project, private-owner and session authorization; retained reports and events remain immutable.

Analysis dataset, original CSV, output artifact and terminal analysis-task retention applies before cleanup. Expired analysis inputs are rejected before task creation or budget reservation. Reads that wait for ordinary task updates recheck the actor's current authorization version before responding.

Validation: **{total}/{total} Platform tests**, retaining all **734** prior named tests; **{focused}/{focused} focused tests** and **13 checks across six repositories**. Actual HTTP streams and Worker-persisted model messages run, including locked Codex through the internal synthetic gateway. AI and business data remain synthetic as authorized. Native SQL080→081 preserves every row digest in **168** prior public tables, old migrations and table ownership/RLS in both databases; only two report-access functions change.

**Desktop remains frameless with no Electron application or Alt menu.** The extension toolbar toggles **Chrome's native Side Panel**, right by default and subject to browser preferences. Existing sources, ASAR, extension ZIP and stage 63 preview packages were rechecked read-only. The actual screenshots and native executions below retain their original Backend scope; this stage adds no browser/native journey qualification of the changed Backend. Installation, signing, store publication and production remain open.

Codex remains the only kernel; every AI request uses the company's internal OpenAI-compatible server. All original 102 requirements and TC/NFR/G01–G10 remain: 81 partially verified, 21 not proven complete, zero fully accepted.'''
    diagram = '''```mermaid
flowchart LR
  Request[Task detail / list / JSON / SSE] --> Auth[Current tenant / project / private owner / session]
  Auth --> Source[Current report and original-source lifecycle]
  Source --> Locks[Source locks / identity recheck after waits]
  Locks --> Read[Authorized immutable data or event batch]
  Read --> Source
  Source --> Closed[Unavailable source / no new body / close open stream]
  Input[Analysis dataset / original CSV] --> Valid[Active and unexpired source]
  Valid --> Reserve[Only then create task and reserve budget]
```'''
    prefaces = {
        'platform': ('本仓库新增 SQL081 与报告/任务读取来源检查；SQL001–080 保持原字节。', 'This repository adds SQL081 and shared report/task read fences. SQL001–080 retain their original bytes.'),
        'web': ('用户工作台通过统一后台执行来源与身份约束；现有数据轮询和事件流在拒绝访问后清空显示内容。', 'The customer workspace uses the shared Backend source and identity checks. Existing polling and event handling clear displayed content after access is denied.'),
        'admin': ('后台内容处置继续使用细分权限；来源隔离与到期同时约束用户端报告及其历史消息。', 'Admin content actions retain granular permissions. Source quarantine and expiry also fence user reports and their historical messages.'),
        'desktop': ('独立 renderer 继续在无边框窗口中使用同一受控后台；当前客户端源码与包只读核对通过。', 'The independent renderer continues using the same controlled Backend in a frameless window. Current client/package bytes passed a read-only recheck.'),
        'extension': ('保持真正 Chrome 原生侧栏交互，默认右侧；本阶段仅核对既有客户端与 ZIP 字节。', 'The extension retains a real Chrome native Side Panel, right by default. This stage rechecks existing client and ZIP bytes only.'),
        'delivery': ('本仓库新增实际 HTTP 来源访问检查、保留原失败回执的回归流程与原生数据库升级核查；未启动 Docker/WSL。', 'This repository adds actual HTTP source-access checks, regression receipts preserving failed attempts, and native database upgrade verification. Docker/WSL are not used.'),
    }
    for name, (preface_zh, preface_en) in prefaces.items():
        repo = DEV / ('copypaste-' + name)
        old_prepend(repo / 'README.md', preface_zh + '\n\n' + zh + '\n\n' + diagram)
        old_prepend(repo / 'README.en.md', preface_en + '\n\n' + en + '\n\n' + diagram)
    status = f'''阶段 64 修复原始分析/SEO 报告在通用任务详情、列表、JSON 历史与两种 SSE 中的来源边界；已有流逐批复查，失效后停止发送正文。分析输入与原始 CSV 到期在创建任务/预留费用前拒绝。平台 **{total}/{total}**、定向 **{focused}/{focused}**、六仓库 13 项检查通过；前全部 734 项命名测试保留。两库 SQL080→081 保留 168 张原公共表全部行摘要与旧迁移，仅更新两个报告访问函数。见[实现细则](technical/64-task-source-visibility.md)、[当前绑定证据](quality/task-source-checkpoint.json)。无边框 Desktop 与 Chrome 原生右侧栏的既有客户端/包只读核对通过；下方旧界面截图及原生验收保留其原后台版本范围。完整 102 项需求和 TC/NFR/G01–G10 继续跟踪，当前仅为已授权模拟环境中的局部验证。'''
    old_prepend(ROOT / 'docs/README.md', status)
    old_prepend(ROOT / 'docs/DELIVERY.md', status)
    old_prepend(ROOT / 'docs/modules/05-analytics-seo-geo.md', '原始分析与 SEO 报告的通用任务历史现执行相同来源治理，包括活动 SSE 的后续消息。分析数据集、原始 CSV、产物和终态任务的保留期在清理前生效。见[阶段 64 实现](../technical/64-task-source-visibility.md)与[绑定回执](../quality/task-source-checkpoint.json)。网站/CMS 写回、GEO 和完整 TC-029 继续跟踪。')
    old_prepend(ROOT / 'docs/quality/02-requirements-traceability.md', '阶段 64 新增原始分析/SEO 任务历史与活动事件流的来源约束证据，见[绑定回执](task-source-checkpoint.json)。原 102 项需求、全部 TC/NFR/G01–G10、81 项局部验证、21 项未证明完成和 0 项完整验收保持不变。原字段与旧失败记录保留。')
    old_prepend(ROOT / 'docs/technical/30-native-window-and-browser-sidepanel.md', '阶段 64 后台修复未改动原生端源码；现有无边框 Desktop、无 Electron/Alt 菜单与 Chrome 原生右侧栏的源码及包已[只读核对](../quality/task-source-client-recheck-01.json)。下方阶段 63 的真实原生检查及截图仍代表原后台版本，未被重新标为新后台旅程。见[当前后台来源约束](64-task-source-visibility.md)。')
    old_prepend(ROOT / 'docs/technical/63-source-governed-website-change-tasks.md', '本页原「原始诊断/其他分析报告历史消息仍待核实」事项已由[阶段 64](64-task-source-visibility.md)完成所列专用与通用入口、活动 SSE 和保留期的定向核查及修复。新的后台证据见[阶段 64 回执](../quality/task-source-checkpoint.json)；本页阶段 63 的 UI/原生及四操作契约源码绑定保持历史原值。完整 TaskDTO、续接任务来源审查、正式环境与完整产品验收继续跟踪。')
    old_prepend(ROOT / 'docs/technical/64-task-source-visibility.md', f'''## 当前已执行的范围

平台完整 **{total}/{total}**，保留前阶段全部 **734 项**命名测试；本阶段定向 **{focused}/{focused}**、六仓库 **13 项**检查通过。两库原生 SQL080→081 核查通过，原 168 张公共表全部行摘要、表所有者/RLS、旧迁移及其记录保留，仅两个报告访问函数变化。本次夹具已回收，自建数据库已关闭。

见[当前绑定回执](../quality/task-source-checkpoint.json)、[当前原生客户端只读核对](../quality/task-source-client-recheck-{a.recheck}.json)和[历史预览包清单](../quality/seo-change-artifacts.json)。阶段 63 的浏览器/原生旅程和补充 API 契约保留原源码绑定；本阶段未新增后台界面旅程验收。''')
    print({'status': 'passed', 'readmes': 12, 'full': total, 'focused': focused, 'new_backend_ui_qualification': False})


if __name__ == '__main__':
    main()
