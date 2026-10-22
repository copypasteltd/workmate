"""Publish current source-lineage documentation without relabelling old UI evidence."""
import argparse
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read
from update_stage63_delivery_docs import prepend
import update_stage63_delivery_docs


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'upgrade', 'recheck'):
        parser.add_argument('--' + key, required=True)
    a = parser.parse_args()
    runs = {key: read(DELIVERY / f'evidence/history-source-{kind}-{getattr(a, key)}.json')
            for key, kind in [('integration', 'integration'), ('full', 'regression'), ('clients', 'clients'), ('upgrade', 'upgrade')]}
    assert all(run['status'] == 'passed' for run in runs.values())
    assert read(ROOT / f'docs/quality/history-source-client-recheck-{a.recheck}.json')['status'] == 'passed'
    total, focused = runs['full']['counts']['pass'], runs['integration']['counts']['pass']
    update_stage63_delivery_docs.MARKER = 'stage65-current-history-source-lineage'
    zh = f'''## 会话与实际读取的来源约束（阶段 65）

模型实际读取的文件版本、云文件引用和营销数据集现在保存不可改写的来源引用。历史助手结果、固定记忆和已批准计划的来源失效后，后续模型、工具重放、事件和产物保存都会重新检查；新付费委派在创建任务和预留资金前拒绝失效历史。会话显示不可用提示，任务列表与详情保留状态和费用元数据并隐藏失效的验收正文。原 PLAN_STALE / PLAN_INPUT_CHANGED 和首次输入补选语义保留。受控删除明确擦除元数据；普通更新不能因缺省擦除标记而改写来源。

显式发布创建独立副本并冻结已确认的输入来源。删除原私有会话仍保留已发布副本；被实际消费的原始文件、数据集或固定记忆失效时，派生副本和公开分享仍受来源约束。恢复来源不改变当前项目、用户或私有范围权限。

验证：平台 **{total}/{total}**，保留此前全部 **746 项**命名测试；定向 **{focused}/{focused}**，六仓库 **13 项**检查通过。包括真实 HTTP SSE、实际 Worker 工具、文件下载、计划、资金预留及公开分享；AI 和业务数据按授权模拟。两库 SQL081→087 保留原 168 张公共表的全部行摘要、旧迁移和原函数定义，新增来源表为空，不补造历史读取。

Desktop 保持无边框、自绘窗口控制、无 Electron 默认或 Alt 菜单；Extension 使用 Chrome 原生 Side Panel，默认右侧并遵循浏览器偏好。既有包与原生旅程只做当前字节核对，原截图和旅程保留原后台源码范围。本阶段未完成新后台的跨端界面验收、签名安装、商店发布或正式环境验收。

仅使用 Codex，全部 AI 请求经公司内部 OpenAI 兼容服务器。原 102 项需求、全部 TC/NFR/G01–G10 保留：81 项局部验证、21 项未证明完成、0 项完整验收。'''
    en = f'''## Sources of conversations and actual reads (stage 65)

Actual model reads now retain immutable file-version, cloud-reference and marketing-dataset provenance. Historical assistant results, pinned memories and approved plans remain subject to current source checks before further model input, cached tools, events and artifact persistence. A new paid delegation rejects unavailable history before creating a task or reserving funds. Conversations show an unavailable placeholder; task lists and details retain state and cost metadata while fencing unavailable acceptance bodies. Existing PLAN_STALE / PLAN_INPUT_CHANGED and initial input-selection semantics remain intact. Controlled deletion explicitly scrubs provenance; a missing erasure flag never authorizes an ordinary provenance rewrite.

Explicit publication creates an independent copy with a frozen set of known inputs. Removing the original private conversation preserves that published copy. Revocation of an input file, dataset or pinned memory still fences derived copies and public shares. Restoration preserves current project, user and private-scope authorization.

Validation: **{total}/{total} Platform tests**, retaining all **746** prior named tests; **{focused}/{focused} focused tests** and **13 checks across six repositories**. Actual HTTP SSE, Worker tools, downloads, plans, holds and public shares run with authorized synthetic AI/business data. Native SQL081→087 preserves row digests for all 168 original public tables, prior migrations and original function definitions. The added provenance table starts empty; historical reads are never invented.

Desktop remains frameless with custom window controls and no Electron default or Alt menu. The extension uses a real Chrome native Side Panel, right by default while respecting browser preferences. Existing packages receive a read-only byte check; screenshots and native journeys retain their historical Backend source scope. Current Backend UI qualification, signed installation, store release and production acceptance remain pending.

Codex is the only kernel. All AI requests use the company internal OpenAI-compatible gateway. All 102 original requirements and TC/NFR/G01–G10 remain: 81 partially verified, 21 without proven completion, zero fully accepted.'''
    diagram = '''```mermaid
flowchart LR
  Input[Actual reads and fixed references] --> Origin[Immutable source provenance]
  Origin --> Work[History and approved plans]
  Origin --> Copy[Independent published copies]
  Guard[Current scope and source lifecycle] --> Work
  Guard --> Copy
  Work --> Result[Authorized model input and output]
  Copy --> Share[Authorized downloads and shares]
```'''
    prefaces = {
        'platform': ('本仓库新增实际读取来源、内容遍历、发布输入快照和受控来源锁，保留原 SQL001–081。', 'This repository adds actual-read provenance, content traversal, publication input snapshots and scoped source locks, preserving SQL001–081.'),
        'web': ('用户工作台继续通过统一后台读取获准的会话和任务内容。', 'The customer workspace continues using the shared Backend for authorized conversations and tasks.'),
        'admin': ('管理后台保留细分权限、用户/费用/VIP控制和审计；来源治理同样约束用户结果。', 'Admin retains granular permissions, user/cost/VIP controls and audits; source governance also fences customer results.'),
        'desktop': ('本阶段保持现有无边框客户端与包字节，后台新增内容来源约束。', 'This stage preserves existing frameless client/package bytes while adding Backend content-source checks.'),
        'extension': ('本阶段保持真正原生浏览器侧栏与现有 ZIP 字节。', 'This stage preserves the native browser Side Panel and existing ZIP bytes.'),
        'delivery': ('本仓库保留修复前和中间失败证据，新增来源回归和原生两库升级核查。', 'This repository retains pre-fix and intermediate failures and adds source-lineage regression and native two-database upgrade verification.'),
    }
    for name, (zh_intro, en_intro) in prefaces.items():
        repo = DEV / ('copypaste-' + name)
        prepend(repo / 'README.md', zh_intro + '\n\n' + zh + '\n\n' + diagram)
        prepend(repo / 'README.en.md', en_intro + '\n\n' + en + '\n\n' + diagram)
    status = f'''阶段 65 新增实际读取及会话、记忆、计划和产物的来源链保护。显式发布冻结已确认输入，保留独立副本语义；失效正文不影响任务状态和费用元数据读取。平台 **{total}/{total}**、定向 **{focused}/{focused}**、六仓库 13 项检查通过，原 746 项命名测试保留。两库 SQL081→087 保留原 168 张公共表的全部行摘要、旧迁移和原函数定义，来源表不补造历史。见[实现细则](technical/65-conversation-content-source-lineage.md)和[绑定回执](quality/history-source-checkpoint.json)。Desktop 无边框和 Chrome 原生右侧栏保持；既有客户端和包只做只读字节核对，旧截图不代表本轮后台界面验收。完整 102 项需求、TC/NFR/G01–G10 和正式环境验收继续跟踪。'''
    prepend(ROOT / 'docs/README.md', status)
    prepend(ROOT / 'docs/DELIVERY.md', status)
    prepend(ROOT / 'docs/quality/02-requirements-traceability.md', '阶段 65 记录实际读取、历史上下文及独立发布输入的来源约束，见[绑定回执](history-source-checkpoint.json)。全部 102 项原始需求、TC/NFR/G01–G10 及 81 局部验证/21 未证明完成/0 完整验收保持；原字段与失败记录保留。')
    for file in ('13-persistent-agents-conversations-memory.md', '31-task-controls-and-native-continuation.md', '64-task-source-visibility.md'):
        prepend(ROOT / 'docs/technical' / file, '后续[阶段 65](65-conversation-content-source-lineage.md)补充实际文件/云引用/数据集读取、历史结果和计划来源检查，以及显式发布的独立输入快照；状态与费用元数据保留。见[当前后台回执](../quality/history-source-checkpoint.json)。本文原阶段源码和执行回执保持其历史范围；已付费原生步骤的业务续接及完整验收继续跟踪。')
    prepend(ROOT / 'docs/technical/30-native-window-and-browser-sidepanel.md', f'阶段 65 保持 Desktop 无边框、无 Electron/Alt 菜单与 Chrome 原生右侧栏。既有客户端/包已[只读核对](../quality/history-source-client-recheck-{a.recheck}.json)，未将原生历史旅程重新标为本轮后台界面验收。见[后台来源链实现](65-conversation-content-source-lineage.md)。')
    prepend(ROOT / 'docs/modules/05-analytics-seo-geo.md', '营销事实工具的实际数据集读取现纳入[阶段 65 来源链](../technical/65-conversation-content-source-lineage.md)，与固定文件、历史上下文、计划及独立发布输入共同复查当前状态和保留期。GEO、网站/CMS 写回和完整 TC-029 继续跟踪。')
    prepend(ROOT / 'docs/technical/65-conversation-content-source-lineage.md', f'当前执行：平台 **{total}/{total}**，保留原全部 **746 项**命名测试；定向 **{focused}/{focused}**，六仓库 **13 项**检查通过。两库 SQL081→087、原 168 张公共表行摘要、旧迁移和原函数核查通过，新增来源表为空。[绑定回执](../quality/history-source-checkpoint.json)列出源码、原始报告、验证器和回收记录。仅当前后台及已授权模拟数据得到所列局部验证；既有原生包只做字节核对。')
    print({'status': 'passed', 'readmes': 12, 'full': total, 'focused': focused, 'new_backend_ui_qualification': False})


if __name__ == '__main__':
    main()
