"""Add the Stage 122 behavior and observed scope to the affected bilingual READMEs."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
LINK = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/122-codex-startup-and-turn-isolation.md'
MARKER = '<!-- runtime-startup-122 -->'
SECTIONS = {
    'platform': (
        '云端 Codex 初始化发生超时或断线时，仅在确认没有模型请求、旧进程及网关已关闭后恢复一次。60 秒 RPC 期限保持；两次启动共享原任务的 15 分钟期限、权限和预算。进入线程或模型调用后的失败不会自动重放。工具、输出和完成通知必须匹配当前线程与轮次。',
        'A timed-out or disconnected cloud Codex initialization may restart once only after zero model dispatches and actual closure of the old process and gateway. RPCs retain the 60-second deadline; both starts share the original task deadline, authority and budget. Failures after thread or model admission are not replayed. Tools, output and completion must belong to the current thread and turn.',
        '12 项实际原生运行检查通过，包含真正等待 60 秒超时、恢复上限、取消、明确拒绝、清理失败及错误轮次拒绝。模型响应为明确假数据；历史偶发超时根因仍未证明。原生检查需要锁定的可执行文件与并列 Desktop 合约。',
        '12 real native runtime checks passed, including the actual 60-second timeout, restart limit, cancellation, explicit rejection, cleanup failure and foreign-turn denial. Model responses are synthetic; the historical intermittent timeout root cause remains unproven. Native checks require the locked executable and adjacent Desktop contract.',
        'flowchart LR\n  A[Original task and budget] --> B[Native Codex initialize]\n  B --> C{Initialized?}\n  C -->|Yes| D[Current thread and turn]\n  C -->|No| E{Zero dispatch, old process closed, retry unused?}\n  E -->|Yes, once| B\n  E -->|No| F[Stop and report actual outcome]\n  D --> G[Company tools and original settlement]'),
    'desktop': (
        '本机 Codex 的工具、输入请求、审批、消息、用量和完成通知绑定当前线程及轮次，排队的旧消息不能转入后续任务。丢失 turn/start 响应时，真实完成通知可结束原轮次，避免重复执行。原生错误日志只保留受限字段。客户本机完整权限、撤销、无边框及自绘窗口控制保持生效。',
        'Local Codex tools, input requests, approvals, messages, usage and completion are scoped to the current thread and turn. Queued old frames cannot enter a later task. A real completion can recover a lost turn/start reply without replay. Native error diagnostics retain only bounded fields. Customer-local full permission, revocation, frameless presentation and custom window controls remain enforced.',
        '180 项单元与 25 项真实原生 Codex 检查通过。npm test 的预构建现包含 Native Host，支持新检出目录。当前源码打包后另有 8 项实际 UI 检查通过，覆盖 OTP/PKCE、本机明确授权、真实本机文件与公司工具费用、撤销，以及 1440/1280/800 窗口无可见滚动条和横向溢出。提供方回复与原生对话框选择为明确测试数据。',
        '180 unit and 25 real native Codex checks passed. npm test now builds the Native Host for fresh checkouts. Eight actual packaged UI checks also passed: OTP/PKCE, explicit local consent, real local files and company-tool billing, revocation, and 1440/1280/800 layouts without visible scrollbar rails or horizontal overflow. Provider responses and native dialog selections are explicit fixtures.',
        'flowchart LR\n  A[Customer permission] --> B[Customer-local Codex]\n  B --> C{Current thread and turn?}\n  C -->|Yes| D[Authorized local or company tool]\n  C -->|No| E[Reject foreign request]\n  D --> F[Native completion and original billing]'),
    'web': (
        '工作详情现在将 runtime.startup.retry 显示为“正在重新連接助手”，并为连接故障提供繁英说明。恢复事件沿用服务器任务身份；页面不会自行重新提交付费任务或重建预算。',
        'Work details now explain runtime.startup.retry as “Reconnecting your assistant”, with Traditional Chinese and English connection messages. Recovery retains the server task identity; the page does not resubmit paid work or create another budget.',
        '20 项现有客户端检查、类型检查及当前构建通过。当前 Web 的 OTP/PKCE 页面也参与本轮打包 Desktop 的实际浏览器登录流程。完整跨端和生产验收仍按需求台账跟踪。',
        'All 20 existing client checks, type checking and the current build passed. The current Web OTP/PKCE pages also participated in the actual browser login to the packaged Desktop. Complete cross-client and production acceptance remains tracked in the requirements ledger.',
        'flowchart LR\n  A[Original cloud task] --> B[Server task events]\n  B --> C[Localized connection progress]\n  B --> D[Original output and usage]\n  C --> D'),
    'delivery': (
        '本轮执行器固定实际源码、原生可执行文件与原始输出，保留失败尝试，并分别验证初始化恢复、轮次隔离、账务事务和真实打包页面。执行器只控制本次拥有的原生进程、目录、数据库与浏览器；不用 Docker、WSL 或虚拟机。',
        'This stage binds actual source bytes, the native executable and raw output; retains failed attempts; and separately checks startup recovery, turn isolation, billing transactions and packaged UI. Runners control only owned native processes, folders, databases and browsers, without Docker, WSL or virtual machines.',
        '已取得云端原生 12 项、Desktop 单元 180 项／原生 25 项、Web 20 项及打包 UI 8 项限定通过记录。相关脚本保留当次工作目录和源码，不应把历史执行器当作另一个产品启动入口。常规使用继续按下方启动说明进行；生产签名发行、真实供应商质量和完整 102 项验收单独跟踪。',
        'Recorded bounded passes cover 12 cloud native checks, 180 Desktop unit / 25 native checks, 20 Web checks and 8 packaged UI checks. Historical runners preserve their authored workspace and source; normal product usage follows the startup instructions below. Production signing, live provider quality and complete acceptance of all 102 requirements are tracked separately.',
        'flowchart LR\n  A[Source and native pin] --> B[Native fault checks]\n  B --> C[Task and billing transactions]\n  C --> D[Packaged UI and recordings]\n  D --> E[Bilingual delivery and committed proofs]\n  E --> F[Ordinary mapped-branch publication]'),
}


def main():
    for component, (zh, en, zcheck, echeck, diagram) in SECTIONS.items():
        folder = DEV / ('copypaste-' + component + ('-runtime-122' if component != 'delivery' else ''))
        for filename, title, body, checks in [('README.md', 'Codex 启动与轮次隔离 · 阶段 122', zh, zcheck),
                                               ('README.en.md', 'Codex startup and turn isolation · Stage 122', en, echeck)]:
            file = folder / filename
            original = file.read_text(encoding='utf-8')
            assert MARKER not in original, file
            head, tail = original.split('\n\n', 2)[:2], original.split('\n\n', 2)[2]
            section = f'{MARKER}\n\n## {title}\n\n{body}\n\n{checks}\n\n```mermaid\n{diagram}\n```\n\n'
            section += f'[完整方案 / Behavior and verification]({LINK})\n\n'
            if component == 'desktop':
                prefix = 'assets/screenshots/workmate-runtime-startup-desktop-02-'
                section += f'![Actual frameless Desktop]({prefix}layout-1440-en.png)\n\n'
                section += f'![Actual native interaction]({prefix}local-cloud-boundary.gif)\n\n'
                section += f'[800px]({prefix}layout-800-en.png) · [繁體中文]({prefix}workspace-zh.png) · [MP4]({prefix}local-cloud-boundary.mp4)\n\n'
            file.write_text('\n\n'.join(head) + '\n\n' + section + tail, encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
