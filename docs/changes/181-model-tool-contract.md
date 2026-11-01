# 阶段181 / Stage181

修复当前 `gpt-6-luna` 完整验证时，固定 Codex 原生 code mode 与旧云端工具校验之间的不兼容；同时修复具体错误被覆盖、后台文字待对账后无法重试的问题。支持普通 function 和当前原生工具编排格式，保留业务授权、请求计费和历史待对账记录。

Fix the incompatibility between the pinned Codex code-mode wire contract and the old cloud gateway during full gpt-6-luna validation. Preserve specific failure codes, permit independently budgeted text retries, and retain business permissions, billing and historical uncertain records.

上线采用独立 overlay，保留现有每模型接口与加密 Key、既有历史账目及增量 schema159、其他服务和冻结版本。实际构建、针对性检查、生产回执、截图与录制见[核查报告](../quality/model-tool-contract-181.json)；早期失败尝试继续保留。模型发布仍是独立的权限操作。

The additive deployment preserves per-model connections/keys, historical accounting and additive schema159, unrelated services and frozen releases. See the [report](../quality/model-tool-contract-181.json) for actual builds, focused checks, production receipts and media, including retained failed attempts. Model publication remains a separate authorized operation.

正式验证揭示初始策略被两条历史未知请求占满；在保留旧占位及所有费用记录的前提下，追加 bootstrap 策略版本，将管理员／验证总名额2调整为4以恢复2个可用名额，原预算上限与其他限制不变。已有后台发布策略不受该脚本覆盖。

Production retry also required a bounded bootstrap headroom recovery: two historical uncertain holds remain intact while administrator/verification ceilings move from2 to4. Budget ceilings and other controls remain intact; published Admin policies cannot be overridden by the recovery script.

迁移159修复原生工具上下文被上游计数遗漏时的费用预留：完整请求字节形成派发前输入边界，按实际 tokens 结算，并继续检查输入、输出与费用上限；历史不确定记录和计数违规保留。失败回执也显示账本已确认的实际 tokens。

Migration159 pre-funds native tool context from serialized request bytes while retaining count proofs, actual billing and all input/output/monetary bounds. Historical uncertain records and count violations remain unchanged; failed receipts also report confirmed ledger tokens.
