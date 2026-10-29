# 本机启动生命周期 · 阶段127 / Customer-local startup lifecycle

Desktop 初始化超过公司初始租约时，原实现未及时保活；异步准备中关闭或撤权，也可能与稍后创建的进程及锁竞争。本轮修复主任务和工作流子任务的启动保活，并让关闭等待准备退出、打断待响应启动请求，再完成资源回收。执行仍位于客户本机，费用仍归属原任务及原预留。

Desktop previously renewed its company lease only after native startup. A valid startup could outlast that lease, while closure during asynchronous preparation could race with a later process or lock. Main and workflow-child tasks now renew authority during startup. Closing interrupts pending startup requests and drains preparation before resource cleanup. Execution remains customer-local, with the original task and billing hold.

| 编号 / ID | 本轮变更 / Change | 验证 / Verification |
| --- | --- | --- |
| 127-01 | 主任务与子任务收到公司许可后立即保活，启动后再次授权 / Renew main and child authority during startup; reauthorize before a turn | 主任务、子任务跨越45秒初始租约及终态后停止保活 / Main/child initial-lease and terminal-drain checks |
| 127-02 | 关闭与撤权阻止准备后迟到创建进程 / Prevent spawning after withdrawal during preparation | 授权、二进制校验、锁及创建进程前四个边界分别关闭与撤权 / Close/revoke at four preparation boundaries |
| 127-03 | 待响应初始化和建会话可主动结束 / Interrupt pending native startup requests | 真实固定Codex、所属进程退出与锁释放 / Pinned native Codex, owned-process exit and lock release |
| 127-04 | 不增加任务或重复扣费 / Preserve original task and charge | 实际打包窗口、真实原生SQL、一次预留/一次模型请求/一次扣费 / Packaged UI, native SQL and one hold/request/charge |
| 127-05 | 默认取消不授权，主动撤权不提交新模型请求 / Default decline grants nothing; withdrawal admits no new model request | 实际原生授权与撤权旅程，模型和对话框选择为测试数据 / Native grant/revocation journey with synthetic model/dialog choices |
| 127-06 | 撤权提示使用清楚的双语说明 / Explain stopped local work in both languages | 新包检查可读提示，不暴露内部错误码 / New package checks readable feedback without internal error codes |
| 127-07 | 双语说明、实拍截图/GIF、失败记录与分支同步 / Bilingual guides, actual captures, preserved failures and branch publication | 以本轮检查点及最终远端SHA回读为准 / Current checkpoint and final remote SHA readback |
| 127-08 | 六端双语安装说明统一到SQL001–132 / Align all six bilingual setup guides with SQL001–132 | 仅更新当前安装要求；既有迁移及历史验收原文不改写 / Current setup requirement only; migration files and original evidence remain unchanged |

控制层完整相关文件73项、真实固定Codex完整文件38项及实际未签名打包窗口5项的最终结果，以[检查点](../quality/local-startup-checkpoint-127.json)为准。打包旅程包含浏览器OTP/PKCE、工作区创建、启动续租、原费用、撤权及1000/1240/1440三个原生窗口宽度。界面使用自绘无边框窗口，无默认菜单、可见滚动条或横向溢出。提供方回答和原生对话框选择使用已授权测试数据。

The [checkpoint](../quality/local-startup-checkpoint-127.json) records final results for 73 complete related controller checks, 38 pinned-native checks and five actual unsigned packaged-window checks. The UI journey covers OTP/PKCE, onboarding, startup renewal, original billing, withdrawal and three native window widths. Model responses and native-dialog choices are synthetic. This is bounded qualification, not complete product acceptance.

原probe-01租约复现、probe-02的17项取消与追加清理回执、desktop-01的对话框测试错误均保留。desktop-02虽通过，但撤权实拍暴露内部错误码，因此更新界面后重建包。desktop-03通过前三项但窗口宽度等待超时，04复用校验值未变的03包，绑定页面所属窗口并记录OS及页面尺寸，不改写旧证据或声称已确定旧窗口状态。见[路径检查](../quality/local-startup-variant-review-127.md)。

The original lease reproduction, cancelled fixture/cleanup receipt and dialog-choice failure remain unchanged. UI02 passed but exposed an internal error code. The rebuilt UI03 passed its first three checks but timed out waiting for a window width. UI04 reuses unchanged package03, binds the page's own native window and records both OS/renderer sizes. The original window state and latency cause remain unproven; earlier evidence is not rewritten.

| 编号 / ID | 待完成 / Remaining | 验收要求 / Acceptance |
| --- | --- | --- |
| REQ-075 | Desktop自动启动恢复 / Automatic Desktop startup recovery | 先撤销并等待旧权限/请求退出，原子证明零准入，持久化有限次数与幂等恢复；不能凭零费用重试 / Revoke and drain old authority, atomically prove zero admission, persist bounded attempts and idempotency |
| REQ-075 | 完整本机工具、工作流和异常恢复组合 / Complete local-tool, workflow and recovery matrix | 不能将本轮主任务或控制层子任务证据替代所有组合 / Current main-task and controller-child evidence does not qualify all combinations |
| REQ-060 | 独立检出、签名安装与完整交付 / Fresh-checkout, signed installation and full delivery | 安装、升级、卸载及部署实测 / Actual installation, upgrade, removal and deployment checks |
| 原编号保留 / IDs retained | 至少十二个角色、完整营销设计/分析、Admin、Extension等整体验收 / At least twelve professional roles and complete business/client acceptance | [89条必需、12条未确认建议及1条可选项](../quality/remaining-work-stage127.md)仍开放，不等同102个完全未编码模块 / All 102 full-acceptance records remain open; they are not 102 wholly uncoded modules |

[方案 / Behavior](../technical/127-desktop-startup-lifecycle.md) · [证据归档 / Evidence](../quality/local-startup-evidence-127/index.json) · [源码分支 / Source](https://github.com/copypasteltd/workmate/tree/desktop)
