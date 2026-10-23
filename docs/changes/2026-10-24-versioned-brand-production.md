# 固定品牌生产增量 / Versioned brand production

Stage79 修复原品牌仅可变正文、历史任务不能可靠读取旧版、字体/促销生产约束缺失的问题。新增 SQL096、真实 font cmap 检查、固定版本事实渲染、受来源治理的 Logo/字体依赖及 Web/本机 Desktop 品牌表单。并发发布、重放、跨范围拒绝、缺字/过期、删除传播和真实云端工具任务已验证。Desktop 保留无边框、无可见滚动条及真实进度，滚轮/键盘和紧凑窗口继续可用。

Current code qualification: 874 platform cases, all prior 861 preserved and 13 new; 68 client unit cases; 30 packaged Desktop checks; four brand Web, four Web/Admin and eight native Side Panel checks. Native supervisor proof retains 17 cases and 57 unchanged bound sources. Real auth/database/files/ledger/local Codex use explicit synthetic model/customer/business content. Original 102 requirements/cases remain 82 partially verified, 20 unproven, zero fully accepted; no G01–G10 gate is closed.

升级：先在配置后端应用 SQL096。SQL001–095 与原 OpenAPI 的各自字节保留，新品牌契约为增量。字体使用资料是客户声明；其他设计格式、完整历史分页、全本机角色品牌生产、语义事实识别、真实客户验收和生产资格仍需独立证据。

[方案 / Design](../technical/79-versioned-brand-production.md) · [精确源码及真实媒体 / Evidence](../quality/brand-production-checkpoint.json) · [增量契约 / Contract](../contracts/brand-production-openapi.json) · [需求进度 / Requirements](../quality/requirements-alignment-progress.json)
