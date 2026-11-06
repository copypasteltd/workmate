# 196 · 任务内审阅、编辑与执行上下文

本轮延续完整目标与194/195的32组、102条追溯，先一次性完成以下全部代码包，之后才开始统一构建、测试及调试。不以关键词扫描代替需求实现，也不以本轮范围重新定义总目标完成。

1. 任务成果内查看固定版本、历史版本及原交付的文字差异，明确散列、换行变化、二进制与大文件的受支持范围。
2. 完成受权的 UTF-8 文字编辑与保存新版本，校验任务/交付/文件版本及散列、并发冲突、原始权限、幂等和审计；人工编辑不调用模型、不产生 AI 任务或费用，重新审阅新交付。
3. 将云端程序输出与实际网页截图纳入同一任务的执行和网页标签，覆盖所有角色；分页在后端按记录类型过滤，避免仅过滤第一页误报无记录。
4. Desktop 同一成果工作区展示真实本机命令与文件变更事件；按当前公司任务标识绑定记录，保留本机执行、原生权限及无边框。旧记录不臆测归属。
5. 新工作中显示所选角色的实际交付类型、示例、依赖就绪与人工验收状态，允许明确选用示例；消除固定角色数量及多余首次必填。
6. 同步两套渲染源的作用域清理、未确定提交重试、键盘/双语/主题/长内容布局。保存文件时不自动重放不确定写入。
7. 所有代码包完成后统一运行六仓库构建、相关回归与实际线上旅程；汇总失败为完整修复批次，保留各版失败回执。
8. 交付新客户端与服务器版本、双语 README、实际截图/交互记录、需求覆盖层、回滚方案，普通推送对应分支。

既有测试邮箱和受信 Windows 签名排除项不变。视频/语音及 Google/Meta 的真实配置、至少12角色的客户专业评审、完整兼容/生产运行与灾备验收继续推进，不能通过本轮工作区更新自动判定为完成。

English: Implement the complete round before integrated builds/tests. Add authorized pinned comparisons and manual text revisions, task-bound cloud/native execution views and contextual role guidance. Preserve full product scope, prior failures, company-only AI, local Desktop Codex and native Side Panel; professional and production qualification require their own evidence.
