# 当前源码增量 / Current source increment · 166

用户任务与内容入口、真实作者归属、权限交集和导航恢复已完成。Creator-filtered user tasks/content and scoped navigation are implemented. 八项原生SQL/API和八组实际Admin页面检查通过；不变的其他端沿用冻结基线。

[本轮更新 / Changes](changes/166-admin-user-resources.md) · [当前源码逻辑 / Behavior](development/166-admin-user-resource-context.md) · [检查及媒体 / Evidence](quality/admin-user-resources-166.json) · [完整待办 / Ledger](quality/remaining-work-stage166.md)

下方 rc.5 下载为保留的冻结基线，不包含本次源码增量。The frozen rc.5 download below remains unchanged and excludes this source increment.

---

## v0.1.0-rc.5 · 已发布 / Published

[完整ZIP / Complete ZIP](https://github.com/copypasteltd/workmate/releases/download/v0.1.0-rc.5/workmate-v0.1.0-rc.5-complete.zip) · [SHA256](https://github.com/copypasteltd/workmate/releases/download/v0.1.0-rc.5/workmate-v0.1.0-rc.5-complete.zip.sha256) · [使用 / Guide](releases/v0.1.0-rc.5.md) · [发布回执 / Receipt](quality/release-publication-165.json)

全部端与源码统一冻结，六个线上资产摘要吻合。All clients and source are frozen; all six uploaded asset digests match. 外部假数据；Windows未签名。Synthetic dependencies; unsigned Windows.

---

# Workmate · 文档与交付 · v0.1.0-rc.5

[English](README.en.md) · [完整Release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0-rc.5) · [中英安装/使用](releases/v0.1.0-rc.5.md)

香港企业Codex Agent平台：Web与Chrome右侧栏使用云端执行；无边框Desktop在客户本机执行，完整本机权限由客户主动授予；Admin独立MFA管理用户、内容、费用和VIP。所有AI请求走公司内部OpenAI兼容网关。

当前发版纳入创建工作区丢响应恢复、Admin用户目标和目录筛选收口，交付所有端、Windows安装程序、六仓源码、固定Codex和实际截图/GIF/MP4。AI/媒体/广告/支付使用已授权假数据，Windows未签名。

## 从这里开始

1. 下载完整ZIP及校验文件，按[Release指南](releases/v0.1.0-rc.5.md)合并源码和runtime。
2. 第一次配置前选择空闲数据库端口，使用Delivery的预检、初始化、配置检查和demo入口；不用Docker/WSL。
3. Web邮箱登录→企业/项目→角色/输入/预算→执行→审阅下载。Admin单独开户和TOTP，不共享普通用户身份。
4. 所有原编号和完整验收范围见台账；本次收口不等于正式生产/跨系统及全部专业质量验收。

## 当前资料索引

| 文档 / Document | 路径 / Path |
|---|---|
|产品需求 / PRD|[product/01-prd.md](product/01-prd.md)|
|用户流程 / Journeys|[product/02-user-journeys.md](product/02-user-journeys.md)|
|角色与Skill / Presets|[product/06-role-templates-and-skill-presets.md](product/06-role-templates-and-skill-presets.md)|
|品牌设计 / Brand|[product/07-brand-design-system.md](product/07-brand-design-system.md)|
|管理后台 / Admin|[product/08-admin-dashboard.md](product/08-admin-dashboard.md)|
|架构技术 / Architecture|[technical/01-architecture-and-stack.md](technical/01-architecture-and-stack.md)|
|Codex与内部API / Runtime|[technical/02-runtime-and-ai-gateway.md](technical/02-runtime-and-ai-gateway.md)|
|本机/云端职责 / Client execution|[requirements/03-client-execution-amendment.md](requirements/03-client-execution-amendment.md)|
|本轮需求补充 / Current requirements|[requirements/27-admin-user-resource-context.md](requirements/27-admin-user-resource-context.md)|
|本轮开发 / Current implementation|[development/166-admin-user-resource-context.md](development/166-admin-user-resource-context.md)|
|本轮更新 / Changes|[changes/166-admin-user-resources.md](changes/166-admin-user-resources.md)|
|必要检查 / Focused checks|[quality/admin-user-resources-166.json](quality/admin-user-resources-166.json)|
|构建冻结 / Freeze checkpoint|[quality/release-freeze-checkpoint-165.json](quality/release-freeze-checkpoint-165.json)|
|全部原编号 / Original acceptance ledger|[quality/remaining-work-stage166.md](quality/remaining-work-stage166.md)|
|Git分支 / Git branches|[governance/04-git-branches-and-publication.md](governance/04-git-branches-and-publication.md)|
|工作区规范 / Workspace policy|[governance/03-workspace-and-path-policy.md](governance/03-workspace-and-path-policy.md)|

## 独立仓库 / Independent repositories

| Branch | Directory | Frozen tag |
|---|---|---|
|[backend](https://github.com/copypasteltd/workmate/tree/backend)|`dev/copypaste-platform`|`v0.1.0-rc.5-backend`|
|[web](https://github.com/copypasteltd/workmate/tree/web)|`dev/copypaste-web`|`v0.1.0-rc.5-web`|
|[admin](https://github.com/copypasteltd/workmate/tree/admin)|`dev/copypaste-admin`|`v0.1.0-rc.5-admin`|
|[desktop](https://github.com/copypasteltd/workmate/tree/desktop)|`dev/copypaste-desktop`|`v0.1.0-rc.5-desktop`|
|[extension](https://github.com/copypasteltd/workmate/tree/extension)|`dev/copypaste-extension`|`v0.1.0-rc.5-extension`|
|[delivery](https://github.com/copypasteltd/workmate/tree/delivery)|`dev/copypaste-delivery`|`v0.1.0-rc.5-delivery`|

主文档位于 `D:/dev/copypasted/自有agent/docs/`，实际代码位于 `dev/`。All development uses this workspace. Each component contains current Chinese/English READMEs, architecture diagrams and scoped actual media.

## 历史与验收 / History and acceptance

[rc.4](releases/v0.1.0-rc.4.md) · [rc.3](releases/v0.1.0-rc.3.md) · [历史README快照 / Archived handbooks](history/readme-before-rc5/docs-zh.md)

旧冻结包与标签不移动；旧报告、失败记录及执行工具保留原样。Previous frozen bytes/tags, reports, failures and executed tools remain unchanged. All102 original requirements and88 required whole-acceptance scopes are preserved;88 is not a count of missing modules.
