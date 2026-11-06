# 199 · 直接设计编辑与草稿恢复

本轮延续全部原始 102 条需求和 32 组未完成项。目标是补齐设计师、矢量设计及演示文稿业务中从已有成果继续编辑到版本交付的直接操作，不把已有代码或本轮通过的检查当作专业或生产验收。

全部产品代码完成后才统一构建、测试及客户端联调；发现的问题整批修正后复验。现有付费模型、权限、账务、来源撤回、不可变版本和幂等操作不能被编辑体验绕过。

本轮完整代码包：

- Web / Desktop 直接画布选择、拖动、缩放、键盘微调、对齐、图层复制、撤销和重做。变换必须符合画布边界、描边、圆角和图表最小尺寸约束。
- 未保存草稿使用服务器真实渲染预览；逐次核对当前用户、项目、工程版本和素材来源，不调用 AI、不写交付资产、不结算模型费用。客户端只接收最新匹配草稿的预览，避免旧响应覆盖新内容。
- 同一用户、企业、项目、工程与原版本的有界会话草稿。刷新后明确恢复或丢弃，跨项目和跨账号隔离，已变化的服务器版本不静默覆盖；退出清理，存储不可用时明确提示。
- 编辑切换的未保存提示、统一版本保存与原幂等核对；交付只能基于已保存当前版本。中文与英文、明暗主题、窄屏和无横向溢出同步处理。
- 同步权限回归、实际交互证据、独立仓库中英 README、下载包和上线记录。

外部视频、语音、Google / Meta 授权、完整客户专业产出、任意本机应用兼容和长期生产验收继续如实保留。受信 Windows 签名按用户要求排除。

English: Implement the complete direct-design editing, authorized unsaved preview and scoped draft-recovery batch before integrated builds and regression. Preserve immutable delivery, current source authority, idempotency and billing. All original requirements and external/professional/production acceptance remain in scope.
