from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';OUT=ROOT/'docs/quality/integrated-round-199'
summary=json.loads((OUT/'test-summary.json').read_text('utf-8'));total=summary['total']
report='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-199/README.md'
flow='''```mermaid
flowchart LR
 A[Cloud Codex source / 雲端來源] --> B[Explicit publication / 明確發布]
 B --> C[Shared project / 共用工程]
 C --> D[Direct canvas and draft / 畫布與草稿]
 D --> E[Current authority and actual preview / 授權與真實預覽]
 E --> F[Save immutable version / 儲存新版本]
 F --> G[Download delivery / 下載交付]
 D --> H[Review and recover / 核對並恢復]
 H --> D
```
'''
items={
'platform':('0.5.7',[
'Web／Extension在公司雲端執行Codex，Desktop在客戶本機執行。每個模型在Admin分別配置上游API地址、API key、別名與費率，所有AI請求經公司伺服器。',
'新增受授權的未儲存設計預覽：核對最新工程頭、原版本、私人／共享來源及固定素材，返回最大960px PNG與完整SHA-256／版本標識；不寫版本、資產、模型或費用。沿用有界渲染隊列，schema163不變。',
'修復私人設計成果發布後無法被工程識別。發布檢查實際來源schema／kind／環境及輸入摘要，只複製必要類型；原來源追溯保留，私人任務及會話綁定不轉移。既有不完整發布保持原樣，可從原私人來源明確重新發布。',
'相關回歸覆蓋矢量及簡報的發布→發現→建立→預覽、同鍵回放、偽造摘要、無權存取、實際像素變化、併發頭與來源撤回；受控夾具並非真實上游專業驗收。'],[
'Web/Extension execute company-hosted Codex; Desktop Codex runs on the customer computer. Admin configures each model with its own upstream API URL, key, alias and rates; all AI calls use company servers.',
'Adds authorized unsaved design previews with exact head/original-version and shared fixed-source checks. Returns a maximum960px PNG with digest/version metadata, without writing versions/assets/provider requests/charges. Rendering remains bounded; schema163 is unchanged.',
'Fixes private design source publication losing editable classification. Actual schema/kind/environment/input digest are checked before copying only source classification. Original provenance stays; private task/conversation bindings do not transfer. Existing incomplete publications remain immutable; explicitly publish the original source again.',
'Relevant regressions cover vector/presentation publication→discovery→creation→preview, idempotency, forged digests, unauthorized reads, actual pixel changes, stale heads and withdrawal. Controlled fixtures do not establish real upstream professional acceptance.']),
'web':('0.5.7',[
'登入後選擇企業、項目及專員，在雲端Codex交付後明確將私人源文件發布到項目。從「設計畫布」選取可編輯來源，確認共用後建立工程。',
'直接選取、拖動、縮放、方向鍵微調（Shift加速）、六向對齊、複製圖層及撤銷重做；文字對齊／行高、圖片適配、形狀描邊／圓角與位置尺寸遵循幾何、品牌與來源約束。未儲存畫面由真正伺服器渲染器產生，不調模型。',
'草稿只在目前分頁依帳戶／企業／項目／工程有界保留：8小時、2MB、最多8份，退出清理。刷新後明確恢復；伺服器版本改變需確認，復原前重新查權，不靜默覆蓋。先儲存新版本，再產生交付檔案與ZIP。',
'實際隔離旅程覆蓋拖動／縮放、刷新恢復、併發v3衝突及v4ZIP。真實雲端Codex來源在已上線Web完成v2保存／下載，與Desktop接續；375／768／1024／1440及淺深色有當前證據。修復重選同一企業導致項目列表清空。'],[
'Sign in, select an organization/project/specialist and explicitly publish the private editable source produced by cloud Codex. Open Design canvas, choose that source and confirm sharing to create an editable project.',
'Select/drag/resize, nudge with arrow keys (Shift accelerates), align in six directions, duplicate layers and undo/redo. Text alignment/line height, image fitting, shape stroke/radius and geometry retain brand/source constraints. Unsaved previews use the real server renderer without model calls.',
'Drafts remain bounded in the current tab, scoped to account/organization/project/work:8 hours,2MB and8 snapshots, cleared on sign-out. Refresh recovery is explicit; changed server heads require review and renewed authorization. Save a new version before creating files/ZIP.',
'The isolated journey covers pointer edits, reload recovery, concurrent version3 conflict and version4 ZIP. The actual deployed Web saves/downloads version2 from a real cloud Codex source and continues in Desktop, with current375/768/1024/1440 and light/dark evidence. Re-selecting the current organization no longer clears project options.']),
'desktop':('0.7.11',[
'從站點下載Setup或Portable，在系統瀏覽器完成安全授權。保持無邊框、無Electron選單，Codex在客戶本機執行；完整本機權限須客戶原生確認且可撤銷，所有模型請求與計費仍經公司伺服器。',
'設計畫布同步Web的直接編輯、真實草稿預覽、版本保存及恢復。雲端共用設計與本機任務仍按原執行位置運作；沒有以共用工程替代本機Agent。',
'本輪最終0.7.11實際包完成新PKCE、真實雲端來源v2→v3保存、無邊框／無選單及根／橫向滾動條檢查。主進程與固定Codex0.163.0-alpha.11全部逐字節對應既有0.7.10已驗收原生實現；本輪沒有重複本機付費執行。',
'保留197／198的原生執行及撤權證據；完整任意應用、其他機器、離線／休眠及升級故障矩陣仍需驗收。Windows受信簽名依用戶要求排除，不能稱為已完成簽名。'],[
'Download Setup or Portable and authorize in the system browser. The app remains frameless without Electron menus; Codex runs locally with explicit, revocable native full-access consent. Company servers still carry all model calls/billing.',
'Design canvas matches Web direct editing, actual draft previews, saved versions and recovery. Shared cloud designs and local tasks retain their execution locations; shared editing does not replace the local agent.',
'The actual final0.7.11 package passes fresh PKCE, real-source version2→3 saving, frameless/no-menu and root/horizontal scrollbar checks. Every main-process and pinned Codex0.163.0-alpha.11 runtime byte matches the accepted0.7.10 native implementation. No repeated paid native execution is claimed this round.',
'Earlier197/198 local execution/revocation evidence remains. Arbitrary applications, other machines, offline/sleep and upgrade-failure matrices still require acceptance. Trusted Windows signing remains excluded by user instruction, not claimed complete.']),
'admin':('0.5.2',[
'Admin繼續透過郵箱驗證及TOTP登入，管理企業／用戶、費用與VIP、模型上游、內容、權限、審批與審計。最高管理員依策略直接執行，其他角色保留策略審批。',
'模型獨立配置API地址、API key、上游別名及費率；支援既有編輯、刪除與受權列表批量操作。服務就緒與角色專業驗收必須如實查看，不把已有代碼當成已接通的真實服務。',
'本輪沒有Admin產品邏輯變更，版本維持0.5.2；完成當前整批構建及22項既有前端回歸。下方198輪截圖及GIF明確作為此前真實界面證據，不聲稱新增本輪Admin操作錄影。',
'測試郵箱依既有要求保留；真實SMTP、視頻／語音及Google／Meta外部設定和完整專業／生產驗收仍開放。'],[
'Admin retains email/TOTP sign-in and management of organizations/users, funds/VIP, model upstreams, content, permissions, approvals and audit. Highest admins execute under policy; other roles retain policy approvals.',
'Each model independently configures API URL, key, upstream alias and rates, with existing edit/delete and authorized list batch actions. Readiness and specialist acceptance remain evidence-based; existing code is not live external integration.',
'No Admin product logic changes this round; version remains0.5.2. The integrated build and22 existing frontend regressions pass. The198 screenshot/GIF below is explicitly earlier real UI evidence, not a newly recorded199 Admin operation.',
'The requested test mailbox stays. Real SMTP, video/speech, Google/Meta configuration and complete professional/production acceptance remain open.']),
'extension':('0.5.7',[
'下載ZIP、解壓並於Chrome開發者模式載入，點擊工具列圖示打開真正右側Side Panel。保持ChatGPT式會話／輸入／附件，Agent在公司雲端執行。',
'完成公司PKCE，選擇企業／項目並明確挑選或拖入附件、貼上圖片；只上傳獲准文件。歷史搜索、歸檔及接續按既有範圍保存，重新開啟仍重新讀取服務端權限及目前資料。',
'本輪插件產品代碼沒有變更，93項回歸通過；原發布0.5.7 ZIP逐字節保留，於/releases/199/提供下載並完成內網全文件SHA核對；公開取件範圍如實見交付記錄。沒有虛增版本、重新打包或聲稱已在Chrome商店上架。',
'下方198輪錄影保留此前真實工具列／Side Panel、PKCE及附件證據，未聲稱本輪新增側欄業務或重跑所有瀏覽器／大型檔案矩陣。'],[
'Download/unzip the ZIP and load it in Chrome developer mode. The toolbar opens the actual right Side Panel with ChatGPT-style conversation/input/attachments; the agent executes in the company cloud.',
'Complete company PKCE, choose an organization/project and explicitly select/drop attachments or paste images. Only authorized files upload. Existing scoped history/archive/continuation state reloads current server data and authority.',
'No Extension product code changes this round;93 regressions pass. The original0.5.7 released ZIP is retained byte-for-byte and provided under/releases/199/ with complete inner HTTP SHA checks; public qualification is reported separately. No inflated version, repackaging or Chrome Web Store publication is claimed.',
'The198 recording below retains earlier actual toolbar/Side Panel, PKCE and attachment evidence. This round does not claim new Side Panel businesses or full browser/large-file matrix coverage.']),
'delivery':('0.5.6',[
f'依要求先完成本輪全部可自主處理的代碼包，再統一構建／測試／聯調。六端構建、Desktop類型及{total}項相關回歸通過；保留所有失敗嘗試並整批修復，不用單個模組通過代表整輪完成。',
'目前包含隔離模擬功能夾具的實際畫布／並發／ZIP證據，以及真正雲端Codex單次HK$0.038898來源、上線Web及最終Desktop0.7.11的新授權／跨端版本。後續編輯沒有新增模型請求。',
'199覆蓋目錄以schema163候選就緒／活動任務0後切換；原憑證及DB／代理進程不變。新Setup／Portable與原ExtensionZIP在不可變/releases/199/通過內網完整HTTP／SHA核對；公開Setup完整下載通過，Portable公開取件零字節停滯未完成全文件驗收。保留198-v2回退和舊下載。',
'開發機直接連線異常；本輪驗收使用原域名與真實TLS的獨立SSH出口，不改安全策略或替換回應，不能稱為直連恢復。32組／102條原要求、外部／專業／生產敞口保持。'],[
f'Complete the full independently implementable round batch before integrated builds/tests/journeys. Six builds, Desktop types and{total} relevant regressions pass. All failed attempts remain with integrated corrections; an isolated module pass does not complete the batch.',
'Evidence distinguishes the isolated simulated functional fixture (actual canvas/conflict/ZIP operations) from one real cloud Codex source charged HK$0.038898, deployed Web and final Desktop0.7.11 fresh authorization/cross-client versions. Subsequent editing adds no model request.',
'The199 overlay activates only after candidate/schema163 readiness and zero active tasks, retaining credentials and DB/proxy processes. New Setup/Portable and the original Extension ZIP pass full inner HTTP/SHA checks under immutable/releases/199/. Public Setup full bytes pass; a zero-byte public Portable stall remains unqualified. Previous198-v2 and old downloads remain.',
'Direct development-machine connectivity remains unqualified. Acceptance uses an owned SSH egress with original company hostnames/TLS, without policy changes or response replacement. All32 groups/102 requirements and external/professional/production gaps remain.'])}
media={'web':('199-v3-live-design-dark.png','workmate-199-v3-live-design','Current actual deployed Web / 本輪真實Web'),'desktop':('199-v2-native-review.png','workmate-199-v2-native-review','Current final packaged0.7.11 / 本輪最終實際包'),'admin':('198-v4-service-readiness.png','workmate-198-v4-service-review','Earlier198 real Admin evidence / 此前198真實後台'),'extension':('198-v1-side-panel.png','workmate-198-v1-side-panel','Earlier198 actual Side Panel evidence / 此前198真實側欄')}
for name,(version,zh,en) in items.items():
 folder=DEV/('copypaste-'+name)
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-199 -->')
  text=f'<!-- integrated-round-199 -->\n\n## 199 · {version} · '+('Direct editing and source-to-delivery continuity' if english else '直接編輯與來源交付接續')+f'\n\n[Delivery and limits / 交付與邊界]({report}) · [Downloads / 下載](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(f'{i}. {s}' for i,s in enumerate(en if english else zh,1))+'\n\n'+flow+'\n'
  if name in media:
   png,stem,label=media[name]
   for f in [png,stem+'.gif',stem+'.mp4']:assert (folder/'assets/screenshots'/f).is_file(),f
   text+=label+'\n\n'+f'![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{stem}.gif)\n\n[Actual recording / 實際錄影](assets/screenshots/{stem}.mp4)\n\n'
  text+=('Earlier release/setup sections remain below. This batch does not close full original acceptance.\n\n' if english else '下方保留此前版本與完整使用／安裝說明。本輪不代表全部原始要求已完成驗收。\n\n')
  p.write_text(text+old,'utf-8')
for english in [False,True]:
 p=ROOT/'docs'/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-199 -->')
 text='<!-- integrated-round-199 -->\n\n'+(f'Round199 adds direct design editing, authorized draft previews/recovery and real-source Web/Desktop continuation;{total} selected checks pass. Full original acceptance stays open.' if english else f'199輪交付直接設計畫布、授權草稿預覽／恢復及真實來源跨端接續；{total}項相關檢查通過，保留全部原始驗收範圍。')+'\n\n[交付 / Delivery](quality/integrated-round-199/README.md) · [102條 / Scope](quality/integrated-round-199/requirements-102.md) · [更新 / Changes](changes/199-direct-design-editing.md)\n\n'
 p.write_text(text+old,'utf-8')
print(json.dumps({'status':'updated','bilingual_readmes':12,'current_media_repositories':2,'explicit_historical_media_repositories':2}))
