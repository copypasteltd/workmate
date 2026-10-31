import { useEffect, useState } from "react";
import { OwnershipTransferAdmin } from "./ownership-transfers";
import { Link } from "react-router-dom";
import { api } from "./api";
import { completeOperation, operationKey } from "./operation-key";
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

const roles = ["owner", "admin", "member", "approver", "viewer"];
type MembershipChange = {
  expected_version: number;
  reason: string;
  user_id: string;
  state: string;
  role: string;
  project_ids: string[];
};

export function MembershipChangeFacts({
  tenant,
  command,
  before,
}: {
  tenant: string;
  command: MembershipChange;
  before: any;
}) {
  const { t } = useI18n();
  return (
    <dl className="preview-details">
      <dt>{t("企業", "Workspace")}</dt>
      <dd>
        <code>{tenant}</code>
      </dd>
      <dt>{t("用戶", "User")}</dt>
      <dd>
        <code>{command.user_id}</code>
      </dd>
      <dt>{t("目前權限", "Current access")}</dt>
      <dd>
        {before.state
          ? `${before.state} / ${before.role} / v${before.version}`
          : t("尚未加入", "No membership")}
      </dd>
      <dt>{t("變更後權限", "Requested access")}</dt>
      <dd>
        {command.state} / {command.role}
      </dd>
      <dt>{t("目前專案", "Current projects")}</dt>
      <dd>{before.project_ids.join(", ") || "—"}</dd>
      <dt>{t("變更後專案", "Requested projects")}</dt>
      <dd>
        {command.state === "removed"
          ? "—"
          : command.project_ids.join(", ") || "—"}
      </dd>
      <dt>{t("原因", "Reason")}</dt>
      <dd>{command.reason}</dd>
    </dl>
  );
}

