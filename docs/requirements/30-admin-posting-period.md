# 按費用入帳期間查詢 / Posting-period consumption

此項補齊原REQ-086「用戶消耗」的入帳期間口徑。管理員可選「工作建立期間」或「費用入帳期間」，再設定香港時間、用戶、付款帳戶、企業、項目等條件。舊請求未指定期間依據時仍按工作建立時間，不改既有重試鍵的內容識別。

This implements posting-period accounting within original REQ-086. Admin chooses creation or posting dates and the existing scoped filters. Omitted time basis retains the old creation-cohort behavior and idempotency input.

## 使用與帳務規則 / User and accounting rules

| 編號 / No. | 規則 / Rule |
| --- | --- |
| 1 | 入帳期間只計左閉右開區間內的確認扣費與退回消耗，包含更早建立的工作。Posting periods include in-range charge/refund entries even for older works. |
| 2 | 退款沿來源連到原消耗／扣費，原扣費在區間外也可追溯；不能再加入本期扣費。Refunds retain their original charge reference without counting it again. |
| 3 | 本期只有退回時，確認扣費為0、淨消耗可為負；金額全程使用精確微港幣字串。Refund-only net may be negative; exact integer micro-HKD is retained. |
| 4 | 香港日期分組按每筆入帳時間投影；同一工作跨日出現時，各日只計當日帳目。Day groups project individual entries, not repeated lifetime totals. |
| 5 | 點選日期後，摘要、工作列表、明細及CSV使用相同投影與快照水印；不屬該組的明細拒絕讀取。Selected summary, list, detail and CSV agree. |
| 6 | 當前預留及對賬預留屬快照時狀態，不算已入帳消耗。入帳匯總顯示不適用，明細另列當前預留。Holds stay separate from posted activity. |
| 7 | 模型用量是所選工作的累計操作背景；不宣稱期間新增用量，也不可跨日期分組相加。Units remain explicitly selected-work lifetime context. |
| 8 | 建立後五分鐘內的翻頁、分組、刷新、明細與匯出固定同一帳務快照；後續退款只在新快照出現。Subsequent refunds affect only fresh snapshots. |

例如舊工作在香港第一天扣費200001微港幣，第二天扣費300002並退回100001：整段確認500003、退回100001、淨額400002；每日淨額200001和200001。若只查退款入帳期間，淨額為-100001，原200001扣費僅供來源追溯。

For example, first-day charge200001 and second-day charge300002/refund100001 give period gross500003, refunds100001 and net400002. Day nets are200001 each. Selecting only the refund posting yields net-100001; its original charge remains reference-only.

## 權限與交付 / Access and delivery

沿用獨立Admin登入、近期MFA、原會話／授權版本／範圍雜湊及模式校驗。用戶、資源與付款帳戶範圍取交集；拒絕規則優先。匯出需同時具有create/download且覆蓋所有所選工作。CSV公式防護、未知真實內部成本、最大5000工作／20000操作／16MiB及超限拒絕仍保留。此功能不發起付款、退款或修改用戶資金。

Current independent Admin identity, recent MFA, original session/auth version, binding hash and environment remain mandatory. Scopes intersect and denies prevail. Both export permissions must cover every row. Existing privacy, unknown-cost and size-limit rules remain. Report reads do not initiate a payment/refund or change balances.

[機器契約 / Contract](../contracts/admin-posting-period-172.json) · [開發說明 / Development](../development/172-admin-posting-period.md)

此為v0.1.1之後的源碼增量，未寫入已發布的v0.1.1 ZIP。真實供應商帳單、完整媒體／團隊／角色／來源／生產規模及其他原驗收範圍仍依原台帳保留。

This is a source increment after v0.1.1, outside its frozen ZIP. Actual supplier bills and all original full media/team/role/source/production-scale acceptance scopes remain tracked.
