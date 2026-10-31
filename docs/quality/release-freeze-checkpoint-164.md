# 164 · rc.4 当前构建核对 / Current build qualification

状态：qualified。六个仓库生产构建与Windows打包共7条命令通过。实际ASAR中 64 个主进程/界面输出逐文件与当前构建一致；Codex四文件摘要与固定版本0.163.0-alpha.11一致。生成Windows完整目录、Portable及NSIS Setup；未新增实际安装验收。

Seven actual build/packaging commands passed. All 64 current native-main/renderer files match the actual ASAR bytes. Four Codex files match the pinned runtime. The unpacked app, Portable and NSIS installer were generated; installed-client acceptance is not newly claimed.

| 编号 | 定向范围 | 结果 |
| --- | --- | --- |
| 1 | 平台、Web、Admin、Desktop、Extension、Delivery构建 | 6项通过 |
| 2 | Windows三种分发 | 生成完成 |
| 3 | 当前ASAR和固定Codex | 字节一致 |
| 4 | 阶段163 HTTP及实际Web/SQL旅程 | 28项结果、3组旅程；源码摘要一致，复用原范围 |
| 5 | 阶段162启动检查 | 9项；源码摘要一致，复用原范围 |
| 6 | 首次ASAR检查 | Windows路径格式误判；原失败保留，v2使用原生路径复核通过 |
| 7 | 生产/签名/跨系统/全专业验收 | 仍按原编号开放 |

未改写已执行验证器或原证据；v2复核同一批构建，不重跑全量历史测试。No executed verifier or original evidence was overwritten. v2 checks the same build with native Windows paths. Broad historical regression is omitted by user request.

[完整数据 / Exact report](release-freeze-checkpoint-164.json) · [使用 / Guide](../releases/v0.1.0-rc.4.md) · [102原编号 / Original IDs](remaining-work-stage164.md)
