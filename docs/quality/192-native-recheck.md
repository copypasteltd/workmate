# 192 · 再次复查结果 / Recheck results

发现并修复两处遗漏：待对账遮住原始本机错误；错误码正则允许尾部换行。Backend、Web、Admin已上线。当前所选功能闭环取得下列证据；不是全产品零错误或完整业务矩阵验收。

|编号|复查范围|本轮结果|
|---|---|---|
|02|客户本机Codex、真实模型、文件/命令、实际结算|完整0.7.4流程通过；新后台上的独立本机任务成功，BOM输出经只读复核；不覆盖失败包装器回执|
|03|本机原始原因与待对账同时可见|实际旧任务修复前/后对照；用户与后台直连页面通过；未知费用状态保留|
|04|Linux程序、API、SQLite执行|实际原生检查和真实云任务通过|
|05|Linux Chromium交互、断言、截图、交付下载|8项原生检查、实际云任务及ZIP/源码/回执SHA-256核验通过|
|07|结束任务释放执行容量，保留未知费用|旧任务和请求仍待财务核对，但不占容量；同一企业新任务成功；结束后0本机残留执行组|
|12|Windows受信签名|按要求移出，0.7.4未签名手动安装包保持原样|

|最终常规检查|通过/总数|
|---|---|
|Backend针对性回归|91/91|
|Web|30/30|
|Admin|22/22|
|Extension|89/89|
|Desktop控制器|74/74|
|Linux原生运行检查|8/8|

真实云任务0106f3ed-cd7f-45ac-a3c9-417a08b7f42e费用HK$0.106047；上线前Desktop任务12a332c0-ecc3-4cf1-8f69-0ef902009566费用HK$0.040595；上线后Desktop任务630ce1e9-b6f2-4e3d-a386-3ad619bcccf9费用HK$0.055477。均为实际测试消耗，不是充值或虚构结算。实际Node与浏览器执行使用相同源码散列，下载包包含准确源码和两份原始检查回执。

普通Chromium不走QA代理直连三个正式域名均200，用户任务与后台错误页面也直连通过；同一网络Python直接GET三域名均403。两组证据均保留，不能据此宣称所有客户端或公网长期稳定。实际模型/云端/桌面付费流程使用记录中的原始CONNECT通道，TLS、模型内容和账务未替换。

未选范围继续保留：190的01公网长期一致性、06Linux Office、08视频、09音频、10Google、11Meta、13全部真实业务矩阵、14生产配置/测试邮箱边界。用户此前要求保留测试收件箱，当前仍是local_development，不宣称真实SMTP已接入。本轮未重新进行图片生成或安装版扩展上传，不用历史通过代替本轮实测。

原失败验证和部署检查见 [尝试历史](native-recheck-192/attempt-history.json)。本轮创建的浏览器/Electron、CONNECT监听和原生测试数据库均已关闭，服务器无残留执行组；未使用本地Docker/WSL/虚拟化。数据、旧费用和发布未覆盖。

The selected workflows are verified within this scope. Two additional diagnostic defects were repaired and deployed. The failed post-deployment wrapper stays failed; a separate read-only check validates the completed task and its original BOM-bearing file. Unselected integrations, the full business matrix, production mail and long-term public consistency are not accepted by this report.

[机器证据 / Machine evidence](192-native-recheck.json) · [实现 / Implementation](../development/192-native-error-observability.md)
