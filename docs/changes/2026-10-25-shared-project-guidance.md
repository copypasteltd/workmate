# 项目共享指引、私有附件和客户端修复 / Shared guidance and client repairs

阶段 86。范围对应 GAP-13，以及 GAP-03/GAP-20 的私有附件和 GAP-21 的限定布局修复。完整目标仍覆盖 26 个差异组、原 102 项需求和原完整验收条件。

## 使用变化

项目 owner/admin 可以保存共享指引草稿，预览精确专业角色/Skill、品牌、共享文件、账号与预算依赖，再确认发布不可变版本。Web/Desktop 提供编辑、历史与复制；原生侧栏提供只读摘要。新工作固定接收版本；旧任务或本机线程继续时保留原版，也保留在首次发布前开始的「无配置」状态。

Desktop 仍在客户本机运行 Codex，由客户主动授予并撤销完整本机权限。实际本机指引场景使用公司参考资料工具读取原始文本，写入本地文件，版本依次为 v3/v3/v4，三次任务分别结算 90 港币微额。发布项目指引不启动模型、不扩大权限，也不建立云端替代任务。

Extension 选文件先建立本人私有会话，再按精确范围、文件摘要和恢复回执分片上传。丢回包后重用原操作，不回退至项目共享；同项目另一编辑者不能列出、读版本、下载或访问私有会话。高级项目共享仍须明确选择，侧栏云端工作不依赖 Desktop 安装。

来源隔离、到期或权限变化后，当前与历史正文隐藏，恢复不改历史摘要。刷新覆盖窗口/页面恢复、手动核对与轮询；历史弹窗和编辑器使用不同 React 标识，修复旧历史 DOM 遗留。Admin 的元数据、敏感正文、隔离、恢复和永久擦除分别授权，财务权限独立保留。

侧栏在实际紧凑 Chrome 窗口和展开说明/设置时保留输入、发送、当前页面和末项访问。Desktop 同范围视频刷新保留播放器与暂停位置，错误/换范围清除旧内容；无边框工作区提供双语键盘滚动目标和焦点样式，保留输入框与弹窗行为，不显示纵横滚动条。共享来源不可用和预算超限改为可行动的双语说明。

## 升级、验证与限制

先在 Backend 执行 `npm run db:migrate` 应用 SQL103，再升级客户端。SQL001–102 以及四份历史 OpenAPI 原字节保留；新增八项接口及独立契约。当前路由目录为 487 项配置接口加一条明确条件化的 demo 路由。

旧库升级测试改为先在 SQL101 构造当时已存在的本机任务，再依次验证 SQL102、SQL103 及重放。它保留未提交音频取消、已派发未知费用、已完成原始字节和未追补客户授权的原检查，并确认 SQL103 不替历史任务追补共享配置。前次失败回执保留；产品接口不增加旧结构绕过，历史 SQL 不改写。

核心专项 25、三文件兼容专项 36、客户端单元 139、实际 Web/Admin/原生侧栏 14、打包本机 Desktop 50 分别通过。完整平台结果、精确源码摘要、媒体和原始回执在[当前检查点](../quality/shared-project-checkpoint.json)登记；[文档核查工具](../tools/audit_shared_configuration_docs.py)核对原条件和双语说明，并在文档固定后生成 `shared-project-docs-audit-01.json`。失败尝试保留原状态，包括来源刷新/历史 DOM、夹具初始化、播放器刷新、页面键盘焦点和紧凑标题定位问题，不以局部观察替代整段通过。

当前限制保留：指引最多 20 个共享文件版本、12 个连接器，各 Agent/品牌/账号选项列表限 200；聊天每条最多 20 个非空附件、每个不超过 5 MiB。恢复回执不保存文件正文或凭据，未发送附件不承诺关闭侧栏后自动恢复。全部大文件/休眠/站点授权矩阵、至少十二个合格专业角色、全部后台内容、音频发行与未知结果恢复、完整 Codex Desktop 能力、签名安装及客户业务接受仍待完成。

全部 AI/媒体提供方内容继续使用已授权假数据。原生数据库、实际浏览器/客户端、文件字节和本机 Codex 分别验证，不代表真实模型专业质量。REQ-065 仅推进至部分验证；其余差异与 G01–G10 不收缩。所有自建运行资源按回执关闭，没有调度 Docker、WSL 或虚拟化环境。

各端继续为独立仓库，更新双语 README、原始截图/GIF/MP4 和发布清单；按[同步规则](../governance/04-git-branches-and-publication.md)提交六组件，再提交主文档，普通原子推送至 backend/web/admin/desktop/extension/delivery/docs/main，禁止强推。最终提交和远程核对以[发布清单](../quality/workmate-publication.json)及实际发布回执为准。

## English

Stage 86 adds immutable shared project guidance with draft/CAS, exact dependency preview, explicit publication, history and copy-to-new-draft. New tasks pin the accepted version. Existing tasks and local Codex threads retain their original version or explicitly absent configuration; publication never retrofits them or grants new authority.

Desktop continues to run Codex on the customer device under explicitly granted, revocable local permission. The real local guidance journey reads exact authorized reference bytes, writes local files, retains v3 after a v4 publication, and adopts v4 only in a new session. Three separate synthetic-model tasks settle 90 micro-HKD each, without cloud replacement.

The native Chrome Side Panel creates an actor-private conversation before resumable attachments. Scope/file-specific receipts survive lost responses without falling back to shared assets. The actual owner downloads the original bytes; an independently authenticated editor in the same project cannot list, download, read versions or open that conversation. Explicit project sharing remains separate and no Desktop install is required.

Refresh and distinct React component identities prevent orphaned history bodies. Current source quarantine hides bodies and blocks new work before task insertion, reservation or inference. Admin metadata, sensitive bodies, quarantine, restoration and permanent erasure remain independently scoped. Same-scope generated-video refresh retains the player and paused position; errors or scope changes clear it. Compact native chat actions and the Desktop's named keyboard scroll target remain usable, with no Desktop scrollbar rails or horizontal layout overflow.

Apply additive SQL103 before upgrading clients. SQL001–102 and four historical contracts retain exact bytes. The additive contract covers eight operations; the route inventory contains 487 configured routes and one explicitly conditional demo route. Independent scopes pass 25 focused, 36 selected compatibility, 139 client, 14 actual cross-client and 50 packaged Desktop checks. Complete platform results and exact sources are recorded in the checkpoint, with original failures retained. Unedited screenshots and observed-time GIF/MP4 recordings accompany bilingual READMEs.

The populated SQL101 upgrade fixture now seeds an already-existing native task before verifying SQL102, SQL103 and migration replay. Original cancellation, unknown-spend, exact-byte and no-backfilled-consent assertions remain, with an additional check that SQL103 does not retrofit shared guidance. The failed receipt remains unchanged; product admission gains no legacy-schema bypass and published migrations retain their bytes.

Synthetic providers remain authorized. Complete professional role qualification, large-file/sleep/site matrices, complete Admin coverage, audio release/recovery, signed install/upgrade/uninstall, full Desktop parity and customer business acceptance remain open. All 102 original requirements, 26 gap groups and G01–G10 are preserved; REQ-065 advances only to partial verification. Owned native resources close after checks and no local virtualization is used. Publication uses ordinary mapped commits and an atomic non-force push, followed by actual remote verification.
