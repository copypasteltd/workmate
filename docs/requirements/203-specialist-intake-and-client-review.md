# 203 · 专业角色开工与客户端复核

完整102条原始需求和32组验收继续保留。上一轮是已上线并同步的实际进展；不能把当前用例通过或无TODO标记解释为完整目标完成。本轮先完成下列整批产品代码、边界控制、运行脚本和计划用例，再统一构建／测试／真实客户端验证。失败保留，修正成批实施后复验。

- Web专业角色和默认助手的新工作入口接入同一附件输入：明确选择／拖放／粘贴图片／素材引用、至多20个固定版本、正在上传时阻止付费提交、草稿恢复和明确重试。附加素材不自动创建Agent任务。上传的项目共享范围在上传前明确展示。
- 每份新工作草稿固定使用者、企业和项目。切换范围立即卸载旧输入；在途上传、迟到结果不得加入另一项目或导航到另一范围。保持Desktop本机Codex入口与Web云端入口各自的执行位置。
- 付费提交必须先持久保存原请求和幂等键；存储失败／读回不一致时阻止发送。未知结果锁定原请求，刷新后只允许明确继续同键；不得因存储异常、草稿失效或项目切换悄悄另建收费任务。旧草稿保持可读取，已接受／移除的正文与附件按原规则清除。
- 角色开工前展示当前依赖与费用确认；附件和连接依赖通过已有服务端授权校验，不绕过当前来源、角色工具权限及费用预留。修复同类素材引用表单的非必要必填约束，避免隐藏的原生表单验证阻止合法提交。
- Web及Desktop复核弹窗使用明确宽版布局；控件根据自身可用宽度换行，比较期标签完整显示。保留CopyPaste蓝／墨色／纸白、现有字体及同口径双轨；测试双主题、双语、小屏／缩放、键盘、嵌套证据弹窗及原生导出，不新增横向或侧边滚动条。
- 真实角色验收推进：只读盘点当前公司模型和角色依赖后，准备至少12个覆盖开发、营销和设计的代表任务，用真实Codex／公司API取得实际成果、工具／Skill、固定输入与费用证据。受控验收样本明确标识；自动检查和模型自述不能替代客户的完整专业质量签收。
- 最后统一更新安装包／下载目录、六端中英双语README、实际PNG／GIF／MP4和更新说明，普通原子同步八分支并回读。服务端仅更新Workmate自身应用；网络环境完全只读，沿用原端口和入口，核对原网络指纹／凭证／数据库和代理进程。

视觉方案：蓝 `#194BFB`、墨 `#15181D`、纸白 `#F6F7F9`、细线 `#DDE2EA`、柔蓝 `#E9EEFF`。沿用Manrope正文及现有品牌标题，数据采用等宽数字。保留有实际业务含义的同口径双轨，移除窄列挤压和输入流程分裂；不引入另一套品牌样式。

未接通的真实视频／语音、Google／Meta／企业IdP、全角色专业质量、全设备／大文件／长稳／容量／灾备／客户业务效果及WorkBuddy同题盲测仍以完整原范围为准。本轮不得自动关闭这些要求。

English: Implement the complete batch before integrated verification. Connect authorized pinned attachments to specialist/default-assistant intake, bind all state to actor/tenant/project, require durable exact request/key storage before paid submission, and preserve explicit same-key recovery. Make actual review dialogs fit their available width across Web and native Desktop while preserving local/cloud execution boundaries and the CopyPaste identity. Advance real representative-role evidence without inventing professional customer acceptance. Deploy only the owned application, preserving all server networking and original requirements.
