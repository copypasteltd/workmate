# 201 · 视频制作整轮更新

原 102 条需求和 32 组完整范围保持。本轮补齐当前模板视频的制作闭环，全部代码完成后再统一构建、测试和页面联调。已有编码、字幕、音轨、独立特效目录不重复计作新增。生成式视频、合成语音及外部广告授权依然需要真实服务配置。

- 六款中英营销视频起步模板、三种画幅，使用现有可恢复工程和实际公司视频渲染；不生成虚构业务数据。
- 分镜新增、复制、移除、排序和时长编辑自动保持连续时间线；按原分镜归属映射字幕，删除画面明确同时移除其字幕。变帧率保留时间关系与音轨入点时长，非法或超限修改整次拒绝。
- 分镜交叉淡化／向左滑动转场实际进入画面、预览、MP4、原工程和导入恢复。转场只消耗该镜头开头已有帧，不改变总时长或音频同步。旧工程不带新增字段时保留原 cuts-2 profile。
- 保存前可明确请求当前帧的服务器 PNG 预览；当前权限、原工程版本和固定来源重新检查，摘要随预览返回。只是画面预览，不声称音轨或整片已验证。
- 图片／音轨可搜索和翻页选择当前项目的共享固定版本，保留原版本引用；私人素材不通过公共选择器泄露。
- 编辑历史、撤销重做和同一用户／企业／项目的分区会话草稿；恢复必须明确确认，原版本有冲突时拒绝覆盖，登出清理草稿；保存失败复用同一请求键。
- Web 与 Desktop 显式合并共享编辑组件，Desktop 本机 Codex、权限、无边框／菜单保持。六端统一构建与相关测试，实际预览／视频／跨端接续，12份双语说明及真实媒体，打包上线、普通八分支同步。

代码与验收保持分离。不得用新增模板数量代替角色专业验收，或用局部绿灯关闭全机器、长期稳定性、客户效果与生产验收。

English: Finish the entire motion-production batch before integrated verification. Add bilingual starters, atomic timeline/caption/rate editing, actual transitions, freshly authorized frame previews, paginated fixed resources and explicit scoped draft recovery. Preserve existing version/idempotency/export contracts, local Desktop Codex and the full original external/professional/production acceptance scope.
