import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { api, patch, post } from "./api";
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

const base = "/v1/admin/access/principals";
type Setup = {
  setup_token: string;
  setup_key: string;
  email: string;
  expires_at: string;
};
type Access = {
  me: any;
  has: (key: string) => boolean;
  refresh: () => Promise<void>;
};

function Reason() {
  const { t } = useI18n();
  return (
    <Field label={t("操作原因", "Reason")}>
      <textarea
        aria-label="Reason"
        name="reason"
        minLength={3}
        maxLength={2000}
        rows={3}
        required
      />
    </Field>
  );
}
function AuthenticatorKey({
  setup,
  complete,
}: {
  setup: Setup;
  complete: (code: string) => Promise<void>;
}) {
  const { t } = useI18n(),
    [visible, setVisible] = useState(false);
  return (
    <div className="identity-setup">
      <p>
        {t(
          "在你的驗證器新增帳戶，選擇以時間為基礎的 6 位數驗證碼。",
          "Add this account to your authenticator using a time-based, six-digit code.",
        )}
      </p>
      <dl className="identity-facts">
        <dt>{t("發行者", "Issuer")}</dt>
        <dd>CopyPaste Admin</dd>
        <dt>{t("帳戶", "Account")}</dt>
        <dd>{setup.email}</dd>
      </dl>
      <Field label={t("手動設定密鑰", "Manual setup key")}>
        <input
          aria-label="Manual setup key"
          name="setup_key"
          type={visible ? "text" : "password"}
          value={setup.setup_key}
          readOnly
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <button
        className="text-button"
        type="button"
        onClick={() => setVisible(!visible)}
      >
        {visible ? t("隱藏密鑰", "Hide key") : t("顯示密鑰", "Show key")}
      </button>
      <p className="muted small-text">
        {t(
          "設定限時 10 分鐘。關閉頁面後，請重新驗證郵箱。",
          "Setup expires within 10 minutes. Verify email again if you close this page.",
        )}{" "}
        <DateText value={setup.expires_at} />
      </p>
      <AsyncForm
        submitLabel={t("確認並啟用驗證器", "Confirm authenticator")}
        onSubmit={async (f) => complete(String(f.get("totp")))}
      >
        <Field label={t("新驗證器的 6 位數驗證碼", "New authenticator code")}>
          <input
            aria-label="New authenticator code"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </Field>
      </AsyncForm>
    </div>
  );
}

