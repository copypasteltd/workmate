"""Add bounded financial behavior and actual repository-local screenshots."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CONTENT = {
    'copypaste-platform': (
        '迁移 061 把规范账目、收款登记/核实及退款来源的真实 INSERT 与通知意图放在同一事务。独立维护任务按当前合法接收人投递，唯一约束及锁定批次防止重复；投递失败不重做资金。GET/PATCH 费用通知每次重验会话、企业、角色和账户；未知退款金额为 null，原要求金额独立保留，不暴露内部原因、银行参考或证据。两库升级前后各 120 张原公共表完整行摘要一致，001–060 不改，历史通知不回填。',
        'Migration 061 captures canonical journal, payment evidence/confirmation and refund INSERTs into an outbox in the same transaction. Independent maintenance delivers to currently eligible recipients with locking and uniqueness; retrying delivery never repeats funding. Financial GET/PATCH operations recheck the current session, workspace, role and account. Unknown refunds retain a null amount and a separate requested amount, with no internal reason, bank reference or evidence in the user DTO. Both native databases retain identical row digests across all 120 original public tables; 001–060 remain unchanged and historical notifications are not backfilled.',
        [('financial-inbox.png', '实际 Web 消费者', 'Actual Web consumer')],
    ),
    'copypaste-web': (
        '用量页增加个人实付、赠送、预留、授信上限和已用授信，精确显示六位 HKD 小数；费用通知支持账户/工作事件、未读、分页和已读切换。收款登记/核实不等于入账，未知退款不能显示成零或成功。读取失败、切换企业、撤权及退出清除旧费用内容；15 秒刷新和当前会话守卫拒绝迟到响应。',
        'Usage now includes personal paid/promotional/reserved balances, credit limit and used credit, with exact six-decimal HKD formatting. The financial inbox supports account/work events, unread filtering, pagination and read-state changes. Payment evidence/confirmation is distinct from posting; an unknown refund stays unknown. Failed reads, workspace changes, revoked access and sign-out clear stale financial content. Polling and current-session guards reject late responses.',
        [('39-financial-inbox.png', '精确账户和费用通知', 'Exact accounts and financial inbox'), ('40-financial-unknown.png', '未知退款', 'Unknown refund'), ('41-financial-narrow-dark.png', '375px 繁中深色', '375px Traditional Chinese dark theme')],
    ),
    'copypaste-admin': (
        '既有费用及 VIP/显式赠额操作现在由平台原子捕获用户通知意图，仍沿用原权限、独立审批和精确账本来源。待审、拒绝和重复请求不会再产生资金或通知事实；银行证据和内部原因不进入用户通知。后台继续使用管理员身份，下面的图片是用户端实际收到的结果，不是后台冒充用户或新的资金写入口。',
        'Existing financial and VIP/explicit-gift commands now capture user-notification intent atomically on the platform, preserving the original permissions, independent review and exact ledger provenance. Pending, rejected and replayed requests do not create duplicate funding or notification facts. Bank evidence and internal reasons stay out of customer notifications. Admin retains its separate identity; the capture below shows the actual customer result, not impersonation or a new funding endpoint.',
        [('financial-client-inbox.png', '实际用户端通知结果', 'Actual customer notification result')],
    ),
    'copypaste-desktop': (
        '独立 renderer 已同步费用账户和通知页面；主进程只放行限定的用户 GET/PATCH 路径，凭证继续由本地安全桥管理。保持无原生边框、无 Electron 默认菜单和自绘窗口控制。实际打包客户端已验证 PKCE、精确赠额、未知退款、跨端已读、撤权与退出清空；当前预览包随新源码重建，阶段 49 包另存保留。',
        'The independent renderer includes the financial accounts and inbox. The main process admits only the bounded user GET/PATCH paths, with credentials retained by the secure local bridge. The window stays frameless with custom controls and no Electron application menu. The actual packaged client verifies PKCE, exact gift values, unknown refunds, cross-client read state and clearing on revocation/sign-out. Current previews are rebuilt from the new source; stage 49 binaries remain archived separately.',
        [('28-financial-inbox.png', '无边框客户端费用账户', 'Frameless financial accounts'), ('29-financial-unknown.png', '实际未知退款', 'Actual unknown refund')],
    ),
    'copypaste-extension': (
        '工具栏仍打开真实 Chrome 原生 Side Panel，默认右侧；左右位置由浏览器偏好决定。侧栏增加精确个人余额、最近五条账户通知、未读筛选和已读切换，完整历史/工作事件在 Web 查看。企业切换、失败读取、撤权和退出清空旧内容，工作区/请求序号拒绝迟到结果。深色提示文字已实际校验对比度 11.59:1；本轮仅使用自建浏览器并完整关闭。',
        'The toolbar continues to open the real native Chrome Side Panel, normally on the right and subject to Chrome’s placement preference. It adds exact personal balances, the latest five account notices, unread filtering and read-state controls; Web provides full history/work events. Workspace changes, failed reads, revocation and sign-out clear stale content, and workspace/request revisions reject late results. Actual dark-theme hint contrast measures 11.59:1. Only owned browsers were used and closed.',
        [('17-financial-inbox.png', '原生侧栏精确账户', 'Native Side Panel accounts'), ('18-financial-unknown.png', '原生侧栏未知退款', 'Unknown refund in the native panel')],
    ),
    'copypaste-delivery': (
        '新增候选、停栈升级和三端费用专项脚本。第四次候选 38/38；平台全量 410/410，707 份来源一致；实际 Web、打包无边框 Desktop 和原生 SIDE_PANEL 费用 8/8，808 份来源及运行字节一致，另存四份补充严格响应和八张未编辑截图。十项既有后台/成员/原生/会话上下文执行均通过。失败尝试和阶段 49 原始证据逐字节归档，旧包与当前重建预览分开保存。',
        'New scripts cover candidate tests, a stopped-stack upgrade and actual three-client finance workflows. Candidate four passes 38/38; the full platform regression passes 410/410 with 707 unchanged source files. Web, packaged frameless Desktop and the native SIDE_PANEL pass 8/8 financial checks, with 808 unchanged source/runtime files, four separate strict supplemental responses and eight unedited captures. All ten existing Admin/member/native/session context runs pass. Failed attempts and original stage 49 evidence are archived byte-for-byte; old binaries and current rebuilt previews remain separate.',
        [('financial-web.png', '实际 Web', 'Actual Web'), ('financial-desktop.png', '实际打包 Desktop', 'Actual packaged Desktop'), ('financial-extension.png', '实际原生 Side Panel', 'Actual native Side Panel')],
    ),
}


def main():
    for repo, (zh, en, captures) in CONTENT.items():
        for english in (False, True):
            path = ROOT / 'dev' / repo / ('README.en.md' if english else 'README.md')
            original = path.read_text(encoding='utf-8')
            title = '## Durable financial notifications and three-client accounts (stage 50)' if english else '## 事务费用通知与三端账户（阶段 50）'
            assert title not in original, f'Already updated: {path}'
            split = original.index('\n## ')
            heading = '\n' + title + '\n\n'
            body = (en if english else zh) + '\n\n'
            body += ('Current platform regression: 410/410; actual three-client financial workflows: 8/8. AI/media and payment evidence are authorized local simulations; authentication, database, authorization, ledger and notification paths execute for real. This does not complete the original 102 acceptance cases, production banking or the full installation/system matrix.\n\n' if english else '当前平台回归 410/410，真实三端费用流程 8/8。AI/媒体和付款证据使用获准本机模拟；身份、数据库、权限、账本及通知实际执行。原始 102 项综合验收、生产银行及完整安装/系统矩阵继续单独跟踪。\n\n')
            body += ('```mermaid\nflowchart LR\n  Source[Canonical financial fact] --> Tx[Same-transaction outbox]\n  Tx --> Worker[Current eligible recipient]\n  Worker --> Access[Recheck current authority]\n  Access --> Clients[Web / frameless Desktop / native Side Panel]\n```\n\n' if english else '```mermaid\nflowchart LR\n  Source[规范费用事实] --> Tx[同事务通知意图]\n  Tx --> Worker[当前合法接收人]\n  Worker --> Access[读取时复查权限]\n  Access --> Clients[Web / 无边框 Desktop / 原生侧栏]\n```\n\n')
            for filename, label_zh, label_en in captures:
                image = path.parent / 'assets/screenshots' / filename
                assert image.is_file(), f'Missing actual capture: {image}'
                body += f'![{label_en if english else label_zh}](assets/screenshots/{filename})\n\n'
            path.write_text(original[:split] + heading + body.rstrip() + '\n' + original[split:], encoding='utf-8', newline='\n')
    print('Updated 12 bilingual READMEs with actual local captures.')


if __name__ == '__main__':
    main()
