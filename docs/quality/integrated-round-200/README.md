# 200 · 完整设计制作与可核对交付

本轮按“完整代码批次→全端统一构建／回归→实际页面联调→整批调试复验→打包上线”交付。新增六种中英版面、固定共享图片加入／替换、精确数据图表选择、新空白页与全部页面尺寸原子适配，贯通原草稿、撤销、不可变版本和真实文件交付。Desktop保持客户本机Codex、原生权限、无边框及无Electron菜单。

| 内容 | 实际证据 |
| --- | --- |
| 统一构建／回归 | 六端最终构建、Desktop主进程／渲染类型、631项相关断言；状态修正后重新执行Web49／Desktop308，未变组件按摘要沿用本轮原断言与回收证据；[汇总](test-summary.json)，不称全部再次执行 |
| 完整隔离旅程 | 原生PostgreSQL、真实Web／服务器／渲染／ZIP。明确模拟营销数据，实际图片与同口径12.34567800／7.00000000图表、新页、全页适配、版本2、16MBZIP；请求0／账务0；[回执](isolated-production-journey.json) |
| 实际线上／客户端 | 原域名真实HTTPS、新模板工程、版本2及实际ZIP，最终Desktop0.7.13新PKCE／无菜单／无边框、同工程版本3可回Web读取；主进程与固定Codex字节同原包；保存提示区分真实已保存版本／未保存草稿；[回执](live-production-journey.json) |
| 部署／下载 | schema163、候选就绪及活动任务0，原凭证及DB／代理进程不变；全部三包和校验文件内网完整HTTP／SHA通过；公开实际链接下载事件仍有超时，逐项保留；三包与校验文件公网完整字节／SHA核对为True；[部署](deployment.json)、[逐项下载结果](public-downloads.json)、[独立公网整文件](public-stream-bytes.json) |
| 保留失败 | 首次45项数据库启动恢复失败和2项状态码预期错误；查询就绪后统一复验。143项断言通过后回收器因一项进程存活检查返回1，原状态保留，V3核对进程结束及15份目录实际回收；不冒称再次执行143项。首次UI选择器混淆同值spend／CPA，新驱动明确指标；[原尝试](retained-attempts.json)、[实际回收](owned-cleanup-recovery.json) |
| 原始范围 | [32组／102条](requirements-102.md)、[完整JSON](requirements-overlay.json)；不以本轮通过或TODO0关闭全部应用验收 |

Backend0.5.8／Web0.5.9，Desktop0.7.13，Delivery0.5.7；Admin0.5.2及Extension0.5.7保持原产品版本。下载位于[产品下载页](https://agent.copypaste.hk/downloads)及不可变/releases/20002/，旧版本保留。Windows受信签名依用户要求排除；插件为可加载解压ZIP，未声称Chrome商店上架。

真实视频／语音、Google／GA4／Search Console／Meta等外部凭证，全部19角色／50Skills专业样本、完整机器／任意应用／长稳／生产／灾备矩阵和WorkBuddy同任务盲测继续开放。测试邮箱按用户要求保留。服务器普通HTTP客户端外网探测403/1010与真实浏览器结果分别记录，未改变防护或替换响应；本轮SSH原域名TLS验收不证明开发机直连恢复。本轮浏览器、Desktop、原生数据库与临时传输均已关闭；数据库完成checkpoint并保留数据，清理脚本因已消失的别名父目录返回1，后续只读核对实际进程／路径已回收，保留原失败于[runtime-cleanup.json](runtime-cleanup.json)。

[需求](../../requirements/200-design-production-round.md) · [开发](../../development/200-design-production.md) · [更新](../../changes/200-design-production.md) · [实际素材与哈希](actual-media.json)

English: The complete code batch precedes unified builds/tests and actual UI integration. Six layouts, fixed image/evidence resources, exact compatible charts, new pages and atomic whole-document resizing connect to deterministic previews, immutable versions and actual delivery. Six builds and631 relevant cases pass. Isolated explicitly simulated fixtures are distinct from actual deployed Web/final packaged Desktop and independently qualified inner/public downloads. Original failures and all102 requirements remain; local Desktop Codex, native permissions and external/professional/production acceptance are preserved.
