# 原生加密备份、删除重放与隔离恢复

实现位于独立 backend 仓库，使用 PostgreSQL 原生工具和 Node.js 流。Admin 接入恢复准备面板。Codex 仍是唯一 Agent 内核，本项不产生模型或媒体调用，也不调度 Docker、WSL 或虚拟机。

## 数据路径与一致性

执行迁移 `125-native-recovery.sql`。`recovery_environment` 保存来源 UUID 和恢复隔离标记；服务身份只能读取。`recovery_runs` 保存只追加、禁止修改和删除的备份、日志、演练凭证。平台服务无法通过管理 API 伪造一份成功备份。

备份进程与数据库迁移共享同一个 advisory lock。它在 repeatable-read 只读事务中导出 PostgreSQL MVCC 快照；`pg_dump --format=custom --snapshot=...` 使用该快照。对象清单从同一快照读取，每个对象逐流核对数据库中的长度和 SHA-256。源文件缺失、被并发删除或摘要不符会使备份失败，失败不会用空文件替代。

文件按独立随机 nonce 进行 AES-256-GCM 加密，HKDF 将清单、删除日志与各备份文件分离。AAD 绑定备份 ID、条目名、类型和目标位置。加密清单保存原文摘要、密文摘要、标签、迁移摘要和来源身份。清单使用认证加密封存，目录中只允许声明的平面条目。写入先经过专属 partial 目录，完整文件 fsync 后发布，再进行全量解密校验，成功后记录凭证。失败 partial 保留供部署负责人调查。

内容包括数据库中已经提交的数据、仍可访问的不可变对象，以及当次扫描可见的已封存预算回执。数据库全局角色密码、`.env`、主密钥、Desktop 本机文件、未提交上传、运行中的浏览器/程序/进程状态与临时 Codex 工作目录不包含在备份中。已提交的云文件版本通过对象清单保留；运行中尚未形成成果的编辑需在恢复核对中处理。

## 配置与命令

在 backend 仓库运行。`OWNER_DATABASE_URL` 是部署负责人持有的数据库管理连接，不能放入 Web、Admin、Desktop 或 Extension；它必须与当前配置的源库地址一致。`MASTER_KEY` 与 `RECOVERY_BACKUP_KEY` 均须明确配置为独立的 32 字节十六进制密钥，分别保管。恢复需要原主密钥。命令行参数不包含密钥或数据库口令。

Windows 开发工具由 `npm run setup:recovery-tools` 下载 PostgreSQL 18.6 官方推荐的 EDB 原生二进制归档，校验锁定的归档长度与 SHA-256，并仅提取受锁定摘要约束的工具和 DLL。运行前重新核对这些工具文件。其他服务器平台由部署负责人提供同一 PostgreSQL 18 大版本的原生 `pg_dump` / `pg_restore`，本轮 Windows 演练不能证明其他平台已通过验收。

设置 `RECOVERY_PG_BIN_DIR` 指向工具目录；Windows 默认 `.data/recovery-tools/bin`。先创建受控备份目录，目录必须使用绝对路径并位于服务 DATA_DIR 之外。示例中的 E 盘是部署示例，应替换成实际受控存储位置；本项目开发执行仍仅在 D 盘工作区内进行。

```powershell
npm run recovery -- backup --archive-root E:\WorkmateBackups
npm run recovery -- ledger --archive-root E:\WorkmateDeletionJournal
npm run recovery -- verify --backup E:\WorkmateBackups\<backup-uuid>
npm run recovery -- prune --archive-root E:\WorkmateBackups
```

`prune` 对完整归档重新认证校验，只删除超过 35 天的有效备份，并为每个 source_id 保留最新一份有效备份。未认证、损坏、partial 和其他文件保留，避免误删待调查材料。删除操作限于已认证 UUID 目录中声明的平面文件；不使用跨壳递归删除。

`watch` 提供常驻执行入口：备份按 10 分钟起始节奏、删除日志按 60 秒起始节奏分别执行；较长备份不阻塞日志导出。数据库 advisory lease 防止两个 watch 同时取得调度身份，连接丢失停止后续投递，SIGINT/SIGTERM/受控 shutdown 等待当前操作结束。部署负责人可将进程纳入现有原生服务管理。实际备份耗时、调度延误与停机观测须在环境交付记录中确认。命令不安装操作系统服务，也不修改系统定时任务。

## 删除日志与恢复

删除日志只包含来源、观察时刻、已删除对象的类型/ID/企业和不可变存储键，使用独立域的认证加密。日志需另行复制到独立故障域。恢复校验日志来源和时间；故障之后能取得的较新日志同样可用于进一步抑制删除内容。未覆盖的最后一段时间以 gap 明确呈现，不能推定其中没有删除。

