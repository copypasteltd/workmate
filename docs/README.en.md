# 当前源码增量 / Current source increment · 172

已补齐按费用实际入账期间报表、香港日期投影及同选择明细／CSV。Posting-period reports, daily entry projection and same-selection detail/CSV are implemented.

[更新 / Changes](changes/172-admin-posting-period.md) · [方案 / Behavior](development/172-admin-posting-period.md) · [证据 / Evidence](quality/admin-posting-period-172.json) · [原编号台账 / Original ledger](quality/remaining-work-stage172.md)

此为v0.1.1之后的源码增量，不在下方冻结ZIP中；原包与标签保持不变。This increment is outside the frozen v0.1.1 bundle below; published archives and tags remain unchanged.

---

## v0.1.1 · 已发布 / Published

[完整ZIP / Complete ZIP](https://github.com/copypasteltd/workmate/releases/download/v0.1.1/workmate-v0.1.1-complete.zip) · [SHA256](https://github.com/copypasteltd/workmate/releases/download/v0.1.1/workmate-v0.1.1-complete.zip.sha256) · [交付入口 / Handoff](releases/v0.1.1-handoff.md) · [使用 / Guide](releases/v0.1.1.md) · [发布回执 / Receipt](quality/release-publication-170.json)

全部端与源码统一冻结，六个线上资产摘要吻合。All clients and source are frozen; all six uploaded asset digests match. 外部假数据；Windows未签名。Synthetic dependencies; unsigned Windows.

---

# 当前冻结交付 / Current frozen delivery · v0.1.1

最新完整包纳入用户运营筛选和消耗报表。Latest complete bundle includes operational filters and consumption reports.

[发行下载 / Download](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装 / Setup](releases/v0.1.1.md)

假数据模式；Windows未签名；数据库156。Authorized synthetic services; unsigned Windows; schema156.

---

# 已纳入 v0.1.1 的源码增量 / Included source increment · 169

用戶消耗固定報表已完成；Scoped consumption reports implemented.

[Git发布回执 / Publication](quality/admin-usage-report-publication-169.json) · [本轮更新 / Changes](changes/169-admin-usage-reports.md) · [方案 / Behavior](development/169-admin-usage-reports.md) · [证据 / Evidence](quality/admin-usage-report-169.json) · [完整台账 / Ledger](quality/remaining-work-stage169.md)

阶段169已纳入当前v0.1.1完整冻结包；旧v0.1.0包保持不变。Stage169 is included in the published v0.1.1 complete bundle; existing v0.1.0 is preserved.

---

# 已纳入 v0.1.1 的源码增量 / Included source increment · 168

用户运营组合筛选与真实账户访问记录已收口；精确费用、独立账户和当前权限约束不变。Scoped operational filters and truthful access metadata are implemented. Backend/Admin builds,8 native SQL/API cases and6 actual Admin UI checks passed.

[Git发布回执 / Publication](quality/admin-directory-filters-publication-168.json) · [本轮更新 / Changes](changes/168-admin-directory-operational-filters.md) · [方案 / Behavior](development/168-admin-directory-operational-filters.md) · [检查与媒体 / Evidence](quality/admin-directory-filters-168.json) · [完整待办 / Ledger](quality/remaining-work-stage168.md)

阶段168已纳入当前v0.1.1完整冻结包，未写入旧v0.1.0包；数据库156需使用本版配套服务。Stage168 is included in v0.1.1, while the old v0.1.0 bundle remains unchanged; schema156 requires matching services.

---

## v0.1.0 · 已发布 / Published

[完整ZIP / Complete ZIP](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip) · [SHA256](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip.sha256) · [使用 / Guide](releases/v0.1.0.md) · [发布回执 / Receipt](quality/release-publication-167.json)

全部端与源码统一冻结，六个线上资产摘要吻合。All clients and source are frozen; all six uploaded asset digests match. 外部假数据；Windows未签名。Synthetic dependencies; unsigned Windows.

---

# Workmate · v0.1.0 · 冻结交付 / Frozen delivery

[中文使用 / Bilingual guide](releases/v0.1.0.md) · [完整Release / Release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [完整ZIP / Complete ZIP](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip) · [SHA256](https://github.com/copypasteltd/workmate/releases/download/v0.1.0/workmate-v0.1.0-complete.zip.sha256)

统一冻结所有端、后端及六仓可构建源码，纳入最新后台用户任务/内容入口。Web/Chrome右侧栏使用云端Codex；无边框Desktop在客户本机运行Codex，客户主动授予完整本机权限。Admin独立MFA管理用户、费用、VIP和内容。AI/媒体/广告/支付使用已授权假数据，Windows未签名。

All clients, backend and six buildable source trees are frozen together, including creator-filtered Admin tasks/content. Web/Side Panel execute cloud Codex; frameless Desktop executes locally with explicitly granted full permission. Admin has independent MFA. Authorized synthetic services; unsigned Windows.

## 使用与资料 / Usage and references

1. 下载完整ZIP及校验文件，按指南合并源码和runtime。
2. 第一次写配置前选空闲数据库端口；Delivery依次执行`demo:preflight`、`bootstrap:demo`、`demo:check`和`demo`，结束运行`npm run stop`。不用Docker/WSL。
3. Web邮箱登录→企业/项目→角色/输入/预算→执行→审阅下载。Admin单独开户和TOTP；普通用户不获得后台权限。

|文档 / Document|入口 / Link|
|---|---|
|产品 / Product|[PRD](product/01-prd.md) · [用户流程](product/02-user-journeys.md)|
|角色与Skill / Presets|[角色模板](product/06-role-templates-and-skill-presets.md)|
|品牌 / Brand|[设计系统](product/07-brand-design-system.md)|
|管理后台 / Admin|[管理设计](product/08-admin-dashboard.md) · [用户任务/内容](requirements/27-admin-user-resource-context.md)|
|技术 / Architecture|[架构](technical/01-architecture-and-stack.md) · [内核/API](technical/02-runtime-and-ai-gateway.md) · [本机/云端职责](requirements/03-client-execution-amendment.md)|
|当前冻结 / Freeze|[实现说明](development/167-final-release-freeze.md) · [本轮编号更新](changes/167-final-release-freeze.md)|
|必要检查 / Focused evidence|[冻结检查点](quality/release-freeze-checkpoint-167.json) · [166原始功能检查](quality/admin-user-resources-166.json)|
|原编号待办 / Acceptance ledger|[102项完整台账](quality/remaining-work-stage167.md)|
|路径与Git / Workspace|[路径规范](governance/03-workspace-and-path-policy.md) · [分支发布](governance/04-git-branches-and-publication.md)|

## 独立仓库 / Independent repositories

|Branch|Directory|Frozen tag|
|---|---|---|
|[backend](https://github.com/copypasteltd/workmate/tree/backend)|`dev/copypaste-platform`|`v0.1.0-backend`|
|[web](https://github.com/copypasteltd/workmate/tree/web)|`dev/copypaste-web`|`v0.1.0-web`|
|[admin](https://github.com/copypasteltd/workmate/tree/admin)|`dev/copypaste-admin`|`v0.1.0-admin`|
|[desktop](https://github.com/copypasteltd/workmate/tree/desktop)|`dev/copypaste-desktop`|`v0.1.0-desktop`|
|[extension](https://github.com/copypasteltd/workmate/tree/extension)|`dev/copypaste-extension`|`v0.1.0-extension`|
|[delivery](https://github.com/copypasteltd/workmate/tree/delivery)|`dev/copypaste-delivery`|`v0.1.0-delivery`|

全部开发根目录为`D:/dev/copypasted/自有agent/`，代码/配套开发脚本在`dev/`，主文档在`docs/`；各仓自带中英README、逻辑图和真实截图/GIF/MP4。源码包不含依赖、秘密、数据库或Git元数据；完整历史在上述分支。

Six fresh builds; byte-identical qualified Windows binaries are verified and reused. Recent source-identical focused checks are inherited, not rerun. Full historical regression is omitted. Frozen tags/bytes remain immutable; later work uses new commits/releases.

## 后续与历史 / Open work and history

正式外部服务、签名安装更新、其他OS、专业质量及用户目录扩展组合筛选仍在原编号台账。保留102原编号与88项必选完整验收范围；88不是未实现模块数。本版交付齐全不表示全部专业/生产验收通过。

Production providers, signing/update, other OSes, advanced directory filters and full professional acceptance remain tracked without changing original requirement scope.

[保留rc.5 / Preserved rc.5](releases/v0.1.0-rc.5.md) · [rc.5发布回执](quality/release-publication-165.json) · [166源码发布回执](quality/admin-user-resources-publication-166.json)
