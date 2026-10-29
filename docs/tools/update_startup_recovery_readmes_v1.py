"""Add bilingual recovery usage and matching native screenshots to relevant repositories."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = 'https://github.com/copypasteltd/workmate/blob/docs/docs/'
ZH = '''<!-- startup-recovery-stage128 -->
## 本机启动安全恢复 · 阶段128

Desktop 在客户电脑运行固定版本 Codex。客户选择目录并主动授权后，初始化或打开会话若发生明确的传输故障，主进程先回收旧进程和锁，再请求公司服务检查原任务。只有轮次尚未准入、没有任何模型/输入计数/公司工具准入，且身份、权限与原截止仍有效，才允许恢复一次。最多两次启动，沿用原任务、原预算预留和 worker attempt，不延长原截止。

界面显示「正在重连」。连接结果未确认时，「重试连线」仅取回原请求结果；可能已执行的工作需先核对本机文件及费用。撤权、协议拒绝、清理失败、已提交轮次和结果未知均禁止自动重做。推理凭证仅传给可信本机运行器，不写入本机恢复日志或渲染页面。

```mermaid
flowchart TD
  Start[原任务与预算] --> Native[客户本机 Codex 启动]
  Native -->|明确传输故障| Clean[回收旧进程、锁和工具资源]
  Clean --> Fence[公司端撤销旧凭证并隔离旧请求]
  Fence --> Proof[原权限、原截止与零准入检查]
  Proof -->|全部成立且尚未恢复| Retry[同任务第二次启动]
  Native --> Gate[轮次准入]
  Retry --> Gate
  Gate --> Turn[执行一次并按公司记录结算]
  Proof -->|无法证明| Review[停止并核对原工作]
```

服务端通过 SQL133 升级；应先使用所有者执行完整迁移，再启动相应 API。新客户端声明 `desktop-startup-recovery-v1`；`/startup-recovery` 使用原绑定、固定契约摘要和原恢复请求键，`/turn-admission` 在 `turn/start` 前登记。旧客户端保持原执行流程，不能取得新的恢复许可。

本轮检查点记录控制层、实际固定 Codex、原生 SQL 与实际未签名打包客户端的限定验证。模型回答和对话框选择按用户要求使用假数据；尚不代表正式模型、签名安装、全部崩溃组合或专业角色整体验收。各旧阶段的包和画面仍对应其原源码。

[方案与接口](DOCStechnical/128-desktop-startup-recovery.md) · [匹配源码与验证](DOCSquality/startup-recovery-checkpoint-128.json) · [编号待办](DOCSquality/remaining-work-stage128.md)

'''
EN = '''<!-- startup-recovery-stage128 -->
## Safe customer-local startup recovery · Stage128

Desktop runs pinned Codex on the customer's computer. After explicit folder selection and consent, a classified initialization/thread transport failure first drains the old process, lock and owned tools. Company services permit one recovery only when no turn, provider, input-count or company-tool request has been admitted and the original identity, permissions and deadline remain valid. At most two launches retain one task, hold and worker attempt; the absolute deadline never extends.

The UI shows Reconnecting. Retry connection retrieves an unconfirmed original result; possibly executed work requires local-file and billing review. Withdrawal, rejection, incomplete cleanup, admitted turns and unknown outcomes cannot replay automatically. Scoped inference credentials go only to the trusted local runtime and are excluded from the recovery journal and renderer.

```mermaid
flowchart TD
  Start[Original task and hold] --> Native[Customer-local Codex startup]
  Native -->|Classified transport fault| Clean[Drain old process, lock and resources]
  Clean --> Fence[Revoke old credential and fence delayed calls]
  Fence --> Proof[Check authority, deadline and zero admissions]
  Proof -->|Safe and no previous recovery| Retry[Second launch of same task]
  Native --> Gate[Durable turn admission]
  Retry --> Gate
  Gate --> Turn[Execute once and settle company facts]
  Proof -->|Unproven| Review[Stop and review original work]
```

Upgrade the server through SQL133 with the database owner before starting the matching API. New clients opt into `desktop-startup-recovery-v1`. `/startup-recovery` binds the original session, contract digest and durable recovery key; `/turn-admission` precedes native `turn/start`. Legacy clients retain their existing flow without recovery authority.

The checkpoint records bounded controller, actual pinned Codex, native SQL and actual unsigned packaged Desktop qualification. Model responses and dialog decisions are synthetic as requested. This does not qualify a live provider, signed installation, every crash combination or complete professional roles. Earlier packages and captures retain their original source scope.

[Design and APIs](DOCStechnical/128-desktop-startup-recovery.md) · [Sources and qualification](DOCSquality/startup-recovery-checkpoint-128.json) · [Numbered open work](DOCSquality/remaining-work-stage128.md)

'''
MEDIA = '''![Actual packaged Desktop reconnecting with the original task](MEDIAworkmate-startup-recovery-128-01-startup-keeps-company-lease.png)

![Actual recovery and original billing interaction](MEDIAworkmate-startup-recovery-128-01-startup-and-original-receipt.gif)

[Original receipt](MEDIAworkmate-startup-recovery-128-01-original-local-receipt.png) · [Withdrawal screenshot](MEDIAworkmate-startup-recovery-128-01-permission-revoked-before-turn.png) · [Withdrawal GIF](MEDIAworkmate-startup-recovery-128-01-revoke-pending-startup.gif) · [Recovery MP4](MEDIAworkmate-startup-recovery-128-01-startup-and-original-receipt.mp4) · [Withdrawal MP4](MEDIAworkmate-startup-recovery-128-01-revoke-pending-startup.mp4)

'''


def main():
    targets = [ROOT / 'docs', ROOT / 'dev/copypaste-platform-publication-125', ROOT / 'dev/copypaste-desktop-publication-125', ROOT / 'dev/copypaste-delivery']
    for repo in targets:
        media = 'assets/screenshots/' if repo.name == 'copypaste-desktop-publication-125' else 'https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/'
        for name, text in [('README.md', ZH), ('README.en.md', EN)]:
            p = repo / name; original = p.read_bytes(); decoded = original.decode('utf-8-sig')
            assert '<!-- startup-recovery-stage128 -->' not in decoded
            first = decoded.index('\n\n')
            # Insert after the language links; keep every historical paragraph.
            second = decoded.index('\n\n', first + 2)
            insert = text.replace('DOCS', DOCS) + MEDIA.replace('MEDIA', media)
            decoded = decoded[:second + 2] + insert + decoded[second + 2:]
            p.write_bytes(decoded.encode('utf-8'))
    print('Updated eight bilingual README files; historical sections preserved.')


if __name__ == '__main__': main()
