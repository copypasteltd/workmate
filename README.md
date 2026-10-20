# CopyPaste Web

[English](README.en.md) · 企业云端工作台 · 0.5.0

面向在港企业 marketing 团队的 Web 客户端，采用 CopyPaste 暖灰白、深墨、亮蓝与衬线标题。繁体中文/英文、浅色/深色/系统主题。客户创意继续使用客户品牌。本仓库可单独安装和构建，服务数据来自独立 platform API。

![首页](assets/screenshots/01-landing.png)

## 启动与构建

Node.js 22.14+。先按 platform 仓库说明启动数据库/API，再执行：

```powershell
npm ci
npm run dev
```

打开 `http://localhost:4317`。开发服务器将 `/v1` 与 `/health` 代理到 `127.0.0.1:4310`。所有命令原生执行，禁止 Docker、WSL 和虚拟化环境。

```powershell
npm run typecheck
npm run build
npm run preview
```

`dist/` 是静态部署产物。推荐在客户 Web 域名上反向代理 `/v1` 至平台，使用 HTTPS；SPA 路由回退到 `index.html`，API 请求不回退 HTML。`.env.example` 的 `VITE_API_BASE` 可在构建时设置 API origin，默认留空使用同源。跨域时精确配置平台 `WEB_ORIGIN` 与 Cookie/CORS，不用通配 Origin。`VITE_*` 会公开到浏览器，绝不能放 AI key。

## 完整用户主线

```mermaid
flowchart LR
  L[官网式入口] --> A[邮箱验证码]
  A --> W[企业与首个项目]
  W --> H[工作台]
  H --> R[18 个角色 / 专属专家]
  R --> C[私密会话 / 范围记忆]
  C --> T[问答、计划或执行 / 预算]
  T --> X[平台执行 / 事件 / 取消]
  X --> O[成果、版本、下载]
  H --> M[素材、品牌、广告数据]
  H --> F[审批流程与本地设备]
  H --> U[权益、消耗与成员设置]
```

首次用户输入工作邮箱并验证，创建企业与首个项目后进入工作台。返回用户直接选择已有工作区/项目。邀请链接绑定邮箱与项目；没有所属企业时回到初始化。验证码无效、过期、限流、会话失效、资源不可见及模型未配置均显示服务端错误，不生成占位结果。

开发模式验证码只写在 platform 的 `.data/mailbox/`，需本机读取；正式环境经真实 SMTP。没有默认用户账号。Desktop/扩展授权页面同样复用邮箱身份，但通过独立 PKCE 授权，不把浏览器 Cookie 转成 bearer token。

## 页面与功能

| 页面      | 实际能力                                                            |
| --------- | ------------------------------------------------------------------- |
| 工作台    | 项目切换、角色入口、近期任务、发布的帮助/公告、服务状态             |
| 角色      | 18 个预设及其 Skill、输入/交付说明、真实可用性                      |
| 项目/任务 | 创建项目、提交任务预算、状态/事件/成果、取消                        |
| 创意      | 文本/色块/固定版本 PNG 的图层 JSON、修改版本、SVG/PNG/模板 MP4 导出 |
| 资产      | 主动文件上传、缩略图、不可变历史版本、下载、重命名、限时分享/撤销   |
| 营销分析  | CSV 导入、精确聚合指标、数据详情、提交 HTML 做 SEO 审核             |
| 工作流    | 数据汇总、Codex、人工审批的有界流程，发布/运行/审批                 |
| 品牌      | 项目品牌色、语气、字体与批准文案                                    |
| 成员      | 邀请、企业角色、项目范围、编辑/移除、最后 owner 保护                |
| 连接器    | Google Ads / GA4 / Search Console / Meta 授权和明确账户报表同步     |
| 设备      | 已配对设备、限时目录 grant、明确本地操作排程和结果                  |
| 用量/设置 | 独立钱包、真实生效套餐与限额、任务消耗、个人语言/主题/名称          |

