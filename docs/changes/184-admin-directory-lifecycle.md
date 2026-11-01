# 用户与企业管理补全 · 阶段184

补齐两个目录的新建、逐行永久删除、当页多选、批量状态变更和批量删除。统一冻结预览、版本核对、幂等提交、细分权限及完整审计；最高管理员直接执行，其他角色继续按发布策略审批。

新建企业同步建立擁有人、账务账户及首个项目。删除用户会移除登录身份与联系资料、撤销凭据及成员授权，保护团队仍需使用的共享内容；删除企业进入持久化永久清理。数据库161禁止恢复已删除身份。旧后台企业清理提交端口改为引导到目录，避免绕过新流程。

13项相关原生数据库/API检查通过。最终版本10项真实浏览器检查通过，包含来源筛选、两种新建、两种列表批量状态和删除以及审计读取。两轮真实页面验证共创建并清理4个专用测试用户、4个专用测试企业；18项实际管理操作对应18条最高管理员直接执行审计。4项企业根清理均完成，实际异常数组为空；完成状态中的保留项包含账务、审计、备份重播和客户本地副本边界。

保留首次测试夹具字段/表名错误及修正版本、部署后检查被系统固件服务启动打断的原始脚本、清理尚在后台执行时的首次状态检查。续查确认60个其他服务的启动时间早于本轮部署，固件服务在核查期间启动，未有本轮命令针对该服务执行操作，原有业务配置和模型/Key/未知费用记录未更改。所有自建浏览器及 SSH 连接已关闭。

This change completes user/workspace creation, row deletion and selected bulk status/deletion workflows. It enforces atomic acceptance, frozen previews, current authority, independent policy review and immutable audit.13 focused native checks and10 final real-browser checks passed. Four owned users and four owned workspaces were created and cleaned across the two actual UI runs; all18 accepted operations have corresponding direct-execution audit facts. All four workspace root cleanup jobs completed with empty operational exception arrays and documented retention boundaries. Original failed attempts and postcheck interruptions are retained with their actual scope.

实际代码、检查日志、服务器核查和媒体摘要见[本轮证据](../quality/admin-directory-lifecycle-184.json)。这仅声明本轮管理目录功能闭环，不替代其他业务模块各自的验收。
