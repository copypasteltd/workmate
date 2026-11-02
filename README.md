<!-- native-recheck-192 -->

## 再次复查与错误可见性 · 192

执行列表在原有原因栏内显示本机错误，不增加横向表格列；获准支援视图同步诊断字段，继续执行原有企业、项目和正文权限。

本轮常规回归：后端91、Web30、后台22、扩展89、桌面控制器74；Linux原生8项通过。普通浏览器直连三域名均200，Python脚本直连仍403；不能宣称全产品零错误。12已移出，视频/音频、Google/Meta、Linux Office及完整矩阵等未选范围保留。

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/192-native-error-observability.md) · [复查 / Recheck](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/192-native-recheck.md)

![本机原始原因 / Reported local cause](assets/screenshots/192-admin-local-cause.png)

![实际桌面结果 / Actual Desktop result](assets/screenshots/192-desktop-local-result.png)

![实际云端下载录像 / Actual cloud download recording](assets/screenshots/192-actual-cloud-download.gif)

<!-- selected-repairs-191 -->

## 指定问题修复与本机交付 · 191

已有后台终止证据/预览/最高管理员直接执行策略用于审计释放旧QA容量；未知费用保留。本轮后台产品源码未修改。 02/03/04/05/07取得本轮证据；12按用户要求移出，新的Windows包为未签名手动安装版本。原未知供应商费用和财务预留保留，不把执行容量释放等同结算。

最终Desktop使用安装包默认公司HTTPS地址，经原始CONNECT通道访问真实域名，TLS证书、请求、模型结果及账务未替换；浏览器PKCE同样使用正式HTTPS域名。本次真实闭环通过，但单次验收不等于长期公网稳定性保证，190的01继续保留。 本轮检查：后端40/40、模型网关24/24、Windows云端兼容38/38、Desktop控制器74/74、实际固定Codex断流1/1、Linux原生8/8；真实云任务HK$0.126067、最终Desktop任务HK$0.035144。上述范围独立记录，不称为全产品重新验收；公网及190的其他未选项目继续保留。以下为当前说明，旧版本记录保留作历史。

```mermaid
flowchart LR
 A[Sign in and select workspace] --> B[Cloud Codex: Web and Extension]
 A --> C[Desktop: explicit local permission]
 C --> D[Customer-local Codex]
 B --> E[Company model API and usage]
 D --> E
 B --> F[Native Linux program and browser receipts]
 E --> G[Measured billing and delivery]
 F --> G
```

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/191-native-execution-and-capacity.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/191-selected-repairs.json) · [Desktop0.7.4手动下载 / Manual download](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)

![Actual Desktop result / 实际本机结果](assets/screenshots/191-real-desktop-result.png)

![Actual Web delivery / 实际Web交付](assets/screenshots/191-real-cloud-delivery.png)

Actual Web download recording excerpt; identity labels redacted. 这是Web实际录像节选，不代表其他端的新交互录像。

![Actual Web download](assets/demos/191-actual-cloud-download.gif)

<!-- live-acceptance-189 -->

## 真实生图上线与本轮验收 · 189

`gpt-image-2` 已使用与文字模型相同的上游接口和密钥通过真实生成、编辑验证并发布。实际 Web 设计师任务已生成文件、下载核对散列并计入真实用量。修复1254平方PNG与请求1024不一致的适配，保留上游原始字节；同时移除生图工具对重复全局密钥的错误依赖，并阻止未恢复的生图失败被标成成功。

模型能力中逐模型填写接口、API Key、模型名与费率，再验证和发布。供应商管理的证据表单可选择“仅确认终止”；这只释放已证实停止的并发占用，费用未知时仍保留财务预留。

后端完整运行1950项：1949通过、1失败；该浏览器超时问题随后14/14复验通过。Web28/28、后台20/20、Extension89/89、Desktop269/269及全部构建通过。图片适配48/48、逐模型图片／原图保存与测试发现36/36、真实本机协议下的生图失败／恢复2/2分别通过，不能相加当作新全量结果。

