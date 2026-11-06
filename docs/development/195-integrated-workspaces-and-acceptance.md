# 195 · 统一工作入口、成果与验收

本轮将主要代码作为一个整体完成，再执行统一构建与验证。具体结果以同轮质量报告为准；本文件说明实现约束，不替代测试证据。

Web 会话提供描述、文件拖入、图片粘贴、素材库固定版本引用及逐个续传。上传先归入当前私人会话，提交时通过现有 `input.asset_version_ids` 交给 Codex。会话、企业、项目或登录身份切换会取消输入区的旧回调。网络结果不明时锁定内容并重试原幂等请求；保存笔记不会启动 AI。

Desktop 保留真实本机 Codex 和原生完整权限确认。新增本机文件选择、拖入及剪贴板图片；文件引用保持本机路径，图片副本写入获准工作目录。唯读授权不能创建粘贴副本；工作目录外的引用要求完整本机权限。主进程对身份、授权版本、有效期和规范化路径进行前后复核。渲染进程不能通过传入路径绕过权限。

成果工作区把文字、固定版本文件预览和下载、活动以及实际费用放在同一任务内。图片仅内嵌受限光栅类型，文本安全显示；Office/PDF 使用现有受权分页预览。切换任务清除前一任务预览，定时重新读取权限。Desktop 的继续修改仍经本机执行接口，不以云端执行代替。

Chrome Extension 继续使用原生右侧 Side Panel。保留已有文件拖入、选择及目录上传流程，新增剪贴板图片及可见拖入反馈，不扩大未获批准的文件访问权限。

后台新增接入与运行就绪视图，准确显示文字、图片、视频、语音、转录、Google、Google Ads、Meta、测试邮件、原生程序、浏览器、Office、磁盘及生产配置。状态只包含布尔值、公开模型标识和需要配置的字段名称，不返回 API key、OAuth secret、数据库密码或 SMTP 密码。模型的接口、密钥、费率继续归属于各自模型能力版本。

角色验收记录绑定任务版本、模板定义、Codex 运行时、能力版本、技能散列及交付快照。正常/修改案例通过前要求真实服务模式、执行成功和客户接受交付；边界案例必须符合明确预期错误。记录不可重写，批次撤回保留原证据与审计，写操作支持幂等重试。角色案例数不自动授予专业资格，客户盲测和专业质量仍须人工验收。

Linux Office 使用服务器已有的 bubblewrap 用户命名空间、原生监督程序、Landlock 文件边界、网络 socket 限制、独立配置、宏/外链预检与资源/时限约束。仅绑定必要唯读运行库和当前作业私有目录；私有目录同时作为 `/work` 和隔离的 `/tmp`，兼容 LibreOffice IPC。正常的 Office 81 重启码只允许在同一时限和配置内重启一次。API 必须非 root，转换程序、bubblewrap 及源文件逐次核对散列，结束、取消或父进程消失会清理对应转换进程。使用 `npm run setup:document-preview:linux` 安装，不调用本地 Docker/WSL/虚拟化。Windows 保留 JobObject 约束，使用独立 TEMP/TMP 和最小环境，关闭图形探测和首次启动向导。

Windows 直接启动已固定散列的 `soffice.bin`；正常的首次启动81退出码允许在同一私有配置、同一 JobObject 和同一总时限内重启一次。不会通过重复启动重置总时限。最终统一回归保留了此前冷启动失败，并覆盖修复后的原生 Word/Excel/PPTX 转换与清理。

三种 OOXML 附件的分片上传均接受精确 MIME，完成时校验 ZIP 文件头和完整散列；宏文档 MIME 不新增支持。预览另行检查容器、宏及外链，不能只验证转换器而遗漏实际上传路径。

会话消息兼容既有不带 `input` 的客户端。带附件交办接受 `input: {prompt, asset_version_ids}`：描述必须与 `body` 一致，仅 `delegate` 可带该输入，版本最多20个且不重复。既有任务依赖服务检查项目、私人归属、有效性及版本；校验、消息、任务和预算预留在同一事务。相同 `client_message_id` 回放原结果，变更原输入则拒绝。真实路由集成用例覆盖成功、回放、输入冲突、重复版本、无授权版本与笔记误带附件。

迁移 163 仅增加角色验收台账和受限统计函数，不修改历史任务或账务。上线先保存原服务配置与部署目录，构建和迁移完成后切换新版本；回滚代码时保留新增审计数据。用户保留测试邮箱、排除受信 Windows 签名的决定不变。

English: One implementation batch precedes integrated validation. Web composes private conversations with pinned files; Desktop remains a native local Codex agent with explicit permission boundaries; the extension remains a cloud-agent Side Panel. Task results use immutable versions and current authorization. Admin readiness does not expose secrets. Human role evidence is append-only and never becomes automatic professional certification. Linux Office uses a native restricted supervisor. Migration 163 is additive; preserve both prior deployment and audit history for rollback.
