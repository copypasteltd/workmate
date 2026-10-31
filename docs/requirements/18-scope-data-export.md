# 範圍資料匯出 / Scope data export

REQ-049 的功能補充。匯出是讀取使用者目前有權讀取的資料；管理企業不授予其他成員的私人正文。This extends REQ-049 without widening existing content access.

1. Web 和本機 Desktop 從「專案」預覽並下載專案資料；owner/admin 可匯出目前企業全部可讀的使用中專案。所有登入、成員、來源及永久刪除約束保持有效。封存專案的正文須先按既有權限恢復，預覽明確指出封存排除。
2. 包含目前可讀的會話/訊息、任務/計畫/事件、記憶及其保留版本、品牌、Agent/技能、雲端目錄、原始檔與全部可用歷史檔案版本、設計/影片/向量/簡報工程、分析/SEO/GEO、工作流/例行/事件、團隊及方案業務資料。企業級及個人記憶僅在企業匯出中包括一次。未授權、撤回、隔離、刪除或過期的來源不會藉由匯出恢復。
3. 使用明確的資料表/欄位清單，預覽和 manifest 列明實際類別、筆數、固定版本、大小及 SHA-256。ZIP 內為 UTF-8 NDJSON 與原始二進位；README 和 SHA256SUMS 可獨立核對。沒有持久化的提取文字或索引不虛構補入。
4. 不含公司/第三方憑據、OAuth/登入秘密、Webhook 密鑰、內部儲存 key、執行憑據、其他企業、全庫備份、未上傳本機檔案。客戶自行寫入正文的商業資料仍屬匯出內容。
5. 預覽摘要綁定帳戶、目前企業/專案與完整選擇。下載確認後重新擷取；選擇變更回報需更新預覽。打包逐檔核對原始位元組、大小及摘要，下載前重新確認登入與當前全部來源，不回傳半成品或靜默截斷。
6. 使用現有磁碟流式 ZIP64 打包，不把全部原始檔讀入記憶體。每包最多 16 GiB 二進位、10,000 個原始版本、100,000 筆每類記錄及 64 MiB 文字資料；容量不足明確失敗，使用者可按專案分別匯出。最多兩個同時打包，單一帳戶一個；五分鐘逾時可重新預覽下載。
7. 取消、斷線、逾時、校驗失敗或完成下載後清理公司暫存，保留最小匯出審計，不建立長期雲端下載副本。已下載的使用者副本不屬雲端刪除保證。
8. Admin 可在內容管理按明確企業/專案匯出共享資料，要求目前的匯出、正文讀取權限及近期 MFA；整企業動作核對所有重疊專案拒絕。管理員不冒用客戶登入，私人資料仍由本人匯出；現有逐筆授權正文審閱入口保持獨立。

English: Export all currently readable records and retained file versions from the selected scope with explicit field projections, provenance fences, verified bytes and independent checksums. Tenant exports require a current owner/admin and omit archived content until restored. Customer-private records stay customer-private. Admin shared-content export requires scoped body-read/export permission and fresh MFA. Never include credentials, internal storage locations, backups or unsubmitted local files. Preview and final checks bind the same live authorized selection; failures are explicit and temporary archives are removed.