Desktop真实供应商任务、公网稳定性、视频／语音／Google与Meta授权、SMTP及Linux原生执行器仍有验收缺口。测试收件箱按要求保留；不宣称完整应用全部通过。[完整方案、使用逻辑、原始失败与回滚](https://github.com/copypasteltd/workmate/blob/docs/docs/development/189-real-image-and-acceptance.md)。

```mermaid
flowchart LR
 A[Select Designer and budget] --> B[Cloud Codex with design skills]
 B --> C[Company API and frozen model connection]
 C --> D[Decode and verify PNG]
 D --> E[1024 image and exact upstream original]
 E --> F[Authorized download and measured billing]
```

![实际后台证据表单 / Actual Admin evidence form](assets/screenshots/189-admin-termination.png)

下方为实际后台表单切换录像节选。

![实际交互](assets/demos/189-actual-admin-evidence.gif)

<!-- live-acceptance-188 -->

## 真实环境测试与上线 · 188

已部署真实文本服务：Web 与 Chrome 原生右侧 Side Panel 已完成“登录 → 上传获准文件 → 云端 Codex 分析 → 生成文件 → 下载 → 核对实际扣费”。后台完成真实用户／企业新建删除、批量状态管理、模型独立 API/Key 编辑删除、VIP 授予撤销及审计检查。操作与使用边界见[完整报告](https://github.com/copypasteltd/workmate/blob/docs/docs/development/188-live-acceptance.md)。

Desktop 使用本机固定版本 Codex，客户主动选择目录并确认完整本机权限。已修复 GPT 模型的原生 exec 格式兼容，真实本机命令／文件／企业工具桥接通过协议测试；最终真实模型 Desktop 复验受公网连接不稳阻塞，尚不能判定端到端通过。全量后端原始回归为 1,936 项：1,834 通过、101 失败、1 跳过；后续针对修复与现行策略的检查分别记录，不能据此宣称全部通过。

配置和使用：管理员在“模型能力”逐模型填写上游 URL、API Key、模型别名与费率，验证并发布可用版本；用户验证邮箱后选择真实企业与项目，再发起有预算的工作。当前仍使用受保护的测试收件箱。生图实际返回403，视频／语音及 Google／Meta 授权缺失；这些服务尚未取得真实验收。

```mermaid
flowchart LR
 A[邮箱验证 / Email verification] --> B[企业与项目 / Workspace and project]
 B --> C[Web 与 Extension: 云端 Codex]
 B --> D[Desktop: 主动授予本机权限]
 D --> E[客户本机 Codex]
 C --> F[公司服务与逐模型连接]
 E --> F
 F --> G[文件交付、实际用量与审计]
```

![实际 Web 云端交付 / Actual Web cloud delivery](assets/screenshots/188-real-cloud-result.png)

下图为真实 Web 已完成任务的只读浏览与滚动录像节选；不代表所有端均已完成真实模型验收。

![实际 Web 结果交互](assets/demos/188-actual-cloud-result.gif)

<!-- test-mailbox-185 -->

## 测试收件箱验证码修复 · 阶段185

已修复跨星期日期排序与30封限制共同隐藏新验证码的问题。打开[测试收件箱](https://agent-dashboard.copypaste.hk/ops/mailbox/)，使用既有独立收件箱凭证；新邮件置顶，每5秒自动检查，也可手动刷新。过期验证码须重新申请，后台继续要求既有 TOTP。

7项相关回归和6项最终公网检查通过；新验证码约3秒自动出现，并实际完成后台登录。此轮更新静态收件箱页面，保留测试投递模式、既有凭证及服务配置。

```mermaid
flowchart LR
 A[要求验证码] --> B[本地邮件文件]
 B --> C[独立认证收件箱]
 C --> D[按时间排序后取最新30封]
 D --> E[自动显示新验证码]
 E --> F[验证码与TOTP登录]
```

[使用、实现、回滚与验证](https://github.com/copypasteltd/workmate/blob/docs/docs/development/185-test-mailbox.md)

![实际收件箱，敏感内容已遮蔽](https://raw.githubusercontent.com/copypasteltd/workmate/delivery/assets/screenshots/185-test-mailbox-fresh.png)

![实际刷新交互，敏感内容已遮蔽](https://raw.githubusercontent.com/copypasteltd/workmate/delivery/assets/demos/185-test-mailbox.gif)

<!-- admin-directory-lifecycle-184 -->

## 用户／企业新建、删除及批量管理 · 阶段184

用户管理与企业管理已增加新建、逐行永久删除、当页多选、批量状态变更及批量删除。提交绑定原因、明确目标、版本、五分钟预览及幂等键。最高管理员直接执行，其他角色按发布策略审批。新建用户登录时仍须验证邮箱；新建企业同时配置擁有人、账务账户及首个项目。

勾选需要处理的记录，选择动作，填写原因后预览并确认；删除须输入 DELETE 加准确数量并确认保留范围。任一记录变化或不符合条件时整批不执行。删除用户撤销登录并移除联系和显示资料，同时保留共用企业内容及账务／审计引用；删除企业立即停止新操作，后台永久清理进度在内容管理查看。接口上限100条，界面不会隐含选取其他页。

```mermaid
flowchart LR
 A[Directory / 目录] --> B[Create or select / 新建或多选]
 B --> C[Authority and frozen preview / 权限与预览]
 C --> D[Confirm or policy review / 确认或策略审批]
 D --> E[Atomic effects and audit / 原子操作与审计]
 E --> F[Result and cleanup tracking / 结果与清理追踪]
```

[完整使用方案、接口、权限、保留规则及部署说明](https://github.com/copypasteltd/workmate/blob/docs/docs/development/184-admin-directory-lifecycle.md)

13项相关原生检查和10项最终真实页面检查通过。两轮专用页面验证已创建并清理4个用户及4个企业，18项操作均保存对应直接执行审计；4项企业根清理已完成，实际异常数组为空，必要保留项有记录。服务器配置、模型 API/Key 和未知费用预留保持原样。

![实际页面 / Actual page](assets/screenshots/184-create-user-preview-d9ef4972-6bc4-49ef-ba30-3632d9df500e.png)

![实际页面 / Actual page](assets/screenshots/184-workspaces-delete-preview-d9ef4972-6bc4-49ef-ba30-3632d9df500e.png)

![实际页面 / Actual page](assets/screenshots/184-cleanup-journal-d9ef4972-6bc4-49ef-ba30-3632d9df500e.png)

![真实交互 / Actual interaction](assets/demos/184-admin-directory-lifecycle.gif)

[完整录屏 / Full recording](assets/demos/184-admin-directory-lifecycle.mp4)

<!-- highest-admin-direct-182 -->

## 最高管理员直接执行 · 阶段182

有效的全局内置 super_admin 可直接执行管理变更；其他角色按业务策略审批，不能审批自己的受控申请。敏感操作继续核对 MFA、业务权限、范围、限额和原始证据，真实操作者、原因、命令摘要及结果与业务效果一并保存审计。

当前 gpt-6-luna 已通过真实后台直接发布：操作 `7d32d69d-5680-4199-bd04-1ebe2b1b4813`、审计 `7174`，未生成待审批申请。18项相关检查、6项真实页面检查通过。原模型配置、加密 Key、未知费用预留及旧违规记录保持原样。追加迁移160须搭配对应 API。

[设计、使用和逻辑图 / Design, usage and diagram](https://github.com/copypasteltd/workmate/blob/docs/docs/development/182-highest-admin-direct.md)

![直接执行预览 / Direct preview](assets/screenshots/182-direct-preview-da96f233-de89-4fb5-94ec-55fe3777a842.png)

![实际审计 / Actual audit](assets/screenshots/182-direct-audit-da96f233-de89-4fb5-94ec-55fe3777a842.png)

![实际交互 / Actual interaction](assets/demos/182-highest-admin-direct.gif)

[交互录像 / Interaction recording](assets/demos/182-highest-admin-direct.mp4)

# Workmate · admin

<!-- model-tool-contract-181 -->
## Codex 完整模型验证修复 · 阶段181

当前保存的 **gpt-6-luna** 已在正式后台通过完整验证：固定 Codex、指定模型与推理强度、注册工具调用及结果返回、最终文字回复、用量记录均完成。保留每模型接口和 Key，兼容普通 function 与原生 code mode 工具格式，并继续执行原业务权限检查。

实际回执 `b8c8c28a-1df1-4ef7-af55-91d9d51b4bcc`；输入／输出 tokens 为 `20230/139`。旧待对账记录保留。未自定义发布的初始策略中，管理员／验证总名额由2调整为4，保留旧占位2个并恢复可用名额2个；费用上限及其他限制不变。原生工具上下文按完整请求字节预留输入额度，再按实际 tokens 结算；输入、输出或费用超额仍会拦截。

Open Model capabilities → Configuration & validation → Test connection → Run validation. Text retries create separately budgeted receipts. The panel explains specific tool/protocol/capacity failures.

[Implementation, workflow and evidence / 方案、逻辑图与回执](https://github.com/copypasteltd/workmate/blob/docs/docs/development/181-model-tool-contract.md)

![Actual full Codex validation](assets/screenshots/181-codex-validation-passed-03f66d6b-a57b-4554-a7ab-1dca62712999.png)

![Actual Admin interaction recording](assets/demos/181-model-tool-contract.gif)

Earlier records follow. 以下为历史记录。

---

<!-- model-http-180 -->
## 模型接口支持 HTTP 和 HTTPS · 阶段180

每模型 API 基础地址支持 **HTTP 和 HTTPS**；公网上游使用 HTTP 无须勾选内网选项。保存、连接测试、Codex 完整能力验证及推理使用同一传输规则。原模型地址及加密 Key 保留。

已在正式后台使用当前 gpt-6-luna 配置进行连接测试，接口及 Key 认证成功，返回列表包含该模型。这是实际连接结果，不代替 Codex 完整能力验证，也不自动发布模型。

Build: `npm run build`. The per-model normalizer and shared transport support both schemes. Private address access still uses its explicit setting; the Admin label reflects this meaning.

[Usage and implementation / 使用与开发](https://github.com/copypasteltd/workmate/blob/docs/docs/development/180-model-http.md)

![Actual HTTP model connection](assets/screenshots/180-http-model-connected-f49d8316-fe59-4bea-beca-07a1668315f1.png)

![Actual connection test recording](assets/demos/180-model-http.gif)

Earlier records follow. 以下为历史记录。

---

<!-- model-management-179 -->
## 已有模型可直接编辑和删除 · 阶段179

打开 [模型能力](https://agent-dashboard.copypaste.hk/catalog?view=capabilities)，当前模型的列表和详情均有 **编辑模型**、**删除模型**。编辑表单预填模型、接口和费率，API Key 输入框可直接输入新 Key。同地址／网络范围可保留已保存 Key，更换范围则需填新 Key。

**保存更改**后，当前列表直接显示更新后的同一模型条目；完成验证、发布后供新工作使用。**删除模型 → 确认删除** 后移出可用目录，拦截新代理和新顶层任务选择，也不会回退到演示模型。旧任务、账务及加密连接保留；列表可切换当前模型、配置历史、已删除模型。

The key field is enabled for saved configurations; typing a replacement automatically deselects retained-key mode. Changing the address/network requires a new key. Save/delete commands use the current revision and report stale edits instead of overwriting newer settings. Historical/deleted model definitions expose no Edit/Delete actions. Build: `npm run build`.

```mermaid
flowchart LR
 E[Edit existing model] --> C[Same model entry, updated configuration]
 C --> V[Validate and publish for new work]
 D[Confirm deletion] --> X[Remove future availability]
 C --> H[Preserve original task and billing bindings]
 X --> H
```

[Usage and implementation / 使用细则](https://github.com/copypasteltd/workmate/blob/docs/docs/development/179-model-management.md)

![Actual editing of an existing model](assets/screenshots/179-edit-model-087bfaac-ff46-480c-ae08-dc1b2aea04ea.png)

![Actual save and deletion](assets/demos/179-model-management.gif)

Earlier implementation and deployment records follow. 以下为原有版本记录。

---

<!-- per-model-connections-178 -->
## 每个模型独立配置上游 · 阶段178

进入 [Admin → 模型能力](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) → **建立配置**，在同一表单填写 `gpt-6-luna`（或上游实际模型别名）、**API Base URL** 和 **API Key**。每个模型独立保存地址及密钥，文字模型须支持 OpenAI Responses API。

使用流程：保存草稿 → 测试连接 → 完整能力验证 → 独立审批发布 → 在角色／模板中绑定已发布能力。连接测试读取 `/models`，保存和测试不会自动发布。完整验证和真实使用会消耗实际上游额度，当前试用记账环境也一样。

密钥由服务器加密保存且不回显；新版本保留原任务冻结的连接。复制版本可明确保留原密钥，更换地址或网络范围必须重新填写。缺少明确连接时直接报错。本轮没有代填真实供应商密钥。

The same upstream fields appear for text, image, video, speech and transcription profiles. New configurations require an explicit URL/key. Detail views show only the URL and configured-key status. Copying a version supports explicit key retention with the same normalized URL/network scope. Build: `npm run build`; focused form checks: `node --import tsx --test tests/model-connection-178-v1.test.ts`.

```mermaid
flowchart LR
 A[Model, URL and API Key] --> D[Immutable model configuration]
 D --> C[Connection check]
 C --> V[Validation and independent publication]
 V --> T[Task freezes model version]
 T --> G[Company gateway]
 G --> U[That model upstream]
```

[使用细则 / Usage and operations](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/model-connections-178.md) · [Source/runtime increment](https://agent.copypaste.hk/downloads/workmate-model-configuration-178.zip)

![Actual model form](assets/screenshots/178-model-form-cdb03034-7f0f-4f3b-b68c-da666853b1c2.png)

![Actual save and connection test](assets/demos/178-model-connections.gif)

Earlier deployment/release records follow; their synthetic-service descriptions describe their original scope. 以下历史记录保留原部署范围。

---

<!-- public-domains-177 -->
## 正式域名试用部署 · 阶段177

[Web](https://agent.copypaste.hk) · [Admin](https://agent-dashboard.copypaste.hk) · [API readiness](https://ai-api.copypaste.hk/health/ready)

后台独立邮箱验证码及 TOTP 登录；管理用户、用量、费用、VIP/权益、内容、审批与审计。

Independent email OTP and TOTP: manage users, usage, charges, VIP/entitlements, content, approvals and audits.

[Current deployment, login and operations / 当前部署、登录与运维](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/domains-177.md)

Credentials are unchanged: server `/root/cfg/workmate/credentials.txt`, root `0600`. Admin: `admin@workmate.local` + email OTP + TOTP. Test mailbox: [protected operator inbox](https://agent-dashboard.copypaste.hk/ops/mailbox/). AI/media/ads/payment remain synthetic; records/files persist. 凭据保留，测试收件箱使用独立操作口令，外部服务仍为假数据。

[Desktop 0.7.2 Setup](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Setup.exe) · [Portable](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Portable.exe) · [Extension 0.5.3 ZIP](https://agent.copypaste.hk/downloads/CopyPaste-Extension-0.5.3.zip) · [Source increment / 源码增量](https://agent.copypaste.hk/downloads/workmate-domains-177.zip)

Windows installers are unsigned. Extract the Extension ZIP and load it unpacked in Chrome developer mode; the extension ID stays `fffkcnmfdhahlnifgdilabheppkgnlok`. Desktop AI access uses company services; supplier keys are not embedded. Windows 未签名，扩展采用已解压加载，固定 ID 不变。

```mermaid
flowchart LR
 W[Web HTTPS] --> P[Same-origin API proxy]
 A[Admin HTTPS and MFA] --> P
 N[Desktop / Extension] --> I[Company API HTTPS]
 P --> B[Isolated backend and database]
 I --> B
 N --> L[Local Codex / approved file upload]
```

![Public Admin users](assets/screenshots/177b-domain-users.png)

![Actual Admin interaction](assets/demos/177-public-domains.gif)

[MP4 recording](assets/demos/177-public-domains.mp4)

---

Earlier releases and deployment history / 以下为历史版本及部署记录。

<!-- lan-deployment-176 -->
## 内网 HTTP 部署 · 阶段176

Web: http://192.168.31.20:63070 · Admin: http://192.168.31.20:63071 · API: http://192.168.31.20:63072

独立邮箱验证码及 TOTP；用户、用量、费用、VIP 和内容管理页面已在内网检查。

服务器明文凭据：`/root/cfg/workmate/credentials.txt`（root `0600`）。邮箱验证码通过受独立口令保护的测试收件箱读取；Admin 另需验证器 TOTP。外部服务继续使用已授权假数据。

[部署、登录与运维 / Deployment and login guide](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/lan-176.md)

![Actual LAN HTTP page](assets/screenshots/176e-lan-users.png)

![Actual post-login interaction](assets/demos/176-lan-http.gif)

[实际操作录像 / Actual recording](assets/demos/176-lan-http.mp4)


## v0.1.3 · 当前完整交付 / Current complete delivery

[Release / 下载](https://github.com/copypasteltd/workmate/releases/tag/v0.1.3) · [中英使用手册 / Bilingual guide](https://github.com/copypasteltd/workmate/blob/v0.1.3/docs/releases/v0.1.3.md)

本轮完整包包含六仓源码和全部端，纳入团队/单次运行费用报表、原成员/协调员账目、交叉筛选和同快照CSV。当前源码与假数据冻结交付按使用者要求收口；服务器资料和正式服务接入后续提供。AI/媒体/广告/支付使用假数据，Windows未签名；完整专业/生产台账保持。

All six source trees/clients are delivered, including team/run financial reports, original member/coordinator entries, intersecting filters and matching snapshot CSV. This current source/synthetic frozen delivery closes as requested; server/live configuration follows later. External services are synthetic and Windows is unsigned. Full professional/production qualification remains tracked.


## 團隊費用 / Team consumption · stage174

團隊及執行ID交叉篩選，成員與協調員實際帳目只加總一次；固定快照明細／CSV保留原身份，舊來源不推斷。Team/run filters and groups sum original work entries once, with immutable detail/CSV and explicit unknown legacy attribution. 21 native report cases and seven current actual Admin journeys; original failed capture retained. Final freeze rebuilds Admin for current CSS.

```mermaid
flowchart LR
 T[Team] --> R[Individual run]
 R --> M[Member / coordinator works]
 M --> L[Original charges and refunds]
 L --> S[Scoped financial snapshot]
 S --> C[Detail and matching CSV]
```

![實際團隊費用 / Actual team consumption](assets/screenshots/workmate-admin-team-usage-174-03-team-02-single-run.png)

![實際操作 / Actual interaction](assets/screenshots/workmate-admin-team-usage-174-03-team-consumption-workflow.gif)

[MP4](assets/screenshots/workmate-admin-team-usage-174-03-team-consumption-workflow.mp4)


## 当前完整冻结交付 · v0.1.2

全部端、六仓源码与本次费用入账期间报表统一纳入完整下载包。Desktop在本机运行Codex且支持客户主动授予完整本机权限；Extension使用原生右侧Side Panel，获准读取/上传文件后由云端Codex执行。数据库156；外部AI/媒体/广告/支付采用已授权假数据，Windows未签名。

[完整下载 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.2) · [安装、登录和使用 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.2/docs/releases/v0.1.2.md)

本轮重新构建Backend/Admin；其余运行产物及Windows分发核对后复用。继承源码一致的阶段172定向验证，阶段173不重跑功能测试。Backend/Admin rebuilt; unchanged runtimes/Windows distributions verified and reused. Exact-source stage172 focused checks inherited; no functional tests rerun at173. Older entries below retain their historical scope.


## 当前源码增量 · 阶段172

Admin新增工作建立／费用入账两种期间。旧任务本期扣费、跨期香港日期、区间外原扣费的退款及负净消耗可查询；分组、明细和CSV共用一份固定快照。预留额度与累积操作用量另行说明。当前源码需配套Backend/Admin，数据库仍为156。此增量不在已冻结v0.1.1 ZIP内；原包与标签保持。

本轮新增8项原生SQL/API＋1项精确投影检查；6项原报表检查在源码一致时继承其实际通过结果；7组实际Admin操作通过。首次历史测试资料缺少资金来源而被约束拒绝，已以新版本补齐来源与资金变动；失败原记录保留，未关闭保护。全部原完整验收范围继续跟踪。

```mermaid
flowchart LR
 A[Admin MFA] --> B[Creation or posting period]
 B --> C[Scoped fixed snapshot]
 C --> D[Hong Kong day entries]
 D --> E[Same summary and detail]
 D --> F[Authorized CSV]
```

![Posting-period report](assets/screenshots/workmate-admin-posting-period-172-01-posting-01-period-summary.png)

![Actual interaction](assets/screenshots/workmate-admin-posting-period-172-01-posting-period-workflow.gif)

[MP4](assets/screenshots/workmate-admin-posting-period-172-01-posting-period-workflow.mp4) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/172-admin-posting-period.md)

## 冻结交付 v0.1.1

完整包统一包含Windows Desktop（本机Codex、无边框）、Web、独立Admin、Chrome右侧Side Panel、Backend、六仓源码和固定runtime。假数据模式，Windows未签名；当前数据库156。

[完整发行包 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装及流程 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.1/docs/releases/v0.1.1.md)

## 当前源码增量 · 阶段169

用户消耗报表支持付款方／项目／时间等筛选、八类分组、任务账务明细和同快照CSV。金额、预留、退款、待对账和未知内部成本分开；当前范围、MFA、导出权限逐次复查。当前库版本156。旧v0.1.0包未改；本增量纳入下一完整冻结包。

```mermaid
flowchart LR
 A[Admin MFA] --> S[Scoped filters]
 S --> R[Encrypted fixed snapshot]
 R --> D[Groups / work / ledger]
 R --> E[Authorized CSV]
```

![Consumption report](assets/screenshots/workmate-admin-usage-report-169-02-usage-01-snapshot-summary.png)

![Actual interaction](assets/screenshots/workmate-admin-usage-report-169-02-consumption-report-workflow.gif)

[MP4](assets/screenshots/workmate-admin-usage-report-169-02-consumption-report-workflow.mp4) · [方案 / Behavior](https://github.com/copypasteltd/workmate/blob/docs/docs/development/169-admin-usage-reports.md)


[English](README.en.md) · [完整Release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [中英安装使用](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/releases/v0.1.0.md)

面向香港企业的 Codex Agent 平台，首批服务既有 marketing 团队，覆盖设计/媒体、广告与网站/SEO/GEO分析、重复流程和软件开发。本仓库为独立 **admin** 端，使用 **React / independent MFA / RBAC**。视觉遵循 CopyPaste 的暖白底、深色文字、品牌色和编辑式排版。

## 当前源码增量 · 阶段168

用户列表可组合注册/最近账户访问、来源、VIP方案/状态/到期、确认扣费、角色建立/开始、待对账和独立账户额度条件。刷新、详情及返回保留URL条件。最近访问包含合法设备后台轮询，不等于真人在线；历史来源和访问保持未知。金额以精确微港币保存，只统计确认扣费；个人/企业资金不合并，未知或不一致账务不当作零。

当前增量需数据库001–156及匹配API/Worker：停止旧服务，备份后迁移，再启动新服务。默认目录DTO兼容；显式view=operations增加来源及访问字段。费用、VIP、账务各需独立当前范围权限及近期MFA，目录读取不写账。

此项是v0.1.0之后的源码更新，**不在原冻结ZIP内**。原发行标签及资产保持不变。当前Backend/Admin构建、8项原生SQL/API和6组实际Admin页面检查通过；保留测试数据与页面定位的原始失败尝试。业务仍使用已授权假数据，完整验收范围继续跟踪。

```mermaid
flowchart LR
 A[Admin OTP and TOTP] --> F[URL filters]
 F --> S[Current user and field scopes]
 S --> E[Same grant / exact charges / separate wallet]
 E --> U[Matching users]
 U --> D[User detail]
 D --> F
```

![Directory result](assets/screenshots/workmate-admin-directory-filters-168-03-filters-02-confirmed-result.png)

![Actual interaction](assets/screenshots/workmate-admin-directory-filters-168-03-directory-filter-workflow.gif)

[MP4](assets/screenshots/workmate-admin-directory-filters-168-03-directory-filter-workflow.mp4) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/168-admin-directory-operational-filters.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-directory-filters-168.json)

## 本版用户任务与内容 · 阶段166

用户详情直接进入该用户的任务与内容。搜索、分页和刷新保留目标，返回恢复原目录条件；换用户清空旧正文和操作。当前用户范围与资源范围同时鉴权，正文/下载保持独立权限与近期MFA。二十类内容按实际创建者归属，品牌保留首版作者；未知作者旧资料在全站目录查看。记录按资源类型计算，同名文件资产及目录项具有独立身份。

该功能已纳入v0.1.0源码与分发包；旧rc.5包和标签保持原样。本轮后端/Admin构建、八项原生SQL/API及八组实际页面检查通过，原始定位失败和录制均保留。外部服务仍用已授权假数据，原完整验收范围继续跟踪。

```mermaid
flowchart LR
 U[用户详情] --> T[该用户任务]
 U --> C[该用户内容]
 T --> P[当前用户与资源权限交集]
 C --> P
 P --> S[搜索/分页/刷新保留目标]
 S --> U
 C --> B[独立正文与管理权限]
```

![用户任务](assets/screenshots/workmate-admin-user-resources-166-02-user-resources-02-selected-user-tasks.png)

![用户内容](assets/screenshots/workmate-admin-user-resources-166-02-user-resources-04-original-user-content.png)

![真实交互](assets/screenshots/workmate-admin-user-resources-166-02-user-task-content-scope.gif)

[MP4](assets/screenshots/workmate-admin-user-resources-166-02-user-task-content-scope.mp4) · [Logic / 逻辑](https://github.com/copypasteltd/workmate/blob/docs/docs/development/166-admin-user-resource-context.md) · [Evidence / 回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-user-resources-166.json)

## 当前冻结版 · v0.1.0

本版统一交付所有端、后端和六仓源码，包含最新用户任务/内容入口。六仓重新构建；当前Desktop输出与已验收Windows完整目录/Portable/Setup逐文件一致，核对后复用。近期阶段166八项SQL/API与八组实际页面检查保留其源码及原始证据；本轮不重跑全部历史用例。

分支`admin`，本版固定标签`v0.1.0-admin`。[完整源码与安装包](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [冻结记录](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/release-freeze-checkpoint-167.json) · [待办](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/remaining-work-stage167.md)。AI/媒体/广告/支付为已授权假数据；Windows未签名。截图/GIF/MP4保留其原实际采集范围，不宣称新增全端安装或专业质量验收。

## 方案与结构

主要入口：`src/main.tsx, src/directory.tsx, src/fees.tsx, src/vip.tsx`。Codex 是唯一 Agent 内核，全部模型请求经公司内部 OpenAI 兼容 API，供应商密钥仅留在后端。专业模板固定 Skill、工具和配置版本；设计师组合为 Codex＋设计 Skill＋公司 Image 2。

Web 访问云端 Agent。Extension 使用 Chrome MV3 原生右侧 Side Panel，提供对话/附件界面，只读取客户选择的文件并经同意上传，由云端执行。Desktop 无边框、无 Electron 默认菜单，在客户本机运行 Codex，客户可主动授予完整本机权限，支持停止/撤权及账户、目录隔离。

Admin 独立邮箱验证码＋TOTP，按权限管理用户/企业、消耗与费用、VIP、角色/Skill和内容。用户详情传递真实用户ID；费用账户按主体筛选，VIP锁定目标，换用户销毁旧弹窗及预览。港币金额按微单位保存；预算、余额、实收、赠额、授信和VIP分开记录。人工变更先预览、再确认，保留当前权限/MFA/策略/审批、幂等和审计。

```mermaid
flowchart LR
 W[Web and Chrome Side Panel] --> A[Company API, identity and metering]
 A --> C[Cloud Codex and versioned Skills]
 D[Frameless Desktop] --> L[Customer-local Codex]
 L --> A
 A --> G[Company OpenAI-compatible gateway]
 M[Independent Admin MFA] --> A
 C --> R[Review, revise and download]
 L --> R
```

## 安装与运行

六个独立仓库并列置于 `dev/`：`copypaste-platform`、`copypaste-web`、`copypaste-admin`、`copypaste-desktop`、`copypaste-extension`、`copypaste-delivery`。使用 Windows x64、Node.js 22.14+、Git及原生PostgreSQL；媒体工作需FFmpeg/FFprobe，固定Codex随runtime分发。禁止Docker/WSL及虚拟化。

完整启动以Release指南为准。首次写配置前选空闲数据库端口，从Delivery依次运行 `demo:preflight` → `bootstrap:demo` → `demo:check` → `demo`。保留已有配置和数据；结束执行Delivery的 `npm run stop`。

本仓库单独开发，先准备对应依赖及配套后端：

```powershell
npm ci
npm run dev
```

API为localhost4310，Web4317，Admin4318。开发验证码位于platform `.data/mailbox/`。管理员需在platform执行 `npm run admin:create -- admin@example.com super_admin` 并按一次性资料绑定TOTP。Desktop通过浏览器PKCE登录后选择本机目录和权限；Chrome使用“加载已解压的扩展程序”，点击图标打开侧栏。

## 使用逻辑

1. 邮箱登录，接受邀请或创建企业及首项目。创建结果未确认时保留原请求；断线/刷新后点“确认并继续”恢复原结果。失效/删除回执不会悄悄新建企业。
2. 选择项目和角色，填写brief、文件/品牌/账户、预算和授权。必要资料在原任务补齐；执行固定当时接受的配置与Skill版本。
3. 查看持久进度、审批、成果版本、费用和用量，审阅后下载原文件或继续修改。未知费用保持待核对，不按免费处理或盲目重跑。
4. Admin从用户详情开费用/VIP，核对主体和预览后按策略确认。目录筛选支持刷新/返回恢复。当前分支已接通按实际创建者筛选的任务和内容入口，返回保留原目录条件。

## 配置与权限

Web/Admin使用 `VITE_API_BASE` 或同源代理；原生端构建时固定允许来源及扩展ID，回环开发外使用HTTPS。SQL增量历史001–155，API/Worker检查版本及环境身份。源码不带密钥、`.env`、用户数据库、依赖或Git元数据。

会话失效清除旧工作台，迟到结果不能覆盖新登录。文件默认私有；请求、任务领取、工具和下载重新核验当前权限。历史回执不保留已撤销访问权。显式退出清除工作区创建草稿中的名称，仅保留原账户可核对的无正文请求标识。

## 角色预设与Skill

目录定义18个专业预设；数量不代表十二个角色已全部通过专业验收。

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



## 实际截图与交互

以下为本次真实Web/SQL恢复和Admin MFA/目标验证的共享媒体，使用合成客户与业务数据；不表示其他原生端重新完成安装验收。

![原工作区恢复](assets/screenshots/workmate-functional-closure-165-01-original-workspace-recovered.png)

![实际断线恢复](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.gif)

[实际MP4](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.mp4)

## rc.5 冻结基线的验证与发布

以下为历史rc.5记录：当时运行七项定向SQL、四项创建草稿检查和实际Web/Admin操作，重建六仓与Windows unpacked/Portable/Setup，核对ASAR和固定Codex。按要求跳过完整重复回归，实际结果以冻结检查点为准。

分支 `admin`，固定标签 `v0.1.0-rc.5-admin`。后续更新同步分支和更新说明，冻结包及标签保持。外部AI/媒体/广告/支付使用已授权假数据，Windows未签名。102个原编号及88项必选完整验收范围保留，88不是未实现模块数。真实服务、签名更新、多平台与完整专业验收继续跟踪。

[检查点](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/release-freeze-checkpoint-165.json) · [完整编号台账](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/remaining-work-stage165.md) · [旧README快照](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/history/readme-before-rc5/admin-zh.md)

## 本端界面与录制 / Component interface and recording

本次实际Admin交互，预览不确认发放。Current actual Admin preview; no credit/VIP confirmation.

![Component UI](assets/screenshots/workmate-functional-closure-165-01-admin-target-01-readonly-vip-subject.png)

![Actual interaction](assets/screenshots/workmate-functional-closure-165-01-selected-user-vip-fee-previews.gif)

[MP4](assets/screenshots/workmate-functional-closure-165-01-selected-user-vip-fee-previews.mp4)