![营销工作台](assets/screenshots/03-workspace.png)
![资产与版本](assets/screenshots/03-assets.png)
![营销分析深色主题](assets/screenshots/04-analytics-dark.png)

## 专属专家与私密工作

从预设角色创建专属专家，设置职责、品牌和工具范围，再开始私密会话。专家修改产生新版本，已有会话可明确采纳更新。笔记不调用 AI；问答和计划只使用读取工具，执行模式才生成交付物。计划转执行须明确批准，并重新验证上下文和预算。

会话支持检索、置顶、改名、归档/恢复及带版本的删除。私密消息、任务、成果仅所属用户可见；发布成果会建立明确的项目共享副本。记忆支持企业、品牌、项目、会话和个人五种范围、内容版本及到期时间。个人/会话记忆保持私密；删除需要确认，有在途任务时须先完成或取消并结算。

390px 移动布局和深色主题经过真实浏览器检查；移动侧栏收起后退出键盘焦点顺序。所有权限与费用由平台在请求时验证。

![专属专家](assets/screenshots/06-persistent-specialists.png)
![私密会话](assets/screenshots/07-private-conversation.png)
![记忆偏好](assets/screenshots/08-memory-preferences.png)
![深色私密会话](assets/screenshots/10-conversation-dark.png)

## 产品规则

后端是权限与费用的权威来源；隐藏按钮不是授权边界。钱包和 VIP 分别显示；个人/企业 VIP 按实际时间生效。没有配置公司 AI 网关时，角色明确不可执行；18 个已安装角色不等于 18 个已通过真实业务验收的角色。

AI 请求全部由平台转发公司内部服务器，本端没有模型 key。浏览器不能无授权扫描本地磁盘：小文件使用明确选择器，持续目录工作需安装 Desktop 原生桥接并逐目录授权。

`src/api.ts` 在 Web 使用带凭证请求和 CSRF，在 Desktop 快照中使用窄 IPC；不在 localStorage 存会话/AI key，仅保存语言与主题。React 文本渲染展示帮助/公告，不执行后台注入 HTML。

## 验证与维护

`npm test` 执行类型检查；真实身份与页面旅程由 delivery 的 `npm run qa:web` 与 `npm run qa:persistent` 执行，截图来自实际 UI 和 PostgreSQL 开发数据，不是设计稿。覆盖首次登录/初始化、13 个工作区模块、16 个 Admin 页面、浅深主题和移动视口。截图 fixture 使用虚构企业和 `.invalid` 邮箱。

`src/main.tsx` 管理路由与页面，`context.tsx` 管理登录/企业/语言/主题上下文，`api.ts` 封装网络和 Desktop 桥接，`native-files.tsx` 提供原生文件面板，`ui.tsx` 与 `style.css` 提供本仓库独立 UI 基础。Desktop 使用显式快照同步，不在构建时偷偷读取相邻源码。

## 本次边界

公司网关、SMTP、广告 OAuth 和 S3 的真实配置与联调仍需部署环境提供。SAML/SCIM、强制 SSO、事件触发、多人并行 Agent、协同编辑及完整 AI 视频/语音尚未实现。数据轮询不等于规划中的完整 SSE。浏览器只提供有限 HTML SEO 检查，不承诺 GEO 排名提升。

界面自托管 Manrope/Fraunces 字体，图标为 Lucide，首页蓝色纸带素材通过用户指定的 sub2-image-gen 生成，品牌来自 copypaste.hk。参见 [素材与依赖说明](THIRD_PARTY_NOTICES.md)。主设计/需求文档在交付根目录 `docs/`。

## 云端定时工作

0.4.0 在工作流页增加每日/每周计划：选择已发布流程、IANA 时区、星期和漏跑规则，预览本地/UTC 时刻及每次预算后明确授权。关闭页面后由服务端执行，保留配置版本与触发结果。每计划只允许一个未完成运行；审批或费用待对账时不会叠加收费任务。

