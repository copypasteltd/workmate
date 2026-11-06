from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];dev=root/'dev'
report='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-201/README.md'
items={
'platform':('0.5.9',[
'六種中英影片版面、三種比例，以及 /video-projects/templates、/resources、/draft-preview 三個獲准路由；目前759個常規路由及1個條件路由。範本不調模型、不建立虛構營銷數值。',
'交叉淡化／向左滑動轉場1–45整數幀，不超過進場鏡頭一半，首鏡頭不接受轉場。新工程按實際轉場使用cuts-3；舊工程缺失此欄位時保留原摘要和cuts-2。PNG預覽和MP4共用繪圖函式，轉場逐幀渲染，正式成片仍完整解碼、檢查音軌與預算。',
'單幀預覽綁定當前使用者／項目／原工程版本，重新核對私人範圍、固定素材、來源狀態、資料環境和SHA，不建立資產／模型請求／費用；只檢查畫面。共享PNG／WAV／MP3搜尋20條分頁；製作時再次核對。',
'所有AI請求仍經公司伺服器；Admin按每個模型配置上游API／key。Web與Extension的Codex在雲端，Desktop的Codex在客戶本機。schema163不變。'],[
'Six bilingual video starters and three formats add authorized /video-projects/templates, /resources and /draft-preview routes:759 regular routes plus one conditional route. Templates make no model calls or invented campaign metrics.',
'Crossfade/slide-left use1–45 integer frames, at most half the incoming scene; scene1 cannot transition. Actual transitions select cuts-3; legacy definitions retain their original digest/cuts-2. PNG preview and MP4 share drawing; transition frames are individually rendered. Full decode/audio/budget checks remain.',
'A frame preview binds current identity/project/original version and rechecks private scope, fixed sources, availability, data mode and SHA. It creates no assets/provider requests/charges and qualifies only a visual frame. Shared PNG/WAV/MP3 search returns20 per page; production rechecks authority.',
'All AI requests still use company servers and per-model Admin API/key settings. Web/Extension Codex runs in the cloud; Desktop Codex runs on the customer computer. Schema163 is unchanged.']),
'web':('0.5.10',[
'登入→選企業與項目→設計畫布→新建影片工程→展開「從影片版面開始」→選六種版面之一及畫幅→填寫真實文案和獲准素材。儲存後與此項目有權成員共用；私人附件不會自動發布。',
'可新增／複製／排序／移除鏡頭及調整時長，字幕跟隨原鏡頭並在跨鏡頭時分段；移除鏡頭同時移除其字幕，撤銷可恢復。變幀率保留時間與音軌入點，超限或字幕折疊整次拒絕。',
'選擇當前幀並按預覽，取得伺服器實際PNG；字幕保持畫面固定位置。這只是畫面預覽，音軌與整片要儲存後正式渲染才核驗。原固定PNG／音軌可搜尋和分頁選擇；配音文字不會自行合成聲音。',
'撤銷／重做和8小時／8份／2MB上限的分區工作階段草稿，恢復必須明確確認。儲存結果不明時保留原請求鍵並暫停編輯，重試不建重複工程；顯式登出清除。真實390幀MP4下載／播放、跨端版本及四寬度無橫向溢出已核查。'],[
'Sign in→choose workspace/project→Design canvas→New video project→Start with a video layout→choose one of six layouts and format→add actual copy and authorized sources. Saving shares with authorized project members; private attachments are never implicitly published.',
'Add/copy/reorder/remove scenes and change duration. Captions follow their original scene, split at cuts and are removed with deleted scenes; Undo restores them. Frame-rate changes retain timing/audio in points. Invalid/collapsed/out-of-budget changes are rejected atomically.',
'Choose a frame and explicitly request the actual server PNG. Captions stay fixed on screen. This visual-only preview does not validate audio/full video; save/render for that. Search/page fixed shared images/audio; narration text is not synthesized voice.',
'Undo/redo and scoped session drafts have8-hour/8-entry/2MB bounds and explicit recovery. Uncertain saves retain the original key and pause editing; retry does not duplicate the work. Explicit sign-out clears drafts. Actual390-frame MP4 play/download, cross-client versions and four exact widths without horizontal overflow are qualified.']),
'desktop':('0.7.14',[
'下載Setup或Portable，在系統瀏覽器完成S256授權。最終包保持無邊框、無Electron選單；Codex在本機執行，客戶可明確授予並撤銷完整本機權限，AI仍走公司API。',
'在設計畫布繼續同一項目影片：六種雙語版面、鏡頭／字幕時間調整、實際轉場、固定共享素材、真實畫面預覽、撤銷／重做與分區草稿。影片製作使用公司媒體服務，並未替代本機Agent。',
'最終0.7.14實際包的新授權／無邊框／無選單、Web影片版本1接續至版本2、原成片保留已驗證；主進程和固定Codex0.163.0-alpha.11字節與此前合格包相同。完整任意應用／機器／安裝升級矩陣仍開放。',
'Setup／Portable和校驗文件已掛在下載頁及/releases/20101/，整文件內網／公網原TLS字節與SHA驗證。受信代碼簽名按使用者要求排除；不冒稱已做所有OS安裝驗收。'],[
'Download Setup/Portable and complete browser S256 authorization. The final package is frameless with no Electron menu. Codex runs locally; customers can explicitly grant/revoke full local permission. AI still uses company APIs.',
'Continue the same project video in Design canvas: six bilingual starters, atomic scene/caption timing, real transitions, fixed shared sources, actual frame preview, undo/redo and scoped drafts. Company media rendering does not replace the local agent.',
'The final actual0.7.14 package completes fresh authorization/no-menu/frameless checks and continues Web video v1 into v2 while retaining its original render. Main process/pinned Codex0.163.0-alpha.11 bytes match the previously qualified package. Full arbitrary-app/machine/install/update matrices remain open.',
'Setup/Portable/checksums are linked at the download page and/releases/20101/; full inner/public original-TLS bytes and hashes are checked. Trusted code signing remains excluded by user instruction; full OS installation acceptance is not claimed.']),
'admin':('0.5.2',[
'本輪後台產品版本不變；22項相關回歸和當前三域名就緒核查通過，下方198實際畫面明確為歷史素材。',
'模型能力仍按單一模型編輯上游OpenAI相容地址／API key／上游名稱／費率，保存與驗證分開；密鑰不下發客戶端。企業／使用者／費用／VIP／內容與批量控制、最高管理員直接執行及完整審計保留。',
'新增影片預覽／素材路由繼續遵守當前項目、資料環境、私人範圍和原版本權限。新增模板數量不代替內容專業驗收；真實生成影片／語音和Google／Meta授權仍需原外部配置。'],[
'The Admin product stays0.5.2. Its22 related regressions and current three-domain readiness checks pass. The198 actual UI media below is explicitly historical.',
'Per-model capability settings retain editable OpenAI-compatible upstream URL/key/model alias/rates with separate save/validation. Credentials never reach clients. Organization/user/fees/VIP/content/bulk controls, super-admin direct execution and full audit stay.',
'New video preview/resource routes enforce current project/data mode/private scope/original version. Template counts do not replace professional acceptance; actual generated video/voice and Google/Meta still require their external configuration.']),
'extension':('0.5.7',[
'保留已發布0.5.7產品與原ZIP字節；93項回歸通過。新版下載頁仍提供解壓載入ZIP，沒有冒稱Chrome商店上架。',
'點擊工具列按鈕開啟瀏覽器原生右SidePanel，使用ChatGPT式對話／附件結構；使用者明確選擇檔案後才讀取／上傳，由雲端Codex執行。私人對話檔案不會自動變成共享影片素材。',
'下方198實際原生SidePanel／授權／附件截圖及錄製為歷史結果；本輪未重跑完整Chrome／大檔案／Native Host矩陣。'],[
'Keep released0.5.7 product/original ZIP bytes;93 regressions pass. The download page provides an unpacked-load ZIP, without a Chrome Web Store claim.',
'Click the toolbar action to open Chrome native right SidePanel with chat/attachment structure. Files are read/uploaded only after explicit selection; Codex runs in the cloud. Private chat files never implicitly become shared video sources.',
'The198 actual native SidePanel/auth/attachment captures below are historical evidence. This round does not repeat the entire Chrome/large-file/Native Host matrix.']),
'delivery':('0.5.8',[
'先完成整批809份產品源碼清單，再統一六端構建／類型與測試；624項相關斷言有通過證據，初始失敗、測試故障注入修正、畫面檢視文案修正和未變源碼沿用範圍均完整記錄。',
'真實隔離Web／原生PostgreSQL／390幀MP4與實際下載播放，和真實上線Web／最終0.7.14包新授權／跨端版本分開記錄，不調新的付費模型。',
'候選就緒及活動客戶任務0後切換，schema163／原憑證／DB和代理進程保持。三包與校驗文件掛站並核對內網／公網完整字節；舊20002下載與200回退原樣保留。',
'12份雙語README、實際PNG／GIF／MP4、完整102條／32組追溯與普通八引用同步。使用公司原域名TLS經獨立SSH出口，非開發機直連驗收；外部／專業／生產敞口保持。'],[
'Record the whole809-file product source batch before unified builds/types/tests.624 distinct relevant assertions have passing evidence. Initial failures, fixture correction, visual-copy correction and the exact unchanged-source evidence scope remain explicit.',
'Actual isolated Web/native PostgreSQL/390-frame MP4 play/download is distinct from actual deployed Web/final0.7.14 package fresh authorization/cross-client versions. No new paid model task is submitted.',
'Activate after candidate readiness/zero active customer tasks; retain schema163, credentials, DB/proxy processes. Three packages/checksums are linked and verified as full inner/public bytes; old20002 downloads/200 rollback stay.',
'Twelve bilingual READMEs, actual PNG/GIF/MP4, all102 requirements/32 groups and ordinary eight-ref synchronization bind delivery. Original company TLS through owned SSH egress is distinct from direct developer connectivity; external/professional/production gaps remain.'])}
flows={
'platform':'A[Current project authority] --> B[Fixed source versions and SHA]\n B --> C[Actual frame preview]\n B --> D[Immutable saved definition]\n D --> E[Real MP4 and full decode]\n E --> F[Versioned project and source package]',
'web':'A[Sign in and choose project] --> B[Six bilingual layouts]\n B --> C[Scenes captions transitions and sources]\n C --> D[Explicit actual frame preview]\n C --> E[Undo and scoped draft recovery]\n D --> F[Immutable save]\n E --> F\n F --> G[Render play and download]',
'desktop':'A[Download and S256 authorization] --> B[Frameless local app]\n B --> C[Local Codex with explicit permissions]\n C --> D[Company model API]\n B --> E[Continue authorized shared video]\n E --> F[Actual preview immutable save and MP4]',
'admin':'A[Administrator identity and role] --> B[Per-model upstream and key]\n A --> C[Users organizations fees VIP and content]\n C --> D[Policy direct execution or approval]\n D --> E[Complete audit]',
'extension':'A[Toolbar click] --> B[Native right SidePanel]\n B --> C[Explicit file choice]\n C --> D[Authorized read and cloud upload]\n D --> E[Company cloud Codex]\n E --> F[Conversation and deliverables]',
'delivery':'A[Complete whole code batch] --> B[Unified builds and tests]\n B --> C[Actual isolated and production journeys]\n C --> D[Collect corrections and retain failures]\n D --> B\n C --> E[Candidate readiness and zero active tasks]\n E --> F[Deploy and verify full download bytes]\n F --> G[Bilingual docs and eight ordinary refs]'}
media={'web':('201-v3-motion-production-live.png','workmate-201-v3-motion-production-live','Actual deployed Web201 / 真實已上線Web201'),'desktop':('201-v3-motion-production-live.png','workmate-201-v3-motion-production-live','Actual final0.7.14 package / 最終實際0.7.14包'),'admin':('198-v4-service-readiness.png','workmate-198-v4-service-review','Historical198 actual Admin / 歷史198實際後台'),'extension':('198-v1-side-panel.png','workmate-198-v1-side-panel','Historical198 native SidePanel / 歷史198原生側欄')}
for component,(version,zh,en)in items.items():
 folder=dev/('copypaste-'+component)
 for english in [False,True]:
  p=folder/('README.en.md'if english else'README.md');old=p.read_text('utf8');assert not old.startswith('<!-- integrated-round-201 -->')
  text=f'<!-- integrated-round-201 -->\n\n## 201 · {version} · '+('Motion production and actual delivery'if english else'影片製作與實際交付')+f'\n\n[Evidence and limits / 證據與邊界]({report}) · [Downloads / 下載](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(f'{i}. {s}'for i,s in enumerate(en if english else zh,1))+'\n\n```mermaid\nflowchart LR\n '+flows[component]+'\n```\n\n'
  if component in media:
   png,stem,label=media[component]
   for name in [png,stem+'.gif',stem+'.mp4']:assert(folder/'assets/screenshots'/name).is_file(),name
   text+=label+f'\n\n![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{stem}.gif)\n\n[Actual recording / 實際錄影](assets/screenshots/{stem}.mp4)\n\n'
  text+=('Earlier installation, architecture and use details remain below.\n\n'if english else'以下保留完整安裝、架構和使用細則。\n\n');p.write_text(text+old,encoding='utf8',newline='\n')
for english in [False,True]:
 p=root/'docs'/('README.en.md'if english else'README.md');old=p.read_text('utf8');assert not old.startswith('<!-- integrated-round-201 -->');text='<!-- integrated-round-201 -->\n\n'+('Round201: six bilingual video layouts, atomic timing/captions/rates, actual transitions and authorized frame previews, scoped recovery and real MP4 delivery.624 relevant assertions, exact source-bound evidence and full original acceptance limits.'if english else'201輪：六款雙語影片版面、原子鏡頭／字幕／幀率、實際轉場與授權畫面預覽、分區草稿及真實MP4交付；624項相關斷言與完整原始驗收邊界。')+'\n\n[交付 / Delivery](quality/integrated-round-201/README.md) · [102條 / Scope](quality/integrated-round-201/requirements-102.md) · [更新 / Changes](changes/201-motion-production.md)\n\n';p.write_text(text+old,encoding='utf8',newline='\n')
print(json.dumps({'bilingual_readmes':12,'new_actual_media_components':2,'historical_unchanged_media_components':2}))
