<!-- scope-erasure-150 -->

**未冻结增量150：项目/企业永久清理闭环**

owner/admin从「项目」预览永久删除，输入完整名称并确认不可恢复及保留范围；整企业仅owner可删。后台内容管理要求对应范围删除权限与近期MFA。/cleanup为独立账户页面，最后企业删除后仍可查看。立即阻止新工作与原文访问；本机/云端执行按公司实际用量收尾，未知费用保留核对。Desktop仍本机运行Codex；Extension仍为云端Agent与原生右侧栏。

11项当前后端检查、6组真实三端流程、初次8步构建及3步定向重构建通过。明确省略一项耗时旧备份重复检查，保留其先前单项通过及所有失败原件；未扩跑广泛回归或真实付费模型。必要帐务/审计、共用身份、其他范围引用与客户本机副本适用明确保留规则。完整导出、全部衍生/生产恢复验收、真实供应方/广告账号和签名仍待完成。首个冻结v0.1.0-rc.1标签及五个ZIP保持原样。

```mermaid
flowchart LR
 A[Current owner or scoped admin] --> B[Preview and exact-name confirmation]
 B --> C[Permanent scope fence]
 C --> D[Cancel new work and close inflight execution]
 D --> E[21 resource roots and derived cleanup]
 E --> F[Safe progress and retained financial facts]
 C --> G[Erasure ledger]
 G --> H[Replay before restoring old backup objects]
```

Actual component journey.

![Actual screen](assets/screenshots/workmate-scope-erasure-150-04-permanent-delete-confirmation-en.png.png)

![Actual interaction](assets/screenshots/workmate-scope-erasure-150-04-scope-cleanup.gif)

[Actual MP4](assets/screenshots/workmate-scope-erasure-150-04-scope-cleanup.mp4)

---

<!-- project-lifecycle-149 -->

**当前开发增量149：首个冻结版 `v0.1.0-rc.1` 后的项目管理修复**

企业 owner/admin 从「项目」筛选使用中/已封存/全部、搜索分页、编辑名称简介，并明确确认归档/恢复。归档最后一个项目后管理页仍可访问，可恢复原项目身份、资料与现有成员权限；已撤销授权不复建。普通成员仅见获准的活动项目。归档控制封存期间可用性，需要结束的任务请先明确取消。

后端在权限锁等待后重新鉴权，支持预期状态冲突与幂等重试；重放返回当前状态，避免恢复后再次封存。两端阻止旧列表覆盖新状态，恢复选中仅采用最新活动项目列表。Desktop仍在客户本机运行Codex并支持客户主动授予完整权限；Extension仍采用原生右侧栏及云端Agent，负责获准文件读取上传。

10项当前后端检查、5组真实界面旅程和6步构建通过，保留4张截图、2组真实GIF/MP4，资源均已关闭。未发起模型请求，按快速冻结要求省略广泛历史回归；原始失败验证及后继修正版均保留。聚合整删、生产联调及完整验收继续开放。原7个冻结标签和5个发行ZIP保持原样，149属于未冻结后续代码。

```mermaid
flowchart LR
  A[Owner / administrator] --> B[Managed project directory]
  B --> C[Edit / archive / restore]
  C --> D[Current authority and exact-state check]
  D --> E[Existing project identity and materials]
  C --> F[Latest active list]
  F --> G[Web / local Desktop selection]
```

本组件当前真实界面旅程。

![Project restored](assets/screenshots/workmate-project-lifecycle-149-01-same-project-restored-en.png)

![Actual archive and restore](assets/screenshots/workmate-project-lifecycle-149-01-project-archive-restore.gif)

[Actual MP4](assets/screenshots/workmate-project-lifecycle-149-01-project-archive-restore.mp4)

当前未签名候选程序：`release/project-lifecycle-149-01/win-unpacked/CopyPaste.exe`，与首个冻结便携ZIP分开保留。

---

<!-- frozen-release-148 -->

**固定运行时准备 / Pinned runtime preparation**：`runtime:prepare` 不下载或查找 PATH。先解压本版 Windows 便携 ZIP，在 PowerShell 设置 `$env:COPYPASTE_LOCAL_CODEX_BIN` 为解压目录中的 `resources/local-codex/codex.exe` 绝对路径（保留旁边全部 helper 文件），再在 desktop 执行 `npm run runtime:prepare`。源码单独交付时，需自行提供与 `contracts/local-codex-runtime.json` 相符的同一组原生文件。首次启动会自动执行原生 PostgreSQL 迁移到145，无需容器。

`runtime:prepare` neither downloads nor searches PATH. Extract this release's Windows directory ZIP, set PowerShell `$env:COPYPASTE_LOCAL_CODEX_BIN` to its absolute `resources/local-codex/codex.exe` path, keep all sibling helpers, and run desktop `npm run runtime:prepare`. A source-only install must supply the exact locked native files. Native database startup applies schema145 automatically.

运行后访问 Web `http://localhost:4317`、Admin `http://localhost:4318`。本机开发验证码保存在 platform `.data/mailbox/`，不是公共邮件服务。另开终端在 platform 执行 `npm run admin:create -- admin@example.com super_admin`，按 `.data/enrolment/` 的一次性资料绑定认证器后删除该私密资料；不提供共享默认密码。Windows 包连接同一后端后使用浏览器登录。

Open Web at localhost4317 and Admin at localhost4318. Development OTP messages are in platform `.data/mailbox/`. In another terminal run platform `npm run admin:create -- admin@example.com super_admin`, enroll its one-time authenticator material, then delete that private enrollment file. No shared administrator password is provided.

**首个冻结候选版本 / First frozen candidate: `v0.1.0-rc.1`**

本版用于 Windows x64 本地试用，AI 提供方使用已获准的模拟数据。产品版本与各组件 package.json 版本独立。Web / Extension 在云端运行 Codex；Desktop 在客户本机运行固定版本 Codex，可由客户主动授予完整本机权限。Extension 保留 Chrome 原生右侧 Side Panel，负责获准文件读取与上传。管理后台保留独立管理员登录、用户/企业控制、费用/VIP/用量及内容权限。

This release candidate provides a Windows x64 local trial with explicitly synthetic AI providers. Product and component versions are independent. Web and Extension use cloud Codex; Desktop runs pinned Codex locally with customer-controlled full OS permission. Extension uses Chrome's native right Side Panel for conversation and consented file upload. Admin provides separate administrator authentication, account controls, billing/VIP/usage and content permissions.

```mermaid
flowchart LR
  W[Web / Chrome Side Panel] --> A[Company API / identity / billing]
  A --> C[Cloud Codex / role skills]
  D[Frameless Desktop] --> L[Customer-local Codex]
  L --> A
  A --> P[Company OpenAI-compatible gateway]
  M[Admin dashboard] --> A
```

**首次启动 / First source startup**：六组件按 `copypaste-platform`、`copypaste-web`、`copypaste-admin`、`copypaste-desktop`、`copypaste-extension`、`copypaste-delivery` 放在同一父目录。要求 Windows x64、Node.js ≥22.14、Git、原生 .NET 构建工具；禁止 Docker/WSL。进入 delivery 执行 `npm run bootstrap`，在 desktop 执行 `npm run runtime:prepare`，回到 delivery 执行 `node scripts/start-frozen-demo-148.mjs`。该入口校验 Codex 版本及 SHA-256，避免使用系统 PATH 中的其他版本；停止用 `npm run stop`。管理员首次开户按 platform 已有 enrollment 命令创建独立管理员，勿使用客户登录代替。

Place all six named repositories under one parent. Run delivery `npm run bootstrap`, desktop `npm run runtime:prepare`, then delivery `node scripts/start-frozen-demo-148.mjs`. This entry verifies the pinned Codex binary instead of selecting an arbitrary PATH version. Stop with delivery `npm run stop`. Enroll an independent administrator using the platform's documented enrollment command.

**使用流程 / Journey**：浏览器打开 Web → 邮箱验证码 → 进入企业/项目 → 选择预设角色 → 提交任务并审核所需权限 → 查看结果、费用、下载。Desktop 配置同一后端，使用浏览器授权登录，再选择本机目录和权限。Chrome 在开发者模式加载 extension 的 `dist/`，点击扩展打开右侧面板、登录并主动选择上传文件。营销分析支持原始 CSV/XLSX 上传、明确数字/日期口径、字段映射、精确预览、确认和持久化分析快照；改变格式会撤销旧确认。

Open Web, verify email, select workspace/project and a role preset, review permissions, run a task and inspect results/usage/downloads. Desktop signs in through browser authorization and then selects local scope. Load Extension `dist/` unpacked in Chrome, click its action to open the native side panel, sign in and explicitly attach files. Marketing imports retain original bytes, require explicit conventions and mapping, preview exact facts and create a durable analysis snapshot; changing conventions clears confirmation.

**冻结依据 / Qualification**：当前后端 17 项必要检查通过；Web、Admin、Extension、Desktop 构建完成，Windows 未签名目录包已在真实窗口验证。当前 UI 冒烟覆盖 Web OTP、Desktop 原生 PKCE 和两端原文件→精确预览→分析快照，共 4 组旅程；保留 4 张实际截图、2 组实际 GIF/MP4。阶段147的真实本地/云端 Codex 与 Chrome 原生侧栏为历史证据，本轮未重复完整回归，也没有把模拟 AI 回复称作真实模型验收。