支持修改、暂停、重新授权恢复和退役；暂停保留当前工作，运行历史另有取消按钮。修改只影响未来，暂停区间不补跑。结束时间排他，夏令时跳空略过、重复时刻只执行第一次。规则由平台校验，界面见 `src/schedules.tsx`；Delivery `qa:schedules` 验证真实时钟、页面关闭后的执行及移动操作。

![真实云端定时工作流](assets/screenshots/15-cloud-schedules.png)

## 0.5.0 企业身份与统一登录

OIDC 使用 code + PKCE S256、签章、state/nonce 与固定回调。先有注册账号及有效企业成员资格，再绑定企业身份；首次绑定需要独立的 CopyPaste 工作邮箱确认码，不按网域自动开户。配置改变、停用或本人解除连接会撤销关联用户的全部 CopyPaste Web/native/refresh 会话和旧执行授权。管理员登录仍独立使用邮箱与 TOTP。

`/login` 增加企业身份入口，`/sso` 输入企业登入代号与工作邮箱，`/sso/confirm` 完成首次邮箱确认。账号设置显示本人连接并明确确认解除后登出全部装置。原生端 `/authorize` 的回调及 PKCE 参数跨企业身份流程保留，最后仍需用户点击授权。

```mermaid
flowchart LR
  Member[已有企业成员] --> IdP[签名 OIDC 与 PKCE]
  IdP --> Proof[首次独立邮箱确认]
  Proof --> Web[CopyPaste 会话]
  Web --> Native[明确原生授权与 PKCE]
  Revoke[停用或解除连接] --> All[浏览器与原生凭证撤销]
```

![实际企业身份界面](assets/screenshots/17-company-sign-in.png)

## 当前修复中的文件与执行流程

演示环境有持续显示的假数据提示和企业 Owner 的一次性模拟额度。上传支持分片摘要、整文件 SHA-256、暂停、取消、断线及刷新后续传；普通文件 100 MiB，媒体 1 GiB。素材显示 90 天默认保留及到期时间，永久删除须确认并可查询实际清理结果。任务页通过持久 SSE 实时更新，重连按序号去重；私有权限与会话撤销在服务端重新检查。

这些是当前未重新打包的源码增量；完整 1 GiB 实传、所有端和 S3 验收仍需继续执行。实际 API/浏览器测试与待办以主文档的全体系修复记录为准。

![断线后保留分片](assets/screenshots/19-upload-interrupted.png)
![刷新后的续传完成](assets/screenshots/20-upload-resumed.png)
![永久删除进度](assets/screenshots/17-erasure-progress.png)
![真实 Codex 与明确模拟数据的实时任务](assets/screenshots/21-live-task-events.png)

## 云端档案（当前源码）

新增共享项目与私人会话文件工作区，支持搜索、文件夹、指定素材版本、编辑移动、文本/小型位图预览、授权下载、确认发布副本及目录条目移除。会话内上传自动保持私人范围，编程角色的工作源码可在后续任务继续。

`npm run qa:cloud-files` 在集成仓库执行。四组浏览器验收覆盖上述流程、两次真实 Codex 模拟任务、四种屏宽、深色与繁中；接口样本另做严格 schema 检查。未执行真实公司模型质量或所有格式预览验收。

![固定版本预览](assets/screenshots/22-cloud-pinned-preview.png)
![持久工作文件](assets/screenshots/23-cloud-working-files.png)
![深色文件工作区](assets/screenshots/24-cloud-files-dark.png)

## 专案技能管理（当前源码）

项目方法新增精确安装及专家/任务版本绑定。普通停用影响新工作；卸载和永久安全撤销阻止包括旧任务在内的后续调用。重装产生新身份，专家须保存新版本后采用。工具调用及结果落库前复查当前方案，实际消耗按原预留结算。

