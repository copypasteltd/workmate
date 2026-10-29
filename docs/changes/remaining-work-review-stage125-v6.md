# 未完成项核查v6 / Open-work review v6

本轮按用户要求整理全部编号待办，保留原需求ID，不以新增工作包重复计数。必需交付89条未完成整体验收，其中77条部分验证、12条未证完成；另外12条未确认扩展建议和1条可选项，共102条开放记录。这是需求验收数量，不能解读为89个未编码模块或开发完成百分比。

| 编号 | 本次完成的核对 | 仍待处理 |
| --- | --- | --- |
| 1 | 102条ID唯一、89/12/1分类、77/12必需状态及七类模块数量已核对 | 没有新增整项验收关闭；全部差额见编号表 |
| 2 | 当前Extension 70/70、Desktop 21/21原始回执、日志和捕获源码SHA匹配 | 两端新增发布功能的实际原生页面、权限变化和真实录制 |
| 3 | Web/Admin实际页面03原始失败、源码及清理证据已核对 | 模拟OAuth表单策略阻塞、客户确认发布及后续Admin页面旅程 |
| 4 | 03自建浏览器、API、夹具、原生数据库回收记录及端口关闭已核对 | 其余跨端、异常、角色专业业务和完整相关回归 |
| 5 | Desktop未签名开发目录包实际存在并记录SHA | 正式签名安装/更新/卸载及实际安装验收 |
| 6 | 六组件HEAD与远端八分支已读取，中英双语文档入口已更新 | 本轮125产品源码、双语组件README、成功截图/GIF、独立检出和整合推送 |

Web/Admin的类型检查与构建成功不能替代实际旅程。03客户登录一项通过后，模拟账户授权提交被浏览器`form-action`策略阻断；尝试的CSP修正没有通过，不记作问题已解决。Admin后续页面未执行。后端05仍为110项中107通过、2失败、1取消，06专项29/29保留为原源码限定证据，当前平台源码已变化。所有旧失败、回执、运行器和截图原文保留。

v5核查器把后端证据内的仓库前缀重复拼接，导致后端差异列表无效；v6按规范前缀定位，并要求每个捕获路径实际存在后再计算SHA。数量不受影响，v5原文保留并由v6明确标记失效部分；已执行的v5工具和报告不改写。

中央仓库仅为v6核查工具增加精确字节属性，保留执行时的Windows换行；已核对暂存Git对象与原始工具SHA一致。Desktop仓库的属性文件未改动。

This review reconciles all 102 unique requirement IDs: 89 required records remain open (77 partial and 12 completion-not-proven), with 12 unconfirmed design suggestions and one optional record tracked separately. No full acceptance record was closed. Fresh receipt/hash checks retain the exact scopes of the 70 Extension and 21 Desktop logic checks. Actual Web/Admin run03 failed after customer login because the synthetic consent submission was blocked by browser form-action policy; the attempted correction is not accepted, and later Admin pages were not reached. Owned resources were reclaimed, recorded ports were rechecked closed, and all earlier failures remain intact. The unsigned Desktop directory package is identified by its actual bytes. Product-source integration, bilingual component guides, successful native captures and publication remain open.

The v5 inventory verifier incorrectly prefixed backend capture paths twice. Its backend difference list is invalid and preserved as such. The new v6 verifier resolves canonical prefixes, requires each captured file to exist, and then compares actual hashes. Counts and original execution receipts are unchanged; no executed verifier or report was edited.

本次只同步中央文档，不宣称阶段125产品源码已经发布；远端组件仍为阶段124。继续使用用户已授权的模拟数据，正式提供方与专业业务质量验收单独保留。

[完整编号表 / All numbered records](../quality/remaining-work-current-review-125-v6.md) · [证据与范围 / Evidence and limits](../quality/remaining-work-current-review-125-v6.json) · [只读核查工具 / Read-only verifier](../tools/record_open_work_review_125_v6.py)
