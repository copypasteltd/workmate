# 实际云端页面检查与软件 Skill 版本


## 阶段 101 实际云端页面检查 / Stage 101 actual cloud browser checks

云端 Codex 新增实际 Chromium 页面交互、DOM 断言、原始截图及确切源码交付。固定原生运行时，在 Windows Job 内核对实际 renderer token，超时、取消及控制器异常退出后回收所属进程。页面使用独立来源 sandbox iframe、任务内资源和离线请求策略；不宣称 Chrome broker 具有操作系统级无网络权限。截图接口重新校验私有任务、来源与文件版本。新增四份 Skill 1.1.0 和六个软件角色 1.1.0，保留旧版本及权限边界。113 项相关测试和 4 项实际登录 Web 流程使用假模型与额度；Desktop 继续在客户本机运行 Codex，独立构建及打包。

Cloud Codex performs actual page interactions, assertions and PNG capture against exact task source. Native Jobs and measured renderer restrictions accompany cancellation/orphan cleanup. Private screenshot reads recheck task/source/version access. Four new Skill packages and six role versions preserve historical bindings and permissions. The 113 related checks and four Web checks use synthetic model responses and credit. Desktop remains customer-local and is built and packaged independently.

[Design / 设计](../technical/101-cloud-browser-preview.md) · [Evidence / 证据](../quality/cloud-browser-checkpoint.json). Static browser, API and SQLite checks remain independent; combined deployed applications, arbitrary packages, live role quality and full product acceptance require separate evidence. Original requirement and gate decisions remain unchanged.