平台全套回归 **185/185**；delivery 的 `npm run qa:skills` 通过三组浏览器验收，31 份实际 HTTP 请求／响应样本通过严格设计 schema。自定义包审核/发布、完整真实角色资格仍待完成，历史 0.5.0 安装包未替换。

![Project methods](assets/screenshots/25-project-methods.png)

![Project methods — dark](assets/screenshots/26-project-methods-dark.png)

## 默认助手与工作通知（当前源码）

新工作默认选择文字助手，可直接编辑示例后提交，随后进入私人会话。点击示例和创建空会话均不启动 AI；图片/代码等专项需求继续选择专业角色。请求结果未知时，当前打开表单保留原提交身份，重试不会多建任务。默认配置不能被普通编辑或删除；可复制自定义，项目管理者明确采用当前方法版本。

工作通知提供全部/未读、分页、标记已读及原任务跳转；跨项目通知会先切换项目。鉴权刷新失败会清空旧通知和未读提示。Web 默认助手和通知分别通过四组浏览器验证，覆盖 375/768/1024/1440、浅深主题与繁英；不等同所有页面的完整可访问性验收。

![默认工作草稿](assets/screenshots/29-default-assistant-brief.png)
![真实私人会话与模拟结果](assets/screenshots/30-default-assistant-result.png)
![工作通知](assets/screenshots/27-work-notifications.png)

## 资料补齐 / Task inputs

新工作可选择先等文件或获准连接。在原私人会话内补传、搜索并明确选择当前版本后，继续同一任务；补传附件保留私人归属。等待期间不调用模型，原预算保持预留；权限错误清空候选并禁用确认。Delivery 的 `npm run qa:task-dependencies` 五组通过，覆盖真实私人上传、执行与结算、通知、四种宽度和两主题/语言。

Choose explicit prerequisites when submitting work. Upload privately within the original conversation, search current versions and confirm an input to continue the same task and budget. The model waits until all inputs are ready. Five browser checks passed with real Codex and a synthetic model; this covers the initial checkpoint, with paid-step continuation and automatic discovery still pending.

```mermaid
flowchart LR
  Brief[Submit with an input request] --> Wait[Same task / reserved budget]
  Wait --> Choose[Private upload / explicit version selection]
  Choose --> Resume[Same task enters the queue once]
  Resume --> Result[Codex / actual file / settlement]
```

![原会话资料补齐 / Inputs in the original conversation](assets/screenshots/32-task-input-wait.png)
![繁中移动界面 / Traditional Chinese on mobile](assets/screenshots/34-task-input-mobile.png)
![同任务执行结果 / Result from the same task](assets/screenshots/35-task-input-result.png)

## 企业共用执行名额（当前源码）

会话和任务页明确显示容量排队，用量页说明未完成工作上限与企业共享容量的关系。排队不调用模型，空位释放后自动继续原任务及原预算。Delivery `qa:execution-capacity` 验证实际等待、管理员可读原因、四宽度/两主题/繁英、真实 Codex 配合模拟模型生成私人文件与一次结算；占槽来源是明确标识且仅限本次企业的模拟记录，不是负载压测。

![真实排队任务](assets/screenshots/36-capacity-wait.png)
![繁中移动端排队](assets/screenshots/38-capacity-mobile.png)

## 从持久模板建立专家

「专业角色」现在读取真实的 18 个专业模板及默认助手，提供分类、字面搜索、版本/交付详情。先检查当前项目依赖，再明确建立专家；检查不启动 AI 或预留预算。编辑表单使检查失效；响应丢失重试沿用同一幂等键。缺失工具、停用方法及尚待验收状态均可见。

八组 Web/源码 Electron 检查覆盖真实登录、重试、技能恢复后重新检查、权限错误隐藏及四宽度/两主题/繁英。当前全部角色仍待真实业务资格，历史安装包未重打。Chrome 扩展没有因此增加模板编辑器。

![持久模板目录](assets/screenshots/44-role-templates.png)

![当前依赖已就绪](assets/screenshots/46-template-ready.png)

