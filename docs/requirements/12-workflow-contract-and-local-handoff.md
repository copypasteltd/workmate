# 流程契约与跨端本机步骤 / Workflow contracts and local handoff

本补充落实原 REQ-032、REQ-041 及 UC11；保留原 SRS、CLIENT01、完整专业场景和生产验收。内核唯一为 Codex。Web、Extension 使用云端 Codex；Desktop 在客户本机执行 Codex。全部模型请求经公司服务器。

| 编号 | 必须满足的行为 |
|---|---|
| FC147-01 | WorkflowVersion 自带命名输入及输出定义。声明必填项、类型和交付步骤；验证后才能准备运行。 |
| FC147-02 | 每次运行保存自己的业务值、固定文件版本及摘要；零、false、小数和未提供值有明确区别。 |
| FC147-03 | 客户核对输入、步骤及独立子步骤费用。模型不能批准运行、修改固定值或取得新权限。 |
| FC147-04 | 云端和本机子步骤读取同一份固定输入；不得静默改用文件最新版。命名文本交付来自完整保存的文件，不能用缩短预览冒充。 |
| FC147-05 | 定时及事件重复运行沿用已批准的输入；事件数据属于不可信业务数据，不覆盖方法、输入、权限及预算。 |
| FC147-06 | 云端任务等待文件时，客户能建立持久本机准备请求；设备离线不丢请求，建立请求不调用模型或授予 OS 权限。 |
| FC147-07 | Desktop 绑定原任务、具体文件检查点、角色、预算、设备、原生登录族、本机会话及工作目录。真实本机 Codex 只能在客户授权后启动。 |
| FC147-08 | 本机权限和费用分别确认。重复接单及响应丢失保留唯一执行身份；未知结果或费用不自动重放、不伪报免费完成。 |
| FC147-09 | 客户审阅并主动选择上传文件，再确认固定版本。服务端完整核查后，原任务沿用原会话、预算及既有线程继续。 |
| FC147-10 | 撤权、原输入变更、取消、来源撤回及保留期结束阻断后续读取、执行和交回；保留真实已发生费用及审计事实。 |
| FC147-11 | 三端可见原任务和本机请求状态。Desktop 保持无边框、隐藏 Electron 菜单及滚动轨道、无横向溢出；Extension 保持原生右侧 Side Panel。 |

The bounded input types are text, number, boolean and exact file version. Named outputs are complete saved text or fixed file lists from producing steps. These contracts do not grant new tools, OS access, external writes or fees. A durable local request is followed by actual customer-local Codex execution and an explicit file return to the original cloud task. Original requirements and full acceptance remain authoritative.

实现语法、状态、接口及边界见 [技术说明](../technical/147-workflow-contract-and-local-handoff.md)。核查结果及实际媒体以阶段147交付记录为准，不以本文声明代替证据。
