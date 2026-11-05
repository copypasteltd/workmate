"""Document the actual public download handoff and retain original diagnostic attempts."""
from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256
import json,shutil,subprocess,sys

ROOT=Path(__file__).resolve().parents[2];D=ROOT/'dev/copypaste-delivery';P=D/'.data/acceptance-193'
qa_path=Path(sys.argv[1]).resolve();qa=json.loads(qa_path.read_bytes())
assert qa_path.is_relative_to(P) and qa['status']=='passed' and qa['owned_browser_closed']
assert all(r.get('full_browser_download') for r in qa['downloads'] if r['name'].endswith(('.exe','.zip')))
def digest(p):return sha256(p.read_bytes()).hexdigest()
def copy(src,dst):
 if dst.exists():assert digest(src)==digest(dst),'Original evidence differs: '+str(dst)
 else:shutil.copyfile(src,dst)
def save(p,obj):
 with p.open('x',encoding='utf8',newline='\n') as f:f.write(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def new(p,text):
 with p.open('x',encoding='utf8',newline='\n') as f:f.write(text.strip()+'\n')
target=ROOT/'docs/quality/product-downloads-193';target.mkdir(exist_ok=True)
evidence=target/'evidence';evidence.mkdir(exist_ok=True);media=target/'media';media.mkdir(exist_ok=True)
for src in [qa_path,D/'.data/deployment-193/upload-receipt.json',D/'.data/deployment-193/upload-manifest.json']:
 copy(src,evidence/src.name)
for filename in ['deploy-v1.log','deploy-v2.log','deploy-v3.log']:
 copy(D/'.data/deployment-193'/filename,evidence/filename)
for filename in ['public-qa-v1.log','public-qa-v2.log','public-qa-v3.log','public-qa-v4.log','public-qa-v5.log','public-qa-v6.log','public-qa-v7.log','click-probe-v1.log']:
 copy(P/filename,evidence/filename)
for sub in sorted(P.glob('public-*/receipt.json')):
 if sub!=qa_path:copy(sub,evidence/(sub.parent.name+'.json'))
for sub in sorted(P.glob('click-probe-*/receipt.json')):copy(sub,evidence/(sub.parent.name+'.json'))
before=next(P.glob('before-*/receipt.json'));copy(before,evidence/'before.json')
for filename in ['downloads-desktop-en.png','downloads-mobile-zh.png','downloads-mobile-dark.png']:
 copy(qa_path.parent/filename,media/filename)
video=Path(qa['actual_video']);assert video.is_file()
ffmpeg=Path(shutil.which('ffmpeg'));assert ffmpeg.is_file()
subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-i',str(video),'-t','16','-vf','fps=5,scale=864:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer','-loop','0',str(media/'actual-download-navigation.gif')],check=True)
specific={
 'platform':('用戶端安裝包由站點靜態分發，不暴露後台、API 金鑰或部署配置；登入後仍按原企業及專案權限使用公司 API。','Client files are served as public static downloads without administrator or provider secrets. App use still requires the existing company/project authorization and company API.'),
 'web':('首頁導覽與頁尾、登入頁、工作台側欄及「裝置與檔案」提供下載入口。/downloads 支援直接訪問、刷新、繁中/英文、亮/暗色及手機版面。','The homepage, footer, sign-in page, workspace sidebar and Devices page link to /downloads. Direct navigation, refresh, Traditional Chinese/English, themes and mobile layouts are supported.'),
 'admin':('管理後台可繼續管理帳戶、模型、權限與用量；安裝包在用戶站點公開下載，毋須把後台入口或管理權限交給客戶。','Administrator account/model/permission/usage management remains in the dashboard; public client downloads are on the customer site and require no administrator access.'),
 'desktop':('下載 Windows 安裝版或便攜版 0.7.4；在瀏覽器完成帳戶驗證後，選擇本機資料夾和權限，Codex 在客戶本機執行。沿用已發布安裝包及原散列。','Download Windows Setup or Portable 0.7.4. Complete account verification in the system browser, choose a local folder and permissions, and run Codex on the customer computer. Existing release binaries and hashes are retained.'),
 'extension':('0.5.4 ZIP 解壓到固定資料夾，在 chrome://extensions 啟用開發人員模式並「載入未封裝項目」，釘選圖示後開啟原生右側欄。登入、選擇及上傳檔案後，Agent 在雲端處理。擴展 ID 保持不變。','Extract the 0.5.4 ZIP to a permanent folder. Enable Developer mode in chrome://extensions, choose Load unpacked, pin the icon and open the native right-side panel. Sign in and explicitly upload files for the cloud agent. The extension ID is preserved.'),
 'delivery':('只分發已校驗的兩個 Desktop 檔案、擴展 ZIP 和 SHA256SUMS.txt；下載頁與版本檔案分開路由，支持 HEAD、Range 斷點續傳，缺檔返回 404、不列目錄。上線只平滑重載站點代理。','Publish only two verified Desktop files, the extension ZIP and SHA256SUMS.txt. Separate page and versioned-file routing supports HEAD and Range/resume, returns 404 for missing files and disables directory listings. Deployment gracefully reloads only the site proxy.'),
}
for name,(zh,en) in specific.items():
 repo=ROOT/'dev'/('copypaste-'+name);assets=repo/'assets/screenshots';assets.mkdir(parents=True,exist_ok=True)
 for src in media.iterdir():copy(src,assets/('193-'+src.name))
 for filename,english in [('README.md',False),('README.en.md',True)]:
  p=repo/filename;original=p.read_text(encoding='utf8');assert '<!-- product-downloads-193 -->' not in original
  text=('''<!-- product-downloads-193 -->

## Public product downloads · 193

[Open the download page](https://agent.copypaste.hk/downloads). Desktop 0.7.4 (Windows Setup/Portable), Chrome extension 0.5.4 ZIP and file checksums download directly from the company site without signing in.

'''+en+'''

The Windows build is unsigned. The extension is installed manually and is not listed in the Chrome Web Store. macOS/Linux installers are not available.
''' if english else '''<!-- product-downloads-193 -->

## 產品下載與安裝 · 193

[開啟產品下載頁](https://agent.copypaste.hk/downloads)。Desktop 0.7.4（Windows 安裝版/便攜版）、Chrome 擴展 0.5.4 ZIP 及檔案校驗清單均可免登入從本站直接下載。

'''+zh+'''

目前 Windows 包未簽名；擴展為手動安裝，尚未上架 Chrome 線上應用程式商店；macOS/Linux 安裝包尚未提供。
''')
  text+='''
[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/193-product-downloads.md) · [驗證 / Verification](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/193-product-downloads.md)

![實際下載頁 / Actual public download page](assets/screenshots/193-downloads-desktop-en.png)

[實際手機下載頁 / Actual mobile download page](assets/screenshots/193-downloads-mobile-zh.png)

![實際頁面操作錄製 / Actual download navigation recording](assets/screenshots/193-actual-download-navigation.gif)

'''
  p.write_text(text+original,encoding='utf8',newline='\n')
req=ROOT/'docs/requirements/193-product-downloads.md'
new(req,'''# 產品下載頁 / Public product downloads

用戶應能從站點找到並下載 Desktop 和瀏覽器擴展。只有 GitHub Release 不構成站點產品交付。

1. `/downloads` 免登入可用；首頁導覽/頁尾、登入頁、工作台及裝置頁均可發現入口，手機亦可見。
2. 明確區分 Desktop 本機 Codex / 主動完整權限與 Extension 原生右側欄 / 選擇上傳 / 雲端 Agent。
3. 提供實際 Windows 安裝版、便攜版、Chrome ZIP、版本、大小、SHA-256 及安裝步驟。
4. 直連下載使用站點 HTTPS；HEAD、檔案長度、Range 續傳正確，缺檔 404、不返回 SPA 或列出目錄。
5. 延續品牌、繁中/英文、亮/暗色；手機無水平溢出；下載不要求登入，使用時沿用既有登入及權限。
6. 如實標示未簽名、未上架商店及未提供平台；不以佔位商店連結或不可用平台取代交付。

Customers can discover and directly download real clients from the site. The public page documents execution/permission differences, actual packages and hashes, installation steps, languages/themes and platform limits. Existing app authentication remains required for use. Versioned downloads must support resume and real 404s, without exposing deployment or administrator secrets.
''')
dev=ROOT/'docs/development/193-product-downloads.md'
new(dev,'''# 產品分發實現 / Product distribution implementation

原問題：現有安裝包在 GitHub，Web 未建立下載頁和導航。舊 Nginx `/downloads/` 目錄別名亦攔截 SPA，直接訪問帶斜線路徑返回 403。修正為公開 `/downloads` 頁、`/downloads/` 規範跳轉，以及獨立的 `/downloads/releases/193/` 檔案目錄。

Web 的 `contracts/product-downloads.json` 綁定版本、原檔大小及 SHA-256；頁面不推測下載地址，不以登入 token、Blob 或後台代理傳輸公開安裝包。原 Desktop 0.7.4 位元組保持不變；擴展 0.5.4 由目前 dist 建包，根目錄包含 manifest.json，保留 public key、原生 sidePanel 和正式 API 地址，排除 source maps。

```mermaid
flowchart TD
 A[首頁 / 登入 / 工作台 / 裝置] --> B[公開下載頁 / downloads]
 B --> C[Windows Setup 或 Portable]
 B --> D[Chrome ZIP + Load unpacked]
 C --> E[瀏覽器帳戶驗證 + 本機資料夾及權限]
 E --> F[客戶本機 Codex]
 D --> G[原生右側欄登入 + 選擇上傳檔案]
 G --> H[雲端 Codex]
 F --> I[公司模型 API / 原用量帳務]
 H --> I
```

上線：`prepare-public-downloads-193-v1.py` 校驗原 Desktop、建擴展 ZIP/清單；`upload-public-downloads-193-v1.py` 僅上傳 Web 靜態包及四個公開檔案；最終 `deploy-public-downloads-193-v3.sh` 校驗伺服器檔案、備份配置、測試 Nginx 並平滑 reload。Web 根為 `/opt/workmate/overlays/product-downloads-193-v3/web/dist`；檔案為 `/opt/workmate/downloads/releases/193/`。受保護備份在 `/root/cfg/workmate/downloads-193-v3/`，不隨安裝包分發。

回滾：以受保護的 nginx.conf.before 恢復原配置，使用既有 `/opt/workmate/nginx/` prefix 測試後 reload。保留原 Web/後台目錄、舊安裝包、服務、資料庫和 env。不要重播原失敗 V1/V2。

The public page and versioned files use separate routes. Existing Desktop bytes remain unchanged; the current extension is packaged as a manual-install ZIP with its stable extension ID. Four public files are served as attachments with immutable versioned caching, HEAD and Range support. Missing files remain 404 and listing remains disabled. Only the proxy is gracefully reloaded; existing API/database service identities, restart counts and configuration bytes are verified unchanged. V1/V2 deployment attempts failed before any server mutation and are retained; V3 accounts for the host's older Python and the original uploaded bundle name.
''')
new(ROOT/'docs/changes/193-product-downloads.md','''# 193 — 補齊站點下載交付 / Complete website client distribution

- 新增可直接訪問/刷新的雙語品牌下載頁及五類入口，修正 `/downloads/` 目錄衝突。
- 本站直接下載 Desktop 0.7.4 安裝/便攜版、Extension 0.5.4 ZIP 和 SHA-256；公開檔案可續傳，缺檔和目錄不偽裝成頁面。
- 寫清本機/雲端執行、登入、權限和手動安裝流程；提供真實網站截圖與錄製 GIF。
- Web 構建、32 項 Web 檢查、89 項 Extension 檢查及實際公網下載/散列、手機/主題、登入入口檢查通過。此次只驗證產品下載交付。

Added a branded bilingual download page with discoverable entry points and correct SPA/file routing. The company site now serves actual Desktop Setup/Portable files, the current manual-install extension ZIP and checksums. Actual browser clicks verify complete download hashes; responsive/theme and authenticated entry points are checked. Existing Desktop binaries and service/database identities are preserved.
''')
new(ROOT/'docs/quality/193-product-downloads.md',f'''# 193 — 產品下載檢查 / Public download verification

[線上下載頁](https://agent.copypaste.hk/downloads) · [機器記錄](193-product-downloads.json) · [實現與回滾](../development/193-product-downloads.md)

原站點沒有產品入口；`/downloads` 只返回 SPA 兜底，`/downloads/` 返回 403，並不提供下載頁。現已部署公開頁及四個版本檔案。Web 構建及 32 項檢查通過；擴展 89 項檢查通過。

實際公網瀏覽器完成 {len(qa['checks'])} 組檢查：首頁/工作台/裝置/登入入口、直接路徑/刷新/斜線、安裝步驟、版本/SHA、HEAD/Range、真實三檔點擊下載及完整散列、403/404、1440/390/320 版面、繁中/英文/深色。瀏覽器均已關閉。未重跑與本次靜態分發無關的付費 Agent 任務。

保留原失敗：部署 V1 遇到伺服器 Python 無 file_digest，V2 上傳包名斷言不符，均在修改配置前停止；V3 成功。瀏覽器 V1 未在程序啟動前指定影片工具目錄；V2 等待 networkidle 超時；V3 的 Range 協議探針後下載等待超時；乾淨瀏覽器獨立探針成功。V4 調整先下載後協議探針，但驗證器未初始化下載記錄；V5 完成三檔完整下載及散列、協議驗證，後於繁中標題含換行的選擇器超時。V6 以整份 HTML 比較時遇 CDN 分析腳本插入；V7 比對實際產品 JS/CSS，續驗剩餘版面/語言/主題/登入入口成功，原 V5 完成下載證據仍保留原失敗狀態。本輪成功結果由已完成下載和續驗結果組成，無付費任務重跑。原記錄不改寫為通過。

Verified actual public download delivery, not complete-product acceptance. Windows is unsigned, extension installation is manual and Chrome Web Store/macOS/Linux distribution is unavailable. Existing backend/database/proxy MainPIDs and restart counts remain identical, with application and migration env bytes preserved.

![Actual download page](product-downloads-193/media/downloads-desktop-en.png)

![Actual mobile view](product-downloads-193/media/downloads-mobile-zh.png)

![Actual navigation recording](product-downloads-193/media/actual-download-navigation.gif)
''')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf8');assert '<!-- product-downloads-193 -->' not in old
 text=('產品下載頁已上線：Desktop 0.7.4 安裝/便攜版及 Extension 0.5.4 ZIP 可從本站直接下載，含安裝步驟及 SHA-256；原包/服務保持。' if name=='README.md' else 'The product download page is live: download Desktop 0.7.4 Setup/Portable and Extension 0.5.4 ZIP directly from the site, with installation instructions and SHA-256. Existing Desktop bytes and services are preserved.')
 p.write_text('<!-- product-downloads-193 -->\n\n'+text+'\n\n[下載 / Downloads](https://agent.copypaste.hk/downloads) · [需求 / Scope](requirements/193-product-downloads.md) · [方案 / Implementation](development/193-product-downloads.md) · [實測 / Verification](quality/193-product-downloads.md)\n\n'+old,encoding='utf8',newline='\n')
repos={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
paths={}
for branch,folder in repos.items():
 repo=ROOT/'dev'/('copypaste-'+folder)
 r=subprocess.run(['git','-c','core.fsmonitor=false','-C',str(repo),'status','--porcelain','-uall'],capture_output=True,check=True)
 names=[line[3:] for line in r.stdout.decode('utf8').splitlines()]
 paths[branch]=sorted(n for n in names if (n.startswith(('README.','assets/screenshots/193-')) or (branch=='delivery' and n.startswith('scripts/') and '-193-' in n)) or (branch=='web' and n in ['contracts/product-downloads.json','src/main.tsx','src/product-download-page.tsx','src/product-download-page.css','src/product-downloads.ts','tests/product-downloads.test.ts']) or (branch=='extension' and n in ['package.json','package-lock.json']))
paths['docs']=sorted(['docs/README.md','docs/README.en.md','docs/requirements/193-product-downloads.md','docs/development/193-product-downloads.md','docs/changes/193-product-downloads.md','docs/quality/193-product-downloads.md','docs/quality/193-product-downloads.json','docs/tools/prepare-product-downloads-193.py','docs/tools/prepare-product-downloads-193-v2.py','docs/tools/publish-product-downloads-193.py']+[str(p.relative_to(ROOT)).replace('\\','/') for p in target.rglob('*') if p.is_file()])
save(P/'publication-paths.json',paths)
sources={}
for branch,folder in repos.items():
 for n in paths[branch]:sources[f'dev/copypaste-{folder}/{n}']=digest(ROOT/'dev'/('copypaste-'+folder)/n)
for n in paths['docs']:
 if (ROOT/n).is_file() and n!='docs/quality/193-product-downloads.json':sources[n]=digest(ROOT/n)
report={'stage':193,'status':'public_download_delivery_verified','at':datetime.now(timezone.utc).isoformat(),'page':'https://agent.copypaste.hk/downloads','scope':'Public product download distribution; not complete-product acceptance','full_product_accepted':False,'desktop_version':'0.7.4','desktop_binaries_changed':False,'extension_version':'0.5.4','web_checks_passed':32,'extension_checks_passed':89,'actual_public_browser_checks':len(qa['checks']),'browser_downloads':qa['downloads'],'owned_browsers_closed':qa['owned_browser_closed'],'sources':sources,'evidence':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':digest(p)} for p in target.rglob('*') if p.is_file()]}
save(ROOT/'docs/quality/193-product-downloads.json',report)
print(json.dumps({'status':'prepared','actual_browser_checks':len(qa['checks']),'reviewed_files':{b:len(n) for b,n in paths.items()}},ensure_ascii=False))
