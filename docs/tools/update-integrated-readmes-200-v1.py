"""Current bilingual independent-repository delivery guides and actual media."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';OUT=ROOT/'docs/quality/integrated-round-200'
summary=json.loads((OUT/'test-summary.json').read_text('utf-8'));total=summary['total'];public=json.loads((OUT/'public-downloads.json').read_text('utf-8'))['status'];public_bytes=json.loads((OUT/'public-downloads.json').read_text('utf-8'))['all_four_public_file_bytes_verified']
report='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-200/README.md'
shared='''flowchart LR
 A[Choose layout or published source / 版面或已發布來源] --> B[Confirm shared work / 確認共用工程]
 C[Fixed shared image / 共用圖片固定版本] --> D[Review rights and exact evidence / 核對權限與證據]
 E[Published analysis source / 已發布分析源] --> D
 B --> F[Edit layers and pages / 編輯圖層與頁面]
 D --> F
 F --> G[Adapt all pages atomically / 全頁原子適配]
 G --> H[Actual preview and immutable version / 真實預覽與新版本]
 H --> I[Download editable delivery / 下載可編輯交付]'''
flows={'platform':shared,'web':shared,
'desktop':'''flowchart LR
 A[Install and browser PKCE / 安裝與授權] --> B[Local folder and specialist / 本機目錄與專員]
 B --> C[Explicit revocable access / 明確可撤銷權限]
 C --> D[Local Codex via company API / 本機Codex與公司API]
 D --> E[Local actions and files / 本機執行與成果]
 A --> F[Authorized shared design / 有權共用設計]
 F --> G[Layouts, resources and pages / 版面素材與頁面]
 G --> H[Immutable version and delivery / 版本與交付]''',
'admin':'''flowchart LR
 A[Email and TOTP / 郵箱與TOTP] --> B[Current role and scope / 目前角色範圍]
 B --> C[Users, VIP, funds and content / 用戶權益費用與內容]
 B --> D[Per-model API URL, key and rates / 模型獨立上游與費率]
 C --> E[Policy approval or direct execution / 策略審批或直接執行]
 D --> E
 E --> F[Audit and actual readiness / 審計與實際就緒]''',
'extension':'''flowchart LR
 A[Toolbar click / 工具列點擊] --> B[Native right Side Panel / 原生右側欄]
 B --> C[Company PKCE and project / 公司授權與項目]
 C --> D[Explicit file or image selection / 明確選擇附件]
 D --> E[Private upload / 私人上傳]
 E --> F[Cloud Codex via company API / 公司雲端Codex]
 F --> G[Conversation and delivery / 會話與交付]''',
'delivery':'''flowchart LR
 A[Complete round code batch / 完成整批代碼] --> B[Build all clients / 全端構建]
 B --> C[Unified tests and real journeys / 統一測試與實際旅程]
 C --> D[Retain failures and batch corrections / 保留失敗並整批修正]
 D --> B
 C --> E[Candidate and zero active tasks / 候選與活動任務核對]
 E --> F[Deploy and immutable downloads / 上線與不可變下載]
 F --> G[Qualify actual bytes and public limits / 驗收實際字節與公網邊界]
 G --> H[Bilingual docs and eight refs / 雙語文檔與八引用同步]'''}
items={
'platform':('0.5.8','設計製作、授權素材與精確證據','Design production, authorized resources and exact evidence',[
'Web／Extension在公司雲端執行Codex，Desktop在客戶本機執行；所有AI請求經公司伺服器。Admin按每個模型配置獨立API地址、API key、上游別名和費率。',
'六種中英矢量／簡報起步版面沿用嚴格參數、共用確認、幂等建立、原請求查詢、審計與不可變版本，不調模型。新增/templates、/resources及/resources/:version三個有權路由；目前756個常規路由及1個條件路由。',
'素材僅列當前項目／環境的有效共用固定版本，每頁20條。PNG≤10MiB真實解碼／預覽；分析JSON≤4MiB，每頁64條證據；實際字節／SHA與來源狀態再次核對。私人分析先明確發布，保留驗證分類及原來源，沒有轉移私人任務權限。',
'圖表最多八項同口徑原值，核對指標／來源／帳戶／幣種／時區／期間／歸因與維度，保留未知原因。無關負變化不再使合法非負條形圖整份來源失效；原分析不被修改。schema163不變。'],[
'Web/Extension use company-hosted Codex; Desktop runs Codex on the customer computer. All AI requests use company servers; Admin configures each model with its own API URL, key, upstream alias and rates.',
'Six bilingual vector/presentation starters retain strict input, explicit sharing, idempotent create/request receipts, audit and immutable versions without model calls. Three authorized template/resource routes bring the current inventory to756 regular routes plus one conditional route.',
'Resource discovery lists only current-project/current-environment active shared fixed versions,20 per page. PNG≤10MiB is decoded and previewed; analysis JSON≤4MiB returns64 exact facts per page. Bytes/hash and source availability are rechecked. Private analysis requires explicit publication; only verified classification/original provenance transfer.',
'Charts accept at most eight scope-compatible original values across metric/source/account/currency/timezone/period/attribution/dimensions, with missing reasons intact. Unrelated signed changes no longer invalidate usable nonnegative bars. Original analysis is unchanged; schema163 stays.']),
'web':('0.5.9','從版面開工到可核對交付','From editable layout to verifiable delivery',[
'登入→選企業／項目→設計畫布→展開「從版面開始新作品」→選六款版面之一及中英文字→確認共用後開工；也可繼續原專員發布來源或導入完整工程包。',
'在「加入／替換圖片與資料圖表」搜尋並選擇共用固定PNG，核對預覽／使用權後加入或替換；分析源先在檔案中明確發布，再選同口徑原值，最多八條。私人對話文件不會自動暴露給共用項目。',
'可加空白頁、沿用原複製／排序／刪除、直接畫布編輯及撤銷重做。整份畫布256–1920px適配全部頁面，字形／描邊／圖表最小面積超限時整次拒絕，不留下半修改。保存新版本後產生PNG／SVG／PDF／PPTX及可編輯ZIP，預覽顯示實際已保存版本；重新編輯才顯示未保存。',
'實際隔離旅程含模擬營銷原值、圖片、四頁／尺寸／撤銷／版本2及真實16MBZIP，模型請求與帳務0；實際已上線Web另完成新工程、版本2、ZIP並接續最終Desktop版本3。淺深色及375／768／1024／1440無頁面橫向溢出。'],[
'Sign in→choose organization/project→Design canvas→expand “Start a new work from a layout”→choose one of six layouts and text language→confirm sharing. Published specialist sources and complete project imports remain available.',
'Search/select a fixed shared PNG under “Add or replace images & data charts”; review pixels/usage rights before adding or replacing. Explicitly publish an analysis source first, then select up to eight compatible original values. Private chat files never become implicitly shared.',
'Add blank pages and retain existing copy/reorder/delete, direct canvas editing and undo/redo. Whole-work256–1920px adaptation validates every page/font/stroke/minimum chart size atomically. Save a new version before generating PNG/SVG/PDF/PPTX and editable ZIP files. The preview shows the saved version; only a new edit marks it unsaved.',
'The actual isolated journey uses explicitly simulated campaign values with real images/four pages/resizing/undo/version2/16MBZIP and zero model requests/ledger writes. Actual deployed Web separately creates version2/downloads a ZIP and continues into final Desktop version3. Light/dark and375/768/1024/1440 have no page overflow.']),
'desktop':('0.7.13','本機Codex與完整設計製作','Local Codex and complete design production',[
'從站點下載Setup／Portable，在系統瀏覽器安全授權。保持無邊框、無Electron原生選單；Codex在客戶本機執行，可明確授予並撤銷完整本機權限，全部模型請求仍走公司API。',
'共用設計同步Web的六種版面、固定圖片／資料圖表、新空白頁、全頁尺寸適配、撤銷／草稿及不可變交付。本機任務和共用雲端工程保留各自執行位置。',
'最終0.7.13實際包完成新S256PKCE、無邊框／無選單／無根和橫向滾動條、真實Web版本2→本機保存版本3→Web讀回。全部主進程與固定Codex0.163.0-alpha.11字節同0.7.12原生實現；本輪沒有重複付費本機任務。',
'保留原本機執行／撤權證據；完整任意應用、其他機器、離線／休眠、更新故障和長期驗收繼續開放。受信Windows簽名按用戶要求排除。'],[
'Download Setup/Portable and authorize in the system browser. The app stays frameless without Electron menus. Codex executes locally with explicit, revocable full native access; all model requests use company APIs.',
'Shared design matches Web six layouts, fixed images/data charts, new slides, whole-document adaptation, undo/drafts and immutable delivery. Local tasks and shared cloud designs retain their execution locations.',
'The final0.7.13 package passes fresh S256PKCE, frameless/no-menu/no-root-or-horizontal-scrollbar checks and actual Web version2→native version3→Web readback. Every main-process/pinned Codex0.163.0-alpha.11 byte matches0.7.12. This round does not repeat paid native execution.',
'Earlier local execution/revocation evidence stays. Arbitrary applications, other machines, offline/sleep, update failures and long-running acceptance remain open. Trusted Windows signing is excluded by user instruction.']),
'admin':('0.5.2','模型、用戶與內容管理相容覆核','Model, user and content management compatibility',[
'管理員以郵箱／TOTP登入，按範圍管理企業、用戶、費用／VIP、內容、權限、審計及審批；最高管理員依策略直接執行，其他角色按策略審批。',
'每個模型各自維護API接口、API key、上游別名與費率，保留編輯／刪除和受權批量操作。就緒狀態與真實上游／角色品質必須分開核對。',
'本輪後台產品沒有新邏輯變更，版本保持0.5.2，整批構建及22項當前前端回歸通過。下方198錄影明確為歷史真實頁面，不冒充200輪新後台交互。',
'測試收件箱按用戶要求保留。真實SMTP、視頻／語音、Google／Meta配置、完整管理資源權限矩陣和生產驗收仍依原範圍處理。'],[
'Email/TOTP Admin sign-in retains scoped organization/user/funds/VIP/content/permission/audit/approval management. Highest admins execute under policy; other roles follow policy approvals.',
'Each model independently stores API URL, key, upstream alias and rates, with existing editing/deletion/authorized batch actions. Readiness is distinct from real upstream/specialist quality acceptance.',
'No new Admin product logic this round; version stays0.5.2. The unified build and22 current frontend cases pass. The198 media below is explicitly earlier real evidence, not a newly recorded200 operation.',
'The requested test inbox stays. Real SMTP, video/speech, Google/Meta settings, the complete administrator resource/permission matrix and production acceptance retain their original scope.']),
'extension':('0.5.7','原生右側欄與獲准附件上傳','Native right Side Panel and authorized uploads',[
'下載／解壓ZIP，以Chrome開發者模式載入。點擊工具列打開真正右側Side Panel，採ChatGPT式會話／附件；Agent在公司雲端執行。',
'以公司PKCE授權，選企業／項目，明確選擇／拖入附件或貼上圖片；只讀取上傳獲准內容。歷史／歸檔／接續每次重新讀當前權限和服務端狀態。',
'本輪插件無產品變更，93項回歸通過；原0.5.7 ZIP逐字節保留，在/releases/20002/與新Desktop一起提供下載並通過內網完整SHA。未虛增版本或聲稱Chrome商店已發布。',
'下方198工具列／真實側欄／授權與附件錄影為明確歷史證據，不能用來聲稱本輪重跑全部Chrome／大型文件矩陣。'],[
'Download/unzip the ZIP and load it in Chrome developer mode. Clicking the toolbar opens the actual right Side Panel with ChatGPT-style conversation/attachments; the agent executes in the company cloud.',
'Authorize with company PKCE, select organization/project and explicitly choose/drop files or paste images. Only authorized content is read/uploaded. History/archive/continuation re-read current server authority/state.',
'No Extension product change;93 regressions pass. The original0.5.7 ZIP is preserved byte-for-byte and provided under/releases/20002/ with new Desktop and complete inner SHA checks. No inflated version or Chrome Web Store publication is claimed.',
'The198 toolbar/real Side Panel/authentication/attachment media is explicitly historical, not a newly repeated200 full Chrome/large-file matrix.']),
'delivery':('0.5.7','完整輪次構建、上線與證據','Complete-round construction, deployment and evidence',[
f'先完成本輪全部可自主處理代碼，再六端統一構建／類型／測試／實際聯調；{total}項相關回歸通過。首次45個資料庫恢復失敗、兩處狀態碼預期及UI同值選擇器已以新版本驅動整批修正／復驗，原失敗保留。',
'隔離模擬營銷功能旅程、真實上線Web及最終Desktop0.7.13新授權／跨端版本／ZIP交付分別記錄；原本機Codex字節與原生權限保持，不以設計工程取代本機Agent。',
f'200候選就緒／活動客戶任務0後切換，schema163／原憑證／DB及代理進程不變，保留200-v1／199回退與舊下載。三個包／校驗文件全部內網完整HTTP和SHA通過；本輪公開事件結果為{public}，三包／校驗文件公網完整字節通過為{public_bytes}；原點擊下載事件超時仍保留，文件字節不等於完整瀏覽器體驗。',
'12份雙語README、真實PNG／GIF／MP4、完整102條／32組原始追溯與正常八引用同步。原域名HTTPS驗收使用獨立SSH出口，不等於開發機直連恢復；外部／專業／生產敞口不自動關閉。'],[
f'Complete the whole independently implementable code batch before unified builds/types/tests/actual journeys;{total} relevant cases pass. Initial45 database-recovery failures, two validation-code expectations and an ambiguous same-value UI selector are corrected together in new drivers; original attempts remain.',
'Isolated simulated campaign functionality is distinct from actual deployed Web/final Desktop0.7.13 fresh authorization/cross-client versions/ZIP. Native Codex bytes/permissions stay; shared design does not replace the local agent.',
f'Activate200 only after candidate readiness/zero active tasks. Schema163, credentials and DB/proxy processes stay, with200-v1/199 rollback and old downloads retained. Three packages/checksums pass complete inner HTTP/SHA; current public event result is{public}, and all four complete public byte/hash checks pass={public_bytes}. Original click-event timeouts stay distinct from full-file fetch verification.',
'Twelve bilingual READMEs, actual PNG/GIF/MP4, all102 requirements/32 groups and ordinary eight-ref synchronization bind the delivery. Original-TLS SSH egress does not establish direct developer connectivity; external/professional/production gaps stay.'])}
media={'web':('200-v3-live-production-dark.png','workmate-200-v3-live-production','Actual deployed Web200 / 真實已上線Web200'),'desktop':('200-v2-native-production.png','workmate-200-v2-native-production','Final actual0.7.13 package / 最終實際0.7.13包'),'admin':('198-v4-service-readiness.png','workmate-198-v4-service-review','Earlier198 real Admin / 歷史198真實後台'),'extension':('198-v1-side-panel.png','workmate-198-v1-side-panel','Earlier198 real native Side Panel / 歷史198真實原生側欄')}
for name,(version,zh_title,en_title,zh,en)in items.items():
 folder=DEV/('copypaste-'+name)
 for english in [False,True]:
  p=folder/('README.en.md'if english else'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-200 -->')
  text=f'<!-- integrated-round-200 -->\n\n## 200 · {version} · '+(en_title if english else zh_title)+f'\n\n[Delivery and limits / 交付與邊界]({report}) · [Downloads / 下載](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(f'{i}. {s}'for i,s in enumerate(en if english else zh,1))+'\n\n```mermaid\n'+flows[name]+'\n```\n\n'
  if name in media:
   png,stem,label=media[name]
   for f in [png,stem+'.gif',stem+'.mp4']:assert(folder/'assets/screenshots'/f).is_file(),f
   text+=label+f'\n\n![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{stem}.gif)\n\n[Actual recording / 實際錄影](assets/screenshots/{stem}.mp4)\n\n'
  text+=('Earlier release/setup instructions remain below; full original acceptance stays open.\n\n'if english else'下方保留此前版本和完整安裝／使用說明，全部原始驗收範圍仍開放。\n\n');p.write_text(text+old,'utf-8')
for english in [False,True]:
 p=ROOT/'docs'/('README.en.md'if english else'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-200 -->')
 text='<!-- integrated-round-200 -->\n\n'+(f'Round200: six editable layouts, authorized image/evidence resources, new pages and atomic whole-document adaptation;{total} relevant checks, actual deployed Web/final Desktop and immutable downloads. All original acceptance remains.'if english else f'200輪：六款可編輯版面、獲准圖片／證據素材、新頁及全部頁面原子適配；{total}項相關回歸、真實上線Web／最終Desktop及不可變下載。全部原始驗收範圍保留。')+'\n\n[交付 / Delivery](quality/integrated-round-200/README.md) · [102條 / Scope](quality/integrated-round-200/requirements-102.md) · [更新 / Changes](changes/200-design-production.md)\n\n';p.write_text(text+old,'utf-8')
print(json.dumps({'status':'updated','bilingual_readmes':12,'current_media_components':2,'explicit_historical_media_components':2}))
