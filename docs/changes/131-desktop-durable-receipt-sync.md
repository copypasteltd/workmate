# 本机子任务回执持久同步 · 阶段131

本轮修复子任务完成请求未送达或其确认响应丢失时，父任务收尾清掉子任务报告的问题。子任务和父任务现在分别保留原任务与原报告，按先子后父的顺序同步；子任务收到匹配的有效终态确认后，才可清理父操作。

| 编号 | 本轮事项 | 结果与实际证据 |
| --- | --- | --- |
| 131-01 | 保留子任务完成报告，父收尾先补子回执 | 旧/新版同一日志对照：旧版遗漏子完成请求，新版先子后父 |
| 131-02 | 稳定原任务、报告与请求标识 | 真实SQL覆盖请求未送达和结算后响应丢失；成功子任务只有一次结算及一笔原预留 |
| 131-03 | 区分已知子任务与未知父任务 | 子任务结算60测试微元；父任务原预算保留在reconciling，不自动按成功扣费 |
| 131-04 | 重启、撤权、过期与账号边界 | 15项新增控制边界；真实撤权后控制器恢复，以及完整打包应用退出/重启后同步通过 |
| 131-05 | 待同步双语说明和同步入口 | 实际4截图、2段实时交互，每段均有GIF及MP4；不是拼接的响应示意图 |
| 131-06 | 保留所有原始失败 | 新增状态字段缺失、三条不完整模拟回执、三条错误父账务预期均保留原报告/脚本/源码快照 |
| 131-07 | 维护交付与完整编号台账 | 六份双语README、逻辑图、实现说明、原始证据、独立发布清单；全部102条完整验收记录继续保留 |

通过124项控制层检查、43项实际固定Codex检查、3条实际原生/SQL流程、2项编译和8项实际未签名Desktop界面检查。原生流程与界面均执行真实命令和文件操作；公司服务使用实际原生PostgreSQL，模型响应与客户选择使用明确测试输入。真实界面主动丢弃已提交的HTTP完成响应，确认本机不会进入QA或重放已完成命令。

两次录屏分别覆盖“回执丢失→明确待同步→撤销本机权限”和“重新打开应用→同步原回执→保持父任务待核对”。录屏期间没有跳过截帧错误；退出第一个应用进程后启动的新应用仍使用原本机日志及账号。三个真实窗口宽度继续保持无边框、无默认Electron菜单、无可见滚动条和无横向溢出。

首轮真实SQL检查的失败来自错误的测试预期：要求未知父任务产生已结算账单。实际服务按既有约束保留父任务预算用于核对，后续新版本测试据此检查，而非修改账务规则。已执行QA文件的原始字节（包括原有末尾空行）保留，不通过改写已执行脚本美化历史结果。

所有本轮创建的浏览器、原生Codex进程、打包Desktop、API和原生数据库均已关闭。Desktop主仓库原有`.gitattributes`字节保留。阶段128的357840项历史证明与阶段130的7754项增量证明各自保留；阶段131新证明只描述本轮当前路径，不重标历史结论。

常规发布使用`docs/tools/publish_receipt_sync_131_v1.py`，从阶段130已核对的远端状态做普通原子推送，核查全部八个远端分支并保留真实回执。实际远端提交以最终推送回执为准。用户已有无关清理文件独立保留。

| 编号 | 继续处理的范围 | 本轮边界 |
| --- | --- | --- |
| NEXT-01 | 任意崩溃、旧进程回收、跨节点及跨登录族恢复 | 本轮实际应用重启发生在所属Codex已经完成并关闭后 |
| NEXT-02 | 父任务费用核对与所有未知结果矩阵 | 本轮保留未知父任务原预算，不自动确认其副作用 |
| NEXT-03 | 全专业角色、三端、全部工具与权限组合 | 本轮验证流程顾问和开发子任务；QA受失败门槛阻止 |
| NEXT-04 | 正式内部模型/媒体、平台连接器、签名安装更新 | 使用测试模型与未签名包，未宣称生产验收 |
| NEXT-05 | 完整状态文案、使用引导及整个产品交付 | 当前完整编号台账保持89必需、12未确认建议、1可选开放 |

[实现方案](../technical/131-desktop-durable-receipt-sync.md) · [源码与媒体检查点](../quality/receipt-sync-checkpoint-131.json) · [原始证据](../quality/receipt-sync-evidence-131/index.json) · [完整编号待办](../quality/remaining-work-stage131.md)

English: Preserve the original child receipt until it is acknowledged, then report the original parent outcome. Known child usage settles once; an unknown parent retains its original hold for reconciliation. Actual native/SQL and unsigned packaged-app restart journeys passed. Model/dialog choices are synthetic. Original failures and executed QA remain unchanged; all 102 full-acceptance records retain their original open status.
