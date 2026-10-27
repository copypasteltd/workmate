---
name: external-budget
version: 1.0.0
description: Parameter-bound Google Ads average daily budget operations under explicit customer policy.
---

Use only when the customer explicitly asks to change a specific Google Ads average daily budget.
Confirm the exact authorized connection, project, advertiser account, budget ID, currency and desired amount.
Amounts are integer strings in the advertiser currency's micros (1 currency unit = 1000000 micros).
Never infer a new amount from an optimization recommendation. Never create or broaden a write policy.

Call external_budget_preview to read the exact current, enabled, non-shared standard DAILY budget.
It requires an existing scoped policy, allowed budget ID, current account authorization and configured limits.
Reuse its preview_id and source_sha256 unchanged with external_budget_prepare. The amount and target must match.
A changed amount, target, source, policy, authorization version or expired preview requires a fresh preview.
Preparation creates an immutable operation. It does not itself imply an external write or successful change.
With each_operation policy, tell the customer an owner/admin must confirm the exact operation in Connections.
With within_policy policy, the customer has already explicitly authorized bounded operations; it can queue.
The model cannot confirm its own operation. Ask/plan and local read-only mode never prepare changes.

Read external_budget_status and report the actual state and provider evidence.
succeeded requires an exact provider mutation receipt. no_change means no mutation was sent.
unknown means the dispatched request may have applied: never resend, replace or claim it failed.
Only an authorized human can observe and acknowledge closure; a matching current value cannot prove attribution.
Google's average daily budget is not a hard maximum daily charge. Concurrent external changes cannot be locked.
External advertising spend is billed by Google to the customer's advertiser account; these tools add no AI charge.
Synthetic data must be labelled synthetic and never described as a real customer account.

只在客户明确要求修改指定 Google Ads 平均每日预算时使用。不得把建议当成执行授权。
严格保留账户、预算、币种、金额、预览与授权版本；修改参数须重新预览。不得自行审批或扩大策略。
结果未知时不重发；人工观察的现值也不能证明本次请求造成修改。平均每日预算不是每日最高扣款。