export function AdminMembershipManager({
  account,
  user,
  initialTenant,
  onClose,
}: {
  account: string;
  user: string;
  initialTenant: string;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [tenant, setTenant] = useState(initialTenant),
    [loadedTenant, setLoadedTenant] = useState(initialTenant),
    [revision, setRevision] = useState(0);
  const options = useData(
    loadedTenant
      ? `/v1/admin/tenants/${loadedTenant}/membership-options?user_id=${encodeURIComponent(user)}`
      : null,
    revision,
  );
  const [role, setRole] = useState("member"),
    [state, setState] = useState("active"),
    [projects, setProjects] = useState<string[]>([]),
    [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [readError, setReadError] = useState<Error | null>(null);
  useEffect(() => {
    if (options.data) {
      const m = options.data.membership;
      setRole(m?.role ?? "member");
      setState(m?.state ?? "active");
      setProjects(m?.project_ids ?? []);
    }
  }, [options.data]);
  const base = `/v1/admin/tenants/${loadedTenant}/memberships`;
  return (
    <Modal
      title={t("管理企業成員", "Manage workspace membership")}
      onClose={onClose}
    >
      <p className="muted">
        {t(
          "企業暫停會立即阻止存取；恢復時明確核對角色與專案。全局帳戶狀態不會因此改變。",
          "Suspension blocks workspace access immediately. Review role and projects when restoring access. Global account status is managed separately.",
        )}
      </p>
      {options.data&&<OwnershipTransferAdmin key={loadedTenant} tenant={loadedTenant} account={account}/>}
      {result ? (
        <>
          <Badge value={result.state} />
          <p>
            <code>{result.id}</code>
          </p>
          <p>
            {result.state === "pending_approval"
              ? t(
                  "已持久保存，等待另一位管理員覆核；權限尚未變更。",
                  "Saved for independent review. Access has not changed yet.",
                )
              : result.state === "succeeded"
                ? t(
                    "成員權限已變更，並保留審計記錄。",
                    "Membership access has changed and the audit record is preserved.",
                  )
                : t(
                    "請按實際操作狀態處理。",
                    "Follow the actual operation status.",
                  )}
          </p>
          <p>
            {t("策略版本", "Policy version")}:{" "}
            <code>{result.policy_version_id}</code>
          </p>
          <ErrorNotice error={readError} />
          <button
            className="button secondary"
            onClick={async () => {
              try {
                setResult(await api(`/v1/admin/operations/${result.id}`));
                setReadError(null);
              } catch (e) {
                setReadError(e as Error);
              }
            }}
          >
            {t("刷新操作狀態", "Refresh operation status")}
          </button>
          <Link
            className="text-link"
            to={
              result.state === "pending_approval"
                ? `/audit?view=approvals&search=${encodeURIComponent(result.id)}`
                : `/jobs?search=${encodeURIComponent(result.id)}`
            }
            onClick={onClose}
          >
            {t("查看操作記錄", "View operation records")}
          </Link>
        </>
      ) : preview ? (
        <>
          <MembershipChangeFacts
            tenant={loadedTenant}
            command={preview.command}
            before={preview.before}
          />
          <p className="notice">
            {preview.approval
              ? t(
                  "此策略要求另一位有權限的管理員在時限內獨立審批。",
                  "This policy requires a different authorized administrator to approve within the deadline.",
                )
              : t(
                  "近期 MFA 與權限有效時，確認後直接執行。",
                  "With valid recent MFA and permissions, confirmation applies the change.",
                )}
          </p>
          <p>
            {t("預覽有效至", "Preview valid until")}:{" "}
            <DateText value={preview.expires_at} />
          </p>
          <AsyncForm
            key={preview.id}
            submitLabel={
              preview.approval
                ? t("提交審批", "Submit for approval")
                : t("確認變更", "Confirm change")
            }
            onSubmit={async () => {
              const identity = { tenant_id: loadedTenant, ...preview.command };
              const key = await operationKey(
                account,
                "admin.membership.change",
                identity,
              );
              const accepted = await api(base, {
                method: "POST",
                headers: {
                  "Idempotency-Key": key,
                  "X-Admin-Preview-ID": preview.id,
                },
                body: JSON.stringify(preview.command),
              });
              setResult(accepted);
              await completeOperation(
                account,
                "admin.membership.change",
                identity,
              );
            }}
          >
            <p className="form-footnote">
              {t(
                "重試會恢復同一項未確認結果的操作。若狀態或策略已變更，請重新預覽。",
                "Retry recovers the same operation after an unknown result. Preview again if the target or policy changed.",
              )}
            </p>
          </AsyncForm>
          <button className="text-button" onClick={() => setPreview(null)}>
            {t("返回修改", "Back to edit")}
          </button>
        </>
      ) : (
        <>
          <AsyncForm
            submitLabel={t("讀取目前成員狀態", "Load current membership")}
            onSubmit={async () => {
              setLoadedTenant(tenant.trim());
              setRevision((v) => v + 1);
            }}
          >
            <Field label={t("企業 ID", "Workspace ID")}>
              <input
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                required
                pattern="[a-fA-F0-9-]{36}"
              />
            </Field>
          </AsyncForm>
          <ErrorNotice error={options.error} />
          {options.loading && <Loading />}
          {options.data && !options.loading && (
            <AsyncForm
              key={`${loadedTenant}:${revision}`}
              submitLabel={t("預覽權限差異", "Preview access changes")}
              onSubmit={async () => {
                const command = {
                  user_id: user,
                  expected_version: options.data.membership?.version ?? 1,
                  role,
                  state,
                  project_ids: state === "removed" ? [] : projects,
                  reason,
                };
                setPreview(
                  await api(base + "/preview", {
                    method: "POST",
                    body: JSON.stringify(command),
                  }),
                );
              }}
            >
              <p className="muted">
                {t("用戶", "User")}: <code>{user}</code> ·{" "}
                {t("版本", "Version")}:{" "}
                {options.data.membership?.version ??
                  t("首次授權", "First grant")}
              </p>
              <Field label={t("角色", "Role")}>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("成員狀態", "Membership state")}>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  <option value="active">{t("啟用", "Active")}</option>
                  <option value="suspended" disabled={!options.data.membership}>
                    {t("後台暫停", "Admin suspended")}
                  </option>
                  <option value="removed" disabled={!options.data.membership}>
                    {t("移除", "Removed")}
                  </option>
                </select>
              </Field>
              <fieldset>
                <legend>
                  {t("明確授予的專案範圍", "Explicit project grants")}
                </legend>
                {options.data.projects.map((p: any) => (
                  <label className="check-row" key={p.id}>
                    <input
                      type="checkbox"
                      checked={projects.includes(p.id)}
                      disabled={state === "removed"}
                      onChange={(e) =>
                        setProjects((ids) =>
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span>
                      {p.name}{" "}
                      {p.archived
                        ? t(
                            "（已歸檔；恢復前請取消選取）",
                            "(archived; deselect before restoring)",
                          )
                        : ""}
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="form-footnote">
                {t(
                  "owner／admin 擁有企業範圍權限。member／approver／viewer 按指定專案存取。暫停保留明確範圍供覆核，移除會清除專案授權。",
                  "Owner/admin roles have enterprise access. Member/approver/viewer roles use assigned projects. Suspension retains explicit scopes for review; removal clears them.",
                )}
              </p>
              <Field label={t("操作原因", "Reason")}>
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </Field>
            </AsyncForm>
          )}
        </>
      )}
    </Modal>
  );
}