Seventeen focused backend checks passed. All client builds completed; the unsigned Windows directory package was exercised in a real window. Four current smoke groups cover Web OTP, native Desktop PKCE and actual original-file imports through durable snapshots, with four screenshots and two GIF/MP4 pairs. Stage147 local/cloud Codex and native Chrome Side Panel evidence stays historical. Broad regression was deliberately omitted at the user's request; synthetic model replies are not production model acceptance.

**边界 / Boundaries**：这是首个候选冻结版。生产内部 API/真实媒体和 Google/Meta 等账户联调、签名安装及更新、完整权限/故障/并发矩阵和全量验收仍待完成。项目/企业聚合整删尚未实现；归档项目的恢复权限路径需要修复，不能视为已支持。UTF-16 CSV 上传需 BOM；其他编码转换为 UTF-8。原有102项需求逐条记录保留，88项必需完整验收范围仍开放，并非88个模块完全未实现。

Production provider/account integration, signed installers/updates and comprehensive permission/failure/concurrency acceptance remain open. Aggregate project/tenant erasure is unimplemented; archived-project restoration still needs its access-path fix. UTF-16 CSV uploads require a BOM. All102 original requirement records remain, including88 open required full-acceptance scopes; this does not mean88 entirely missing modules.

冻结标签 / Frozen tags: `v0.1.0-rc.1` (docs), `v0.1.0-rc.1-backend`, `-web`, `-admin`, `-desktop`, `-extension`, `-delivery` (full tag prefix for each component). Each tag identifies a complete independent Git history; compact release source archives omit historical evidence/media, which remain available in Git.

实际 Desktop 窗口 / Actual Desktop window

![Exact imported facts](assets/screenshots/workmate-marketing-release-148-04-parsed-exact-campaign-en.png)

![Actual interaction](assets/screenshots/workmate-marketing-release-148-04-reviewed-marketing-import.gif)

[Actual MP4](assets/screenshots/workmate-marketing-release-148-04-reviewed-marketing-import.mp4) · [Saved analysis](assets/screenshots/workmate-marketing-release-148-04-durable-analysis-snapshot-en.png)

---

<!-- business-history-stage144 -->

<!-- workflow-handoff-stage145 -->
## 阶段145：完整成果交接与失败确认

可信本机顺序器增加输入／失败确认约束；保持本机Codex和原OS授权。

客户由流程顾问准备版本，核对输入、预算和失败策略，明确确认后执行；完成后下载原文件。已结算失败可按预设等待客户确认略过，整体失败与原费用保留，不自动重试。

39项后端＋12项可信本机控制、7项实际Web流程通过。模型响应为明确假数据；生产接入及完整本机Codex／OS验收仍开放。默认Desktop测试保留历史文件并选择当前修订。

```mermaid
flowchart LR
  A[Prepare frozen version] --> B[Customer review]
  B --> C[Local or cloud specialist]
  C --> D[Exact saved outputs]
  D --> E[Next specialist]
  C --> F[Known failure review]
  F --> G[Skip independent work; retain failure]
```

