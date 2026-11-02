# 191 · 指定修复范围 / Selected repair requirements

用户指定修复190清单的02、03、04、05、07。随后明确“那么去掉12”；因此12（Windows受信代码签名、正式分发/自动更新验收）从本轮范围移除，不要求证书或以证书阻止交付。仍交付新的未签名手动安装包，旧冻结发布不覆盖。

|编号|完成条件|本轮证据|
|---|---|---|
|02|客户本机固定Codex、真实公司模型、主动本机权限、真实文件/命令与实际结算|最终0.7.4实际任务完成，HK$0.035144，并验证撤销权限|
|03|原始本机错误在本地/重启后保留，并原样分类回传服务端|断流分类、本地日志重载、服务端finish持久化和幂等验证|
|04|Linux服务器实际运行批准程序并交付结果|原生隔离Node/API/SQLite、超时/拒绝验证及真实用户任务|
|05|Linux服务器实际运行浏览器、交互、断言、截图与清理|原生Chromium表单填写/点击/截图，下载散列验证|
|07|有结束证据的本机任务不再占执行容量；未知费用仍保留|三条自有QA请求经后台审计释放容量；旧任务/预留原样，原企业新任务成功|
|12|移出本轮|不要求受信代码签名或自动更新验收|

内核唯一Codex；AI经公司逐模型上游配置。Web/Extension在云端执行，Desktop在客户本机执行并可由客户授予完整本机权限。原有无边框、无Electron菜单、Chrome原生右侧栏及品牌风格约束继续生效。

本轮不把190的01、06、08—11、13—14改成完成，也不把未知供应商账目判成零。旧错误码缺失无法追溯补造。测试收件箱继续保留。最终没有重跑全产品所有历史测试。

English: the owner selected02/03/04/05/07 and explicitly removed12. Acceptance requires actual supplier-backed local execution, durable original errors, native Linux program/browser operations and evidence-based capacity release without financial fabrication. Signing and automatic update qualification are excluded. Other numbered gaps retain their original scope. See the [implementation and evidence](../development/191-native-execution-and-capacity.md).
