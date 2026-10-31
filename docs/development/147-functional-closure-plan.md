# 147：可复用流程与跨端本机步骤 / Reusable workflows and cross-client local steps

本轮保留全部原需求及阶段146证据。前一轮属于实际进展：文件预览、版本选择、三端交互及八个远端分支已发布。本轮针对 REQ-032 的流程输入输出契约，以及 UC11／REQ-041 的 Web 原任务等待本机步骤继续实现功能；不把旧文件桥接当作完整本机 Agent。

## Web → Desktop → 原任务

1. 云端任务在原有、已完成模型轮次或首次运行的文件输入检查点等待，原任务、会话、费用保留。用户明确选择一个待补齐文件输入，为本机准备步骤选择角色及独立费用上限。请求持久保留，不要求设备立即在线；此动作不授予 OS 权限或启动模型。
2. 同一账号在 Desktop 的待处理列表查看具体来源、步骤、角色和费用。选择真实目录、受限／完整本机权限并明确确认后，原有受信任主进程建立唯一的本机 Codex 任务。绑定设备、原生登录族、本机会话、目录摘要、固定 Codex／角色和费用。云端 Worker 不执行该本机任务。
3. 本机使用现有启动／执行／结算日志和回执恢复；重复接单、响应丢失和重新连接沿用同一任务。未知或已经执行的本机工作不自动重放。注销、撤权、来源隔离和取消阻断后续步骤。
4. 本机完成后由客户选择并上传要交回的文件，明确确认固定版本。服务端核对来源、任务归属、原输入版本及全部文件后，原子补齐原检查点；原云端任务沿用既有线程、预算和会话继续。返回的本机完成信息标记为客户机报告，不声称独立证明全部 OS 行为。
5. Web／Extension 显示等待、处理中、待交回、完成或取消；客户可以审阅原任务产物。取消保留已发生费用，不自动把未知工作改报免费成功。

## 流程契约

流程应可声明有界、命名且有类型的业务输入和命名交付输出。每次运行绑定明确输入值／固定文件版本，验证必填项、类型和来源，再进入原有逐步费用确认、前序文件交接和审批。契约属于不可变流程版本；不推导任意条件分支为本轮的强制需求。具体字段语法在实现后记录并测试。

## Evidence and delivery

Keep original checks, failures and source snapshots immutable. Verify real native PostgreSQL, current authority, idempotency and negative paths, then exercise actual Web / frameless Windows Desktop / Chrome native right Side Panel. Use the already authorized synthetic model data. Update independent bilingual READMEs, real screenshots/GIF/video and change notes; publish ordinary non-forced branch updates. All code and generated runtime artifacts stay under `dev/`, authoritative documents under `docs/`. No local Docker, WSL or virtualization.