恢复命令要求明确确认隔离，并使用 `workmate_recovery_<32位hex>` 新库名和 `restore-<32位hex>` 新目录名。数据库和数据目录都不允许覆盖。创建库后，在导入业务表之前撤销 PUBLIC 和三个服务身份的 CONNECT 权限，并安装独立数据库标记；导入后另写恢复表标记。两个标记都参与 API / worker 启动核查。

```powershell
npm run recovery -- restore `
  --backup E:\WorkmateBackups\<backup-uuid> `
  --ledger E:\WorkmateDeletionJournal\ledger-<journal-uuid>.sealed `
  --incident-at 2026-10-27T10:30:00.000Z `
  --database-name workmate_recovery_<32位hex> `
  --target-data-dir E:\WorkmateRecovery\restore-<32位hex> `
  --acknowledge-isolation true
```

先完整验证归档，再流式导入原生数据库，保留原安全定义者函数所属角色与 ACL。目标服务器须预先具备原 owner 和受限的 `cp_app` / `cp_control` / `cp_queue`；程序核对服务身份没有超级用户、绕过 RLS、建库或建角色能力。数据库转储是受信运维输入，只有持有部署权限和备份密钥的负责人可以执行恢复。

导入后先应用新日志的删除状态及 tombstone，再写入仍合法的对象文件，并仅在匹配恢复 ID 的隔离库中进行离线内容清理。共享对象仍有合法引用时按既有删除规则保留。未完成清理记为 incomplete，隔离保持。恢复凭证记录删除遗留数量、待核对任务、snapshot gap、ledger gap 与原生恢复耗时。原库仍可用时同步凭证；原库丢失时，目标库和恢复目录中的凭证仍保留。

恢复流程保持数据库中的任务和金融事实，API 与 worker 禁止自动执行。正式切换还需环境级核对外部结果、授权撤销、付款/用量、密钥、对象、主机边界及服务路由。本版本提供可运行的隔离恢复与核验，生产切换和完整业务恢复时间需另行实测。

## Admin 使用

入口「备份与恢复 / Backup & recovery」，提供有效备份的时效、删除日志覆盖、最近演练、类型筛选、游标分页和详情。新安装的全局 super 角色包含 `admin.recovery.read`；已有角色不自动扩权。已有部署由负责人对已登记的永久全局 super 明确运行：

```powershell
npm run admin:enable-recovery -- operator@example.com --acknowledge-global-recovery-visibility
```

每次读取都检查有效全局权限、显式 deny 和最近 10 分钟 MFA，读后再次检查并写入审计。带企业/项目 deny 的主体不能读取覆盖全平台的恢复摘要。接口只投影受控字段；工作路径、SQL、口令、加密正文不返回客户端。MFA 失效时面板撤回旧数据。

## 资料依据

数据库快照与归档参数依据 [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) 和 [快照同步函数](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)。Windows 工具来源由 [PostgreSQL Windows 下载页](https://www.postgresql.org/download/windows/) 指向 [EDB 二进制归档](https://www.enterprisedb.com/download-postgresql-binaries)。

## 本轮验证与交付

本轮执行 64 项相关后端测试，包含 10 项使用真实 PostgreSQL 18.6 工具的恢复测试：一致快照及对象完整性、错误密钥、备份后删除与金融事实保留、双重执行隔离、错误目标／日志拒绝、归档篡改、缺失对象、按来源保留最新有效归档、MFA／范围／显式拒绝／契约、单例巡检，以及源数据库实际丢失后的独立恢复。历史迁移 1—124 保持原字节，只新增迁移 125。

六个仓库共执行 13 项类型／构建检查。实际后台完成 6 条流程及 1440px 英文浅色、200% CSS 放大、375px 繁中深色三种布局。布局同时检查正文相对窗口的边界、内部溢出以及移动侧栏收起后的遮挡；截图和 GIF／MP4 来自真实页面及实际等待时间。此前抓图早于布局／动画结束的轮次完整保留，交付选用修正后的录制。

核验报告：[原生恢复检查点](../quality/native-recovery-checkpoint.json)。[实际后台画面](../design/implementation/copypaste-admin__workmate-recovery-06-overview-en.png)与[实际交互 GIF](../design/implementation/copypaste-admin__workmate-06-native-recovery.gif)。各独立仓库中英双语 README 同步补充命令、使用逻辑、隔离约束、逻辑图和媒体。

通过轮次释放本次创建的浏览器、API、预览及原生测试数据库。中断轮次单独记为中断，保留其未能证明优雅关闭的事实。本轮属于备份与隔离恢复的相关范围验证，不扩大为全产品、真实模型、生产切换、异地耐久性或生产 RPO／RTO 达标证明。
