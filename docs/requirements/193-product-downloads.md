# 產品下載頁 / Public product downloads

用戶應能從站點找到並下載 Desktop 和瀏覽器擴展。只有 GitHub Release 不構成站點產品交付。

1. `/downloads` 免登入可用；首頁導覽/頁尾、登入頁、工作台及裝置頁均可發現入口，手機亦可見。
2. 明確區分 Desktop 本機 Codex / 主動完整權限與 Extension 原生右側欄 / 選擇上傳 / 雲端 Agent。
3. 提供實際 Windows 安裝版、便攜版、Chrome ZIP、版本、大小、SHA-256 及安裝步驟。
4. 直連下載使用站點 HTTPS；HEAD、檔案長度、Range 續傳正確，缺檔 404、不返回 SPA 或列出目錄。
5. 延續品牌、繁中/英文、亮/暗色；手機無水平溢出；下載不要求登入，使用時沿用既有登入及權限。
6. 如實標示未簽名、未上架商店及未提供平台；不以佔位商店連結或不可用平台取代交付。

Customers can discover and directly download real clients from the site. The public page documents execution/permission differences, actual packages and hashes, installation steps, languages/themes and platform limits. Existing app authentication remains required for use. Versioned downloads must support resume and real 404s, without exposing deployment or administrator secrets.
