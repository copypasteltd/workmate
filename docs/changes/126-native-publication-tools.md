# 阶段126：原生发布工具修复 / Native publishing tool fixes

## 本轮已实现 / Implemented

| 编号 | 实现 | 当前验证 |
| --- | --- | --- |
| 126-01 | 修复新版社交角色被误报工具未实现、无法创建。 | 原生专项05实际通过角色创建入口。 |
| 126-02 | 修复发布预览来源版本ID错误；保留数据库身份约束。 | 原生专项05核对实际版本ID和SHA-256。 |
| 126-03 | 模拟模型经真实云端Codex执行账户→预览→准备→状态，保留客户明确确认。 | 当前源码专项09为5/5，完整相关回归10为155/155，不覆盖旧失败。 |
| 126-04 | 补充脱敏错误码诊断并保留此前失败和源代码快照。 | 检查04定位实际23514；未将失败改标为通过。 |
| 126-05 | 完成阶段125八分支推送与远端SHA核对。 | 原始回执：quality/publication-stage125-remote-receipt-01.json。 |
| 126-06 | 分析原生测试增加阶段与耗时诊断，并在测试截止时中止所属Codex。 | 独立复查07为12/12；保留原180秒截止，不宣称偶发超时已修复。 |
| 126-07 | 将零模型请求且未提交轮次的云端启动恢复扩展到线程创建与恢复；共享两次上限。 | red01复现旧缺口；green03的9项真实原生故障检查通过，包含真实60秒超时、拒绝、取消和清理边界。 |
| 126-08 | 修正故障注入辅助器的进程创建时间校验，使用捕获的实际spawn时间。 | green02原失败7/8保留；单独原生检查验证错时间拒绝、正确时间允许、取消后退出。 |
| 126-09 | 扩充原worker attempt、原预算预留与一次结算的真实原生回归，并保留全部历史回执。 | 完整16文件回归10为155/155，源码未变，所属原生数据库和夹具清理通过；full08的132通过／1失败保留。 |
| 126-10 | 发布器并行读取七个独立仓库，最终复查合并重复的main/docs目录；对象导入和远端写入仍顺序执行。 | 语法核查及最终发布执行器回执；八个远端分支仍逐一核对确切SHA。 |

## 待完成 / Remaining

| 编号 | 待完成 |
| --- | --- |
| NEXT-126-01 | 六个组件独立检出后的完整复现与最终可安装交付；本轮八分支源码同步以发布执行器最终回执及远端SHA为准。 |
| NEXT-126-02 | Desktop本机启动故障恢复与四发布工具组合；其他角色／团队／计划／恢复的完整Skill组合及底层偶发原生延迟根因。 |
| NEXT-126-03 | 原生视频播放／拖动、签名安装更新及完整本机工具覆盖。 |
| NEXT-126-04 | 至少12个完整专业角色、完整Admin治理和其余必需功能闭环。 |
| NEXT-126-05 | 正式服务联调与生产验收；继续按已授权假数据完成开发。 |

本轮暂不关闭原始完整需求：89条必需项、12条未确认扩展建议、1条可选项仍分别统计。

English: fixes template admission and immutable publication provenance, adds real cloud-Codex four-tool execution with simulated model/accounts, and extends bounded startup recovery before turn admission. Native fault03 passes9/9 with actual timeout, cancellation and ownership boundaries; current native09 passes5/5 and complete sixteen-file related10 passes155/155. Original failures, interrupted06 and failed08 remain preserved. Source publication requires its final SHA receipt. Stage125 is already pushed and SHA-verified across eight branches. Desktop-local recovery/tools, remaining roles/native media/Admin work and production qualification remain open.
