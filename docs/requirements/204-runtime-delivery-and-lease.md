# 204 · 云端交付、工具反馈与任务续租

原始102条要求及32组验收保持完整，不以本轮范围替代完整目标。203轮有实际代码、部署、八分支发布及11类角色样例进展；营销分析仍没有图表文件，原通用工具错误无法证明具体原因。一次工作租约超时已按真实调用审计结算，根因与长稳尚未验收。

本轮先完成整批自主代码、配套用例与验证工具，再统一构建、测试和线上联调；失败集中成批修正并保留原始证据。

- 为受信工具输入验证提供有界、脱敏、可操作的错误反馈；区分参数校验、来源／权限变化与未知执行结果。不返回原异常、参数、上游响应、密钥或堆栈，不以“参数可修正”授予新的操作、费用或重复执行权限。
- 每次实际工具调用记录安全的成功／失败事件、原参数摘要和调用参考；工具结果及原业务事务仍是交付依据。输入解析失败能指明受信字段和约束；营销图表必须保留固定来源、计算摘要、证据引用及完整输出校验。
- 无法恢复的已尝试交付工具失败不得被原生完成消息覆盖成成功；同一工作内真实修正成功可解除该项失败。未解决的结果从持久化事件继承到补充资料后的新回合，最终任务状态再次核对，保留实际部分成果与已知用量。请求必要资料保持原预算／计量检查点。未知付费结果不自动重试或释放费用预留。
- 核清并修正续租与长业务事务的交互：保持原45秒期限、fencing、当前权限、撤权／取消与结算边界；不通过无限延时或跳过授权掩盖问题。测试实际长事务锁定、续租、撤权及过期情形。
- Web与Desktop在成果／活动中显示清楚的工具交付问题及恢复状态，避免大量文字事件冲掉关键反馈；工作区活动必须读取后续页。双语、双主题、品牌风格及无横向溢出保持。Desktop本机Codex、完整权限、原生登录／保存和无边框不被覆盖；Extension保留原生右侧栏与云端Codex。
- 用真实公司API对营销分析执行一项有原失败父任务、固定文件版本及预算的修正观察；保留失败，不反复提交付费样例追逐通过。完整专业设计、外部视频／语音／营销授权、所有机器与生产验收仍独立开放。
- 沿原端口／下载／静态入口只更新Workmate自身；服务器DNS、hosts、路由、网卡、防火墙、系统代理、Nginx及穿透配置只读，不改写或重载。核对配置／规则、原凭证与数据库／代理进程。更新六端双语README及实际媒体后普通原子同步八引用，不强推；27份原用户未跟踪文件保持原字节。

English: Complete the whole implementation batch before integrated verification. Add safe actionable tool validation and durable bounded execution feedback, truthful unresolved-delivery outcomes, and correct lease/transaction interaction without relaxing authority or budget controls. Preserve full original scope, customer-local Desktop Codex, company-only AI, actual failed evidence, immutable publications and read-only server networking.
