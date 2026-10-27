import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  MonitorOff,
  ShieldCheck,
  FolderHeart,
  Unplug,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import { useI18n } from "./ui";
import "./desktop-updates.css";
import "./desktop-removal.css";

export function DesktopRemovalCard() {
  const { t } = useI18n(),
    bridge = window.copyPasteBridge;
  const [status, setStatus] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [clearCache, setClearCache] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const read = () => {
      void bridge
        .desktopRemoval("status")
        .then((value) => {
          if (alive) setStatus(value);
        })
        .catch(() => {
          if (alive)
            setMessage(
              t(
                "暫時未能讀取此電腦狀態。",
                "This computer's status could not be read.",
              ),
            );
        });
    };
    read();
    const off = bridge.onDesktopRemovalChanged(read);
    return () => {
      alive = false;
      off();
    };
  }, [bridge, t]);
  if (!bridge) return null;
  const action = async (kind: "prepare" | "retry" | "uninstall-settings") => {
    setBusy(true);
    setMessage("");
    try {
      const result = await bridge.desktopRemoval(
        kind,
        kind === "prepare" ? { clearCache } : undefined,
      );
      setStatus(result);
      if (result.cancelled)
        setMessage(
          t(
            "已取消，電腦權限未變更。",
            "Cancelled. Computer permissions were not changed.",
          ),
        );
    } catch {
      setMessage(
        t(
          "操作未完成。請先結束或取消正在進行的更新，再重試；未完成的撤權記錄會保留。",
          "This action did not finish. Finish or cancel an active update, then retry. Unfinished withdrawal records are retained.",
        ),
      );
      try {
        setStatus(await bridge.desktopRemoval("status"));
      } catch {}
    } finally {
      setBusy(false);
    }
  };
  const ready =
    status?.disabled &&
    status.completedAt &&
    status.host !== "retry" &&
    status.cache !== "retry";
  const reconnect = async () => {
    setBusy(true);
    setMessage("");
    try {
      await bridge.signIn();
      setStatus(await bridge.desktopRemoval("status"));
    } catch {
      setMessage(
        t(
          "尚未完成重新登入，請再試一次。",
          "Sign-in did not finish. Please try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="card desktop-update-card desktop-removal-card"
      aria-label={t("此電腦與卸載", "This computer and uninstall")}
      aria-busy={busy}
    >
      <div className="desktop-update-heading">
        <span className="desktop-update-icon">
          <MonitorOff size={24} />
        </span>
        <div>
          <p className="eyebrow">YOUR COMPUTER. YOUR CONTROL.</p>
          <h2>{t("此電腦與卸載", "This computer and uninstall")}</h2>
        </div>
      </div>
      <div className="desktop-update-status" role="status" aria-live="polite">
        {ready ? <CheckCircle2 size={20} /> : <ShieldCheck size={20} />}
        <strong>
          {busy
            ? t(
                "正在停止工作並處理權限…",
                "Stopping work and processing permissions…",
              )
            : !status
              ? t("讀取狀態中…", "Reading status…")
              : ready
                ? t("此電腦已斷開", "This computer is disconnected")
                : status.disabled
                  ? t(
                      "本機已停用，仍有步驟待完成",
                      "Local access disabled; preparation is unfinished",
                    )
                  : t(
                      "由你決定此電腦的權限",
                      "You control this computer's permissions",
                    )}
        </strong>
      </div>
      <p className="desktop-update-message muted">
        {t(
          "準備停用或卸載時，先安全結束本機工作。重新使用需要再次登入及授權。",
          "Before disconnecting or uninstalling, safely finish local work. Using this computer again requires a new sign-in and permission.",
        )}
      </p>
      <ol className="desktop-removal-steps">
        <li>
          <Unplug size={19} />
          <div>
            <strong>{t("停止本機操作", "Stop local work")}</strong>
            <p>
              {t(
                "停止 Codex、目錄自動工作及程式，關閉 Agent 建立的瀏覽器頁面。",
                "Stop Codex, folder work and programs. Close browser pages created by the Agent.",
              )}
            </p>
          </div>
        </li>
        <li>
          <ShieldCheck size={19} />
          <div>
            <strong>
              {t("撤銷此電腦的連線", "Withdraw this computer's connections")}
            </strong>
            <p>
              {t(
                "登出 Desktop、撤銷資料夾授權及 Chrome Host，斷開對應的雲端設備。",
                "Sign out Desktop, withdraw folder grants and Chrome Host, and disconnect the matching cloud devices.",
              )}
            </p>
          </div>
        </li>
        <li>
          <FolderHeart size={19} />
          <div>
            <strong>{t("保留你的原始檔案", "Keep your original files")}</strong>
            <p>
              {t(
                "工作目錄、客戶原檔、未結算記錄和加密重試回執保留。其他電腦及企業帳戶繼續使用。",
                "Keep workspaces, original files, unsettled records and encrypted retry receipts. Other computers and the company account remain available.",
              )}
            </p>
          </div>
        </li>
      </ol>
      {(status?.disabled || status?.pending > 0) && (
        <div
          className="desktop-removal-receipt"
          aria-label={t("撤權回執", "Withdrawal receipt")}
        >
          <p>
            <strong>{t("雲端撤權", "Cloud withdrawal")}</strong>
            <span data-removal-remote={status.remote}>
              {status.remote === "disconnected"
                ? t("已確認", "Confirmed")
                : status.remote === "unverified"
                  ? t(
                      "未驗證，請重試或到網頁設備頁處理",
                      "Unverified. Retry or review Devices on the web.",
                    )
                  : t(
                      "待重試；離線時無法確認雲端撤權",
                      "Pending retry. Cloud withdrawal cannot be confirmed offline.",
                    )}
            </span>
          </p>
          <p>
            <strong>{t("Chrome Host", "Chrome Host")}</strong>
            <span>
              {status.host === "retry"
                ? t("待完成", "Unfinished")
                : status.host === "foreign"
                  ? t(
                      "保留其他安裝的註冊",
                      "Another installation's registration retained",
                    )
                  : t(
                      "此安裝的註冊已移除或不存在",
                      "This installation's registration is removed or absent",
                    )}
            </span>
          </p>
          <p>
            <strong>{t("應用程式快取", "App caches")}</strong>
            <span>
              {status.cache === "cleared"
                ? t("已清理", "Cleared")
                : status.cache === "retry"
                  ? t("清理待重試", "Cleanup needs retry")
                  : t("保留", "Retained")}
            </span>
          </p>
        </div>
      )}
      <label className="desktop-removal-option">
        <input
          type="checkbox"
          checked={clearCache}
          disabled={busy}
          onChange={(event) => setClearCache(event.target.checked)}
        />
        <span>
          {t(
            "同時清理應用程式快取及已下載更新",
            "Also clear app caches and downloaded updates",
          )}
          <small>
            {t(
              "原生確認視窗會再次顯示此選項。",
              "The native confirmation dialog shows this choice again.",
            )}
          </small>
        </span>
      </label>
      <div className="desktop-update-actions">
        <button
          className="button"
          disabled={busy || !status}
          onClick={() => void action("prepare")}
        >
          <Unplug size={16} />
          {t("斷開此電腦", "Disconnect this computer")}
        </button>
        {(status?.disabled || status?.pending > 0) && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void action("retry")}
          >
            <RefreshCw size={16} />
            {t("重試未完成步驟", "Retry unfinished steps")}
          </button>
        )}
        {ready && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void reconnect()}
          >
            {t("重新登入此電腦", "Sign in to this computer again")}
          </button>
        )}
        {ready && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void action("uninstall-settings")}
          >
            <ArrowUpRight size={16} />
            {t("前往 Windows 卸載", "Open Windows uninstall")}
          </button>
        )}
        {status?.disabled && status.remote !== "disconnected" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void bridge.openCloudWorkspace("devices")}
          >
            {t("在網頁檢查設備", "Review Devices on the web")}
          </button>
        )}
      </div>
      {message && (
        <p className="desktop-update-message" role="alert">
          {message}
        </p>
      )}
      <p className="desktop-update-footnote">
        <ShieldCheck size={15} />
        {t(
          "每次斷開都需要你在原生視窗確認。離線回執會在本程式重新開啟後重試；卸載程式會保留該回執及必要的加密金鑰。",
          "Each disconnection requires your native confirmation. Offline receipts retry when this app reopens; uninstall retains the receipt and its necessary encrypted key.",
        )}
      </p>
    </section>
  );
}
export function DesktopRemovalPage() {
  const { t } = useI18n();
  return (
    <main className="desktop-updates-page desktop-removal-page">
      <div className="desktop-updates-top">
        <Link to="/" className="logo">
          <img src="./brand-mark.png" alt="" />
          <strong>CopyPaste</strong>
        </Link>
        <Link to="/app/settings" className="button secondary">
          {t("返回工作區", "Back to workspace")}
        </Link>
      </div>
      <DesktopRemovalCard />
    </main>
  );
}
