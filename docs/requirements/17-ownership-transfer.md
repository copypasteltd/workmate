# 企業所有權交接 / Workspace ownership handover

REQ-085 的統一交接流程補充；不縮小原帳戶控制、在途工作及跨端驗收範圍。

1. 僅現有企業 owner 可向同企業另一位啟用、未被平台暫停且尚非 owner 的成員發起交接。輸入目前企業全名並明確確認。每企業最多一筆待確認交接，有效期24小時。
2. 發起不改變任何權限。僅指定接收方可在自己的有效登入中接受或拒絕；其他成員、來源方和平台管理員不得代替接收。正常登出不取消待確認意向；帳戶授權版本或任一成員版本變更使舊意向失效。
3. 接收時鎖定當前兩方授權、當前登入、成員及企業，再檢查來源仍為啟用owner、接收方仍可接收、企業未暫停或永久刪除、期限及版本。先提升接收方為owner，再將來源方降為admin，兩筆成員及交接結果和審計原子提交；不存在無owner視窗。其他既有owner保留。
4. owner可撤銷待確認交接；指定接收方可拒絕。過期、成員/帳戶撤權和企業刪除不能接受舊意向。重試已成功的同一決策返回目前終態，不重複授予、不回退後續角色變更。
5. 交接不轉移個人私有會話、檔案、任務執行者、已發生費用或付款主體，不授予額外專案或本機權限。現有在途工作繼續按原執行者的當前權限和原費用協定處理。
6. Web和無邊框Desktop均提供所有成員可查收的交接區、持續工作區提示、精確接收方及原owner變為admin的確認、狀態與歷史。頁面切換、換企業、換帳戶後的舊回應不得完成新操作；繁中/英文、無水平溢出、Desktop隱藏滾動軌。
7. Admin沿用企業成員管理入口，近期MFA及企業級admin.tenants.members.write；明確project deny優先。可查看和取消，不能代替客戶接受。既有直接特權成員變更仍走原獨立審批流程，沒有新旁路。
8. 清理/過期後保留最小交接治理ID、版本、狀態及審計，不保存自由文字理由、企業名稱快照或授權憑證。查閱繼續使用當前企業/管理員權限。列表分頁最多100筆。

Only a current owner initiates a24-hour handover to another active, non-owner member. Only the exact recipient accepts in a current session. Acceptance rechecks both users and memberships, promotes the recipient and demotes the source to admin atomically, preserving other owners. Account authorization or membership version changes invalidate prior intent. Either source cancellation or recipient decline closes it. Existing private authorship, billing and local permissions are separate. Web/Desktop expose a discoverable inbox and history; Admin can inspect/cancel with recent MFA and tenant membership permission, without impersonating consent or bypassing existing privilege approvals. Only minimal governance history is retained. This increment does not claim full production, OS or comprehensive concurrency acceptance.
