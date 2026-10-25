# Workmate 仓库、分支与同步规则 / Repository and publication policy

**阶段 86 当前增量：** 共享配置草稿/精确预览/不可变发布、新工作固定版本、旧任务保留原版或原先无配置状态，已在实际 Web、原生侧栏及本机 Codex 核对。本机三次执行采用 v3/v3/v4，资料工具与本地原字节、各自费用结算均检查。侧栏聊天附件先建立本人私有会话，分片校验与精确恢复回执不回退共享；同项目另一编辑者不能列出、下载、读取版本或访问私有会话。独立 Admin 正文/费用权限与隔离/恢复/永久擦除继续生效。平台 1023（保留原 1001）、核心 25、兼容 36、客户端 139、实际 Web/Admin/侧栏 14、打包 Desktop 50 分别通过，选定源码精确相符。SQL103 增量保留 SQL001–102 和四份历史契约；487 配置路由加 1 条条件 demo 路由。REQ-065 更新为部分验证，原 102 项为 84 部分／18 未证明完整／0 完整验收，G01–G10 和其余全部差异保留。假模型证据不代表真实专业质量。见[当前方案与限定证据](../technical/86-shared-project-guidance-and-private-chat.md)。

本阶段先完成当前检查点、媒体/文档及暂存核查，提交六组件后执行 `python -X utf8 docs/tools/finalize_shared_configuration_manifest.py`，再提交主文档。在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个实际远程 SHA。旧阶段工具仅解释历史回执，常规同步沿用用户既有授权，禁止强推。

以下保留既有规范及历史记录；阶段专属命令仅解释当时回执，当前增量以前述方案、检查点和发布流程为准。 Existing specifications and historical records follow. Stage-specific commands explain their original receipts; the current increment uses the guidance, checkpoint and publication flow above.

**阶段 85 历史基线：** 原任务中的音频提案需原客户以当前登录会话独立确认精确内容和公司报价；默认不勾选，权利依据/用途为空。模型与 Admin 不能代签。拒绝、截止、停止及撤权阻断派发，撤回阻断交付但保留真实或未知费用。新增 SQL102，保留 SQL001–101、四份已发布契约及旧角色/Skill。平台 1001（全部原 988 用例保留）、核心 56、兼容 80、客户端 124、真实 Web/Admin/原生侧栏 13、打包 Desktop 41 分别通过；全部选定源码摘要精确相符。Desktop 保持客户本机 Codex、主动可撤销全权限、无边框/菜单，无可见纵横滚动条，保留滚轮/键盘/末项焦点及真实进度。原生右侧栏保持云端 Codex 和获准文件上传。真实声音/粤语质量、后台音频发行和未知 POST 外部证据结算仍保留；原 102 REQ/102 TC 为 83 部分／19 未证明／0 完整验收，G01–G10 不变。见[当前方案与限定证据](../technical/85-audio-rights-and-administration.md)。

本次先提交六个组件，再执行 python -X utf8 docs/tools/finalize_audio_authorizations_manifest.py，最后提交主文档。随后在 Delivery 执行 node scripts/publish-workmate.mjs --push，按发布回执核对 backend/web/admin/desktop/extension/delivery/docs/main 八个远程 SHA；docs 与 main 必须相同。历史工具/回执保持原阶段范围，常规同步沿用既有授权，禁止强推。

