# 160 · Admin總覽修復 / Admin overview correction

統一總覽與目錄/費用頁的現行權限，修復用戶人數、個人預留及無普通任務的雲端資源扣費漏算。所有數字由單一SQL快照讀取，權限鎖後重驗會話；錯誤時清除舊值並顯示破折號，增加明確刷新與扣費口徑。

Unifies current directory/account scopes and includes personal holds and resource charge facts. Exact-session revalidation, one numeric snapshot and explicit unavailable/recovery states prevent misleading figures.9 SQL/HTTP cases and3 actual Admin journeys; original failures and whole scopes remain. Unfrozen source correction; rc.2 artifacts and tags stay unchanged.