![移动深色详情](assets/screenshots/47-template-mobile-dark.png)

## PDF 导出与原版本重试

设计画布可导出实际单页 PDF 审阅稿并立即下载，也可从素材页取回。界面说明 PDF 已栅格化，文字与图层仍在工程/SVG 编辑。过期版本显示刷新入口；接受后回执丢失重试不生成重复文件。

七组 Web/源码 Desktop 验收包含真实邮箱、画布、版本冲突、繁英/两主题/四宽度及独立 PDF 解析渲染。模型依赖继续模拟，未宣称印刷交付或角色正式合格。

![实际 PDF 导出](assets/screenshots/49-design-pdf-export.png)

![下载 PDF 后实际渲染](assets/screenshots/50-design-pdf-render.png)

## 营销 CSV、精确指标与来源（当前源码）

导入先预览并确认账户、币种、时区、实体层级、归因和转化定义；支持通用 CSV 及 Google/Meta 风格候选表头与手动映射。原始 UTF-8/BOM、SHA-256、映射和计算结果真实保存。相同项目内重复请求或成功回执丢失后的重试只返回原快照；被隔离的数据不能绕过限制重新上传。未知转化不计零，CTR/CPC/CPM/CVR/CPA/ROAS 用精确小数先加总再计算，历史结果冻结。

原始 CSV、标准化 CSV、带 11 项证据的 JSON 计算报告及实际 SVG 可下载。页面显示实际数据日期；上传时间不冒充平台取数截止时间。没有正式广告账户同步、跨平台转化去重、FX 或完整 AI 叙述验收；营销分析角色仍未合格。模型依赖继续使用获准假数据，数据库与文件逻辑真实执行。历史安装包未重打。

导入错误定位 CSV 物理行和列；切换数据集读取失败时清空指标与下载，不用其他快照冒充。四宽度、浅深主题、繁英及丢失回执重试已实际验证；公共轮询在前次请求结束后才继续，错误清空旧数据。

```mermaid
flowchart LR
  Pick[选择 CSV] --> Preview[映射与范围预览]
  Preview --> Confirm[明确确认]
  Confirm --> Result[同一快照 / 精确值与图表]
  Result --> Download[原文与计算报告]
```

![实际映射确认](assets/screenshots/52-marketing-import-preview.png)

![实际营销指标与图表](assets/screenshots/53-marketing-analysis.png)

![繁中深色移动端](assets/screenshots/56-marketing-mobile-zh-dark.png)

## AnalysisSpec 私人报告（当前源码）

在行销分析选择已有快照、业务问题、日期/比较区间、指标、维度和 HKD 最高预算。预览不调用模型或预留费用；明确确认后原子建立私人 Codex 任务、冻结计算/证据及单笔预留。来源、账户、币种、时区及归因独立；重复事实去重，冲突拒绝，比较零值/无数据保留原因。接受后丢失回执重试返回原报告。

真实 Codex 通过分页事实工具读取固定值，服务端检查证据占位符及数字字面量后发布固定 HTML 资产，JSON 保留完整计算。自然语言语义和专业业务质量仍待验收；当前模型为明确标识的假数据。来源隔离/删除和项目撤权阻止读取及下载。完整 102 条综合验收、正式连接、专业角色资格和生产发布仍未完成，历史安装包未更新。

列表轮询真实任务状态，证据可展开查看；读取拒绝会清空报告与下载。四宽度、浅深主题及繁英实际检查通过，已修复手机选择框撑宽和切换/拒绝后的旧证据展示。实际 HTML/JSON 下载及成功回执丢失后的重试由 delivery `qa:analysis-reports` 验证。构建通过，约 511 kB 主块仍有 Vite 体积提示。

```mermaid
flowchart LR
  Scope[Select snapshots and dates] --> Preview[Uncharged calculation preview]
  Preview --> Confirm[Explicit confirmation]
  Confirm --> Task[One persisted report task]
  Task --> Inspect[Evidence / HTML and JSON download]
```

