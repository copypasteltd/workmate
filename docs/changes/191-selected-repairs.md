# 191 · 指定问题修复 / Selected fixes

- 02：修复长SSE行正则阻塞事件循环、活跃推理续租、周期心跳被无关身份读取阻塞、单次网络抖动直接取消；实际最终Desktop完成本机命令/文件及结算。
- 03：有界原始错误码上报、服务端持久化、完成幂等校验、重启保留与界面显示；网络中断原因与财务待对账独立保留。
- 04/05：增加Linux原生Node/API/SQLite与Chromium隔离执行、二进制批准清单、systemd自身委派、回执及清理；实际Web下载交付通过。
- 07：schema162统一待对账执行容量判定；三条旧QA请求经实际后台有审计释放容量，未知金额与预留不变。
- 12：按用户明确指示移出范围。交付0.7.4未签名手动安装器，保留旧发布和标签。
- 补充六仓双语README、真实截图/Web下载交互GIF、逐文件散列、部署及失败记录；本轮只声明相关定向与实际业务验证。

English: repair local execution/error durability and live renewal; enable native Linux program/browser work; release ended execution capacity through evidence-based admin operations without inventing fees. Item12 is excluded. Add an unsigned manual Desktop build and source-bound bilingual evidence; preserve old releases and unrelated gaps.

[方案与验证](../development/191-native-execution-and-capacity.md) · [机器证据](../quality/191-selected-repairs.json)

最终补充：本轮失败QA另1条请求也经后台终止证据和审计释放容量。最后只读复核两个自有QA企业：8条待对账本机任务均不占执行名额，仍持有供应商容量的请求为0，本机任务组无残留进程；4条已释放请求费用均仍unknown，原财务预留保留。

Final observation: one additional failed QA request had capacity released through the same audited evidence workflow. Both owned QA workspaces have zero held provider requests and zero occupied execution slots; eight native tasks retain reconciliation state, unknown fees and original reservations. No native task process remains.
