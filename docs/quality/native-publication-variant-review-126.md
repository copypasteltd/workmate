# 发布缺陷同类检查 / Publishing defect variant review

日期：2026-10-29。使用 variant-analysis 技能，围绕已复现缺陷检查相同成因。范围为当前后端所有角色工具声明与来源追踪调用，以及 Web、Desktop、Extension 的相关准入显示。此为有界检查，不是完整安全认证。

| 编号 | 严重度／置信度 | 结论 | 证据与处理 |
| --- | --- | --- | --- |
| VAR-126-01 | P1／高 | 确认缺陷：工具登记遗漏同时影响目录就绪展示和角色实例创建。 | 原生检查01的五项均在创建入口收到 TOOL_NOT_IMPLEMENTED。补齐两个已有实现的工具ID；检查05实际创建新版社交角色并执行四个真实工具。 |
| VAR-126-02 | P1／高 | 确认缺陷：来源ID与版本ID混用。 | 检查04中两条图片预览收到SQLSTATE 23514；原始数据库日志指向 task_source_reads_check1。改用 source.asset_version_id，检查05验证实际来源行和源哈希。 |
| VAR-126-03 | 信息／高 | 专属云电脑的 computer.read / computer.control 不应直接加入普通角色工具登记。 | 可选专属设备需要独立运行环境和授权；未通过普通登记来放宽它。 |
| VAR-126-04 | 信息／中 | 未发现其他相同字面表达式错误。 | 检查 src 内19处固定 asset_version 来源记录调用，修复后资源ID表达式均与版本ID表达式相同；这不替代逐调用的动态安全验证。 |
| VAR-126-05 | P1／高 | 云端恢复范围缺口已复现：旧实现只重试initialize，thread/start连接丢失直接结束。 | full08实际60秒线程创建超时、零模型请求；red01以真实原生断连复现。现扩展到提交轮次前的三个启动方法，并保留两次上限及零请求／先清理／取消边界；最终资格见本轮检查点。 |
| VAR-126-06 | 待验证／中 | Desktop有独立的启动后关闭并抛错路径，未发现外层自动启动重试；不能把云端修复扩称到Desktop。 | 阅读src/local-codex.ts的start/catch及src/local-agent.ts两个实际调用点；异常进入原任务失败结算。服务端desktop-executions的running凭据可调用网关，公开状态缺少原子化零请求与旧网关撤销证明，不能只依据费用为零重启。尚未做Desktop同类故障注入，不声称已复现相同故障或完成修复。 |

角色目录逐一比较：18个业务角色及默认助手已无登记缺项。Web与Desktop仅显示服务端的 TOOL_NOT_IMPLEMENTED 原因；Extension未维护重复准入表。没有据此声称全部角色的完整业务验收已通过。

检查方法从两个精确登记ID和 publication-tools 的错误调用开始，扩展到完整已加载角色目录，再检查所有来源读取调用。TypeScript 7包默认入口仅导出版本信息，原AST探查未成功；随后使用有界调用提取并阅读周边代码，不把失败的探查计为通过证据。现有数据库 CHECK 保留，原生检查中的来源行断言用于防止回归。

English: admission/provenance defects were reproduced and corrected without relaxing database or authorization boundaries. A separate cloud startup gap was reproduced and now receives bounded pre-turn recovery. Other literal asset-version calls and all business role declarations were inspected. Desktop has a separate close-and-fail startup path; this is a source observation pending local fault reproduction and qualification. Optional dedicated-computer controls remain separate. Full role quality and product acceptance remain open.