export function Enrollment({
  me,
  onComplete,
  onLogout,
}: {
  me: any;
  onComplete: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const { t } = useI18n(),
    navigate = useNavigate(),
    location = useLocation();
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [invitation, setInvitation] = useState<any>(null),
    [challenge, setChallenge] = useState<any>(null),
    [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const next = new URLSearchParams(location.hash.slice(1)).get("token");
    if (next) setInviteToken(next);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, [location.hash]);
  useEffect(() => {
    setInvitation(null);
    setChallenge(null);
    setSetup(null);
    setError(null);
    setLoading(true);
    // The email capability stays in component memory, never storage or navigation history.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    const ctrl = new AbortController();
    void api("/v1/admin/auth/enrollment/inspect", {
      method: "POST",
      body: JSON.stringify({ token: inviteToken }),
      signal: ctrl.signal,
    })
      .then(setInvitation)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [inviteToken]);
  return (
    <div className="auth-layout identity-enrollment">
      <section className="auth-content">
        <Link to="/" className="logo">
          <img src="/brand-mark.png" alt="" />
          <strong>CopyPaste</strong>
          <span className="admin-label">ADMIN</span>
        </Link>
        <div className="auth-form">
          <p className="eyebrow">YOUR ACCESS. YOUR AUTHENTICATOR.</p>
          <h1>
            {t("開通你的", "Set up your")}
            <br />
            <em>{t("管理帳戶。", "admin account.")}</em>
          </h1>
          {loading ? (
            <Loading />
          ) : (
            <>
              <ErrorNotice error={error} />
              {invitation && (
                <>
                  <p className="muted">
                    {invitation.name} · {invitation.email}
                  </p>
                  {me ? (
                    <>
                      <p>
                        {t(
                          "請先登出目前的管理帳戶，再以受邀郵箱完成開通。",
                          "Sign out of the current admin account before verifying the invited email.",
                        )}
                      </p>
                      <AsyncForm
                        children={null}
                        submitLabel={t(
                          "登出並繼續開通",
                          "Sign out and continue setup",
                        )}
                        onSubmit={onLogout}
                      />
                    </>
                  ) : setup ? (
                    <AuthenticatorKey
                      setup={setup}
                      complete={async (code) => {
                        await post("/v1/admin/auth/enrollment/complete", {
                          setup_token: setup.setup_token,
                          totp: code,
                        });
                        setSetup(null);
                        await onComplete();
                        navigate("/", { replace: true });
                      }}
                    />
                  ) : (
                    <>
                      <p>
                        {t(
                          "驗證受邀郵箱後，設定只有你自己掌握的驗證器。",
                          "Verify the invited email, then set up your own authenticator.",
                        )}
                      </p>
                      {!challenge ? (
                        <AsyncForm
                          children={null}
                          submitLabel={t("發送開通驗證碼", "Send setup code")}
                          onSubmit={async () =>
                            setChallenge(
                              await post("/v1/admin/auth/challenge", {
                                email: invitation.email,
                              }),
                            )
                          }
                        />
                      ) : (
                        <AsyncForm
                          submitLabel={t(
                            "驗證郵箱並設定 MFA",
                            "Verify email and set up MFA",
                          )}
                          onSubmit={async (f) =>
                            setSetup(
                              await post("/v1/admin/auth/enrollment/setup", {
                                token: inviteToken,
                                challenge_id: challenge.challenge_id,
                                code: String(f.get("code")),
                              }),
                            )
                          }
                        >
                          <p className="notice">
                            <Mail size={18} />
                            {t(
                              "請輸入剛收到的郵箱驗證碼。",
                              "Enter the code just sent to your email.",
                            )}
                          </p>
                          <Field
                            label={t("郵箱驗證碼", "Email verification code")}
                          >
                            <input
                              aria-label="Email verification code"
                              name="code"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              pattern="[0-9]{6}"
                              maxLength={6}
                              required
                            />
                          </Field>
                        </AsyncForm>
                      )}
                    </>
                  )}
                </>
              )}
              <p>
                <Link className="text-link" to="/">
                  {t("返回管理員登入", "Back to administrator sign-in")}
                </Link>
              </p>
            </>
          )}
        </div>
        <span className="auth-bottom">COPYPASTE CONTROL ROOM · HONG KONG</span>
      </section>
      <aside className="auth-art">
        <img src="/copypaste-folds.png" alt="" />
        <div>
          <span className="eyebrow">A CONSIDERED VIEW OF THE WHOLE.</span>
          <p>
            {t("每一次授權，", "Every invitation.")}
            <br />
            <em>{t("都有清晰邊界。", "A clear boundary.")}</em>
          </p>
        </div>
      </aside>
    </div>
  );
}

export function AuthenticatorSettings({
  access,
  onClose,
}: {
  access: Access;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [challenge, setChallenge] = useState<any>(null),
    [setup, setSetup] = useState<Setup | null>(null);
  return (
    <Modal
      title={t("更換我的驗證器", "Replace my authenticator")}
      onClose={onClose}
    >
      <p className="muted">
        {t(
          "先驗證你的郵箱。新驗證器確認成功後，所有舊登入會失效，並保留目前的新登入。敏感操作需要在登入後 10 分鐘內進行。",
          "Verify your email first. Confirming the new authenticator revokes every old session and signs you in again here. A sign-in within the last 10 minutes is required.",
        )}
      </p>
      <p>{access.me.user.email}</p>
      {setup ? (
        <AuthenticatorKey
          setup={setup}
          complete={async (code) => {
            await post("/v1/admin/auth/mfa/complete", {
              setup_token: setup.setup_token,
              totp: code,
            });
            setSetup(null);
            await access.refresh();
            onClose();
          }}
        />
      ) : !challenge ? (
        <AsyncForm
          children={null}
          submitLabel={t(
            "發送更換驗證碼",
            "Send authenticator replacement code",
          )}
          onSubmit={async () =>
            setChallenge(
              await post("/v1/admin/auth/challenge", {
                email: access.me.user.email,
              }),
            )
          }
        />
      ) : (
        <AsyncForm
          submitLabel={t("驗證郵箱", "Verify email")}
          onSubmit={async (f) =>
            setSetup(
              await post("/v1/admin/auth/mfa/setup", {
                challenge_id: challenge.challenge_id,
                code: String(f.get("code")),
              }),
            )
          }
        >
          <Field label={t("郵箱驗證碼", "Email verification code")}>
            <input
              aria-label="Email verification code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </Field>
        </AsyncForm>
      )}
    </Modal>
  );
}

export function InviteAdministrator({
  roles,
  canBind,
  onDone,
  onClose,
}: {
  roles: any[];
  canBind: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [role, setRole] = useState(""),
    [scope, setScope] = useState("global"),
    [result, setResult] = useState<any>(null);
  return (
    <Modal title={t("邀請管理員", "Invite administrator")} onClose={onClose}>
      {result ? (
        <div className="identity-result">
          <ShieldCheck size={30} />
          <h3>
            {result.delivery === "sent"
              ? t("邀請已寄出", "Invitation sent")
              : t(
                  "帳戶已建立，郵件尚未送達",
                  "Account created; email not delivered",
                )}
          </h3>
          <p>{result.principal.email}</p>
          <p className="muted">
            {result.delivery === "sent"
              ? t(
                  "受邀者須親自驗證郵箱並綁定 MFA。",
                  "The recipient must verify their email and set up MFA.",
                )
              : t(
                  "請在帳戶詳情重新發送邀請。舊連結會同時失效。",
                  "Resend the invitation from account details. This also invalidates the old link.",
                )}
          </p>
          <button className="button secondary" onClick={onClose}>
            {t("完成", "Done")}
          </button>
        </div>
      ) : (
        <AsyncForm
          submitLabel={t("建立並寄出邀請", "Create and send invitation")}
          onSubmit={async (f) => {
            const binding = role
              ? {
                  role_key: role,
                  scope_kind: scope,
                  ...(scope !== "global"
                    ? { scope_id: String(f.get("scope_id")) }
                    : {}),
                  effect: "allow",
                  limits: Object.fromEntries(
                    [
                      "max_amount_micros",
                      "max_daily_amount_micros",
                      "max_duration_hours",
                      "max_batch",
                    ].flatMap((k) => (f.get(k) ? [[k, Number(f.get(k))]] : [])),
                  ),
                  ...(f.get("expires_at")
                    ? {
                        expires_at: new Date(
                          String(f.get("expires_at")),
                        ).toISOString(),
                      }
                    : {}),
                }
              : undefined;
            setResult(
              await post(base, {
                email: String(f.get("email")),
                name: String(f.get("name")),
                reason: String(f.get("reason")),
                ...(binding ? { binding } : {}),
              }),
            );
            onDone();
          }}
        >
          <Field label={t("管理員姓名", "Administrator name")}>
            <input
              aria-label="Administrator name"
              name="name"
              minLength={1}
              maxLength={120}
              required
            />
          </Field>
          <Field label={t("管理員郵箱", "Administrator email")}>
            <input
              aria-label="Administrator email"
              name="email"
              type="email"
              autoComplete="off"
              required
            />
          </Field>
          {canBind && (
            <Field label={t("初始權限角色", "Initial permission role")}>
              <select
                aria-label="Initial permission role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">
                  {t(
                    "先開通帳戶，稍後授權",
                    "Set up account; assign access later",
                  )}
                </option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {role && (
            <>
              <Field label={t("授權範圍", "Permission scope")}>
                <select
                  aria-label="Permission scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="global">Global</option>
                  <option value="tenant">Workspace</option>
                  <option value="project">Project</option>
                </select>
              </Field>
              {scope !== "global" && (
                <Field label={t("範圍 ID", "Scope ID")}>
                  <input aria-label="Scope ID" name="scope_id" required />
                </Field>
              )}
              <details>
                <summary>
                  {t("委派限額與有效期", "Delegation limits and expiry")}
                </summary>
                <p className="muted small-text">
                  {t(
                    "授權不能超過你現有的權限、限額及有效期。金額單位為百萬分之一 HKD。",
                    "Access, limits and expiry must fit your existing grants. Amounts use millionths of HKD.",
                  )}
                </p>
                <Field
                  label={t(
                    "金額上限（微額 HKD）",
                    "Maximum amount (micro HKD)",
                  )}
                >
                  <input
                    aria-label="Maximum amount (micro HKD)"
                    name="max_amount_micros"
                    type="number"
                    min={0}
                    step={1}
                    max={1e12}
                  />
                </Field>
                <Field
                  label={t(
                    "每日金額上限（微額 HKD，香港日界）",
                    "Maximum daily amount (micro HKD, Hong Kong day)",
                  )}
                >
                  <input
                    name="max_daily_amount_micros"
                    type="number"
                    min={0}
                    step={1}
                    max={1e12}
                  />
                </Field>
                <Field label={t("最長時數", "Maximum duration in hours")}>
                  <input
                    aria-label="Maximum duration in hours"
                    name="max_duration_hours"
                    type="number"
                    min={1}
                    step={1}
                  />
                </Field>
                <Field label={t("批次上限", "Maximum batch size")}>
                  <input
                    aria-label="Maximum batch size"
                    name="max_batch"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                  />
                </Field>
                <Field label={t("授權截止時間", "Permission expiry")}>
                  <input
                    aria-label="Permission expiry"
                    name="expires_at"
                    type="datetime-local"
                  />
                </Field>
              </details>
            </>
          )}
          <Reason />
        </AsyncForm>
      )}
    </Modal>
  );
}

export function PrincipalActions({
  principal,
  onOpen,
}: {
  principal: any;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      title={t("管理員帳戶詳情", "Administrator account details")}
      aria-label={`Manage administrator ${principal.email}`}
      onClick={onOpen}
    >
      <Eye size={16} />
    </button>
  );
}
export function PrincipalDetail({
  id,
  access,
  onDone,
  onClose,
}: {
  id: string;
  access: Access;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [operation, setOperation] = useState(""),
    [outcome, setOutcome] = useState<any>(null);
  const { data, error, loading } = useData(base + "/" + id, revision),
    p = data?.principal,
    self = id === access.me.user.id;
  const refresh = () => {
    setRevision((r) => r + 1);
    onDone();
  };
  return (
    <Modal
      title={t("管理員帳戶詳情", "Administrator account details")}
      onClose={onClose}
    >
      <ErrorNotice error={error} />
      {loading && <Loading />}
      {p && (
        <>
          <div className="identity-heading">
            <KeyRound size={25} />
            <div>
              <h3>{p.name}</h3>
              <p className="muted">{p.email}</p>
            </div>
          </div>
          <div className="row-actions">
            <Badge value={p.status} />
            <Badge
              value={
                p.enrollment_state === "enrolled"
                  ? "mfa_enabled"
                  : "mfa_pending"
              }
            />
          </div>
          <dl className="identity-facts">
            <dt>{t("記錄版本", "Record version")}</dt>
            <dd>{p.version}</dd>
            <dt>{t("開通時間", "Enrolled")}</dt>
            <dd>
              <DateText value={p.enrolled_at} />
            </dd>
          </dl>
          {p.invitation && (
            <p className="notice">
              {t("最近的開通郵件", "Latest setup email")}:{" "}
              {p.invitation.delivery_state} ·{" "}
              <DateText value={p.invitation.expires_at} />
              {p.invitation.revoked_at
                ? t(" · 連結已撤銷", " · Link revoked")
                : p.invitation.consumed_at
                  ? t(" · 已使用", " · Used")
                  : ""}
            </p>
          )}
          {outcome && (
            <p
              className={
                outcome.delivery && outcome.delivery !== "sent"
                  ? "notice error"
                  : "notice"
              }
              role="status"
            >
              {outcome.delivery
                ? outcome.delivery === "sent"
                  ? t("新的邀請已寄出。", "New invitation sent.")
                  : t(
                      "帳戶已更新，郵件送達失敗，請重新發送。",
                      "Account updated; delivery failed. Please resend.",
                    )
                : t("帳戶已更新。", "Account updated.")}
            </p>
          )}
          <div className="row-actions identity-actions">
            {access.has("admin.access.principals.write") && (
              <>
                <button
                  className="button secondary"
                  onClick={() => setOperation("profile")}
                >
                  {t("編輯姓名", "Edit name")}
                </button>
                {!self && (
                  <>
                    <button
                      className="button secondary"
                      onClick={() => setOperation("status")}
                    >
                      {p.status === "active"
                        ? t("停用帳戶", "Suspend account")
                        : t("恢復帳戶", "Resume account")}
                    </button>
                    {p.status === "active" && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          setOperation(
                            p.enrollment_state === "pending"
                              ? "enrollment"
                              : "reset-mfa",
                          )
                        }
                      >
                        {p.enrollment_state === "pending"
                          ? t("重新發送邀請", "Resend invitation")
                          : t("重設 MFA", "Reset MFA")}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {access.has("admin.access.sessions.revoke") && (
              <button
                className="button secondary"
                onClick={() => setOperation("session-revocations")}
              >
                {t("撤銷所有登入", "Revoke all sessions")}
              </button>
            )}
          </div>
          {operation && (
            <div className="identity-operation" key={operation + p.version}>
              <h3>
                {
                  (
                    {
                      profile: t("編輯姓名", "Edit name"),
                      status:
                        p.status === "active"
                          ? t("確認停用帳戶", "Confirm account suspension")
                          : t("確認恢復帳戶", "Confirm account resumption"),
                      enrollment: t("重新發送邀請", "Resend invitation"),
                      "reset-mfa": t("確認重設 MFA", "Confirm MFA reset"),
                      "session-revocations": t(
                        "確認撤銷所有登入",
                        "Confirm session revocation",
                      ),
                    } as Record<string, string>
                  )[operation]
                }
              </h3>
              <p className="muted small-text">
                {operation === "profile"
                  ? t(
                      "郵箱身分固定，僅可修改顯示姓名。",
                      "Email identity is fixed; only the display name changes.",
                    )
                  : operation === "enrollment"
                    ? t(
                        "舊邀請及未完成的 MFA 設定會失效。",
                        "Previous invitations and incomplete MFA setup will expire.",
                      )
                    : t(
                        "此操作會撤銷已有登入和未完成的設定；恢復帳戶後需重新登入。最後一位有效超管受保護。",
                        "This revokes existing sessions and incomplete setup. A resumed account must sign in again. The last effective super administrator is protected.",
                      )}
              </p>
              <AsyncForm
                submitLabel={t("確認操作", "Confirm action")}
                onSubmit={async (f) => {
                  const body = {
                    expected_version: p.version,
                    reason: String(f.get("reason")),
                  };
                  const result =
                    operation === "profile"
                      ? await patch(base + "/" + id, {
                          ...body,
                          name: String(f.get("name")),
                        })
                      : await post(base + "/" + id + "/" + operation, {
                          ...body,
                          ...(operation === "status"
                            ? {
                                state:
                                  p.status === "active"
                                    ? "suspended"
                                    : "active",
                              }
                            : {}),
                        });
                  setOutcome(result);
                  setOperation("");
                  refresh();
                  if (self) await access.refresh();
                }}
              >
                {operation === "profile" && (
                  <Field label={t("管理員姓名", "Administrator name")}>
                    <input
                      aria-label="Administrator name"
                      name="name"
                      defaultValue={p.name}
                      minLength={1}
                      maxLength={120}
                      required
                    />
                  </Field>
                )}
                <Reason />
              </AsyncForm>
              <button className="text-button" onClick={() => setOperation("")}>
                {t("取消", "Cancel")}
              </button>
            </div>
          )}
          <h3>{t("權限綁定", "Access bindings")}</h3>
          {!data.bindings.length ? (
            <p className="muted">
              {t(
                "尚未授權，登入後等待分配權限。",
                "No access assigned. The account can sign in and await permission assignment.",
              )}
            </p>
          ) : (
            <ul className="identity-bindings">
              {data.bindings.map((b: any) => (
                <li key={b.id}>
                  <strong>{b.role_name}</strong> · {b.effect} · {b.scope_kind}{" "}
                  {b.scope_id && <code>{b.scope_id}</code>}
                  <small>
                    {t("到期", "Expires")}: <DateText value={b.expires_at} /> ·{" "}
                    {JSON.stringify(b.limits)}
                  </small>
                </li>
              ))}
            </ul>
          )}
          <h3>{t("登入記錄", "Sign-in sessions")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("建立", "Created")}</th>
                  <th>{t("有效期", "Expires")}</th>
                  <th>{t("狀態", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <DateText value={s.created_at} />
                      {s.id === data.current_session_id && (
                        <small> · {t("目前", "Current")}</small>
                      )}
                    </td>
                    <td>
                      <DateText value={s.expires_at} />
                    </td>
                    <td>
                      {s.active ? t("有效", "Active") : t("已失效", "Inactive")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.sessions_truncated && (
            <p className="muted small-text">
              {t("顯示最近 100 次登入。", "Showing the latest 100 sessions.")}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