![AnalysisSpec report](assets/screenshots/58-analysis-report-ready.png)

## CSV／XLSX 文件导入与更正历史（当前源码）

营销输入现在先保存为项目共享文件的固定版本，再预览工作表、标题列、映射和账户口径。Google/Meta 经规范 `POST /v1/dataset-imports`，通用表格沿用兼容入口；预览不调用模型或预留费用。重复上传、接受回执丢失与重试不重复建立相同快照。原始 CSV/XLSX 下载校验实际字节及 SHA-256。

XLSX 限 5,000,000 字节、50 张工作表、100 列和 10,000 数据行；多表须明确选择，标题列为 1–100。只读解析共享/内联字符串、XML 中文字符引用、精确数字及 1900/1904 日期；金额输入最多六位小数，冻结指标保留八位。拒绝公式（含缓存结果）、宏、外链、加密文件和数据区合并单元格。错误定位实际工作表单元格。预览失败仍保留已明确上传的项目原始文件，界面提前说明。

更正新建不可变快照并记录完整祖先链，保留旧指标和历史报告；AnalysisSpec 在建立任务/预算前拒绝同时汇总祖先及更正版。来源隔离或删除阻止依赖数据、报告和文件读取；删除恢复流程关闭尚未领取的任务并释放未用预留，已运行或费用不明的任务保留原对账规则。私人文件须先明确发布为共享副本。

```mermaid
flowchart LR
  File[CSV / XLSX] --> Version[固定共享文件版本]
  Version --> Preview[表 / 标题列 / 映射 / 免费预览]
  Preview --> Confirm[当前授权与明确确认]
  Confirm --> Snapshot[幂等快照与冻结指标]
  Snapshot --> Correction[新更正版 / 保留祖先]
  Version --> Lifecycle[隔离或删除依赖守卫]
```

平台完整回归 **185/185**，严格实际 HTTP 样本 **31/31**，文件导入四组及原有 CSV 六组 Web/源码 Electron 流程通过；原生类型检查和四项单元通过。模型/媒体依赖为获准假数据，数据库、Codex、文件与授权逻辑真实执行。完整 102 条综合验收、全部官方导出格式、正式连接器、专业业务资格和生产发布仍待完成，历史 0.5.0 安装包未重打。详细规则见主文档 `docs/technical/29-file-imports-and-correction-lineage.md`。

上传分配键按用户、企业、项目及文件摘要先保存，重选同一文件可继续；更换输入使预览和确认失效。四宽度、两主题及繁英 16 种界面组合已验证。

![工作表与更正选择](assets/screenshots/61-xlsx-correction-preview.png)

![冻结来源和更正历史](assets/screenshots/62-xlsx-source-and-lineage.png)

![繁中深色移动端](assets/screenshots/63-xlsx-mobile-zh-dark.png)

任务详情新增“暂停排队 / 继续工作”，仅在首次模型调用前可用；使用当前任务版本，冲突后刷新，原任务和预留预算保持一致。运行中任务继续提供取消；已付费步骤恢复仍未实现。Delivery `qa:task-controls` 已实际验证 Web、源码 Desktop 与 MV3 的暂停/恢复/取消及恢复后一次结算。

![任务暂停](assets/screenshots/49-task-paused.png)

## 装置会话与退出

账户设置区分 Web、Desktop、Chrome 扩展，标记当前装置、显示有效期；包括访问令牌过期但仍可刷新的设备。撤销前有确认、执行中禁用按钮、失败可重新载入。当前 Web 会话撤销会清理 Cookie；退出通过无凭证的跨标签事件清理同一浏览器的工作区视图，迟到响应不能恢复旧数据。原生客户端接收相同页面快照。

![装置会话](assets/screenshots/50-active-sessions.png)
![小屏深色会话页](assets/screenshots/51-sessions-mobile-dark.png)