[完整方案与使用边界](https://github.com/copypasteltd/workmate/blob/docs/docs/development/145-workflow-handoffs-and-failure-review.md) · [102项原编号清单](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage145.md)

以下为真实Web客户流程的共享发布截图／录制，不冒充本端专有界面。

![Actual Web workflow](assets/screenshots/workmate-workflow-handoff-145-03-complete-deliverables-en.png)

![Actual workflow interaction](assets/screenshots/workmate-workflow-handoff-145-03-exact-workflow-handoff.gif)

[MP4](assets/screenshots/workmate-workflow-handoff-145-03-exact-workflow-handoff.mp4)

## 后台业务版本闭环

阶段144补齐品牌、团队、简报、计划及全部设计工程的后台已保存历史，普通画布记录不可变版本，新品牌版本记录真实客户操作者。当前52项相关后端及9项实际Admin浏览器旅程通过。下图和录屏为本轮实际后台界面。

```mermaid
flowchart LR
 A[Customer saves] --> B[Immutable saved versions]
 B --> C[Scoped administrator reader]
 C --> D[Bounded navigation]
 E[Authority or source withdrawal] --> F[Clear private body]
```

![Actual administrator brand history](assets/screenshots/workmate-business-history-144-01-brand-latest-en.png)

![Actual version navigation recording](assets/screenshots/workmate-business-history-144-01-business-version-navigation.gif)

[MP4](assets/screenshots/workmate-business-history-144-01-business-version-navigation.mp4) · [详细方案 / Usage and implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/144-admin-business-content-history.md)

使用「用户端内容 → 阅读内容 → 最新／最早／前后翻页」，展开记录可查看确切定义。阅读要求当前正文权限及项目范围，依赖撤回会隐藏正文；未保存过的旧内容不补造。Desktop继续在客户本机执行Codex，Extension保留原生浏览器右侧栏。原完整产品验收继续开放。

<!-- editable-projects-stage143 -->

新增矢量设计／演示文稿的持续编辑工程：从专员固定来源建立、逐页和逐层修改、保存历史版本、真实预览与SVG/PNG/PDF/PPTX交付、完整工程包跨项目恢复、品牌逐项核对与图表原值独立确认。同时补齐预览与保存排队、后台删除历史及实际衍生文件。

42项相关检查及真实三端旅程通过。使用假业务／模型数据，实际原生登录、存储和文件渲染；Windows包未签名。全部专业格式、Office与跨机器整项验收仍开放。 [方案与使用 / Design and usage](https://github.com/copypasteltd/workmate/blob/docs/docs/development/143-editable-project-workspaces.md).

```mermaid
flowchart LR
 A[Fixed editable source or ZIP] --> B[Project and brand/data review]
 B --> C[Edit layers pages and notes]
 C --> D[Save immutable version]
 D --> E[SVG PNG PDF PPTX]
 E --> F[Complete portable ZIP]
 F --> B
```

![Actual desktop editable-project workflow](assets/screenshots/workmate-editable-projects-143-04-chart-and-brand-reviewed-en.png)

![Actual desktop editable-project workflow](assets/screenshots/workmate-editable-projects-143-04-restored-edited-rendered-en.png)

[Actual interaction recording](assets/screenshots/workmate-editable-projects-143-04-project-restore.mp4)

![Recorded interaction](assets/screenshots/workmate-editable-projects-143-04-project-restore.gif)

<!-- brand-reuse-stage142 -->

品牌工程可在新项目选择目的品牌固定版本，逐项映射字体、价格／促销事实、Logo和可选配色，核对实际差异并确认后恢复新副本。Web/Desktop继续编辑、输出PNG/PDF/SVG并再次打包；扩展在原生右侧栏完成上传、核对与恢复。修复文字矢量化导致品牌／矢量／演示稿源图片丢失的问题，保留图像和形状层叠顺序。

62项相关检查、真实三端旅程、5张截图和3组GIF／MP4已通过并绑定源码。假数据，无模型调用；Windows包未签名。全部格式恢复、跨机器和正式服务验收仍开放。 [方案 / Guide](https://github.com/copypasteltd/workmate/blob/docs/docs/development/142-brand-project-reuse.md).

```mermaid
flowchart LR
 A[Fixed source ZIP] --> B[Destination brand maps]
 B --> C[Review and approve]
 C --> D[New shared copy]
 D --> E[Edit / render / export again]
```

![Actual brand workflow](assets/screenshots/workmate-creative-brand-142-02-brand-mapping-reviewed-en.png)

![Actual brand workflow](assets/screenshots/workmate-creative-brand-142-02-restored-brand-rendered-en.png)

[Actual interaction MP4](assets/screenshots/workmate-creative-brand-142-02-project-restore.mp4)

![Actual interaction GIF](assets/screenshots/workmate-creative-brand-142-02-project-restore.gif)

# Workmate · CopyPaste Enterprise Agent · desktop

<!-- creative-packages-stage140 -->
## 工程打包与恢复 · 阶段140

无边框Desktop内已接上相同恢复流程：完整影片素材与字型恢复后，修改脚本并重新渲染MP4，也可通过本机保存窗口下载工程ZIP。本机Codex执行与客户授权沿用既有本机流程。

导出和恢复不请求AI。上传前先明确确认项目共用，恢复前再确认素材权利；原工程不覆写，中断后核对原请求。当前支持普通分层画布和campaign-cuts影片；画布系统字型差异、品牌重绑、全部格式及跨机器恢复仍待完整验收。

```mermaid
flowchart LR
 A[Fixed canvas or video version] --> B[Source JSON and exact media ZIP]
 B --> C[Explicit project sharing and verified upload]
 C --> D[Review manifest and rights]
 D --> E[Restore new project and media IDs]
 E --> F[Edit layers or timeline]
 F --> G[Render PNG or MP4 and export again]
 D --> H[Lost response: check original receipt]
 H --> E
```

- [Format, APIs & usage / 格式、接口及使用](https://github.com/copypasteltd/workmate/blob/docs/docs/development/140-creative-project-packages.md)
- [Actual qualification / 实际验证](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/creative-packages-checkpoint-140.json)
- [Open acceptance scopes / 未完成验收](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage140.md)

![Actual desktop project restoration · synthetic campaign content](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-creative-packages-140-07-verified-restore-review-en.png)

![Actual desktop project restoration · synthetic campaign content](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-creative-packages-140-07-restored-video-rerendered-en.png)

- [Actual web interaction .MP4](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-creative-packages-140-07-project-restore.mp4)
- [Actual web interaction .GIF](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-creative-packages-140-07-project-restore.gif)
- [Actual desktop interaction .MP4](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-creative-packages-140-07-project-restore.mp4)
![Actual desktop project restoration interaction](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-creative-packages-140-07-project-restore.gif)

- [Actual desktop interaction .GIF](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-creative-packages-140-07-project-restore.gif)
- [Actual extension interaction .MP4](https://github.com/copypasteltd/workmate/blob/extension/assets/screenshots/workmate-creative-packages-140-07-project-restore.mp4)
- [Actual extension interaction .GIF](https://github.com/copypasteltd/workmate/blob/extension/assets/screenshots/workmate-creative-packages-140-07-project-restore.gif)

<!-- native-teams-stage139 -->
## 本机专家团队 · 阶段139

打开「本机团队」，创建协调员及成员，填写整体简报、各步要求、依赖和预算。审阅时在本机选择目录及权限，确认后由客户电脑运行独立Codex成员；只有全部实际成果完成后协调员才开始。打开成员会话可回答问题；新增分工需重新审阅。可整组停止、从任一成员撤权，完成后下载团队交付。

最多16步、7位成员加1位通用协调员、3步并行，共用一个明确授权目录；并行编辑应分配到不同文件。审阅免费，批准预算固定，预留与实际费用分开；已接受但未知的操作不重跑。撤权先停止本机工具，未同步回执继续可见。团队ZIP仅包含主动提交的成果，本机未提交文件留在本机。

60项后端、36项扩展、81项本机控制／下载回归及6项实际Windows旅程通过；4张截图、1组GIF／MP4、3档布局及1个独立解压的完整团队包绑定1756份确切源码。

业务／模型答复及本机目录／授权／保存窗口的选择决定为受控假数据；实际OTP／PKCE、本机Codex、Windows文件操作、公司计量、撤权和ZIP解压确实执行。Windows包未签名；全部专业角色质量、签名安装、真实公司模型／广告账户及跨机器工程恢复继续独立验收。

```mermaid
flowchart LR
 A[Versioned team and fixed Skills] --> B[Free review: local folder, permission and budgets]
 B --> C[Customer approval and durable admission]
 C --> D[Parallel local Codex members]
 D --> E[Dependent local review]
 E --> F[Local coordinator]
 F --> G[Exact results and complete team ZIP]
 D --> H[Stop or revoke the whole team]
 H --> I[Recover original receipts, never replay unknown work]
```

[需求](https://github.com/copypasteltd/workmate/blob/main/docs/requirements/16-desktop-native-teams.md) · [接口／权限／恢复／交付方案](https://github.com/copypasteltd/workmate/blob/main/docs/technical/139-desktop-native-teams.md) · [源码与证据](https://github.com/copypasteltd/workmate/blob/main/docs/quality/native-teams-checkpoint-139.json) · [全部编号](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage139.md)

真实Desktop操作，业务内容为假数据：

![Actual local team delivery](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-completed-local-team-zh.png)

![Actual local team delivery](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-local-team.gif)

- [workmate-native-teams-139-05-review-before-local-run-en.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-review-before-local-run-en.png)
- [workmate-native-teams-139-05-completed-local-team-en.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-completed-local-team-en.png)
- [workmate-native-teams-139-05-whole-team-access-revoked-zh.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-whole-team-access-revoked-zh.png)
- [workmate-native-teams-139-05-local-team.mp4](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-native-teams-139-05-local-team.mp4)

<!-- delivery-revision-stage138 -->
## 原成果修改与新版本交付 · 阶段138

原本机会话完成工作后，展开交付审阅并提出修改。新工作使用当前有效本机权限、原目录和原Codex线程，由客户本机Codex执行；授权可撤销。修改受理记录跨重启保存。无边框、无Electron菜单及无可见滚动轨要求保留，禁止云端Agent替代本机执行。

可选择整份交付、答复、单文件、Unicode文字选段、图片区域或有效视频时段。预览不调用AI或预留费用；确认后建立单独预算的新任务，沿用原角色与来源，保留原成果及费用。源文件换版或撤回将阻断后续读取与完成交付。获准项目编辑可修改共享工作，私有会话保留原归属。结果未知时继续核对原请求。

文字预览上限1 MiB，图片／MP4内嵌预览4 MiB；更大或不支持预览的文件可下载后按完整文件提出修改。整份修改最多引用20个文件，视频时段须有保留的有效时长。图片／视频位置是修改意见，不能视为编辑操作审批或专业质量通过；专门工作流保留原确认步骤。

34项当前后端检查（含13项新增修改测试）、36项扩展状态检查、73项桌面控制／下载回归及9项三端实际旅程通过。11张实际截图、3组GIF／MP4、7档布局和3个独立解压的下载包绑定1732份确切源码。

业务／模型答复及原生文件／授权窗口选择为明确受控的假数据；登录、数据库权限、确切文件、实际打包本机Codex、Windows原生窗口、Chrome右侧栏和新成果下载实际运行。Windows包未签名。真实公司模型／账户、完整专业角色输出、安装矩阵和工程恢复继续独立验收。

```mermaid
flowchart LR
  A[Original delivery] --> B[Select exact source and anchor]
  B --> C[Confirm changes and new budget]
  C --> D{Original execution location}
  D --> E[Cloud Codex: Web and Extension]
  D --> F[Local Codex: Desktop]
  E --> G[New delivery, original retained]
  F --> G
  G --> H[Original conversation and new ZIP]
```

[需求](https://github.com/copypasteltd/workmate/blob/main/docs/requirements/15-delivery-revisions.md) · [方案与使用逻辑](https://github.com/copypasteltd/workmate/blob/main/docs/technical/138-source-bound-delivery-revisions.md) · [源码与原始证据](https://github.com/copypasteltd/workmate/blob/main/docs/quality/delivery-revision-checkpoint-138.json) · [全部编号](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage138.md)

实际产品操作，业务内容为假数据：

![本端实际修改流程](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-revision-138-06-local-revision-en.png)

![本端实际修改流程](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-revision-138-06-delivery-revision.gif)

其他实际页面截图及MP4录屏：

- [workmate-delivery-revision-138-06-local-revision-zh.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-revision-138-06-local-revision-zh.png)
- [workmate-delivery-revision-138-06-local-revised-delivery.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-revision-138-06-local-revised-delivery.png)
- [workmate-delivery-revision-138-06-delivery-revision.mp4](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-revision-138-06-delivery-revision.mp4)

<!-- delivery-package-stage137 -->
## 完整交付与原对话下载 · 阶段137

主要业务按“提交目标 → 补充资料 → 执行 → 审阅 → 下载成果 → 原对话修改”继续收口。现在 Web 和 Chrome 原生右侧栏可直接在原聊天下载完整当前交付包，任务审阅区也提供入口；Desktop 使用公司授权接口和原生保存窗口。取消保存不发请求、不显示成功，侧栏提示跨刷新及繁英切换保留。

ZIP 包含实际成果、文字答复（如有）、任务及素材固定版本、SHA-256清单及中英编辑说明。同名文件分别保留，失败／停止工作的现有成果明确标示为部分交付。源代码ZIP、SVG／PPTX、工程JSON及只读成片分别按实际编辑能力说明，不虚构源工程。没有提交为交付物的本机文件仍留在本机；Desktop Agent仍是本机Codex，云端包不会扫描本机工作区。

用户看到的任务版本和交付摘要必须一致。后端顺序读取真实文件、流式校验大小与摘要，在受控磁盘生成ZIP，完成后再次检查当前权限、来源、保留期限及精确版本；文件损坏、素材撤回或版本变化会拒绝整个包。只读项目成员可下载获准共享成果，审阅仍需批准权限；管理员身份不自动获取私有会话。导出不调用AI、不创建新任务、不增加AI费用。容量为16 GiB／10,000个成果／文字条目，超限明确拒绝，不悄悄遗漏文件。

本轮不新增数据库迁移：Backend沿用SQL135并重新构建，Web／Desktop／Extension重新构建。扩展新增Chrome `downloads` 权限，使用浏览器默认下载位置及冲突改名；授权只在公司请求头中传递。新增契约为Backend `contracts/delivery-package-v1.json`。从Delivery执行 `npm run qa:delivery-package-backend -- <新两位编号>` 或 `npm run qa:delivery-package -- <新两位编号>`；后者默认完整构建、创建未签名Windows包并操作实际右侧栏与原生下载。

21项当前后端检查（含11项新打包测试）、37项扩展状态检查、1项桌面下载回归、12项边界绑定及10项三端实际旅程通过。9张实际截图、3组GIF／MP4、7档布局和3个独立解压的下载包绑定1713份确切源码。 使用受控Codex适配器和假业务内容；真实OTP／PKCE、文件读取、权限、原生窗口和Chrome下载管理器实际运行。Desktop保存窗口的选择结果由夹具指定到本轮自有目录。本轮未重新证明全部本机Codex工具、真实公司模型、专业素材质量或完整跨环境工程恢复。既有52项后端／来源回归另有阶段内原始记录，按其自身源码范围保留，不混称本轮全平台回归。

```mermaid
flowchart LR
  A[原对话成果] --> B[当前版本与交付摘要]
  B --> C[权限与来源验证]
  C --> D[逐文件校验与完整ZIP]
  D --> E[再次验证原版本和权限]
  E --> F[浏览器或原生窗口保存]
  F --> G[原对话反馈与新工作确认]
```

[需求](https://github.com/copypasteltd/workmate/blob/main/docs/requirements/14-complete-delivery-package.md) · [方案与使用逻辑](https://github.com/copypasteltd/workmate/blob/main/docs/technical/137-complete-delivery-package.md) · [确切源码与证据](https://github.com/copypasteltd/workmate/blob/main/docs/quality/delivery-package-checkpoint-137.json) · [全部编号](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage137.md)

实际客户流程截图与交互（业务内容为假数据）：

![本端实际交付操作](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-package-137-02-downloaded.png)

![本端实际交付操作](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-delivery-package-137-02-delivery-download.gif)

<!-- business-inputs-stage136 -->
## 业务问题与原任务续跑 · 阶段136

Agent遇到确实缺少的尺寸、目标受众或业务口径，可在原对话提出问题。客户可点击建议再修改，也可直接自由回答，最后明确确认；没有预选或自动提交。多项问题逐项保存，全部补齐后继续同一任务、同一会话和原预算预留，已计量用量统一结算。确认的问题和答案保留为原对话备注，相同请求重试不重复写入。

Web和Chrome原生右侧栏直接在原聊天展示问题，Desktop既有云任务详情也支持补答。繁中／英文切换保留未提交的回答，失败保留文字；扩展切换身份或会话清除草稿，来源不可读时清除受保护问题。建议仅供选择，答案不授予文件、广告账户、工具、本机或额外费用权限。

服务端严格区分`question`／`file`／`connection`，最多8项建议、4,000字符回答，校验版本、当前权限、来源及整批合法性后才写入。已确认答案不可改写。付费提问必须处于已完成且计量明确的Codex回合边界，继续原线程；取消只结算已知用量。删除私有会话清除问题、答案、检查点及正文，保留必要费用事实。

SQL135须在启动API／Worker前迁移：Backend执行`npm run db:migrate`。原SQL001–134、原二十项任务定义及主OpenAPI保持原字节；新增结构在`contracts/business-inputs-v1.schema.json`，扩展原创建／补交接口。原依赖文件与连接结构继续有效，问题使用`answer`而非`resource_ids`。

122项后端集成检查（含11项新增问题测试）、61项扩展状态检查、12项交付绑定及14项实际三端流程通过；9张实际截图、3组GIF／MP4及7个尺寸检查绑定确切来源。 原生Codex检查使用实际固定二进制和合成Responses服务，页面旅程使用受控工具和假业务回复。客户端初次完整构建成功；修正页面夹具后复用逐字节一致的源码和Windows包，原失败记录保留。可在Delivery执行`npm run qa:business-inputs-backend -- <新两位编号>`或`npm run qa:business-inputs -- <新两位编号>`；后者默认完整构建并创建独立原生测试数据库。

Desktop本机Codex及客户主动授予的本机完整权限沿用独立流程，本轮新增的是其云端任务视图问答。实际Windows窗口保持无边框、无Electron菜单、无可见纵向滚动轨和横向溢出；扩展保持实际Chrome原生右侧SIDE_PANEL。使用假数据，Windows包未签名；真实生产模型及全部角色专业交付仍待验收。完整编号仍开放88条必需、12条未确认建议、1条可选，REQ-095原始验收维持。

```mermaid
flowchart LR
  A[原任务缺少业务资料] --> B[已计量Codex回合提出问题]
  B --> C[客户选择建议或自由回答]
  C --> D[明确确认 校验版本与当前权限]
  D --> E{是否已补齐}
  E -->|尚未补齐| C
  E -->|已补齐| F[原线程 原任务 原预算继续]
  F --> G[原对话结果 一次累计结算]
```

[需求](https://github.com/copypasteltd/workmate/blob/main/docs/requirements/13-business-brief-inputs.md) · [实现与使用逻辑](https://github.com/copypasteltd/workmate/blob/main/docs/technical/136-business-brief-clarification.md) · [全部102条编号](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage136.md) · [源码与原始验收](https://github.com/copypasteltd/workmate/blob/main/docs/quality/business-inputs-checkpoint-136.json)

![Actual workmate-business-inputs-136-05-question-en.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-business-inputs-136-05-question-en.png)

![Actual workmate-business-inputs-136-05-question-zh.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-business-inputs-136-05-question-zh.png)

![Actual workmate-business-inputs-136-05-completed.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-business-inputs-136-05-completed.png)

![Actual workmate-business-inputs-136-05-business-clarification.gif](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-business-inputs-136-05-business-clarification.gif)

<!-- client-errors-stage135 -->
## 四端连接与登录恢复 · 阶段135

Web、Admin、Desktop及Extension对读取失败显示当前语言的连接说明，保留有效登录。提交后响应丢失或无法解析时，提示先查收结果；应用层不会自动重发；浏览器可能在底层重传，服务端按原消息编号去重。客服授权继续使用原编号和期限，扩展委派继续使用原消息编号，显式重试不生成第二个任务。后台轮询不清除提交结果未确认的提醒，切换繁中／英文会更新同一错误提示，已知连接异常不显示Electron内部文字、地址或响应正文。

受保护请求收到401时，先核对所属登录并清除当前身份；HTML或空正文不能绕过清除。旧请求不能注销新登录或覆盖新防伪标记。Admin即时隐藏独立管理外壳，支持会话列表的连接错误与表单／撤销提醒分开，列表恢复后只清除本次连接提示。

15项连接／身份检查（含实际HTTP故障）、12项交付文件绑定、1项原生桥检查及30项实际四端流程通过。20张截图、7组实际GIF／MP4绑定源码；包含真实右侧SIDE_PANEL、客户OTP／PKCE及独立管理员TOTP、真实提交后响应丢失与同消息重试。09重新编译／构建Extension及Delivery，复用与02逐字节相同的后台、Web、Admin、Desktop源码及Windows包；没有伪称再次完整打包。旧失败与执行原件保留。Delivery当前`npm test`包含严格编译、文件绑定及连接检查；`npm run qa:client-errors -- <新的两位编号>`默认完整构建。

Desktop仍在客户本机运行Codex，完整本机权限单独授予，保持无边框、无Electron菜单及可见滚动条。Extension通过Chrome工具栏打开原生右侧栏，负责获准文件上传和云端执行。业务使用假数据，模型未运行，Windows包未签名。完整验收仍有88条必需、12条未确认建议、1条可选开放；REQ-095原始验收维持。

```mermaid
flowchart LR
  U[用户操作] --> R{读取或提交}
  R -->|读取失败| C[保留登录 主动刷新]
  R -->|提交结果未知| Q[查收结果 同编号明确重试]
  R -->|当前HTTP401| L[清除旧内容 返回登录]
  R -->|旧登录的迟到响应| S[拒绝旧响应 保留新登录]
```

[使用与实现](https://github.com/copypasteltd/workmate/blob/main/docs/technical/135-client-connection-and-session-recovery.md) · [全部102条编号](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage135.md) · [源码与验收绑定](https://github.com/copypasteltd/workmate/blob/main/docs/quality/client-errors-checkpoint-135.json)

![Actual workmate-client-errors-135-09-native-unconfirmed-zh.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-client-errors-135-09-native-unconfirmed-zh.png)
![Actual workmate-client-errors-135-09-native-unconfirmed-en.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-client-errors-135-09-native-unconfirmed-en.png)
![Actual workmate-client-errors-135-09-expired-session-en.png](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-client-errors-135-09-expired-session-en.png)
![Actual workmate-client-errors-135-09-customer-grant.gif](https://github.com/copypasteltd/workmate/blob/desktop/assets/screenshots/workmate-client-errors-135-09-customer-grant.gif)

<!-- support-recovery-stage134 -->
## 客户授权恢复与客服原始验收 · 阶段134

客户从 **Web／Desktop → 账户设置 → 客服限时协助** 选择项目、原因及期限，空项目选择只表示元资料。首次提交固定申请编号和截止时间。响应丢失后可点击**查收先前申请**，或使用相同资料重试；刷新先查询既有结果，不自动再次提交。不同资料不能替换尚未确认的申请。查收展示目前有效／撤销／到期状态，不会续期；客户随时可在列表撤销。

恢复记录只在当前浏览器会话保存随机编号、申请摘要和固定截止时间，不保存原因、项目ID、正文或凭证。禁用存储时仅当前renderer内可恢复；服务器已经提交的授权仍显示在列表中。切换账户或企业后，迟到的结果不能回填新表单。原生Desktop桥仅新增客户查收GET，不开放管理员支持接口。

**原始REQ-095／TC-095已通过验收**，十二条条件逐项对应当前源码与真实执行证据：真实管理员和只读提示、明确范围、独立正文权限、写入／付款／VIP／凭证拒绝、无隐身登录、真实到期、撤销及审计失败回滚。本轮关闭这一条原始需求；全平台无障碍REQ-055、完整权限与竞争矩阵REQ-094继续各自跟踪。

65项相关后端检查、1项原生桥边界检查、18项实际Admin／Web／打包Desktop旅程及10条构建命令通过。覆盖提交前／后真实HTTP响应丢失、刷新、实际切换企业、同内容重试、当前回执查收、真实到期和原生客户撤销；客服操作期间user／native会话、刷新令牌和本机授权码行数不增加。确切源码绑定9截图和5组实时GIF／MP4。支持页面验证键盘及文字放大，Web／Admin采用CSS 200%，Desktop采用实际原生webContents 200%缩放；不据此关闭全平台浏览器／读屏验收。

Desktop继续在客户本机运行Codex，客户独立主动授予完整本机权限；保持无边框、无Electron默认菜单和无可见滚动条。Extension继续使用Chrome原生Side Panel承载获准文件上传与云端执行。本轮模型没有运行，业务及保留结果为合成夹具，Windows包未签名。自建浏览器、原生客户端与数据库均已关闭。

```mermaid
flowchart LR
  C[客户明确授权] --> F[固定申请与截止时间]
  F --> P[公司服务器]
  P --> L[响应丢失]
  L --> R[查收本人当前回执]
  R --> E[既有授权目前状态]
  R --> S[相同资料同键重试]
  S --> P
  E --> V[客户可随时撤销]
```

[方案 / Behavior](https://github.com/copypasteltd/workmate/blob/main/docs/technical/134-support-grant-recovery-and-acceptance.md) · [TC-095 acceptance](https://github.com/copypasteltd/workmate/blob/main/docs/quality/tc095-acceptance-134.json) · [Checkpoint](https://github.com/copypasteltd/workmate/blob/main/docs/quality/support-recovery-checkpoint-134.json) · [完整编号清单 / Remaining work](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage134.md)

![Actual native unconfirmed request](assets/screenshots/workmate-support-recovery-134-04-native-unconfirmed-en.png)

![Actual customer result recovery and workspace switch](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-support-recovery-134-04-grant-result-recovery.gif)

![Actual fixed-intent keyboard retry](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-support-recovery-134-04-fixed-intent-retry.gif)

[Recovery recording](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-support-recovery-134-04-grant-result-recovery.mp4) · [Retry recording](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-support-recovery-134-04-fixed-intent-retry.mp4) · [Native grant](assets/screenshots/workmate-support-recovery-134-04-customer-grant.mp4) · [Native revocation](assets/screenshots/workmate-support-recovery-134-04-customer-revocation.gif) · [200% Admin](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-recovery-134-04-support-en-200.png) · [Chinese dark Admin](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-recovery-134-04-support-zh-dark.png)

本轮1条需求验收完成；仍有88条必需、12条未确认建议和1条可选记录开放。这是完整验收记录数量，不代表101个未编码模块。完整源码交付复现、签名安装、生产接入及其余业务验收继续按编号推进；下方历史章节保留原运行范围。

---

<!-- support-access-stage133 -->
## 受控客服与原生客户授权 · 阶段133

客户从 **Web／Desktop → 账户设置 → 客服限时协助** 选择实际项目、原因及15／30／60分钟期限；空选择只包含企业／用户元资料。把授权ID提供给客服，并可随时在同一客户表单撤销。

管理员以自己的邮箱与TOTP登录 **Admin → 支援工作台**，明确选择客户、企业、项目、期限及可选客户授权。只读横幅持续显示真实身份和截止时间。共享正文还需要当前独立正文权限，私人会话保持私有；该视图不提供写入、费用、VIP或客户登录权限。

客服接口现会核对任务原始来源。来源隔离／到期或版本擦除后，保留正文不可继续返回，诊断标题也会隐藏。所选正文绑定当前版本，审计期间变化会被拒绝。页面取消旧请求，拒绝迟到任务／会话响应；版本变化、来源撤回、隐藏、失败、撤销或到期后清空正文。服务端逐次判断权限；可见Admin约每两秒复查。

59项后台相关测试及13项实际Admin／Web／打包原生Desktop旅程通过，确切源码绑定6截图和3组实时GIF／MP4。实际验证OTP／PKCE、邮箱／TOTP、客户授权／撤销、迟到响应、来源撤回、真实到期、繁中深色、四档Admin宽度和三档原生无边框窗口。所属浏览器、客户端与测试数据库均已关闭。模型没有运行，业务数据、保留结果和夹具文件读取明确为合成数据；Windows包仍未签名。

Desktop继续在本机运行Codex，本机权限由客户独立主动授权；客服表单只调用客户接口，管理员视图留在Admin。Extension继续使用Chrome原生Side Panel，承载获准文件上传及云端执行；本轮没有修改Extension执行代码。

```mermaid
flowchart LR
  C[客户Web或原生Desktop] --> G[明确范围及截止时间]
  G --> A[管理员使用自己的身份]
  A --> P[当前权限及原始来源]
  P --> R[所选正文版本]
  R --> V[只读共享内容]
  X[撤销／到期／来源撤回] --> K[拒绝读取并清空正文]
```

[实现方案](https://github.com/copypasteltd/workmate/blob/main/docs/technical/133-controlled-support-source-and-native-access.md) · [Checkpoint](https://github.com/copypasteltd/workmate/blob/main/docs/quality/support-access-checkpoint-133.json) · [完整编号待办](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage133.md)

![Actual native customer grant](assets/screenshots/workmate-support-access-133-02-native-grant-en.png)

![Actual delayed task selection](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-access-133-02-task-selection.gif)

![Actual native customer revocation](assets/screenshots/workmate-support-access-133-02-customer-revocation.gif)

[Native grant recording](assets/screenshots/workmate-support-access-133-02-customer-grant.mp4) · [Selection recording](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-access-133-02-task-selection.mp4) · [Revocation recording](assets/screenshots/workmate-support-access-133-02-customer-revocation.mp4) · [Web metadata-only grant](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/workmate-support-access-133-02-metadata-grant-en.png) · [Chinese dark Admin](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-access-133-02-support-zh-dark.png) · [Source withdrawn](https://github.com/copypasteltd/workmate/blob/admin/assets/screenshots/workmate-support-access-133-02-source-withdrawn-en.png)

仍有89条必需完整验收、12条未确认建议及1条可选记录开放，不代表102个未编码模块。完整权限竞争矩阵、各页面无障碍、签名安装和生产接入继续按编号推进；下方历史章节保留原范围。

---

<!-- durable-receipt-stage131 -->
## 本机结果与费用回执持久同步 · 阶段131

本机子任务完成后，即使公司接口未收到完成请求，或已结算但响应丢失，原始结果仍保存在本机。父任务只有确认子任务回执后才能清理操作记录。恢复连线后选择“同步已储存的回执”；撤销本机权限后或完整退出并重新打开应用后，仍可同步原回执。同步不会重新运行命令、启动QA或新增模型请求。

已知成功的子任务按公司实际观测结算一次。未知父任务继续保留原预算、等待费用核对；同步成功不代表整个流程成功，也不解除未知本机副作用限制。账号切换和服务端权限继续校验，不能绕过原登录族或企业权限。

```mermaid
flowchart LR
  A[保存原子任务报告] --> B[补交原回执]
  B --> C[原任务终态确认]
  C --> D[提交父任务结果]
  D --> E[未知父任务待核对]
  B --> F[断网或响应丢失]
  F --> G[保留本机记录]
  G --> H[重启或撤权后同步]
  H --> B
```

限定验证通过：124项控制层检查（含15项新增回执边界）、43项真实固定Codex检查、3条真实本机/SQL回执丢失流程、2项编译检查和8项实际未签名Desktop界面检查。旧版与新版对照确认原缺陷：旧版遗漏子任务完成请求，新版先子后父。真实进程、命令、文件、数据库、HTTP响应丢失和完整应用重启已运行；模型回答及系统对话框选择为测试输入。全部所属测试资源已关闭，原始失败、执行脚本和源码快照保留。

[实现方案](https://github.com/copypasteltd/workmate/blob/main/docs/technical/131-desktop-durable-receipt-sync.md) · [当前检查点](https://github.com/copypasteltd/workmate/blob/main/docs/quality/receipt-sync-checkpoint-131.json) · [完整编号待办](https://github.com/copypasteltd/workmate/blob/main/docs/quality/remaining-work-stage131.md)

![Saved native receipts awaiting synchronization](assets/screenshots/workmate-receipt-sync-131-01-saved-receipts-pending-en.png)

![Actual receipt loss and local permission withdrawal](assets/screenshots/workmate-receipt-sync-131-01-receipt-loss-and-permission-withdrawal.gif)

![Actual synchronization after full application restart](assets/screenshots/workmate-receipt-sync-131-01-receipt-sync-after-application-restart.gif)

[Fee confirmation](assets/screenshots/workmate-receipt-sync-131-01-child-fee-confirmation-en.png) · [撤权后中文提示](assets/screenshots/workmate-receipt-sync-131-01-revoked-receipts-pending-zh.png) · [Original receipts synchronized](assets/screenshots/workmate-receipt-sync-131-01-original-receipts-synchronized-en.png) · [Loss/withdrawal MP4](assets/screenshots/workmate-receipt-sync-131-01-receipt-loss-and-permission-withdrawal.mp4) · [Restart/sync MP4](assets/screenshots/workmate-receipt-sync-131-01-receipt-sync-after-application-restart.mp4)

当前仍有89条必需、12条未确认建议、1条可选完整验收记录开放，不能理解为102个模块尚未编码。任意崩溃/旧进程回收、换登录族后的处理、全部父任务账务核对、专业角色、正式模型/媒体及签名安装继续推进。当前增量使用阶段131独立清单与发布器；阶段128和130证据保持各自历史范围。

```powershell
node scripts/qualify-receipt-sync-v1.mjs unit 11
node scripts/qualify-receipt-sync-v1.mjs native 12
node scripts/qualify-receipt-sync-v1.mjs types 13
```

运行前先准备固定版本Codex；使用新的两位执行编号，禁止覆盖已有原始证据。

---

<!-- workflow-recovery-stage130 -->
## 本机父子流程恢复与取消 · 阶段130

本轮修复停止或正常完成任务时，后台授权保活响应卡住导致收尾等待的问题。主任务和每个子任务分别取消并等待自己的保活观察器；即使底层请求忽略取消，其迟到响应也不能继续启动任务。正常完成不会因此取消父任务；提交本机轮次前仍必须重新检查当前权限。

客户流程为：浏览器登录与企业工作区 → 选择本机目录并主动授权 → 确认额外子任务费用 → 本机开发者执行 → 客户审核实际文件 → 本机QA执行 → 下载SOP、固定版本JSON和恢复说明。两个子任务分别发生真实初始化/建会话故障后，在公司持久证明零准入的前提下各恢复一次；原任务、原预算、截止与worker attempt保持一致。

```mermaid
flowchart LR
  A[本机主任务] --> B[确认子任务费用]
  B --> C[本机开发者]
  C --> D[客户审批]
  D --> E[本机QA]
  E --> F[私有交付与原费用]
  C --> G[清理旧进程、证明零准入、恢复一次]
  E --> G
```

限定验证通过：109项控制层、43项真实固定Codex、3个完整原生父子流程、2项当前编译和8项实际未签名打包界面检查。打包旅程使用真实Electron、原生PostgreSQL、本机命令与文件；模型回答、对话框选择及注入的传输故障为测试输入。三个原生窗口宽度保持无边框、无默认菜单、无可见滚动条及无横向溢出，全部所属资源已关闭。原始失败及其源码快照保持不变。

[实现方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/130-desktop-workflow-recovery.md) · [当前检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/workflow-recovery-checkpoint-130.json) · [完整编号待办](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage130.md)

![Actual human review after recovered native child](assets/screenshots/workmate-workflow-recovery-130-01-recovered-developer-human-review-en.png)

![Actual parent and child recovery interaction](assets/screenshots/workmate-workflow-recovery-130-01-parent-child-startup-recovery.gif)

[费用确认](assets/screenshots/workmate-workflow-recovery-130-01-child-fee-confirmation-en.png) · [英文完成画面](assets/screenshots/workmate-workflow-recovery-130-01-two-recovered-children-completed-en.png) · [中文完成画面](assets/screenshots/workmate-workflow-recovery-130-01-two-recovered-children-completed-zh.png) · [完整实时MP4](assets/screenshots/workmate-workflow-recovery-130-01-parent-child-startup-recovery.mp4)

完整验收仍有89条必需、12条未确认建议和1条可选记录开放；它们是完整验收记录，不等于102个功能尚未编码。任意崩溃/多节点、所有本机工具、全部专业角色、丢失子任务完成回执的持久补交、正式模型及签名安装等继续推进。当前发布由阶段130独立清单和发布器约束；旧V11入口及阶段128清单保留历史源码范围，不用于发布本轮变更。

[简体中文](README.md) · [English](README.en.md)

<!-- startup-recovery-stage128 -->
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

本轮限定检查通过：91项相关控制层、43项真实固定版本Codex、30项原生数据库/API、3项当前编译和6项实际未签名打包界面检查。实际旅程验证了登录、授权、一次启动恢复、原任务的一次收费、单次回答、待响应时撤权，以及1000/1240/1440三个原生窗口宽度。当前截图、GIF和MP4来自成功的04次运行；失败的01—03次运行及原始记录均完整保留。发布入口为V11，远端状态以最终推送回执和SHA回读为准。

[方案与接口](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/128-desktop-startup-recovery.md) · [匹配源码与验证](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/startup-recovery-checkpoint-128.json) · [编号待办](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage128.md)

![Actual packaged Desktop reconnecting with the original task](assets/screenshots/workmate-startup-recovery-128-04-startup-keeps-company-lease.png)

![Actual recovery and original billing interaction](assets/screenshots/workmate-startup-recovery-128-04-startup-and-original-receipt.gif)

[Original receipt](assets/screenshots/workmate-startup-recovery-128-04-original-local-receipt.png) · [Withdrawal screenshot](assets/screenshots/workmate-startup-recovery-128-04-permission-revoked-before-turn.png) · [Withdrawal GIF](assets/screenshots/workmate-startup-recovery-128-04-revoke-pending-startup.gif) · [Recovery MP4](assets/screenshots/workmate-startup-recovery-128-04-startup-and-original-receipt.mp4) · [Withdrawal MP4](assets/screenshots/workmate-startup-recovery-128-04-revoke-pending-startup.mp4)

<!-- local-startup-stage127 -->
## 本机启动、保活与撤权 · 阶段127

客户选择目录并主动授权后，Codex始终在客户电脑运行；公司服务负责身份、模型网关与原任务费用。主任务和工作流子任务现在在准备/启动期间即续租，启动后再次检查授权，才提交轮次。关闭或撤权会中断待响应的初始化/建会话请求，等待准备退出并回收所属进程与锁，不会在清理后迟到启动。

启动等待超过初始45秒不另建任务、不重复预留。正常完成先停止并等待保活，再关闭资源及同步原费用回执。撤权提示说明本机工作停止、检查授权及原费用；已接受或结果不明的工作不自动重做。Desktop自动启动恢复仍待实现，不能仅凭零费用就重试。

```mermaid
flowchart TD
  Grant[客户选择目录并授权] --> Admit[公司原任务和预算预留]
  Admit --> Renew[准备及启动期间持续检查授权]
  Renew --> Native[客户本机Codex]
  Native --> Check[启动完成后再次授权]
  Check --> Turn[提交原任务轮次]
  Turn --> Finish[等待保活退出、关闭资源、同步费用]
  Renew -->|关闭或撤权| Drain[中断启动、等待准备退出、回收所属进程]
```

本轮限定验收为73项完整相关控制层、38项真实固定Codex及5项实际未签名打包窗口检查；最终结果见下方检查点。实际窗口旅程覆盖浏览器OTP/PKCE与工作区创建、默认取消不授权、超过45秒启动、一次真实公司账务、待响应启动撤权及1000/1240/1440宽度无边框、无菜单和无可见滚动条。模型回答和原生对话框选择为明确测试数据，不代表正式模型、签名安装或全部角色验收。此前阶段的包与画面保留原源码范围。

当前未签名目录包：`release/local-startup-127-03/win-unpacked/`。正常安装/启动按本README后续说明；`scripts/qualify-local-startup-v2.mjs`及Delivery的`run-desktop-startup-v4.mjs`是绑定当次候选目录、固定二进制和隔离数据库的验收工具，不是其他检出的通用启动器。

[方案与执行顺序](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/127-desktop-startup-lifecycle.md) · [确切源码与最终结果](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/local-startup-checkpoint-127.json) · [编号待办](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage127.md)

![实际启动等待期间保持公司授权](assets/screenshots/workmate-local-startup-127-04-startup-keeps-company-lease.png)

![实际本机任务和原费用交互](assets/screenshots/workmate-local-startup-127-04-startup-and-original-receipt.gif)

![实际启动中撤销本机权限](assets/screenshots/workmate-local-startup-127-04-permission-revoked-before-turn.png)

[原费用截图](assets/screenshots/workmate-local-startup-127-04-original-local-receipt.png) · [撤权GIF](assets/screenshots/workmate-local-startup-127-04-revoke-pending-startup.gif) · [完成MP4](assets/screenshots/workmate-local-startup-127-04-startup-and-original-receipt.mp4) · [撤权MP4](assets/screenshots/workmate-local-startup-127-04-revoke-pending-startup.mp4)

<!-- controlled-publications-stage125 -->
## 本机发布预览与权限 · 阶段125

Desktop保留客户本机Codex、可撤销完整本机权限及无边框窗口。主进程访问公司服务，渲染层不接收Bearer。`workmate-media`能力绑定窗口、会话及范围，支持有界流、HEAD／Range、完整性校验、并发和有效期限制；登出、换会话及窗口销毁撤销能力。

安全浏览器登录并创建工作区后，在Web连接社交账户、明确范围；回到Desktop选择文案和确切素材版本，核对实际媒体，主动勾选发布并读取回执。未知结果只能核对或人工结案，不能自动重发。来源失效或撤权会撤回内容。

```mermaid
flowchart LR
  UI[无边框本机界面] --> Main[主进程会话和媒体能力]
  UI --> Codex[客户本机Codex]
  Codex --> Gateway[公司AI网关]
  Main --> Company[公司发布服务]
```

类型检查及媒体／会话21/21通过。最新未签名目录包为`release/publications-125-02/win-unpacked/`。实际打包Electron／Chrome原生侧栏发布旅程10/10通过，含原生媒体、三档OS窗口尺寸、无边框／菜单／可见滚动条、明确确认和撤权。签名安装、完整本机工具及专业角色资格另验。

![实际本机受保护图片预览](assets/screenshots/workmate-native-publications-02-protected-image-preview.png)

![实际本机发布交互](assets/screenshots/workmate-native-publications-02-native-preview-and-confirm.gif)

[实际交互MP4](assets/screenshots/workmate-native-publications-02-native-preview-and-confirm.mp4)


<!-- runtime-startup-122 -->

## Codex 启动与轮次隔离 · 阶段 122

本机 Codex 的工具、输入请求、审批、消息、用量和完成通知绑定当前线程及轮次，排队的旧消息不能转入后续任务。丢失 turn/start 响应时，真实完成通知可结束原轮次，避免重复执行。原生错误日志只保留受限字段。客户本机完整权限、撤销、无边框及自绘窗口控制保持生效。

180 项单元与 25 项真实原生 Codex 检查通过。npm test 的预构建现包含 Native Host，支持新检出目录。当前源码打包后另有 8 项实际 UI 检查通过，覆盖 OTP/PKCE、本机明确授权、真实本机文件与公司工具费用、撤销，以及 1440/1280/800 窗口无可见滚动条和横向溢出。提供方回复与原生对话框选择为明确测试数据。

```mermaid
flowchart LR
  A[Customer permission] --> B[Customer-local Codex]
  B --> C{Current thread and turn?}
  C -->|Yes| D[Authorized local or company tool]
  C -->|No| E[Reject foreign request]
  D --> F[Native completion and original billing]
```

[完整方案 / Behavior and verification](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/122-codex-startup-and-turn-isolation.md)

![Actual frameless Desktop](assets/screenshots/workmate-runtime-startup-desktop-02-layout-1440-en.png)

![Actual native interaction](assets/screenshots/workmate-runtime-startup-desktop-02-local-cloud-boundary.gif)

[800px](assets/screenshots/workmate-runtime-startup-desktop-02-layout-800-en.png) · [繁體中文](assets/screenshots/workmate-runtime-startup-desktop-02-workspace-zh.png) · [MP4](assets/screenshots/workmate-runtime-startup-desktop-02-local-cloud-boundary.mp4)

## 产品与边界

首批面向现有客户的 marketing 团队，完整范围包含生图、设计/字体、视频/特效、广告和网站分析、SEO/GEO、企业重复流程及软件开发。目录已有 18 个精确 Skill 绑定的候选角色；至少十二个逐一完成专业任务、修改及异常处理的角色仍是验收要求。设计师由 Codex、设计 Skill 与公司 Image 2 组合。Agent 内核唯一使用 Codex；全部 AI 请求走公司 OpenAI 兼容后端。当前开发使用已授权假数据，不代表真实模型专业质量已经验收。

Electron 主进程管理 OS 授权、加密本机会话、固定 Codex 子进程、文件/终端、浏览器及 IPC；React 渲染器不持有通用 Node/任意进程调用。选择角色和工作目录后设置唯读、目录内读写或完整本机权限，原生确认默认取消。Codex 在客户电脑运行，推理/图片/视频/音频仍经公司服务器。真实待答问题默认不选择，客户回答继续原任务/线程/轮次；停止和撤权清除待答并结束拥有的子进程。

## 仓库与执行位置

| Branch | Directory | Runtime |
| --- | --- | --- |
| [backend](https://github.com/copypasteltd/workmate/tree/backend) | `dev/copypaste-platform` | Fastify / PostgreSQL / cloud Codex |
| [web](https://github.com/copypasteltd/workmate/tree/web) | `dev/copypaste-web` | React / Vite / cloud workspace |
| [admin](https://github.com/copypasteltd/workmate/tree/admin) | `dev/copypaste-admin` | React / separate Admin identity |
| [desktop](https://github.com/copypasteltd/workmate/tree/desktop) | `dev/copypaste-desktop` | Electron / customer-local Codex |
| [extension](https://github.com/copypasteltd/workmate/tree/extension) | `dev/copypaste-extension` | Chrome MV3 / native Side Panel / cloud Codex |
| [delivery](https://github.com/copypasteltd/workmate/tree/delivery) | `dev/copypaste-delivery` | Native development, QA and publication tools |

各组件为独立 Git 仓库，保留上述并列布局。项目仅使用原生工具；禁止 Docker、WSL 和虚拟机。

## 使用逻辑

1. 安装或启动无边框客户端，以浏览器 PKCE 登录后选择企业、项目和本机工作目录。
2. 选择只读、目录内读写或完整本机权限；完整权限由客户主动确认，默认取消，可随时撤销。
3. 本机 Codex 操作客户本机文件、终端和浏览器；需要固定外部程序时，由客户选择实际程序并确认。
4. 查看原线程问题、真实进程输出、文件变更、成果和费用；停止或撤权结束所属执行，不把不确定结果改写为成功。
5. 目录自动工作先保存为暂停，再独立确认自动费用；重新打开应用保留队列和限额，重新确认后继续。

```mermaid
flowchart TD
  Login[Browser PKCE and local session] --> Grant[Customer local permission]
  Grant --> Codex[Codex process on customer computer]
  Codex --> Local[Local files, terminal and browser]
  Codex --> Company[Company inference and media APIs]
  Local --> Receipt[Actual files, process receipts and cost]
  Grant --> Revoke[Customer stop or revoke]
  Revoke --> Cleanup[End owned work and retain truthful outcome]
```

## 启动与使用

### 本地启动

以下命令在已检出的对应仓库内执行。完整工作区将六个独立仓库并列放在 `dev/`，见[分支与检出布局](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md)。使用 Windows x64、Node.js >=22.14、npm/Git，以及文档约束的原生 PostgreSQL、FFmpeg/FFprobe 与固定 Codex 资源；保留已有本地配置和数据，不使用 Docker/WSL/虚拟机。

```powershell
Set-Location 'D:/dev/copypasted/自有agent/dev/copypaste-desktop'
npm ci
$env:COPYPASTE_LOCAL_CODEX_BIN = 'D:/approved-runtime/codex.exe'
npm run runtime:prepare
npm run build
npm start
```

先启动后端。上述内核路径是示例，需提供符合 `contracts/local-codex-runtime.json` 的固定二进制及相邻辅助资源；公司地址配置在 `deployment.json`。`npm run package:dir` 构建解包候选，`npm run package` 构建安装包。当前证据覆盖未签名解包候选，签名及人工安装/升级/卸载验收仍保留。渲染器可独立构建，须保留本机覆盖层。

### 当前使用流程

1. 完成登录、企业成员/邀请和项目选择。原生端通过浏览器 PKCE 登录；Admin 使用独立 MFA 身份。过期、撤销、换企业不应静默切换身份和资料范围。
2. 选择专业角色，提供工作说明及明确获准的资料/账号。缺少必要输入时请求客户补齐。项目负责人可以保存草稿、核对依赖、预览并明确发布不可变共享指引；发布不启动 AI、不增加权限。
3. 新任务固定当时接受的角色、Skill、品牌、资料和指引版本。既有工作保留原版，包括原先没有共享配置的状态。来源被隔离、删除或撤权后隐藏失效正文并阻断后续使用；历史内容不是越权入口。
4. 确认预算和必要的操作/媒体授权，查看真实状态、进度、文件与原费用回执。修改沿原工作谱系继续。未知用量保持原预留供对账，不能当作免费或盲目重新执行。
5. Admin 可按独立权限管理用户/企业状态、查看获准消耗，预览并确认人工费用/赠额和 VIP 权益/到期。余额、实收记录、授信、预算和 VIP 分别保存；同一确认幂等，操作保留审计，不能因重放重复赠额。

## Desktop 本机程序与浏览器

登录并选择企业/项目→建立本机会话→主动授予完整本机权限→打开「本机程式」→选择实际程序并在默认取消的原生窗口确认→返回对话提出工作→查看参数、真实输出、PID/退出码和原任务费用。取消选择或拒绝确认不会批准程序。程序清单固定文件身份和 SHA-256；Agent 只传程序 ID 与参数数组，不临时指定 shell 或环境变量。

停止原任务或撤销程序会结束该任务拥有的原生进程树；撤销某个程序不撤销客户另行授予的完整本机权限。成功、失败、停止及未知结果分别保留，原调用 ID 不重跑。重启后未确认结果保持未知，客户核对后只能允许后续新调用，不能把旧记录改为成功。完整 OS 权限允许客户程序以本机用户权限操作，不宣称额外受目录 OS 沙箱保护；Admin/云端不能代客户批准。

当前 Windows x64 原生 Job Object 监督程序不继承公司推理凭据。每执行器最多两个活动程序，保留最多 100 个批准记录/200 个运行记录，每次至多 64 个参数、120 秒，stdout/stderr 各保留最多 32 KiB 并标记截断。新会话固定程序工具版本，旧会话工具集合保持原样。浏览器普通页面与弹窗共同计入每任务三页、每执行器两个活动上下文；第三个上下文拒绝，不挤掉他人任务，复用前清除 cookie/localStorage。

## Desktop 本机目录工作

选择具备读写授权的本机会话，打开「目录工作」，选择工作目录内真实输入目录，配置扩展名、处理说明、稳定等待时间、每档/总授权上限和最多次数。已有文件默认不处理；客户明确勾选后才纳入。保存只建立**暂停**规则；「确认并启用」另行打开默认取消的原生自动收费确认。

本机文件事件与有界核对发现稳定输入，按持久队列逐档处理。每档保存精确快照、独立输出目录、原任务编号和公司费用回执。专家需要客户回答时，目录页显示待答入口；「回答问题」返回对话，客户明确选择后继续原任务/线程/轮次。同一规则中已处理的相同路径/内容不会再次收费，产品输出不成为输入；尚未开始的旧内容合并为最新稳定版本。

暂停停止新派发，已开始的一档可以完成；撤销只停止该规则拥有的工作，保留交付和费用。应用关闭后停止监听，真实重开保留加密账本及已分配上限，但必须再次确认。丢失回包复用原派发/创建/开始/结算键；未知本机动作阻断供核对。完整 OS 权限仍是客户主动授予的本机权限，目录规则没有额外创造一个 OS 沙箱。Web/Extension 保持云端执行，本机目录工作是 Desktop 能力。

明确上限：20 条规则；每规则 1,000 项历史/200 项排队，每会话 1,000 项派发回执；每次扫描 2,000 个匹配文件/10,000 项条目/12 层深度；每档 20 MiB、单次新读取 64 MiB；最多授权 100 次，目录调度同一时间执行一档。暂停或重启不重置上限。输出位于 `.copypaste-local-jobs/<rule>/<job>/output/`。越界、路径遍历、symlink/junction、源文件替换和冲突阻断自动执行。本机程序见上节；完整应用操作及崩溃/休眠/离线矩阵仍待补齐。

## 配置、权限与费用

本候选要求完整 SQL001–133 增量历史。API/Worker 准入拒绝缺失、变更或不支持的版本，并独立检查恢复环境身份。公司模型别名、已验证媒体能力、精确费率及供应商密钥只在后端配置；未配置能力保持不可用。当前开发继续使用已授权假数据。

Web/Admin 使用 `VITE_API_BASE` 或同源代理，开发端口为 4317/4318。Desktop/Extension 构建时固定 `COPYPASTE_API_ORIGIN`、`COPYPASTE_WEB_ORIGIN`，Desktop 另固定 `COPYPASTE_EXTENSION_ID`。除获准回环开发场景外使用 HTTPS；渲染器与扩展不持有公司供应商密钥。

文件默认私有，项目共享需要客户明确操作。新请求、Worker 领取、工具及下载重新核验权限；旧历史不能绕过撤权或正文治理。金额使用精确港币微单位；预算、余额、授信、实收与 VIP 分开记录。稳定请求身份防止重复赠额、建任务和预留；未知费用或物理清理保留待核对。

## 预设角色与 Skill

目录定义 18 个专业预设及默认助手，每次执行固定 Skill 版本和注册工具。模板数量不等于至少十二个角色已通过完整专业资格验收。

| ID | Role | Required Skill bindings |
| --- | --- | --- |
| R01 | 全栈开发工程师 | `fullstack-engineering@1.0.0`, `frontend-implementation@1.0.0`, `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R02 | 前端开发工程师 | `frontend-implementation@1.0.0`, `ui-system@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R03 | 后端与 API 工程师 | `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R04 | 软件测试工程师 | `qa-testing@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R05 | UI/UX 设计师 | `ux-research@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R06 | 设计师 | `creative-direction@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R07 | 品牌视觉设计师 | `brand-system@1.1.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R08 | 广告创意设计师 | `ad-creative@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R09 | 电商商品设计师 | `ecommerce-visual@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R10 | 社媒内容设计师 | `social-content@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R11 | 插画与 IP 设计师 | `illustration-ip@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R12 | 字体与版式设计师 | `typography-layout@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R13 | 演示文稿设计师 | `presentation-production@1.1.0`, `typography-layout@1.0.0`, `dataviz@1.1.0`, `delivery-core@1.0.0`, `deterministic-metrics@1.1.0` |
| R14 | 网页与落地页设计师 | `landing-page@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R15 | 信息图与数据可视化设计师 | `dataviz@1.1.0`, `deterministic-metrics@1.1.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R16 | 视频与动效设计师 | `video-storyboard@1.0.0`, `template-video-composition@1.0.0`, `video-generation@1.1.0`, `speech-production@1.2.0`, `delivery-core@1.0.0` |
| R17 | 营销数据分析师 | `ads-analysis@1.1.0`, `deterministic-metrics@1.1.0`, `dataviz@1.1.0`, `delivery-core@1.0.0` |
| R18 | 企业流程自动化顾问 | `workflow-design@1.1.0`, `workflow-execution@1.1.0`, `delivery-core@1.0.0` |

设计师组合为 Codex＋设计 Skill＋公司 Image 2。可选 R19 云端电脑操作员必须绑定另行确认的租约与 AI 预算；本机 Desktop 不提供该创建入口，继续由客户本机执行。

[Role contract](https://github.com/copypasteltd/workmate/blob/backend/catalog/role-preset-catalog.json) · [Skill packages](https://github.com/copypasteltd/workmate/blob/backend/catalog/skill-packages.json)

## 实际界面与交互录制

下列为真实产品界面截图和按墙上时间录制的交互。客户、模型、媒体响应明确使用假数据；所注明的原生 Codex、文件、数据库和账务路径实际运行。假节点画面不代表真实 Linux 远端桌面已验收。

![Actual product UI](assets/screenshots/workmate-dedicated-desktop-06-layout-800-en.png)

![Actual interaction](assets/screenshots/workmate-dedicated-desktop-06-local-cloud-boundary.gif)

[Original MP4](assets/screenshots/workmate-dedicated-desktop-06-local-cloud-boundary.mp4)

## 验证与交付状态

整合后的客户端/工具共 338 项通过：Web 20、Admin 9、Extension 63、Desktop 180、实际本机 Codex 22、Delivery 44，对应类型/构建通过。Desktop、Web/Admin、原生侧栏各有 8 项限定实际 UI 检查，共 29 张截图与 5 组 GIF/MP4。后端完整成功须有最终完整清单回执，检查点记录实际结果并保留失败。

安装原生前置依赖后执行本仓库 `npm run typecheck`、`npm run build` 及测试脚本。Delivery 默认 `npm test` 仅覆盖原生界面完整性，完整单元清单使用 `node --test --test-concurrency=1 tests/*.test.mjs`。`node scripts/qualify-delivered-clients-v1.mjs NN` 在 Delivery 使用新两位编号及并列布局检查完整客户端清单；历史候选专项执行器保留原目录要求。

完整产品验收仍开放：至少十二个专业角色资格、全权限/业务/兼容矩阵、真实服务质量、签名安装更新、生产负载恢复及客户业务接受。以编号清单管理完成条件，不以测试数量推算完成率；使用后清理自建浏览器/进程，保留用户资源。

[Implementation / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/121-dedicated-cloud-and-client-execution.md) · [Checkpoint / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/dedicated-cloud-checkpoint.json) · [Open requirements / 未完成项](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-2026-10-29.md) · [Branch layout / 检出布局](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md)


<!-- document-preview-stage146 -->
## 阶段146：实际文档分页与完整素材选择

无边框Windows客户端增加云端文件分页；本机Codex与完整本机授权保留。

进入文件工作区，搜索获准素材，明确选择固定版本，再预览／翻页／下载或交给角色。Extension点击已上传附件的预览按钮；预览不会发送附件或产生AI任务。19项后端检查、4组真实三端流程通过，9张截图与3组时序GIF／MP4。当前Office预览设置与真实验收为Windows x64，其他服务器平台待验收；生产AI与完整本机Codex／OS验收继续开放。

```mermaid
flowchart LR
  A[Select authorized source] --> B[Choose immutable version]
  B --> C[Check current authority]
  C --> D[Render actual document page]
  D --> E[Recheck authority]
  E --> F[Preview or pass exact reference]
```

[Design / 使用方案](https://github.com/copypasteltd/workmate/blob/docs/docs/development/146-document-pages-and-source-selection.md) · [Original numbered ledger / 原编号清单](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage146.md)

![Actual document preview](assets/screenshots/workmate-document-preview-146-04-office-page-one-en.png)

![Real-time interaction](assets/screenshots/workmate-document-preview-146-04-document-pages.gif)

[Actual MP4 recording](assets/screenshots/workmate-document-preview-146-04-document-pages.mp4)



<!-- functional-closure-stage147 -->
## 阶段147：具名流程与原任务本机准备闭环

无边框本机工作区选择真实目录、授予完整本机权限并运行实际Codex；明确确认独立费用，完成后等待客户交回。

使用顺序：登录并选择项目 → 原云任务请求本机文件 → Desktop选择目录／OS权限 → 核对本机独立费用 → 实际本机Codex执行 → 客户逐个上传并确认固定版本 → 原云任务沿原线程继续。工作流按不可变输入运行，查看完整命名交付；重复运行需分别确认规则及预算。

95项后端、5组实际三端流程、11张截图、5组GIF／MP4通过。内部模型继续使用获准假数据，Windows包未签名；完整专业／生产／OS验收保留。

后端覆盖由相同产品源码的92项既有检查与3项并发复测组成；原测试上下文错误及失败记录保留，不宣称新一次95项完整重跑。

```mermaid
flowchart LR
  A[Original cloud task] --> B[Request local material]
  B --> C[Folder and OS grant]
  C --> D[Review separate fees]
  D --> E[Actual local Codex]
  E --> F[Customer uploads exact files]
  F --> G[Same original cloud thread]
  G --> H[Complete delivery and settlement]
```

[Usage / 使用流程](https://github.com/copypasteltd/workmate/blob/docs/docs/development/147-functional-closure.md) · [Detailed contracts / 详细契约](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/147-workflow-contract-and-local-handoff.md) · [Numbered ledger / 全部编号](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/remaining-work-stage147.md)

![Actual customer flow](assets/screenshots/workmate-functional-closure-147-08-fixed-local-budget-and-full-permission-en.png)

![Recorded interaction](assets/screenshots/workmate-functional-closure-147-08-native-preparation.gif)

[Actual MP4](assets/screenshots/workmate-functional-closure-147-08-native-preparation.mp4)
