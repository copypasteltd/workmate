# 营销原文件与格式口径 / Marketing import conventions

统一资产上传→inspect→明确格式/映射→preview→确认→`POST /v1/dataset-imports`→持久快照/报告/原文件下载。所有阶段重新检查当前企业、项目、资源与授权，重放幂等结果不能绕过已撤销来源。预览与导入使用同一套解析选项；改变任一格式会取消客户旧确认。

Upload original bytes, inspect, select conventions/mappings, preview exact facts, confirm, then create a canonical dataset import and analysis snapshot. Each stage rechecks current scope and source access. Preview and import share options; changing conventions resets confirmation.

|选项 / Option|支持 / Supported|
|---|---|
|number_format|dot_decimal / comma_decimal / space_dot / space_comma；严格分组，NBSP/窄NBSP；不猜测|
|date_format|iso / day_first / month_first / year_first；四位年份和真实日历日期|
|csv_delimiter|comma / semicolon / tab|
|csv_encoding|UTF-8；UTF-16LE/BE上传需相应BOM，检测/指定冲突时报错|
|header_row|API 1–100；先跳过说明行再进行CSV词法解析|
|XLSX|客户选工作表/表头；原生数字和日期使用服务端可信规范值，不按本地文本再次缩放|

不接受负值、指数或百分数字串进入金额/计数字段。字符串数字按十进制定点归一化，既有BigInt/micros计算保持精确；显示端按十进制字符串拆分。ISO日期始终接受，其他日期按明确规则解释，不按语言猜测。默认及显式标准选项保持原import_key/spec_hash；非默认口径进入新规范身份。CSV dialect/encoding/header及原始字节摘要也参与文件规范身份。

Amounts/counts use exact decimal strings and existing integer micros/BigInt calculations. Invalid grouping, negative/scientific/percentage strings are rejected for these fields. Defaults retain existing import identities; nondefault conventions and file dialect selections become part of identity. Original-source download preserves uploaded bytes and SHA, with the correct CSV encoding content type.

CSV行号按真实物理CR/LF/CRLF计数，工作簿规范单元格按记录序号绑定。客户端不能提交可信规范单元格映射。私有角色工具支持同一口径，仍是获准的私有附件，不擅自变成共享数据集。UTF-16放行仅限有BOM的CSV，其他MIME/NUL类型边界保持。

Physical CSV line diagnostics handle CR/LF/CRLF, including quoted newlines. Trusted workbook cells are server-bound by record ordinal and cannot be supplied by clients. Private Codex file tools share conventions without creating shared datasets. UTF-16 acceptance is limited to BOM-marked CSV, preserving other MIME/NUL guards.

[First release](../releases/v0.1.0-rc.1.md) · [Checkpoint](../quality/release-freeze-checkpoint-148.json)