GitHub 目标为 [copypasteltd/workmate](https://github.com/copypasteltd/workmate)，SSH 地址为 `git@github.com:copypasteltd/workmate.git`。各端继续保留独立 Git 历史和独立构建入口，按下表发布到同一远程的不同分支。每次发布以最终远程分支 SHA 核对及本次发布回执为准。

| 本地目录 | 本地工作分支 | GitHub 分支 | 职责 |
| --- | --- | --- | --- |
| `dev/copypaste-platform` | `codex/backend` | `backend` | API、Codex、身份权限、业务、计量与数据库 |
| `dev/copypaste-web` | `codex/web` | `web` | 云端用户工作台 |
| `dev/copypaste-admin` | `codex/admin` | `admin` | 独立管理后台 |
| `dev/copypaste-desktop` | `codex/desktop` | `desktop` | 无边框 Electron、本机 Codex、客户授权/费用及独立可选文件桥 |
| `dev/copypaste-extension` | `codex/extension` | `extension` | Chrome MV3 原生右侧栏 |
| `dev/copypaste-delivery` | `codex/delivery` | `delivery` | 原生启动、验证、录制与发布工具 |
| 项目根目录 | `codex/docs` | `docs`、`main` | 主需求、架构、交付说明和跨分支导航 |

`main` 和 `docs` 发布相同的主文档提交。各分支根目录直接包含对应仓库内容，不把各端代码混放在一个分支中。`docs/README.md` 提供总导航；各端 `README.md` 为中文、`README.en.md` 为英文。GitHub 上的跨端和主文档链接使用明确分支 URL，避免依赖不存在的上级目录。

表中 `codex/*` 是当前工作分支。按 README 新检出的本地同名分支（例如 `backend`、`docs`）也可直接执行发布器，无须额外重命名；其他功能分支应先审阅并整合到对应工作分支。本次使用 `python docs/tools/finalize_audio_authorizations_manifest.py` 明确刷新已提交组件清单，再提交主文档；旧清单保留于 Git 历史。

## 每次更新必须同步

1. 在唯一 D 盘工作区的对应独立仓库修改代码；主文档和文档工具仍放在根目录 `docs/`。
2. 按实际改动完成类型、测试及必要的原生验证。模拟数据、实际 Codex 进程、生产接口、安装和商店资格分别说明，保持原 102 项需求与全部验收门槛。
3. 同步修改中英双语 README。改变界面或使用流程时，补录实际页面截图、交互视频及 GIF，并说明数据来源与演示范围。记录源码和媒体摘要。
4. 在 `docs/changes/` 维护中英双语更新说明，记录改动、使用影响、验证和剩余限制。历史 README 原始字节归档于 `docs/quality/history/`，不将历史阶段结论当成最新结论。
5. 检查待发布源码、历史对象大小和凭据；不提交 `.env`、本地账户/会话、数据库、运行状态、依赖或安装包。安装包保持本地忽略产物，源码附可复现构建命令。
6. 提交各端，再提交主文档中的组件版本清单。推送明确列出的目标分支，核对远程 SHA 与本地提交一致。正常更新不强制推送，不删除其他分支，不创建未经要求的定时任务。

用户已明确要求后续修改同步推送此远程；常规修复、文档和演示素材更新不重复询问发布授权。遇到真实远程分支冲突先取回并处理，不能用强推覆盖协作者的工作。

## English

Each component remains an independent local Git repository and publishes its root content to the branch shown above. The primary documentation repository publishes the same commit to `main` and `docs`. Every component has a complete Chinese `README.md` and English `README.en.md`, with architecture, setup, identity and usage flows, configuration, verification, screenshots and actual interaction media.

The table records current `codex/*` working branches. Fresh README checkouts using the published local branch names, such as `backend` and `docs`, can also run the publisher directly. Integrate reviewed feature work into the mapped branch first. Refresh this delivery's committed component versions explicitly with `python docs/tools/finalize_audio_authorizations_manifest.py`, then commit docs; Git history preserves the prior plan.

Every subsequent change must update the corresponding documentation and bilingual release notes, refresh relevant real captures when UI behavior changes, run checks appropriate to the change, commit, push the explicitly mapped branch and compare remote commit IDs. The user has authorized ongoing synchronization to this remote. Preserve collaborator history; do not force-push or delete unrelated branches. Keep credentials, local sessions, databases, dependencies and generated installers out of Git. Synthetic demonstrations and production qualification must remain clearly distinguished.

All work remains under `D:\dev\copypasted\自有agent\`; native processes only, with no Docker/WSL/virtualization. Close owned browser tabs and instances after capture while preserving the user's windows.

## 当前版本清单 / Current publication manifest

阶段 82 使用上方 `finalize_creative_feedback_manifest.py`：先完成当前检查点、文档核对及七仓库暂存检查，再提交六个组件，由此工具绑定已提交组件与当前证据，最后提交主文档并运行 Delivery 发布器。旧阶段工具保留用于解释各自历史回执，不能直接套用于新的源码。以后更新须使用与当次检查点匹配的清单工具，并保留其真实验证范围。

For stage 82, complete the current checkpoint, documentation audit and staged checks, commit the six components, run the manifest tool shown above, then commit documentation and invoke the Delivery publisher. Earlier tools explain their own historical receipts. Subsequent updates must bind their own current sources and qualification rather than reuse stale source assumptions.

阶段 82 历史发布使用 `finalize_creative_feedback_manifest.py` 绑定当时已提交组件、回执、双语文档及暂存核查；旧阶段工具和回执保留自身历史范围。Stage 82 bound its own receipts and committed components before non-force publication; earlier evidence is retained under its original scope.

阶段 83 使用 `finalize_geo_observation_manifest.py` 绑定已提交的六个组件、当前 GEO/原生布局回执、双语说明、实际媒体及暂存核查，再按既有授权非强制推送。旧阶段工具和回执仅保留其历史范围。Stage 83 binds exact committed components and current evidence before the authorized ordinary push.

阶段 84 使用 `finalize_audio_authorizations_manifest.py` 绑定已提交六组件、当前音频/字幕、原生布局、完整回归、实际媒体与双语文档。先完成实际检查和暂存核查，再提交六组件、刷新清单、提交主文档，最后运行 Delivery 发布器并核对八个远程分支 SHA；不复用旧阶段源码假设，不强推。

Stage 84 binds committed components to its current audio/native-layout, full-regression, media and bilingual documentation evidence with `finalize_audio_authorizations_manifest.py`. Complete checks and staged review, commit the six components, refresh the manifest, commit docs, then run the publisher and verify all eight remote refs without force.
