# 202 · 营销证据复核与交付

本轮完成来源／私人报告历史搜索分页、全部独立口径的精确指标复核、来源及缺失原因展示、免费HTML／CSV／JSON证据导出，以及明确授权付费分析后未知结果的原请求锁定／刷新恢复／同键继续。Web与Desktop共享业务逻辑，原生保存有界且检查会话和摘要。全部代码及计划用例先完成，再统一构建、测试和真实页面联调；失败保留并整批修正。

Backend0.5.10、Web0.5.11、Desktop0.7.15、Delivery0.5.9；Admin0.5.2／Extension0.5.7产品版本保持。Desktop在客户本机运行固定Codex并保留明确可撤销完整权限、无边框／无Electron菜单；Extension仍为原生右SidePanel及明确文件读取上传，Codex在云端。全部AI经公司API，确定性复核不收模型费用。

| 内容 | 实际证据与边界 |
| --- | --- |
| 代码／构建／回归 | [构建前快照](implementation-batch.json)、[最终源码及三份补充原生preload](final-source-manifest.json)；六端构建／Desktop类型及677项相关用例有通过证据，保留原失败及精确沿用／重跑来源；[汇总](test-summary.json) |
| 隔离真实页面 | 原生PostgreSQL、实际构建Web、13口径与精确八位证据、三种实际下载、375／768／1024／1440和明暗主题；提交已成功但响应丢失后刷新，明确继续仍只一个私人任务／预留；业务数据／故障注入明确为受控验收；[回执](isolated-production-journey.json) |
| 正式Web／最终Desktop | 实际HTTPS、13口径及三种导出，最终0.7.15新S256授权／无边框／无菜单及原生保存，文件字节／SHA与Web一致。原付费任务金额不变；此轮不新增付费模型任务，保存路径是自动选择的专属测试位置；[回执](live-production-journey.json) |
| 应用上线 | schema163与凭证保持；候选就绪及活动任务0后只切换Workmate应用。现有端口、下载alias和静态入口保留，原应用及旧包可追溯；[部署](deployment.json) |
| 服务器网络 | DNS／hosts／netplan／防火墙／反代的9份文件、实时路由与规则相同；防火墙导出只替换生成时间注释即可重构原基线SHA，其他全部字节相同。无网络设置修改，无Nginx改写／重载；[核对](network-preserved.json) |
| 完整下载 | 四文件内网完整200及公网原TLS全部206内容重组后验证完整SHA／字节，三正式域名就绪和实际下载链接通过；[下载](public-downloads.json)。旧包保留，插件ZIP仍是原0.5.7字节，无商店发布声明 |
| 连通性范围 | [开发机原HTTPS直连](direct-browser-readiness.json)三健康200，另有仅允许公司域名的独立SSH出口验收。某些普通服务器HTTP客户端仍遇到Cloudflare1010，此轮未修改其策略；首次HTML／超时及后续真实复验均保留 |
| 原始目标 | [全部102条／32组](requirements-102.md)、[JSON](requirements-overlay.json)；真实生成视频／语音、Google／Meta授权、19角色／50Skills专业样本、完整机器／任意应用／大文件／长稳／容量／灾备／客户效果和WorkBuddy同题盲测仍保持开放 |

[产品下载页](https://agent.copypaste.hk/downloads) 使用不可变 `/downloads/releases/20201/`。Windows受信签名按用户要求排除。自建浏览器、Desktop、原生数据库和临时传输已按所有者回收，保留用户既有程序；[清理](runtime-cleanup.json)、[失败与原尝试](retained-attempts.json)、[真实PNG／GIF／MP4](actual-media.json)、[实现及使用逻辑](../../development/202-marketing-review.md)。上述增量不能据此把完整goal标记为完成。

English: Complete the code batch before unified verification. Searchable authorized history, complete exact evidence review, free bounded exports and persisted same-request paid recovery connect actual Web/final native Desktop.677 distinct related test cases have passing sources with retained failures and explicit corrected replays. Deployment changes only the owned application; all original server network configuration/rule fingerprints remain equal. Whole inner/public download bytes are verified. Controlled CSV/fault injection, production services and direct/SSH connectivity scopes remain explicit. All original102 requirements and remaining external/professional/production acceptance stay traceable.
