import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Monitor,
} from "lucide-react";
import { useI18n } from "./ui";
import "./desktop-updates.css";

export function DesktopUpdatesCard() {
  const { t, locale } = useI18n(),
    [status, setStatus] = useState<any>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const bridge = window.copyPasteBridge;
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const read = () => {
      void bridge
        .desktopUpdates("status")
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch(() => {});
    };
    read();
    const off = bridge.onDesktopUpdatesChanged(read);
    return () => {
      active = false;
      off();
    };
  }, [bridge]);
  if (!bridge) return null;
  const act = async (
    action: "check" | "download" | "cancel" | "discard" | "install",
  ) => {
    setPending(true);
    setError("");
    try {
      setStatus(await bridge.desktopUpdates(action));
    } catch {
      setError(
        t(
          "暫時未能完成，請稍後再試。",
          "This action could not finish. Please try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const messages: Record<string, [string, string]> = {
    UPDATE_TRUST_NOT_CONFIGURED: [
      "此版本尚未啟用公司更新頻道。",
      "Company updates are not enabled for this build.",
    ],
    UPDATE_CURRENT: [
      "你正在使用目前適用的版本。",
      "You are using the current version for this installation.",
    ],
    UPDATE_NO_RELEASE: [
      "目前沒有已發佈的更新。",
      "There is no published update yet.",
    ],
    UPDATE_WITHDRAWN: [
      "此更新已撤回，請等候新版本。",
      "This update was withdrawn. Please wait for the next release.",
    ],
    UPDATE_ROLLOUT_PENDING: [
      "新版本正在分批推出，稍後將輪到此電腦。",
      "The release is rolling out gradually. This computer will become eligible later.",
    ],
    UPDATE_MANUAL_UPGRADE_REQUIRED: [
      "此版本需要由管理員協助升級。",
      "Please ask your administrator to help upgrade this version.",
    ],
    UPDATE_MANUAL_INSTALL_REQUIRED: [
      "可攜或開發版本不支援直接安裝。請使用公司提供的已簽署安裝程式。",
      "Portable and development builds require the company's signed installer.",
    ],
    UPDATE_LOCAL_WORK_PENDING: [
      "請先完成或停止本機工作、核對待處理結果，並暫停目錄自動工作，再檢查更新。",
      "Finish or stop local work, review pending outcomes, and pause folder automation. Then check the update again.",
    ],
    UPDATE_RELEASE_CHANGED: [
      "更新版本已變更，請重新檢查。",
      "The published release changed. Please check again.",
    ],
    UPDATE_CANCELLED: [
      "下載已取消，可重新檢查。",
      "Download cancelled. You can check again.",
    ],
    UPDATE_AUTHENTICODE_INVALID: [
      "安裝程式的 Windows 簽名未通過驗證。請聯絡管理員。",
      "The installer's Windows signature could not be verified. Please contact your administrator.",
    ],
    UPDATE_SIGNER_MISMATCH: [
      "安裝程式的發行者不符，已停止更新。",
      "The installer publisher did not match. The update was stopped.",
    ],
    UPDATE_ARTIFACT_MISMATCH: [
      "下載檔案未通過完整性驗證，請重新檢查。",
      "The download failed its integrity check. Please check again.",
    ],
  };
  const phase: Record<string, [string, string]> = {
    disabled: ["由公司管理", "Managed by your company"],
    idle: ["隨時保持最新", "Ready when you are"],
    checking: ["正在檢查更新", "Checking for updates"],
    available: ["新版本已備妥", "A new version is available"],
    current: ["已檢查更新", "Update checked"],
    downloading: ["正在下載更新", "Downloading update"],
    verifying: ["正在驗證安裝程式", "Verifying installer"],
    ready: ["可以安裝", "Ready to install"],
    installing: ["即將重新啟動", "Restarting shortly"],
    error: ["更新暫停", "Update paused"],
  };
  const busy =
      pending ||
      ["checking", "downloading", "verifying", "installing"].includes(
        status?.state,
      ),
    payload = status?.release,
    release = payload?.release;
  const message = messages[status?.code];
  return (
    <section
      className="card desktop-update-card"
      aria-label={t("應用程式更新", "Application updates")}
    >
      <div className="desktop-update-heading">
        <span className="desktop-update-icon">
          <Monitor size={23} />
        </span>
        <div>
          <p className="eyebrow">COPYPASTE DESKTOP</p>
          <h2>{t("讓工作，持續向前。", "Keep your work moving.")}</h2>
        </div>
        <ShieldCheck size={21} className="muted" />
      </div>
      <div className="desktop-update-version">
        <span>
          {t("目前版本", "Current version")}{" "}
          <strong>{status?.current_version ?? "—"}</strong>
        </span>
        <span>{t("穩定頻道", "Stable channel")}</span>
      </div>
      <div className="desktop-update-status" role="status" aria-live="polite">
        <CheckCircle2 size={18} />
        <strong>{t(...(phase[status?.state ?? "idle"] ?? phase.idle))}</strong>
        {release && <span>v{release.version}</span>}
      </div>
      {release && (
        <div className="desktop-update-notes">
          <span className="eyebrow">
            {payload.action === "rollback"
              ? t("公司建議回復此版本", "Company rollback release")
              : t("本次更新", "What's new")}
          </span>
          <p>{locale === "en" ? release.notes.en : release.notes.zh}</p>
        </div>
      )}
      {["downloading", "verifying"].includes(status?.state) && (
        <div className="desktop-update-progress">
          <progress
            max={status.total_bytes || 1}
            value={status.received_bytes}
            aria-label={t("更新下載進度", "Update download progress")}
          />
          <span>
            {Math.floor(status.received_bytes / 1024 / 1024)} /{" "}
            {Math.ceil(status.total_bytes / 1024 / 1024)} MB
          </span>
        </div>
      )}
      {message && (
        <p className="muted desktop-update-message">{t(...message)}</p>
      )}
      {status?.state === "error" && !message && (
        <p className="notice error">
          {t(
            "暫時無法安全完成更新，請重新檢查或聯絡管理員。",
            "The update could not finish safely. Check again or contact your administrator.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {status?.state === "ready" && !status.installer_supported && (
        <p className="muted">{t(...messages.UPDATE_MANUAL_INSTALL_REQUIRED)}</p>
      )}
      <div className="desktop-update-actions">
        <button
          className="button secondary"
          onClick={() => void act("check")}
          disabled={busy}
        >
          <RefreshCw size={16} />
          {t("檢查更新", "Check for updates")}
        </button>
        {status?.state === "available" && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void act("download")}
          >
            <ArrowDownToLine size={16} />
            {t("下載更新", "Download update")}
          </button>
        )}
        {status?.state === "ready" && status.installer_supported && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void act("install")}
          >
            {t("安裝並重新啟動", "Install and restart")}
          </button>
        )}
        {status?.state === "downloading" && (
          <button
            className="button secondary"
            onClick={() => void bridge.desktopUpdates("cancel")}
          >
            {t("取消下載", "Cancel download")}
          </button>
        )}
        {status?.state === "ready" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void act("discard")}
          >
            {t("移除下載", "Remove download")}
          </button>
        )}
      </div>
      <p className="desktop-update-footnote">
        <ShieldCheck size={15} />
        {t(
          "由公司驗證的更新。安裝前會等待本機工作完成。",
          "Company verified updates. Local work must finish before installation.",
        )}
      </p>
    </section>
  );
}
export function DesktopUpdatesPage() {
  const { t } = useI18n();
  return (
    <main className="desktop-updates-page">
      <div className="desktop-updates-top">
        <Link to="/" className="logo">
          <img src="./brand-mark.png" alt="" />
          <strong>CopyPaste</strong>
        </Link>
        <Link to="/app/settings" className="button secondary">
          {t("返回工作區", "Back to workspace")}
        </Link>
      </div>
      <DesktopUpdatesCard />
    </main>
  );
}
