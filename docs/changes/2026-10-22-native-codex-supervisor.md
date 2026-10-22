# 2026-10-22 Desktop 本机 Codex 内核增量

按 CLIENT01 新增独立 `LocalCodexSession`，使用锁定 Windows 原生 Codex app-server，在本机执行终端、文件和 Skill，支持流事件、线程继续、权限切换、中断及关闭。完整权限实际使用 danger-full-access / never；公司推理凭证从终端环境移除，检查点绑定账号、项目与版本，拒绝未知回合重放及旧授权恢复。

真实 Codex 配合模拟公司网关完成本机集成测试，最新报告和原始失败均见 [检查点](../quality/local-codex-supervisor-checkpoint.json)。曾发现并修复 Skill 目录注册、空线程 resume 和跨账号拒绝前覆盖 Skill 的问题。

当前是内核库增量：Electron 主流程、客户完整权限界面、费用凭证服务、Codex 随包交付和 Extension 对话附件改版尚未接入。现有录屏仍展示云端/文件桥接基线，不作为新本机页面验收。完整实现边界及后续工作见 [技术说明](../technical/70-desktop-native-codex-supervisor.md)。
