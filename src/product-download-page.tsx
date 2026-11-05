import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight, Check, ChevronRight, Download, FolderOpen, Globe2, Monitor, PanelRight, ShieldCheck } from "lucide-react";
import { useI18n } from "./ui";
import { desktopPortable, desktopSetup, downloadSize, productDownloads } from "./product-downloads";
import "./product-download-page.css";

export function ProductDownloads({ workspace = "/login" }: { workspace?: string }) {
  const { t, locale } = useI18n();
  const [active, setActive] = useState<"desktop" | "extension">("desktop");
  const extension = productDownloads.extension;
  useEffect(() => {
    const previous = document.title;
    document.title = t("下載 · CopyPaste", "Downloads · CopyPaste");
    return () => { document.title = previous; };
  }, [locale]);
  const steps = active === "desktop" ? [
    [t("安裝並開啟", "Install and open"), t("下載 Windows 安裝版，開啟檔案並依畫面完成安裝；便攜版可直接執行。", "Download the Windows installer and follow its steps. The portable edition runs without installation.")],
    [t("用同一帳戶登入", "Sign in to your workspace"), t("在系統瀏覽器完成郵箱驗證，再返回桌面端選擇企業、專案和專家。", "Verify your email in the system browser, then return to choose your workspace, project and specialist.")],
    [t("選擇資料夾與權限", "Choose a folder and permissions"), t("選定工作資料夾。你可以主動授予完整本機權限，讓 Agent 處理本機檔案與命令，並隨時撤銷。", "Choose a project folder. You can explicitly grant full local access for files and commands, and revoke it whenever needed.")],
  ] : [
    [t("下載並解壓縮", "Download and extract"), t("將擴展 ZIP 解壓縮到固定資料夾，並保留該資料夾。", "Extract the extension ZIP to a permanent folder and keep that folder in place.")],
    [t("在 Chrome 載入擴展", "Load it in Chrome"), t("開啟 chrome://extensions，啟用「開發人員模式」，點選「載入未封裝項目」，選擇內含 manifest.json 的資料夾。", "Open chrome://extensions, enable Developer mode, choose Load unpacked and select the folder containing manifest.json.")],
    [t("釘選並開啟右側欄", "Pin and open the side panel"), t("將 CopyPaste 釘選到工具列，點選圖示開啟右側對話欄。登入後，可選擇並上傳允許使用的檔案，由雲端 Agent 處理。", "Pin CopyPaste to the toolbar and click its icon to open the right-side conversation panel. Sign in, then choose and upload files for the cloud agent.")],
  ];
  return <div className="product-downloads">
    <a className="downloads-skip" href="#download-options">{t("跳至下載選項", "Skip to download options")}</a>
    <header className="site-header downloads-header">
      <Link to="/" className="logo" aria-label="CopyPaste home"><img src="/brand-mark.png" alt="" /><strong>CopyPaste</strong></Link>
      <nav aria-label={t("網站導覽", "Site navigation")}>
        <Link to="/">{t("首頁", "Home")}</Link>
        <Link to="/downloads" aria-current="page">{t("下載", "Downloads")}</Link>
        <Link className="button secondary small" to={workspace}>{t("進入工作台", "Open workspace")}<ArrowUpRight size={15} /></Link>
      </nav>
    </header>
    <main className="downloads-main" id="downloads-main">
      <section className="downloads-intro" aria-labelledby="download-heading">
        <div>
          <p className="eyebrow">COPYPASTE, WHERE YOU WORK.</p>
          <h1 id="download-heading">{t("把工作空間，", "Your workspace,")}<br /><em>{t("帶到手邊。", "closer to hand.")}</em></h1>
        </div>
        <div className="downloads-intro-copy"><p>{t("在本機深入處理專案，或在瀏覽器旁隨手交辦。選擇適合你的方式，沿用同一個 CopyPaste 帳戶。", "Work deeply with a local project, or delegate from beside your browser. Choose how you work and keep the same CopyPaste account.")}</p><a href="#download-options">{t("選擇你的版本", "Choose your edition")}<ArrowDown size={16} /></a></div>
      </section>
      <section className="download-options" id="download-options" aria-label={t("產品下載", "Product downloads")}>
        <article className="download-edition desktop-edition" aria-labelledby="desktop-heading">
          <div className="download-edition-top"><div className="download-platform-icon"><Monitor size={29} strokeWidth={1.5} /></div><span className="download-version">Windows · v{productDownloads.desktop.version}</span></div>
          <p className="eyebrow">ON YOUR COMPUTER</p>
          <h2 id="desktop-heading">CopyPaste <em>Desktop</em></h2>
          <p className="download-edition-description">{t("讓你的本機檔案，真正參與工作。", "Put your local project to work.")}</p>
          <ul className="download-feature-list">
            <li><FolderOpen size={17} />{t("Agent 在你的電腦上執行，讀寫檔案、執行命令。", "The agent works on your computer, with local files and commands.")}</li>
            <li><ShieldCheck size={17} />{t("主動授予完整本機權限，也能隨時撤銷。", "Explicit full local access, with permission you can revoke.")}</li>
            <li><Check size={17} />{t("沿用企業專案、專家角色與用量記錄。", "Your company projects, specialists and usage stay connected.")}</li>
          </ul>
          <div className="download-edition-actions">
            <a className="button primary" href={desktopSetup.url} download={desktopSetup.name} data-download="desktop-setup"><Download size={17} />{t("下載 Windows 安裝版", "Download for Windows")}<ChevronRight size={17} /></a>
            <span className="download-file-meta">64-bit · {downloadSize(desktopSetup.bytes)}</span>
            <a className="download-secondary-link" href={desktopPortable.url} download={desktopPortable.name} data-download="desktop-portable">{t("下載便攜版", "Download portable edition")}<ArrowDown size={14} /><span>{downloadSize(desktopPortable.bytes)}</span></a>
          </div>
          <p className="download-install-note">{t("目前提供 Windows 64 位元版本。此版本尚未簽署，Windows 可能提示未識別的發行者。", "Available for 64-bit Windows. This build is unsigned; Windows may show an unrecognized publisher notice.")}</p>
        </article>
        <article className="download-edition extension-edition" aria-labelledby="extension-heading">
          <div className="download-edition-top"><div className="download-platform-icon"><PanelRight size={28} strokeWidth={1.5} /></div><span className="download-version">Chrome · v{extension.version}</span></div>
          <p className="eyebrow">BESIDE YOUR BROWSER</p>
          <h2 id="extension-heading">CopyPaste <em>Extension</em></h2>
          <p className="download-edition-description">{t("不用離開頁面，就能開始交辦。", "Start a conversation beside your page.")}</p>
          <ul className="download-feature-list">
            <li><PanelRight size={17} />{t("點選圖示，在瀏覽器原生右側欄對話。", "Click the icon to open a native right-side conversation panel.")}</li>
            <li><FolderOpen size={17} />{t("選擇並上傳檔案，交給雲端 Agent 使用。", "Choose and upload files for your cloud agent to use.")}</li>
            <li><Check size={17} />{t("檔案由你選擇，工作成果回到同一個專案。", "You select the files; results return to the same project.")}</li>
          </ul>
          <div className="download-edition-actions">
            <a className="button secondary" href={extension.artifact.url} download={extension.artifact.name} data-download="extension"><Download size={17} />{t("下載 Chrome 擴展 ZIP", "Download Chrome extension ZIP")}</a>
            <span className="download-file-meta">Chrome {extension.minimum_chrome_version}+ · {downloadSize(extension.artifact.bytes)}</span>
            <a className="download-secondary-link" href="#installation" onClick={() => setActive("extension")}>{t("查看安裝步驟", "View installation steps")}<ArrowDown size={14} /></a>
          </div>
          <p className="download-install-note">{t("目前以 ZIP 手動安裝，尚未上架 Chrome 線上應用程式商店。", "Currently installed manually from a ZIP. It is not yet listed in the Chrome Web Store.")}</p>
        </article>
      </section>
      <section className="download-browser-option">
        <Globe2 size={22} strokeWidth={1.5} /><div><h2>{t("也可以，直接用網頁。", "Or simply use the web.")}</h2><p>{t("不需安裝，在瀏覽器開始創作、分析與雲端工作。", "Create, analyze and delegate cloud work without installing anything.")}</p></div><Link to={workspace}>{t("開啟網頁工作台", "Open web workspace")}<ArrowUpRight size={17} /></Link>
      </section>
      <section className="download-installation" id="installation" aria-labelledby="installation-heading">
        <div className="download-section-heading"><div><p className="eyebrow">READY WHEN YOU ARE.</p><h2 id="installation-heading">{t("安裝，然後開始。", "Set up. Set to work.")}</h2></div><div className="download-install-switch" role="group" aria-label={t("安裝方式", "Installation guide")}><button type="button" aria-pressed={active === "desktop"} onClick={() => setActive("desktop")}>Desktop</button><button type="button" aria-pressed={active === "extension"} onClick={() => setActive("extension")}>Extension</button></div></div>
        <ol className="download-install-steps" aria-live="polite">{steps.map(([title,body],index)=><li key={active+index}><span className="download-step-number">{String(index+1).padStart(2,"0")}</span><h3>{title}</h3><p>{body}</p></li>)}</ol>
      </section>
      <section className="download-details" aria-labelledby="download-details-heading"><h2 id="download-details-heading">{t("版本與檔案校驗", "Versions and file verification")}</h2><p>{t("下載不需登入；使用時再完成帳戶驗證。下方 SHA-256 對應此頁的實際安裝檔。", "Downloads do not require sign-in. Verify your account when you start using the app. These SHA-256 values match the files on this page.")}</p><details><summary>{t("查看版本說明與 SHA-256", "View release notes and SHA-256")}</summary><div className="download-release-notes"><p><strong>Desktop {productDownloads.desktop.version}</strong> — {t("本機 Codex、資料夾與完整權限控制、公司模型接入及用量結算。", "Local Codex, project folders, explicit full access, company model access and usage settlement.")}</p><p><strong>Extension {extension.version}</strong> — {t("原生右側欄、帳戶登入、授權檔案上傳與雲端任務；本次整理公開下載安裝包。", "Native side panel, sign-in, authorized uploads and cloud tasks; packaged for public download in this release.")}</p><p>{t("macOS 與 Linux 安裝包尚未提供。", "macOS and Linux installers are not currently available.")}</p></div><dl className="download-checksums">{[desktopSetup,desktopPortable,extension.artifact].map(a=><div key={a.name}><dt>{a.name}</dt><dd><code>{a.sha256}</code></dd></div>)}</dl><a href={productDownloads.checksums_url} download="SHA256SUMS.txt" className="download-secondary-link">{t("下載校驗清單", "Download checksum list")}<Download size={14}/></a></details></section>
    </main>
    <footer className="site-footer downloads-footer"><Link to="/" className="logo"><img src="/brand-mark.png" alt="" /><strong>CopyPaste</strong></Link><span>© {new Date().getFullYear()} CopyPaste · Hong Kong</span><a href="https://copypaste.hk/" target="_blank" rel="noreferrer">copypaste.hk<ArrowUpRight size={14}/></a></footer>
  </div>;
}
