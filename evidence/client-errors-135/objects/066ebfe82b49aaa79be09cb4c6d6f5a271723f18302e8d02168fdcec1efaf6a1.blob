---
name: web-analytics
description: Produce source-bound GA4 and Search Console analysis from captured account reports with deterministic calculations and explicit coverage.
---

Version: 1.0.0.

Use connector_read to discover actual captured snapshots, then read the selected snapshot's fixed specification. Choose one exact account, reporting profile, date range inside the captured query and supported group_by dimensions. Call connector_read with snapshot_id and analysis to obtain deterministic metrics. Follow next_offset for group evidence; a paged result does not prove all groups were reviewed. Do not infer a live refresh, an authorization, an account ID or a source version.

For ga4_traffic use date, channel and landing_page. For ga4_events use date and event. These are separate reporting profiles. Never add totalUsers across source rows or reports: it represents distinct users, and overlapping users cannot be deduplicated from these captured dimensions. The server returns a null reason when an aggregate unique-user count is unavailable. Key events per session is a repeatable event count ratio, not a conversion rate. Revenue uses the captured property currency and can be negative after refunds. Do not mix currencies, accounts, time zones or reporting identities.

For search_performance use date, query, page, country and device. CTR is sum(clicks)/sum(impressions), not a mean of row CTRs. Position is weighted by impressions over captured byPage rows; it does not establish a property-wide rank. Search Console may omit anonymized queries or lower-ranked rows. Dates use the source's Pacific reporting zone, not an assumed Hong Kong day. Missing dates and metrics remain unknown instead of zero. Partial, sampled or thresholded data must keep its limitations visible.

Use only the returned values, evidence IDs, formula version and calculation SHA-256 when explaining findings. Separate observations from unverified hypotheses and recommended experiments. Link the provided authenticated report downloads so the customer can obtain the complete deterministic HTML, metric CSV and JSON without an extra model call. These files summarize observed source rows; they do not establish complete site coverage, causality, attribution across platforms or business ROI.

For a revision, select the explicit changed dates/dimensions and calculate again. Retain the original source and calculation digests, and do not describe an earlier report as updated in place. If access, retention or the source is revoked, stop using it and ask the customer to review a currently authorized snapshot. OAuth disconnect stops future retrieval but does not by itself delete retained historical data.

Desktop runs Codex on the customer's device with the customer's local permissions. Web and the native Chrome Side Panel use company cloud Codex. Reading captured analytics does not grant OS access or external writes. All AI calls use the company gateway; deterministic report calculation and download add no separate AI charge.

繁中：先選擇真實已捕獲的帳戶、報告類型和日期，透過計算工具取得可回溯的指標。用戶數不可跨行相加；流量與事件報告分開，收入保留退款及原幣種。搜尋點擊率以合計點擊／曝光計算，排名只對已捕獲行作曝光加權。未知值、無資料日期、部分同步、抽樣和門檻限制全部保留。修改範圍後重新計算並保留原摘要；撤權後停止使用原來源。下載不新增 AI 費用，技術計算不代表真實業務質素已驗收。
