# Workmate 仓库、分支与同步规则 / Repository and publication policy

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

表中 `codex/*` 是当前工作分支。按 README 新检出的本地同名分支（例如 `backend`、`docs`）也可直接执行发布器，无须额外重命名；其他功能分支应先审阅并整合到对应工作分支。后续使用 `python docs/tools/finalize_managed_video_manifest.py` 明确刷新已提交组件清单，再提交主文档；旧清单保留于 Git 历史。

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

The table records current `codex/*` working branches. Fresh README checkouts using the published local branch names, such as `backend` and `docs`, can also run the publisher directly. Integrate reviewed feature work into the mapped branch first. Refresh committed component versions explicitly with `python docs/tools/finalize_managed_video_manifest.py`, then commit docs; Git history preserves the prior plan.

Every subsequent change must update the corresponding documentation and bilingual release notes, refresh relevant real captures when UI behavior changes, run checks appropriate to the change, commit, push the explicitly mapped branch and compare remote commit IDs. The user has authorized ongoing synchronization to this remote. Preserve collaborator history; do not force-push or delete unrelated branches. Keep credentials, local sessions, databases, dependencies and generated installers out of Git. Synthetic demonstrations and production qualification must remain clearly distinguished.

All work remains under `D:\dev\copypasted\自有agent\`; native processes only, with no Docker/WSL/virtualization. Close owned browser tabs and instances after capture while preserving the user's windows.

## 当前版本清单 / Current publication manifest

阶段 81 使用上方 `finalize_managed_video_manifest.py`：先完成当前检查点、文档核对及七仓库暂存检查，再提交六个组件，由此工具绑定已提交组件与当前证据，最后提交主文档并运行 Delivery 发布器。旧阶段工具保留用于解释各自历史回执，不能直接套用于新的源码。以后更新须使用与当次检查点匹配的清单工具，并保留其真实验证范围。

For stage 81, complete the current checkpoint, documentation audit and staged checks, commit the six components, run the manifest tool shown above, then commit documentation and invoke the Delivery publisher. Earlier tools explain their own historical receipts. Subsequent updates must bind their own current sources and qualification rather than reuse stale source assumptions.
