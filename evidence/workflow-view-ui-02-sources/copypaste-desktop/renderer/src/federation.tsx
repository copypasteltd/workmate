import { useState, type ReactNode } from "react";
import { authReturnPath } from "./auth-return";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, ShieldCheck } from "lucide-react";
import { post } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  Badge,
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";

function SignInLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-layout">
      <section className="auth-content">
        <Link to="/" className="logo" aria-label="CopyPaste home">
          <img src="./brand-mark.png" alt="" />
          <strong>CopyPaste</strong>
        </Link>
        <div className="auth-form">{children}</div>
        <span className="auth-bottom">
          DESIGNED FOR WHAT’S NEXT. © COPYPASTE
        </span>
      </section>
      <aside className="auth-art">
        <img src="./copypaste-folds.png" alt="CopyPaste blue folded sculpture" />
        <div>
          <span className="eyebrow">WORK, WITH YOUR PEOPLE.</span>
          <p>
            {t("連接企業身份，", "Connected to your company,")}
            <br />
            <em>{t("開始一起創造。", "ready to create.")}</em>
          </p>
        </div>
      </aside>
    </div>
  );
}
export function CompanySignIn() {
  const { t } = useI18n(),
    [q] = useSearchParams();
  if (window.copyPasteBridge) return <Navigate to="/login" replace />;
  const next = authReturnPath(q.get("next"));
  return (
    <SignInLayout>
      <p className="eyebrow">YOUR COMPANY. YOUR WORKSPACE.</p>
      <h1>
        {t("企業身份", "Company")}
        <br />
        <em>{t("安全登入。", "sign-in.")}</em>
      </h1>
      <p className="muted">
        {t(
          "使用管理員提供的企業登入代號與工作郵箱。請先完成郵箱註冊並接受企業邀請。",
          "Use the company sign-in key from your administrator and your work email. Verify your email and accept your workspace invitation first.",
        )}
      </p>
      <AsyncForm
        submitLabel={t("前往企業身份驗證", "Continue to company identity")}
        onSubmit={async (f) => {
          const result = await post("/v1/auth/sso/start", {
            login_key: String(f.get("login_key")),
            email: String(f.get("email")),
            next,
          });
          window.location.assign(result.redirect);
        }}
      >
        <Field
          label={t("企業登入代號", "Company sign-in key")}
          hint={t(
            "由企業管理員提供。",
            "Provided by your company administrator.",
          )}
        >
          <input
            name="login_key"
            defaultValue={q.get("company") ?? ""}
            autoComplete="organization"
            placeholder="your-company"
            minLength={4}
            maxLength={64}
            pattern="[a-z0-9][a-z0-9-]{2,62}[a-z0-9]"
            required
            autoFocus
          />
        </Field>
        <Field label={t("工作郵箱", "Work email")}>
          <input
            name="email"
            type="email"
            defaultValue={q.get("email") ?? ""}
            autoComplete="email"
            placeholder="you@company.hk"
            required
          />
        </Field>
      </AsyncForm>
      <p className="form-footnote">
        <ShieldCheck size={14} />
        {t(
          "首次連接需要再次驗證工作郵箱。",
          "Your first connection also requires work email confirmation.",
        )}
      </p>
      <Link
        className="text-button"
        to={"/login?next=" + encodeURIComponent(next)}
      >
        {t("使用郵箱登入或建立帳戶", "Sign in or create an account with email")}
      </Link>
    </SignInLayout>
  );
}
export function ConfirmCompanyIdentity() {
  const { t } = useI18n(),
    [q] = useSearchParams(),
    [challenge, setChallenge] = useState<any>(null);
  const failed = !!q.get("error"),
    pending = useData(failed ? null : "/v1/auth/sso/pending");
  if (window.copyPasteBridge) return <Navigate to="/login" replace />;
  return (
    <SignInLayout>
      <p className="eyebrow">ONE LAST CONFIRMATION.</p>
      <h1>
        {t("確認是你，", "Make it")}
        <br />
        <em>{t("連接企業。", "yours.")}</em>
      </h1>
      {failed || pending.error ? (
        <>
          <div className="notice" role="alert">
            {t(
              "這次企業登入未能完成或已過期。請確認你已有企業成員資格，再重新登入；也可以先使用工作郵箱登入。",
              "This company sign-in could not be completed or has expired. Check your workspace membership and try again, or sign in with your work email.",
            )}
          </div>
          <Link className="button primary" to="/sso">
            {t("重新企業登入", "Restart company sign-in")}
          </Link>
          <Link className="text-button" to="/login">
            {t("使用郵箱登入", "Sign in with email")}
          </Link>
        </>
      ) : !pending.data ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            {t(
              `你正透過 ${pending.data.provider} 連接 ${pending.data.workspace}。請驗證 ${pending.data.email}，以完成首次連接。`,
              `You’re connecting to ${pending.data.workspace} through ${pending.data.provider}. Confirm ${pending.data.email} to complete the connection.`,
            )}
          </p>
          {!challenge ? (
            <AsyncForm
              submitLabel={t("發送連接確認碼", "Send connection code")}
              onSubmit={async () =>
                setChallenge(await post("/v1/auth/sso/link/challenge", {}))
              }
            >
              <div className="notice">
                <Building2 size={20} />
                <span>
                  {pending.data.email}
                  <br />
                  {t(
                    "企業身份與 CopyPaste 帳戶將建立連接。",
                    "Your company identity will be linked to your CopyPaste account.",
                  )}
                </span>
              </div>
            </AsyncForm>
          ) : (
            <>
              <div className="notice">
                {challenge.delivery === "local_mailbox"
                  ? t(
                      "確認碼已送至本機開發郵箱，讀取方式見 README。",
                      "A code is ready in the local development mailbox. See the README.",
                    )
                  : t(
                      "確認碼已發送至你的工作郵箱。",
                      "A confirmation code has been sent to your work email.",
                    )}
              </div>
              <AsyncForm
                submitLabel={t(
                  "確認並連接企業身份",
                  "Confirm & connect identity",
                )}
                onSubmit={async (f) => {
                  const result = await post("/v1/auth/sso/link", {
                    challenge_id: challenge.challenge_id,
                    code: String(f.get("code")),
                  });
                  window.location.assign(result.redirect);
                }}
              >
                <Field label={t("6 位數連接確認碼", "6-digit connection code")}>
                  <input
                    name="code"
                    className="code-input"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                  />
                </Field>
              </AsyncForm>
            </>
          )}
          <Link className="text-button" to="/sso">
            {t("重新開始", "Start again")}
          </Link>
        </>
      )}
    </SignInLayout>
  );
}
export function LinkedCompanyIdentities() {
  const { t } = useI18n(),
    w = useWorkspace(),
    nav = useNavigate();
  const [selected, setSelected] = useState<any>(null),
    identities = useData("/v1/me/sso-identities");
  return (
    <section className="card">
      <h2>{t("企業登入連接", "Company sign-in connections")}</h2>
      <p className="muted">
        {t(
          "連接不會增加企業權限；仍依現有成員和專案資格使用。",
          "Connections use your existing workspace and project membership.",
        )}
      </p>
      <ErrorNotice error={identities.error} />
      {identities.data?.items.length === 0 && (
        <p className="muted">
          {t("尚未連接企業身份。", "No company identities connected yet.")}
        </p>
      )}
      {identities.data?.items.map((i: any) => (
        <div className="session-row" key={i.id}>
          <Building2 size={19} />
          <div>
            <strong>{i.name}</strong>
            <small>
              {i.tenant_name} ·{" "}
              <DateText value={i.last_login_at ?? i.linked_at} />
            </small>
            <Badge value={i.status} />
          </div>
          {i.status === "active" && (
            <button className="text-button" onClick={() => setSelected(i)}>
              {t("解除連接", "Disconnect")}
            </button>
          )}
        </div>
      ))}
      {window.copyPasteBridge ? (
        <p className="muted small-text">
          {t(
            "透過系統瀏覽器的登入頁連接企業身份。",
            "Connect a company identity through the sign-in page in your system browser.",
          )}
        </p>
      ) : (
        <Link
          className="button secondary"
          to={
            "/sso?next=%2Fapp%2Fsettings&email=" +
            encodeURIComponent(w.me.user.email)
          }
        >
          {t("連接企業身份", "Connect company identity")}
        </Link>
      )}
      {selected && (
        <Modal
          title={t("解除企業連接", "Disconnect company identity")}
          onClose={() => setSelected(null)}
        >
          <AsyncForm
            submitLabel={t(
              "解除並登出所有裝置",
              "Disconnect & sign out everywhere",
            )}
            onSubmit={async () => {
              await post("/v1/me/sso-identities/" + selected.id + "/revoke", {
                expected_version: selected.version,
              });
              if (window.copyPasteBridge)
                await window.copyPasteBridge.signOut();
              await w.refresh();
              nav("/login", { replace: true });
            }}
          >
            <p>
              {t(
                "解除後，所有 CopyPaste 瀏覽器及原生裝置都會登出；進行中的授權工作將重新檢查。你仍可用工作郵箱重新登入。",
                "Disconnecting signs out every CopyPaste browser and native device. Authorized work is checked again. You can still sign in with your work email.",
              )}
            </p>
            <label className="check-line">
              <input type="checkbox" required />
              {t(
                "我確認解除並登出所有裝置。",
                "I confirm disconnecting and signing out all devices.",
              )}
            </label>
          </AsyncForm>
        </Modal>
      )}
    </section>
  );
}
