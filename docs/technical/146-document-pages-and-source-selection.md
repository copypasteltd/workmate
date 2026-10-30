# 阶段146：文件分页预览与完整来源选择 / Document pages and complete source selection

客户可以在 Web 和 Desktop 的云端文件工作区中查看 PDF、DOCX、XLSX、PPTX 的实际分页图像，翻页、跳页、查看本页文字并下载原文件。引用素材使用服务端搜索、连续分页和明确的历史版本选择，不再限于前200项或静默绑定最新版。Extension 在原生右侧栏内预览已获准上传的私人附件，保持聊天和待发送状态。

## 使用流程 / Customer journey

1. 邮箱验证码登录；Desktop 和 Extension 通过现有浏览器授权及 PKCE 进入选定企业、项目。会话附件保持私人范围。
2. 上传或选择来源。在“新增项目 → 引用素材版本”搜索整个获准素材范围，载入更多素材／较早版本，明确选择固定版本后保存。搜索词按字面处理 `%`、`_`、反斜线，不把它们当通配符。
3. “预览及引用”打开实际页面，上一页／下一页／跳页只读取该版本。原始 SHA-256、版本和字节保留；后续新版本不会替换已有引用。
4. 复制工作引用或使用既有附件／角色输入流程交给助手。预览本身不会启动任务、调用 AI 模型或产生 AI 费用；角色执行仍需既有预算／权限确认。
5. Extension 点击上传完成附件的“预览附件”，在真实 Chrome 右侧 Side Panel 内翻页。关闭预览后附件仍处于“已上传，待发送”，不会替用户发送。
6. 每次页面读取前后重查当前会话、企业、项目、私人范围及来源状态。打开的预览每4秒复查；撤权、隔离、删除或来源更改后清除图像、文字和敏感标题。清理存在网络往返与4秒轮询延迟。

```mermaid
flowchart LR
  A[客户选择或上传文件] --> B[不可变版本与摘要]
  B --> C[当前会话及文件权限]
  C --> D[只读文件检查]
  D --> E[原生 Office 转为 PDF]
  D --> F[PDF 页面工作线程]
  E --> F
  F --> G[再次验证权限及版本]
  G --> H[Web / Desktop / 原生 Side Panel]
  H --> I[固定版本引用交给角色]
```

## 原生运行与边界 / Native runtime

- 在 backend 仓库执行 `npm ci`、`npm run setup:document-preview`、`npm run build`。设置脚本从 LibreOffice 官方站下载固定26.8.2 Windows x64 MSI，校验固定 SHA-256及官方元数据，使用 `msiexec /a` 解包到被忽略的 `.data/document-preview/`，编译本仓库的 C# 进程宿主并绑定摘要。无系统 Office 安装，无 Docker／WSL／虚拟化。下载和生成文件不提交 Git。
- PDF 使用固定 `pdfjs-dist@6.4.299`（Apache-2.0）和原生 Canvas；Office 使用 LibreOffice（MPL-2.0，具体发行文件保留官方许可证）。当前 Office 设置和真实转换验收为 Windows x64；其他服务器平台的 Office 转换部署仍待验收。PDF 不依赖 Office。
- 源文件≤25 MiB，≤400页；每页图像≤1200×1600且≤2 MiB，本页文字≤20000字符。全服务最多同时2个预览、每用户1个；繁忙明确返回429。超限或不支持的文件保留原文件下载路径，不伪造预览。
- Office ZIP 预检限制条目数、单文件及累计解压量，禁止宏、VBA、ActiveX、OLE、外部数据／图片、危险字段、路径穿越及嵌套宏；按XML实体解码后的文字复查网络公式和字段，SVG外部资源同样拒绝。当前预览只接受UTF-8／US-ASCII XML部分，其他编码保留原件下载。转换禁宏／外链更新，固定格式导出器，使用独立临时配置目录和 Windows Job，最多8个进程、1 GiB内存、45秒；取消、父进程退出或宿主退出会回收本次子进程。
- 对“转换器退出成功但没有输出PDF”仅允许一次新的独立临时配置重做只读转换，最终失败返回明确422；不重放AI任务、付款或客户外部操作。PDF工作线程≤256 MiB／20秒，禁网络、XFA及脚本求值，关闭时等待工作线程终止。
- 转换PDF缓存≤3项／80 MiB、5分钟；缓存命中仍逐次读取原件并检查当前访问与 SHA。缓存不会作为权限证明。临时输入／输出在本次处理结束后删除；Windows短暂文件占用会按限次退避等待，不再把清理竞争当作预览成功。所有权标记独立于待删除目录，部分删除仍可保留；持续占用明确返回503。所属进程已退出的已标记遗留目录，在下一次 Office 转换前清理。未知目录不触碰。
- Desktop 的此页面属于现有公司云端文件区；本机 Codex 内核与完整本机授权流程保留。此次文件预览验收不冒充本机 Codex／OS操作验收。

