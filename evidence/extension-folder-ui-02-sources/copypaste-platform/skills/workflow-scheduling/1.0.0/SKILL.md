---
name: workflow-scheduling
description: Prepare a version-bound private cloud schedule from a conversation or an existing method for explicit customer activation.
---

Help the customer turn repeated work into a clear, bounded routine. Ask for the intended inputs, expected output, daily or weekly local time, an explicit IANA time zone, missed-run policy and optional end. Hong Kong time is Asia/Hong_Kong; do not silently assume it when the customer has not specified a zone.

Use workflow_validate, workflow_save and workflow_publish to prepare an immutable private cloud workflow. Read real authorized evidence and fixed versions; do not invent workflow, dataset, role or source IDs. Exact role/Skill hashes and per-step budgets come from the company tools. Do not convert missing input into an assumed permission, an outside publication or an external write.

Use workflow_schedule_preview to review the exact published workflow version, calendar, source inputs, output expectation, upcoming times and per-run maximum. Explain that preparation-task fees are separate from later child steps and that the same fixed data version is reused unless the method explicitly provides a supported fresh-input tool. Do not describe a fixed dataset as a live daily refresh.

When the customer asks to save the routine, workflow_schedule_request creates a PENDING request. It cannot activate or reserve child fees. Tell the customer to review and explicitly activate the request in their interface. Never claim a prepared request is active. The original consultant task must finish successfully and sources must remain available before customer activation.

Use workflow_schedule_status for actual activation, trigger and run outcomes. A timer launch is not a completed delivery. Human review steps still wait for the customer each run. Failed work blocks further triggers for review; never silently restart unknown results or charges. Pausing future times preserves current work, and cancelling a current workflow is a separate action. A revised schedule creates a new reviewed version; original runs keep their method and budget.

Desktop keeps its customer-local Codex and native local schedules. Cloud scheduling tools are absent on Desktop; do not call cloud activation endpoints or offer a cloud replacement for local execution. Web and the native Chrome Side Panel use company cloud Codex. All AI calls go through the company gateway.

中文：先向客户确认输入、输出、时区、频率、具体时刻、漏跑处理及截止时间，再准备固定的私有流程版本。定时提案只保存为待确认，不启用、不预留子任务费用。客户在界面核对方法、资料版本、输出和每次预算后明确启用。固定数据不会自动变成实时来源；人工审批点每次保留。失败后阻止未来触发并等待核对，不重放未知收费。暂停未来计划与取消当前工作分别处理。Desktop 始终使用本机 Codex 和本机计划。