交付仓库 `npm run qa:sessions` 验证真实 Web、源码 Electron 和 MV3 登录/撤销、过期凭证退出、离线退出提示及延迟响应。完整身份、全部设备/系统矩阵和生产发布仍按主文档验收。

## 规范登录与授权 / Canonical sign-in and consent

邮箱登录接入规范 challenges/sessions；相同输入的未知响应保留请求标识，重发或更换输入后新建标识。显示真实验证码到期时间，开发邮箱提示来自公开环境配置。原生授权使用真正的 S256 授权导航链接；当前退出接入规范 DELETE。登录与企业身份返回地址限制为内部产品路由。

Email sign-in consumes the canonical challenge/session contracts and retains the request identity for unknown replies. Native consent uses a real S256 authorization link, and sign-out uses the canonical DELETE operation. Safe internal return paths preserve nested PKCE callbacks while rejecting external, malformed and API destinations. `npm test` checks the return-path boundary; the Delivery sessions journey exercises real browser authentication.

当前 `npm test` **3/3** 返回地址边界检查及 TypeScript 检查通过。 / Current return-path checks: **3/3**, with TypeScript validation.

真实导航专项 **3/3**：邮箱登录、用户点击跨 origin GET 授权至自有 loopback / S256 交换，以及重复退出。 / Actual canonical browser navigation: **3/3**, with an owned callback and no model calls.

![实际原生授权页面 / Actual native consent page](assets/screenshots/52-native-authorization.png)

## 资料接口与初始化 / Profile API and bootstrap

工作区刷新使用 `GET /v1/session/context` 取得本人资料、企业列表与 CSRF；`GET /v1/me` 专用于原始规范的 `User`，资料更新继续使用 `PATCH /v1/me`。退出、换账号和迟到响应守卫继续生效。Desktop renderer 通过显式快照同步同一调用逻辑。

Workspace refresh uses authenticated `GET /v1/session/context`; canonical `GET /v1/me` returns only `id`, `email` and `display_name`. Profile updates still use `PATCH /v1/me`. Existing identity-change and late-response fences remain active, and Desktop receives the same client logic through its explicit renderer snapshot.

## 成员与邀请 / Members and invitations

成员页支持角色和项目选择、分页、所有者编辑、移除确认，以及邀请投递状态、重发和撤销。邮件登录保留邀请地址并选择实际加入的企业。未知响应保留操作身份，退出后拒绝迟到的上下文响应。单元检查 5/5；当前服务端真实 HTTP 五组通过。此前页面复核超时与早期被覆盖的成功不计为通过，原失败记录保留。2026-10-20 当前源码页面 6/6 通过，164 份源码／verifier 前后一致，实际会话退出、自建浏览器关闭。新回执和截图见下文。

The member page supports project selection, paging, owner edits, removal confirmation, delivery status, resend and revocation. Invite links survive email login and select the joined workspace. Unknown replies retain their operation identity; late context/member responses cannot cross a sign-in revision. Unit checks pass 5/5 and five current-source HTTP groups pass separately. Earlier page timeouts and overwritten success remain historical and are excluded from passing evidence. The current-source rerun now passes 6/6 with 164 unchanged source/verifier files, actual session revocation and owned browser closure; new evidence appears below.

![早期实际成员页 / Earlier verified member page](assets/screenshots/53-member-invitations.png)

## 后台暂停的用户端反馈

获授权的成员目录将后台暂停单独显示；暂停中的成员无法访问该企业，也不能由 owner 编辑、移除后重加或接受新邀请解除。恢复由当前获授管理员执行。严格 Member.state 继续只使用 active/removed，管理提示由额外目录字段提供。当前六组 Admin 页面复核已验证 owner 提示、暂停即时拒绝和恢复后移除旧提示；完整原生／后台矩阵仍保留。

## 当前成员与跨端会话复核（2026-10-20）