## 接口 / API

所有接口要求当前用户会话；原生端使用当前原生令牌。`X-Tenant-ID`适用于工作区短路径。

| 接口 | 参数与行为 |
|---|---|
| `GET /v1/tenants/:tenant/projects/:project/assets` | 可选 `q`≤150字符、`scope=all/shared/private`、`limit=1..200`、UUID `cursor`；稳定 `(created_at,id)` 倒序分页，保留 PostgreSQL 微秒精度。显式查询返回 `next_cursor`；无参数保留原兼容响应。 |
| `GET .../assets/:asset/versions` | 可选 `limit=1..200`、`before_version`；明确载入较早版本，分页不返回已擦除版本；原无参数响应兼容保留。 |
| `GET .../cloud-nodes/:node_id/document-preview` | 必填UUID `asset_version_id`、`page=1..400`，可选 `describe=true`；核对当前目录绑定及原版本。 |
| `GET /v1/workspace-nodes/:node_id/document-preview` | 同上，使用当前租户头。 |
| `GET .../assets/:asset/document-preview` | 受当前项目及私有来源权限约束，用于 Extension 已上传附件；知道UUID不代表有权限。 |

响应包含固定来源、SHA、页数、图像及本页文字；`Cache-Control: private, no-store`。状态涵盖404无权／不可见来源、409引用更改／游标失效、416页码越界、422不安全／不可转换、429繁忙、503转换未设置。未设置 Office 时描述明确 `setup_required` 并保留原件下载，不报告成功页面。

## 验证与交付范围 / Evidence

选择后端 `backend-06`、实际三端 `ui-04`：19项后端定向检查通过，4组实际操作流程通过，9张截图、3组实际时序GIF／MP4，网页1440／960／390、Desktop1360／1000及原生Side Panel布局检查。真实 PDF／中文Word／双工作表Excel／双页PowerPoint、213项素材微秒游标、54版历史、字面搜索、私人越权、读取期间撤销会话／成员资格、隔离缓存来源、嵌套宏／外部图片阻断、取消与关闭，以及真实 Windows 排他文件占用和延后释放均有证据。

保留全部原始失败尝试、原始源码快照、校验器及日志；未将失败记录改成成功。当前模型服务按用户授权继续使用假数据，本轮预览不发送模型请求。此为文件工作区功能增量，非全平台回归、生产AI／广告／付款接入或完整本机操作验收。102项原编号与完整范围保留，本轮没有新增整项关闭。

## English

Web and the frameless Desktop cloud-files workspace now display actual PDF/DOCX/XLSX/PPTX page images, extracted page text and original-version downloads. Search and keyset pagination traverse the complete authorized asset set; users explicitly choose an older or current immutable version. The native Chrome right Side Panel previews customer-selected uploaded private attachments without sending them or starting an AI task.

Every read checks the current session, tenant/project/private scope, source state and exact version before and after rendering; open viewers recheck every four seconds. Revoked or changed sources clear their visible content. Original bytes are unchanged. Office archives undergo bounded structural and external-resource checks, run in a hidden native process Job with private temporary profiles, fixed PDF exporters and bounded cleanup. A successful exit with no PDF allows one repeat of the private read-only conversion, followed by an explicit failure if needed. PDF workers disable networking and script evaluation.

Run `npm run setup:document-preview` in the backend before building on Windows x64. It verifies and administratively extracts the pinned official LibreOffice26.8.2 package and compiles the repository-owned host; it does not install system Office or use virtualization. PDF preview uses pinned PDF.js6.4.299. Office deployment on other server operating systems remains unqualified.

The selected evidence covers 19 backend cases, four actual client journeys, nine screenshots and three real-time GIF/MP4 pairs. It includes a real unsigned frameless Windows package and the actual Chrome right SIDE_PANEL, not a replacement extension tab. No AI provider request is made. Production services, full native Codex/OS acceptance and the original whole-product acceptance scopes remain open.

Primary references: [LibreOffice](https://www.libreoffice.org/download/), [native command parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
