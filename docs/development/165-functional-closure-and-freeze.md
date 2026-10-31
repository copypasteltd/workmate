# 165 · 收口与rc.5冻结

本轮限定修复直接影响首次使用和管理操作的缺口，随后冻结；不再扩展新模块。原规格、只读原HEAD报告和独立代码/规格反驳保留在quality/spec-review-165。

## 创建工作区

Web和Desktop共享同形的owner-scoped sessionStorage请求状态，先保存UUID、原trim名称和SHA256指纹再POST。结果不明时冻结原输入，刷新可先GET /v1/workspace-creation-requests/:key。后端采用user-authority→当前用户→actor/action/key→会员权限锁顺序；不把提交中的事务误判为未提交。原replay保持不改；每次返回复核当前权限，首项目归档/删除返回null不复制企业。会话切换、摘要后和导航前有代次/卸载守卫；显式退出移除名称，回执标识不自动过期。

## Admin

用户详情以typed DTO传data.user；目标id必填；换详情id keyed remount清除旧弹窗/预览。目录允许字段读写URL，并在返回与刷新恢复；不扩权限、不放宽MFA/审批/确认。尚无统一user_id任务/内容契约，留待后续实现。

## 冻结和交付

六仓双语README改为当前版本手册，旧文保存docs/history/readme-before-rc5并固定原提交链接。发布七类归档、源码、固定Codex、实际截图/GIF/MP4和SHA256。所有分支及七个新标签原子推送；旧包/旧标签不变。首次启动沿用Delivery的预检、初始化、配置核验与原生服务入口。外部依赖使用已授权假数据，Windows未签名。

## 必要验证

七项隔离原生SQL/HTTP、四项创建草稿状态、真实Web响应丢失后刷新恢复和Admin目标/URL旅程。仅启动本轮自有PG/API/Vite/浏览器并关闭，不触及其他数据库，无Docker/WSL。六仓生产构建及Windows安装程序，逐文件核对ASAR和固定Codex。按用户要求省略完整重复回归，不据此关闭原102/88完整验收范围。