Delivery `qa:membership` 当前 6/6，覆盖真实邮箱邀请／重发／加入／移除／撤销及迟到上下文拒绝；四份实际 Invite、Member、MemberList、Ack 严格通过。另有 `qa:admin-membership-ui` 6/6 验证管理暂停、恢复和本页 owner 提示。`qa:sessions` 的 Web／源码 Electron／MV3 十二组覆盖首次交换和刷新回执丢失恢复、设备撤销、账号切换、过期／离线退出及跨标签清理。自建实例和测试会话均关闭，模型调用 0；旧失败原字节保留。全部安装包／企业身份／系统及完整成员旅程仍须验收。

![当前邀请与重发](assets/screenshots/60-membership-invitations-current.png)
![viewer 加入工作区](assets/screenshots/61-membership-viewer-current.png)
![当前成员目录](assets/screenshots/62-membership-directory-current.png)
![owner 看到后台暂停](assets/screenshots/63-membership-admin-suspended.png)
![实际原生授权页](assets/screenshots/64-native-authorization-current.png)
![当前设备目录](assets/screenshots/65-active-sessions-current.png)
![深色窄屏设备目录](assets/screenshots/66-sessions-mobile-dark-current.png)

2026-10-20 付款增量后的当前复核仍为成员 6/6（164 份源码）、Admin 成员 6/6（190 份）及三端认证 12/12（769 份）。前后摘要一致，拥有的会话和浏览器均清理；完整发布／系统矩阵继续独立跟踪。

2026-10-20 退款增量后当前源码复核：Web 成员 6/6（169 份来源）、Admin 成员 6/6（196 份）和 Web/源码 Electron/MV3 认证 12/12（775 份）通过，前后摘要一致，拥有的会话、浏览器、Electron 和扩展进程均已清理。首轮 Electron 调试连接超时原回执保留，随后相同源码重跑通过。Desktop 无边框和原生 Side Panel 预览包保持原字节；完整安装包认证及系统矩阵仍须独立验收。

2026-10-20 方案版本增量後的當前源碼復核：Web 成員 6/6（172 份來源）、Admin 成員 6/6（200 份），Web／源碼 Electron／MV3 認證 12/12（779 份）；測試前後摘要一致，自建瀏覽器／Electron／擴展均關閉，測試憑證清理。新增不可變方案定義與固定歷史授權綁定不改寫原生預覽包。完整 VIP／配額、安裝包認證及系統驗收仍按主文檔繼續追蹤。

## 当前有效权益与变更通知（阶段 47）

用量页接入原规范 EffectiveEntitlements，展示个人与目前企业的有效功能、服务器确认时间、权益版本和下一次开始／到期边界；本机授权、项目权限与预算仍分别校验。补充站内通知保留实际变更、授予修订和已读状态，提供明确分页。没有有效 VIP 时回到当前免费方案；VIP 不增加余额。

```mermaid
flowchart LR
  Session[当前真实会话与企业] --> Server[服务器时间计算权益]
  Server --> Access[功能和配额摘要]
  Server --> Notice[本人的变更通知]
  Access --> Recheck[使用时再查资源 预算和本机授权]
  Session --> Fence[退出或切换企业后丢弃旧响应]
```

页面每 15 秒内刷新，并在下一边界重新读取；失败清除旧权益显示，迟到响应不能恢复已退出账号。实际 Admin 开通／独立审批和暂停后，用户端原规范读取已经验证；英文浅色桌面及 375px 繁中深色截图来自真实浏览器。原生安装包的完整旅程及全部系统验收另按各自回执记录。

![用户端有效权益](assets/screenshots/67-effective-entitlements.png)
![繁中深色权益与通知](assets/screenshots/68-entitlements-mobile-dark.png)

本轮实际原生截图发现旧方案标题不会随新权益更新，现已修复：方案名、并发/预算与有效权益共同刷新，比较主体版本和固定方案集合后才显示；下一边界按服务端确认时间安排，避免本机时钟偏差。
