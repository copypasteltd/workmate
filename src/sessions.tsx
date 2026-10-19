import { useState, useEffect } from "react";
import { Globe, Monitor, Puzzle, LogOut, LoaderCircle } from "lucide-react";
import { api, post, endClientSession } from "./api";
import {
  AsyncForm,
  DateText,
  ErrorNotice,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";

function remoteNotice() {
  sessionStorage.setItem("cp_signout_remote_unconfirmed", "true");
  window.dispatchEvent(new Event("copypaste:session-notice"));
}
async function signOut() {
  if (window.copyPasteBridge) {
    const result = await window.copyPasteBridge.signOut();
    if (result?.remote_revoked === false) remoteNotice();
    endClientSession();
  } else await post("/v1/auth/logout");
}
export function SignedOutNotice() {
  const { t } = useI18n();
  const [show, setShow] = useState(
    () => !!sessionStorage.getItem("cp_signout_remote_unconfirmed"),
  );
  useEffect(() => {
    const changed = () =>
      setShow(!!sessionStorage.getItem("cp_signout_remote_unconfirmed"));
    window.addEventListener("copypaste:session-notice", changed);
    return () =>
      window.removeEventListener("copypaste:session-notice", changed);
  }, []);
  return show ? (
    <div className="notice" role="status">
      {t(
        "此裝置已登出，但未能確認服務端撤銷。請連線後從其他已登入裝置的帳戶設定撤銷此會話。",
        "This device is signed out. Remote revocation could not be confirmed. When online, revoke this session from Account settings on another signed-in device.",
      )}
    </div>
  ) : null;
}
export function SignOutButton() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  return (
    <>
      <button
        className="icon-button"
        aria-label={t("登出", "Sign out")}
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          setError(null);
          void signOut()
            .catch((e: Error) => setError(e))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <LogOut size={16} />
        )}
      </button>
      {error && (
        <span className="signout-error" role="alert">
          {error.message}
        </span>
      )}
    </>
  );
}
export function NativeSignInButton() {
  const { t } = useI18n();
  return (
    <AsyncForm
      submitLabel={t("透過瀏覽器安全登入", "Sign in securely in your browser")}
      onSubmit={async () => {
        await window.copyPasteBridge!.signIn();
        sessionStorage.removeItem("cp_signout_remote_unconfirmed");
      }}
    >
      <SignedOutNotice />
    </AsyncForm>
  );
}
type Session = {
  id: string;
  client_id: "web" | "desktop" | "extension";
  current: boolean;
  created_at: string;
  expires_at: string;
  refresh_expires_at: string | null;
};
export function SessionsCard() {
  const { t } = useI18n();
  const [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState<Session | null>(null);
  const sessions = useData<{ items: Session[] }>(
    "/v1/me/sessions",
    refresh,
    15000,
  );
  const label = (s: Session) =>
    s.client_id === "desktop"
      ? "CopyPaste Desktop"
      : s.client_id === "extension"
        ? t("Chrome 擴展", "Chrome extension")
        : t("Web 瀏覽器", "Web browser");
  return (
    <section className="card" aria-label={t("登入中的裝置", "Active sessions")}>
      <div className="section-heading">
        <h2>{t("登入中的裝置", "Active sessions")}</h2>
        <button
          className="text-button"
          disabled={sessions.loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          {t("重新載入", "Reload")}
        </button>
      </div>
      <p className="muted">
        {t(
          "撤銷會同時停用該裝置的存取與更新憑證，不會取消雲端工作。",
          "Revoking ends this device’s access and refresh credentials. Cloud tasks keep running.",
        )}
      </p>
      <ErrorNotice error={sessions.error} />
      {sessions.loading && !sessions.data && <Loading />}
      {sessions.data?.items.map((s) => {
        const Icon =
          s.client_id === "desktop"
            ? Monitor
            : s.client_id === "extension"
              ? Puzzle
              : Globe;
        return (
          <div
            className="session-row"
            key={s.id}
            data-session-id={s.id}
            data-client={s.client_id}
          >
            <Icon size={20} aria-hidden="true" />
            <div>
              <strong>
                {label(s)}{" "}
                {s.current && (
                  <span className="session-current">
                    {t("目前裝置", "This device")}
                  </span>
                )}
              </strong>
              <small>
                {t("登入於", "Signed in")} <DateText value={s.created_at} />
              </small>
              <small>
                {t("有效至", "Valid until")}{" "}
                <DateText value={s.refresh_expires_at ?? s.expires_at} />
              </small>
            </div>
            <button
              className="text-button"
              aria-label={`${t("撤銷", "Revoke")} ${label(s)}${s.current ? t("（目前裝置）", " (this device)") : ""}`}
              onClick={() => setSelected(s)}
            >
              {t("撤銷", "Revoke")}
            </button>
          </div>
        );
      })}
      {sessions.data?.items.length === 0 && (
        <p role="status">
          {t("沒有其他有效會話。", "No active sessions found.")}
        </p>
      )}
      {selected && (
        <Modal
          title={t("撤銷裝置會話", "Revoke device session")}
          onClose={() => setSelected(null)}
        >
          <AsyncForm
            submitLabel={
              selected.current
                ? t("撤銷並登出此裝置", "Revoke & sign out this device")
                : t("確認撤銷", "Confirm revocation")
            }
            onSubmit={async () => {
              if (selected.current && window.copyPasteBridge) await signOut();
              else {
                await api("/v1/me/sessions/" + selected.id, {
                  method: "DELETE",
                });
                if (selected.current) endClientSession();
              }
              setSelected(null);
              setRefresh((v) => v + 1);
            }}
          >
            <p>{label(selected)}</p>
            <p>
              {selected.current
                ? t(
                    "你正在撤銷目前裝置，完成後需要重新登入。",
                    "You are revoking this device. You will need to sign in again.",
                  )
                : t(
                    "該裝置下次請求將被拒絕。其他登入中的裝置不受影響。",
                    "This device’s next request will be rejected. Your other signed-in devices remain available.",
                  )}
            </p>
          </AsyncForm>
        </Modal>
      )}
    </section>
  );
}
