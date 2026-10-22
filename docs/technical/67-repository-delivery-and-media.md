# 仓库整理、实际交互媒体与分支交付

本次交付在保留六端独立 Git 历史的基础上，为用户指定的 `copypasteltd/workmate` 建立清晰分支入口。主需求、规范合同及已应用迁移没有因 README 整理而降级或删减。

## 交付结构

| 分支 | 内容 | 使用入口 |
| --- | --- | --- |
| `backend` | API、Codex、数据、费用、权限与业务 | 独立中英 README、类型检查、构建与原生集成测试 |
| `web` | 云端工作台 | 独立中英 README、开发服务、静态构建 |
| `admin` | 独立管理后台 | 独立中英 README、MFA 身份与分范围管理 |
| `desktop` | 无边框 Electron 和 Native Messaging bridge | 独立中英 README、源码构建及本地打包 |
| `extension` | Chrome MV3 原生 Side Panel | 独立中英 README、加载已解压扩展 |
| `delivery` | 启动、跨端验证、录制和发布脚本 | 独立中英 README、自有进程控制和证据 |
| `docs`、`main` | 同一份主文档提交 | `docs/README.md`、`docs/README.en.md` 总导航 |

各分支根目录直接是对应仓库根目录。跨端链接使用明确 GitHub 分支，组件图片、MP4/GIF 保存在各自仓库，主文档另保留实际媒体的相同字节。旧 README 十三份原字节已归档，[摘要清单](../quality/history/stage66-before-workmate-readmes/manifest.json)保持其原提交、路径与 SHA。

## 使用与录制

```mermaid
sequenceDiagram
  participant QA as Owned native journey
  participant Clients as Actual packaged clients
  participant API as Company Backend
  participant DB as Isolated native PostgreSQL
  participant Capture as Actual viewport capture
  participant Media as FFmpeg / FFprobe
  QA->>API: Email OTP / PKCE; Admin OTP + TOTP
  API->>DB: Current identity, project and funding checks
  QA->>Clients: Select authorized input in original task
  Clients->>API: Confirm input and continue
  API->>DB: Same task/thread/hold; cumulative settlement
  Capture->>Clients: Repeated real viewport frames
  Capture->>Media: Observed frame timing and bytes
  Media->>Media: H264 MP4 + palette GIF; complete decode
  QA->>Clients: Close owned pages, contexts and instances
  QA->>DB: Reclaim isolated fixtures; normal shutdown
```

本次媒体旅程 06 的 **32/32** 原生断言通过，四个实际界面产生 **11 张**新展示截图、四段 MP4 和四份 GIF。Desktop 运行原先新建的 `paid-input-66-03` unpacked 产物，实际断言 `frame:false`、自绘窗口控件、无应用/Alt 菜单和沙箱；Extension 经真实工具栏动作打开 `SIDE_PANEL`，断言右侧布局、主页面宽度减少和没有 popup/额外标签页。

扩展媒体从该原生 Side Panel 文档直接捕获可见视口，**不包含浏览器工具栏**。它不是普通标签页模拟的侧栏，也不将文档截图说成浏览器整窗截图。Admin 使用隔离的模拟操作员，经实际 OTP/TOTP 接口建立独立会话，操作用户筛选、消耗查看及 VIP/费用表单；没有将表单演示说成财务提交。

UI 模型回合、供应商及业务数据使用用户明确授权的假数据；实际 Codex 子进程、线程续接、工具及用量另由阶段 66 的内部模拟网关集成测试覆盖。模拟没有替代真实 API、模型质量、实际付款、安装/签名或商店验收。

[媒体回执](../quality/workmate-media-06.json)记录原捕获时间、源码/文件摘要、帧数、不同画面数量和关闭回执。[完整解码验证](../quality/workmate-media-validation-02.json)核对八个视频/GIF 的帧、尺寸、时长、摘要及零解码错误；MP4 为 H264 8-bit 4:2:0，ffprobe 根据 full-range 信号可报告 `yuvj420p`。所有主文档媒体均来自实际运行。

## 失败与证据完整性

- 旅程 04 的浏览器整窗捕获返回黑屏，画面变化断言拒绝该素材；失败 JSON、日志与原截图保留，README 使用后续直接原生文档捕获。
- 旅程 05 在 Desktop 网站修改任务继续步骤超时，失败截图和原日志保留。下一旅程先确认实际 `paused` 状态，再对已启用 Resume 按钮使用键盘激活；32 项原断言全部保留，没有修改产品运行代码来取得通过，也没有把旧失败改成成功。
- 媒体验证 01 将 full-range `yuvj420p` 误判为非 4:2:0，保留[首次失败](../quality/workmate-media-validation-01-failure.json)；验证 02 同时识别两种真实像素格式并记录范围，原媒体未重编码或改写。
- 原始 Vite 日志包含尾空格及末尾空行，保留原字节及摘要；这些是限定原始记录例外，不对代码或 Markdown 放宽空白规则。

## 发布与后续同步

Delivery 的 `scripts/publish-workmate.mjs` 在已提交且干净的独立仓库上执行。`--check` 校验组件版本清单、完整可达历史对象、配置凭据、100 MiB 文件限制、禁止发布路径、README 链接、媒体摘要和远端祖先关系。`--push` 明确列出八个目标引用，使用 `git push --atomic`，推送后重新读取并逐个核对远端 SHA，要求 `main == docs`。

发布器先将各独立仓库的已审阅提交取入主文档仓库的专用引用，只搬运 Git 对象，不改变组件工作区。推送没有 `--force`，不删除其他分支；冲突会阻止原子推送。运行回执保留在 Delivery 忽略的 `.data/publication/`，避免提交自身 SHA 导致循环。

后续修改必须同步相关端的中英 README、实际截图/交互、双语更新说明、组件 SHA 清单及对应远端分支。完整规则见[分支与同步](../governance/04-git-branches-and-publication.md)，版本内容见[本次更新](../changes/2026-10-22-workmate-publication.md)。

## 验证范围

阶段 66 平台完整 **782/782**、专项 **34/34** 保留；本次客户端检查 08 为 **13/13**，其时源码不变；实际旅程 06 为 **32/32**，源码、产物和自建进程关闭检查通过。新增发布脚本在此后单独进行语法检查和实际发布预检，不能说它已经包含于先前客户端报告中。

全部 102 项 REQ/TC、NFR/G01–G10 与 **81 局部验证 /21 未证明完成 /0 完整验收**基线保持；18 个预设角色、29 个计划 Skill、零个完整实网合格角色保持。完整规范 TaskDTO/任务创建、任意执行中暂停、未知外部结果恢复、全角色业务、GEO、真实供应商和生产分发资格继续跟踪。本次是仓库和文档交付，不是全量产品验收。
