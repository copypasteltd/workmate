# 201 · 从视频模板到真实成片

本轮先完成整批代码，再统一六端构建、测试和真实页面联调。六种中英营销视频版面／三画幅，原子镜头编排、字幕映射、帧率与音轨入点转换，实际交叉淡化／向左滑动转场，当前权限核验的单帧PNG预览、素材搜索分页、撤销／重做和明确分区草稿恢复，已贯通不可变版本、工程恢复、成片播放与真实下载。

Backend0.5.9、Web0.5.10、Desktop0.7.14、Delivery0.5.8；Admin0.5.2、Extension0.5.7保留原产品版本。Desktop仍在客户本机运行Codex并保留明确完整权限、无边框／无Electron菜单；Extension仍为原生右SidePanel与明确文件上传。全部AI请求经公司服务器，模板渲染不调用模型。

| 内容 | 实际证据与边界 |
| --- | --- |
| 整轮代码 | [构建前809源码清单](implementation-batch.json)、[最终清单](final-source-manifest.json)；先完成整批，再统一验证；整批修正与失败保留 |
| 构建／回归 | 六端构建、Desktop类型及624项相关断言有通过证据；其他后端123项沿用原通过运行，5项视频在修正故障注入及模板文案后复验，全部客户端原通过运行按源码摘要绑定；[汇总](test-summary.json) |
| 实际隔离页面 | 真实Web、原生PostgreSQL、公司渲染器、390帧MP4及实际下载／播放、原稿恢复，375／768／1024／1440精确宽度无横向溢出；业务数据明确为模拟；[回执](isolated-production-journey.json) |
| 实际线上／Desktop | 公司真实HTTPS、视频预览／成片／下载，最终安装包新S256授权、同一Web工程接续版本2；旧版本1成片保留，原AI任务扣费不变；主进程与本机固定Codex字节未变；[回执](live-production-journey.json) |
| 上线／下载 | schema163、原凭证和数据库／代理进程保持，候选就绪与活动任务0后切换；补齐原生FFmpeg／FFprobe后实际成片通过。四文件内网整文件200及公网全部206分段内容重组后完整SHA／字节核对，下载入口／HEAD／Range及三域名就绪；[部署](deployment.json)、[下载](public-downloads.json) |
| 原始范围 | [32组／102条](requirements-102.md)、[JSON](requirements-overlay.json)；全部19角色／50Skills专业样本、真实生成视频／语音、Google／Meta授权、完整机器／任意应用／长稳／容量／灾备／客户效果与WorkBuddy同题盲测仍开放 |

[产品下载页](https://agent.copypaste.hk/downloads) 使用不可变 `/downloads/releases/20101/`，旧包保留。Windows受信签名按用户要求排除；插件ZIP可加载，不声称Chrome商店发布。本轮原域名TLS经独立、仅允许三公司域名的SSH出口，保持原证书和响应，不证明开发机直连恢复。自建浏览器、Desktop、原生数据库与临时传输均已回收；[清理](runtime-cleanup.json)、[原尝试](retained-attempts.json)、[真实PNG／GIF／MP4](actual-media.json)。

English: Complete the code batch before integrated verification. Six bilingual motion starters connect atomic timing/caption/rate editing, actual transitions, authorized frame previews, fixed resources, undo/recovery, immutable versions and actual playable MP4 delivery. Six builds/types and624 distinct relevant assertions have passing evidence, with unchanged runs and corrected replays identified. Actual isolated fixtures remain distinct from production Web/final packaged Desktop. All original102 requirements remain; external/professional/production acceptance is still open.
