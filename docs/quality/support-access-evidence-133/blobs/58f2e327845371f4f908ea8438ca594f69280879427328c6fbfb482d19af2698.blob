import { useState } from "react";
import { post } from "./api";
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

export function EnterpriseSignIn({
  tenant,
  canEdit,
  onClose,
}: {
  tenant: { id: string; name: string };
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [action, setAction] = useState("save");
  const base = "/v1/admin/tenants/" + tenant.id + "/sso",
    { data, error, loading } = useData(base, refresh);
  const c = data?.connection;
  return (
    <Modal
      title={t("企業身份登入", "Company identity sign-in")}
      onClose={onClose}
    >
      <p className="muted">{tenant.name}</p>
      <ErrorNotice error={error} />
      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <Field
            label={t(
              "在身份供應商登記的回調網址",
              "Callback URI to register with your provider",
            )}
          >
            <input
              value={data.callback_uri}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </Field>
          {c && (
            <div className="notice">
              <div>
                <strong>{c.name}</strong> ·{" "}
                <Badge value={c.enabled ? "active" : "paused"} />
                <br />
                {t("已連接用戶", "Linked users")}: {c.linked_users} ·{" "}
                {t("版本", "Version")}: {c.version}
                <br />
                {t("最近中繼資料檢查", "Last metadata check")}:{" "}
                <DateText value={c.last_probed_at} />
                <br />
                {t("登入代號", "Sign-in key")}: <code>{c.login_key}</code>
              </div>
            </div>
          )}
          <p className="muted small-text">
            {t(
              "只有已註冊並加入此企業的成員可以登入。首次綁定還需獨立的工作郵箱確認碼。此入口不替代管理員郵箱與 MFA。",
              "Only registered members of this workspace can sign in. First binding also requires a separate work email confirmation code. Administrator email and MFA remain separate.",
            )}
          </p>
          {canEdit ? (
            <AsyncForm
              key={c?.version ?? 0}
              submitLabel={t("確認操作", "Confirm action")}
              onSubmit={async (f) => {
                const common = {
                  expected_version: c?.version ?? 0,
                  reason: String(f.get("reason")),
                };
                if (action === "save")
                  await post(base, {
                    ...common,
                    login_key: String(f.get("login_key")),
                    name: String(f.get("name")),
                    issuer: String(f.get("issuer")),
                    client_id: String(f.get("client_id")),
                    ...(String(f.get("client_secret") ?? "")
                      ? { client_secret: String(f.get("client_secret")) }
                      : {}),
                    domains: String(f.get("domains"))
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    token_auth_method: String(f.get("token_auth_method")),
                    signing_alg: String(f.get("signing_alg")),
                    email_mode: String(f.get("email_mode")),
                  });
                else if (action === "probe")
                  await post(base + "/probe", common);
                else await post(base + "/status", { ...common, action });
                setAction("save");
                setRefresh((v) => v + 1);
              }}
            >
              <Field label={t("操作", "Action")}>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="save">
                    {t(
                      "儲存配置（停用連接）",
                      "Save configuration (disables connection)",
                    )}
                  </option>
                  <option value="probe" disabled={!c || c.enabled}>
                    {t("檢查中繼資料與公鑰", "Check metadata & public keys")}
                  </option>
                  <option
                    value="enable"
                    disabled={
                      !c || c.enabled || c.verified_revision !== c.revision
                    }
                  >
                    {t("啟用企業登入", "Enable company sign-in")}
                  </option>
                  <option value="disable" disabled={!c?.enabled}>
                    {t("停用企業登入", "Disable company sign-in")}
                  </option>
                </select>
              </Field>
              {action === "save" ? (
                <>
                  <Field label={t("連接名稱", "Connection name")}>
                    <input
                      name="name"
                      defaultValue={c?.name ?? tenant.name + " identity"}
                      required
                      maxLength={160}
                    />
                  </Field>
                  <Field
                    label={t("企業登入代號", "Company sign-in key")}
                    hint={t(
                      "4–64 個小寫英文字母、數字或連字號；提供給企業成員。",
                      "4–64 lowercase letters, digits or hyphens; share this key with members.",
                    )}
                  >
                    <input
                      name="login_key"
                      defaultValue={c?.login_key ?? ""}
                      pattern="[a-z0-9][a-z0-9-]{2,62}[a-z0-9]"
                      required
                    />
                  </Field>
                  <Field label="OIDC issuer">
                    <input
                      name="issuer"
                      type="url"
                      defaultValue={c?.issuer ?? ""}
                      placeholder="https://identity.company.hk/issuer"
                      required
                    />
                  </Field>
                  <Field label="Client ID">
                    <input
                      name="client_id"
                      defaultValue={c?.client_id ?? ""}
                      required
                      maxLength={512}
                    />
                  </Field>
                  <Field
                    label={t(
                      "Client secret（現有連接留空則保留）",
                      "Client secret (leave blank to retain)",
                    )}
                  >
                    <input
                      name="client_secret"
                      type="password"
                      autoComplete="new-password"
                      required={!c}
                      minLength={8}
                      maxLength={8192}
                    />
                  </Field>
                  <Field
                    label={t(
                      "允許的工作郵箱網域（以逗號分隔）",
                      "Allowed work email domains (comma separated)",
                    )}
                  >
                    <input
                      name="domains"
                      defaultValue={c?.domains.join(", ") ?? ""}
                      placeholder="company.hk"
                      required
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label={t("客戶端驗證方式", "Client authentication")}>
                      <select
                        name="token_auth_method"
                        defaultValue={
                          c?.token_auth_method ?? "client_secret_post"
                        }
                      >
                        <option value="client_secret_post">
                          client_secret_post
                        </option>
                        <option value="client_secret_basic">
                          client_secret_basic
                        </option>
                      </select>
                    </Field>
                    <Field label={t("ID token 簽章", "ID token signature")}>
                      <select
                        name="signing_alg"
                        defaultValue={c?.signing_alg ?? "RS256"}
                      >
                        <option>RS256</option>
                        <option>ES256</option>
                      </select>
                    </Field>
                  </div>
                  <Field label={t("身份郵箱政策", "Identity email policy")}>
                    <select
                      name="email_mode"
                      defaultValue={c?.email_mode ?? "verified_email"}
                    >
                      <option value="verified_email">
                        {t(
                          "已驗證且相符的 IdP 郵箱 + 首次郵箱確認",
                          "Verified matching IdP email + first-link email proof",
                        )}
                      </option>
                      <option value="subject_with_proof">
                        {t(
                          "固定 issuer/subject + 首次郵箱確認",
                          "Stable issuer/subject + first-link email proof",
                        )}
                      </option>
                    </select>
                  </Field>
                  <p className="muted small-text">
                    {t(
                      "第二種政策適用於不提供已驗證郵箱聲明的供應商；不會自動按網域新增成員。",
                      "The second policy supports providers without a verified email claim; it does not enroll users by domain.",
                    )}
                  </p>
                </>
              ) : action === "probe" ? (
                <div className="notice">
                  {t(
                    "只驗證 OIDC discovery、PKCE S256 與公開簽章金鑰；不代表已用企業帳號完成端到端登入，也不驗證 client secret。啟用前請另做真實帳號測試。",
                    "Checks OIDC discovery, PKCE S256 and public signing keys. This does not validate the client secret or complete a live company-account sign-in. Test a real account before rollout.",
                  )}
                </div>
              ) : null}
              {(action === "disable" || (action === "save" && c)) && (
                <div className="notice">
                  <div>
                    {t(
                      "此操作會撤銷已連接用戶的全部 CopyPaste 瀏覽器與原生端會話、待交換授權碼，並使舊執行授權失效；重新啟用後需重新確認企業綁定。",
                      "This revokes every CopyPaste browser/native session and outstanding authorization code for linked users, and invalidates prior execution authorization. Re-enabling requires fresh identity confirmation.",
                    )}
                    <label className="check-row">
                      <input type="checkbox" required />
                      {t(
                        "確認連接用戶將全部登出。",
                        "Confirm signing out all linked users.",
                      )}
                    </label>
                  </div>
                </div>
              )}
              <Field label={t("操作原因", "Reason")}>
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={2000}
                  required
                />
              </Field>
            </AsyncForm>
          ) : (
            <p className="notice">
              {t(
                "需要全域企業 SSO 管理權限與近期 MFA 才能修改。",
                "Changes require global company SSO permission and recent MFA.",
              )}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
