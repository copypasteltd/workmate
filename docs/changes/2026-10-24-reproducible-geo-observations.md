# 可复核的 GEO 观测 / Reproducible GEO observations

原 GEO 缺少固定问句/配置与原始回答记录。本次新增不可改写的完整 Agent/skills/模型别名配置、独立重复 Codex API 任务、原文资产与哈希、配置差异对比和真实 JSON 导出。消费者人工样本明确标为用户提供，保留未知模型/检索状态，不与 API 样本混算，不调用模型。字面别名和回答链接不冒充提供方核实、全网排名或因果收益。

服务端检查整组任务名额及预算，原子创建；私有 RLS、独立后台正文权限、项目范围内容控制、已发布副本的来源继承、过期及物理删除覆盖新类型。未知用量保持待核实，不产生虚假零费用。

实际验证暴露并修复了两项产品问题：规范导出曾把数据库 Date 写为空对象，并可能输出未定义答案；现先归一化 JSON，保留 ISO 时间并省略缺失原文。配置版本表单的异步 Agent 选项曾丢失已有选择；改为受控选择并核对原 Agent。原 Web 800×600 固定偏好控件遮挡下载按钮的问题用实际点击/下载复测修复。原生 Side Panel 文档创建时 URL 暂为空，测试等待实际 documentUrl 导航完成，未降低原生侧栏断言。全部早期失败回执和源码归档保留。

English: Immutable GEO harness/question versions, independent repeats, exact retained answers and separately attested consumer samples now support reproducible observations. Current source/owner checks govern exports, publication copies and derived reads. Atomic admission preserves plan/wallet limits; unknown usage remains under reconciliation. JSON date/missing-value serialization, asynchronous Agent selection and the compact Web preference overlap were fixed through actual failures. Native Side Panel testing waits for its actual document navigation. Original failed receipts are preserved.

Desktop attempt 45 passed 22 functional checks but exceeded a 60-second long-recording encoding wait and remains failed. Its exact sources and original media are retained. Only that encoding wait changed to 180 seconds; product code, functional/media assertions and the outer owned-journey deadline were unchanged. A new complete journey is required. 第 45 轮的编码超时不计为通过；仅调整编码等待时间，全部功能与媒体断言保留，另用完整新轮次核对。

Attempt 46 passed 36 checks, including the new compact GEO entry and feedback workflow, but the final locale step still expected the local home after the GEO helper had left the marketing route active. It remains failed. The helper now returns to the local workspace and waits for its actual heading before the existing feedback/locale checks. No product or assertion is removed. 第 46 轮的最后语言步骤暴露测试页面恢复遗漏，补齐实际本机首页等待后重新完整验证，失败凭据保留。

Full backend qualification 32 stopped at batch 05: the unchanged complete-inventory check detected all eleven new GEO operations missing from the descriptive route file. The failed batch remains failed, and every source snapshot was archived before refreshing the inventory from the actual app. Both published descriptive copies now list 465 configured operations plus one conditional demo route, retaining every previous route. New native/UI/client qualifications bind the refreshed inventory and unchanged runtime; the final full backend run also covers the later test expectations described below. 第 32 轮真实检出清单漏记接口；保留失败回执并同步完整路由清单后，使用新轮次复核，未删除或放宽原清单断言。

Backend run 33 stopped at batch 08 because its historical 098-to-099 fixture also applied SQL100. That fixture now explicitly stops at 99, preserving its original source OID/prepared-reader/data assertions. Two separate populated-upgrade expectations are proactively advanced from latest version 99 to 100. No product/runtime byte changed. Exact old bytes and failed receipts are archived. Final qualification uses unchanged-source passing batches 01–07 from run 33 and freshly executes 08–19 in run 34, including both changed test files. Every actual test file is covered once with current runtime/test/helper bytes; no failed receipt is relabelled. 第 33 轮实际失败为历史夹具范围，明确限定原迁移目标；另同步最新版本预期。两个受影响批次重新执行，其他通过批次须满足源码字节一致才能计入。

Desktop remains local Codex, frameless and without Electron menus or visible scrollbar rails. Real scroll/keyboard/focus/progress are retained. Its GEO button is an explicit fixed company-browser handoff; the local GEO protocol remains open. Extension remains cloud Codex plus authorized attachments in the real right Chrome Side Panel.

Validation: platform 968/968 with every previous 946 case retained; core 22, clients 124, Web/Admin/native Side Panel 13 and packaged local Desktop 37. Synthetic gateway/model/consumer/ad fixtures only. SQL100 is additive; SQL001–099, original OpenAPI, original 102 REQ/102 TC and 83/19/0 acceptance states remain unchanged. G01–G10, professional customer outcomes, full parity, signing, performance and production readiness remain open.

[方案 / Design](../technical/83-reproducible-geo-observations.md) · [证据 / Evidence](../quality/geo-observation-checkpoint.json) · [契约 / API](../contracts/geo-observation-openapi.json)
