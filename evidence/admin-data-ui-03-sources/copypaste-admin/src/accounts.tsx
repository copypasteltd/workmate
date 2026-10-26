import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { completeOperation, operationKey } from "./operation-key";
import {
  AsyncForm,
  Badge,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";

function AccountStateBadge({ state }: { state: string }) {
  const { t } = useI18n();
  return state === "closed" || state === "frozen" ? (
    <span className="badge status-suspended">
      {state === "closed" ? t("已關閉", "Closed") : t("已凍結", "Frozen")}
    </span>
  ) : (
    <Badge value={state} />
  );
}

export function AccountChangeFacts({
  target,
  command,
  before,
}: {
  target: string;
  command: any;
  before: any;
}) {
  const { t } = useI18n();
  return (
    <dl className="preview-details">
      <dt>{t("目標帳戶", "Target account")}</dt>
      <dd>
        <code>{target}</code>
      </dd>
      <dt>{t("目前狀態與版本", "Current state and revision")}</dt>
      <dd>
        <AccountStateBadge state={before.state} /> · v{before.version}
      </dd>
      {command.state && (
        <>
          <dt>{t("變更後狀態", "Requested state")}</dt>
          <dd>
            <AccountStateBadge state={command.state} />
          </dd>
          <dt>{t("進行中的工作", "Tasks in progress")}</dt>
          <dd>
            {command.inflight_policy === "request_cancel"
              ? t(
                  "請求取消；已發生的費用仍須結算",
                  "Request cancellation; accepted usage still requires settlement",
                )
              : t(
                  "停止新的使用，保留進行中的工作結算",
                  "Stop new usage and preserve settlement of work in progress",
                )}
          </dd>
        </>
      )}
      {command.display_name !== undefined && (
        <>
          <dt>{t("名稱變更", "Name change")}</dt>
          <dd>
            {before.display_name} → {command.display_name}
          </dd>
        </>
      )}
      {command.labels !== undefined && (
        <>
          <dt>{t("標籤變更", "Label change")}</dt>
          <dd>
            {before.labels?.join(", ") || "—"} →{" "}
            {command.labels.join(", ") || "—"}
          </dd>
        </>
      )}
      {command.state === undefined &&
        command.display_name === undefined &&
        command.labels === undefined && (
          <>
            <dt>{t("操作", "Action")}</dt>
            <dd>
              {t(
                "撤銷全部登入會話；帳戶與成員權限保留",
                "Revoke all sign-in sessions and retain the account and memberships",
              )}
            </dd>
          </>
        )}
      <dt>{t("原因", "Reason")}</dt>
      <dd>{command.reason}</dd>
    </dl>
  );
}

export function AdminAccountManager({
  account,
  type,
  target,
  onClose,
}: {
  account: string;
  type: "users" | "tenants";
  target: string;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0);
  const base = `/v1/admin/${type}/${target}`;
  const options = useData(base + "/account-control", revision);
  const [action, setAction] = useState(""),
    [state, setState] = useState("active"),
    [displayName, setDisplayName] = useState(""),
    [labels, setLabels] = useState("");
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null);
  useEffect(() => {
    if (options.data) {
      const d = options.data;
      setAction(
        d.capabilities.includes(`${type}.status.write`)
          ? `${type}.status.write`
          : (d.capabilities[0] ?? ""),
      );
      setState(d.state);
      setDisplayName(d.display_name);
      setLabels((d.labels ?? []).join(", "));
    }
  }, [options.data, type]);
  const pathFor = (a: string) =>
    a.endsWith("profile.write")
      ? "/profile"
      : a.endsWith("sessions.revoke")
        ? "/session-revocations"
        : "/status";
  const titleFor = (a: string) =>
    a.endsWith("profile.write")
      ? t("名稱與標籤", "Name and labels")
      : a.endsWith("sessions.revoke")
        ? t("撤銷全部會話", "Revoke all sessions")
        : t("變更帳戶狀態", "Change account state");
  return (
    <Modal
      title={
        type === "users"
          ? t("管理用戶帳戶", "Manage user account")
          : t("管理企業帳戶", "Manage workspace account")
      }
      onClose={onClose}
    >
      {result ? (
        <>
          <Badge value={result.state} />
          <p>
            <code>{result.id}</code>
          </p>
          <p>
            {result.state === "pending_approval"
              ? t(
                  "已保存，等待另一位管理員覆核；帳戶狀態尚未變更。",
                  "Saved for independent review. Account state has not changed yet.",
                )
              : t(
                  "操作已完成並記錄於審計日誌。",
                  "The operation is complete and recorded in the audit log.",
                )}
          </p>
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
          <button className="button secondary" onClick={onClose}>
            {t("完成", "Done")}
          </button>
        </>
      ) : preview ? (
        <>
          <AccountChangeFacts
            target={target}
            command={preview.command}
            before={preview.before}
          />
          <p className="muted">
            {t("進行中的工作", "Tasks in progress")}:{" "}
            {preview.impact.tasks.reduce((n: number, x: any) => n + x.count, 0)}
          </p>
          {preview.approval && (
            <p className="notice">
              {t(
                "關閉或重開帳戶須由另一位管理員覆核。關閉不等同刪除資料。",
                "Closing or reopening requires another administrator's review. Closure retains data according to retention rules.",
              )}
            </p>
          )}
          <AsyncForm
            submitLabel={
              preview.approval
                ? t("提交獨立覆核", "Submit for independent review")
                : t("確認變更", "Confirm change")
            }
            onSubmit={async () => {
              const path = base + pathFor(preview.action),
                identity = { target_id: target, command: preview.command };
              const key = await operationKey(account, preview.action, identity);
              const accepted = await api(path, {
                method: "POST",
                headers: {
                  "Idempotency-Key": key,
                  "X-Admin-Preview-ID": preview.id,
                },
                body: JSON.stringify(preview.command),
              });
              setResult(accepted);
              await completeOperation(account, preview.action, identity);
            }}
          >
            <p className="form-footnote">
              {t(
                "結果未確認時可重試同一操作；狀態已變更時請重新預覽。",
                "Retry this operation if the outcome is unknown. Preview again if account state changed.",
              )}
            </p>
          </AsyncForm>
          <button
            className="text-button"
            onClick={() => {
              setPreview(null);
              setRevision((v) => v + 1);
            }}
          >
            {t("返回修改", "Back to edit")}
          </button>
        </>
      ) : (
        <>
          <ErrorNotice error={options.error} />
          {options.loading && <Loading />}
          {options.data &&
            !options.loading &&
            (options.data.capabilities.length ? (
              <AsyncForm
                submitLabel={t("預覽變更", "Preview changes")}
                onSubmit={async (f) => {
                  const command: any = { reason: String(f.get("reason")) };
                  if (action === "users.profile.write")
                    Object.assign(command, {
                      expected_version: options.data.version,
                      display_name: displayName,
                      labels: labels
                        .split(/[,，\n]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    });
                  else if (action.endsWith("status.write"))
                    Object.assign(command, {
                      expected_version: options.data.version,
                      state,
                      inflight_policy: String(f.get("inflight")),
                    });
                  setPreview(
                    await api(base + pathFor(action) + "/preview", {
                      method: "POST",
                      body: JSON.stringify(command),
                    }),
                  );
                }}
              >
                <p className="muted">
                  {options.data.display_name} ·{" "}
                  <AccountStateBadge state={options.data.state} /> · v
                  {options.data.version}
                </p>
                <p className="muted">
                  {type === "users"
                    ? t(
                        "此處管理用戶的全部企業與登入會話。單一企業權限請在成員管理中調整。",
                        "These controls affect the user's entire account. Use membership management for access within one workspace.",
                      )
                    : t(
                        "企業停用會阻止該企業存取，成員仍可使用其他企業。",
                        "Suspending this workspace blocks its access while members retain access to other workspaces.",
                      )}
                </p>
                <Field label={t("操作", "Action")}>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    {options.data.capabilities.map((a: string) => (
                      <option key={a} value={a}>
                        {titleFor(a)}
                      </option>
                    ))}
                  </select>
                </Field>
                {action === "users.profile.write" && (
                  <>
                    <Field label={t("顯示名稱", "Display name")}>
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        required
                      />
                    </Field>
                    <Field
                      label={t(
                        "標籤（以逗號分隔）",
                        "Labels (comma separated)",
                      )}
                    >
                      <textarea
                        value={labels}
                        onChange={(e) => setLabels(e.target.value)}
                        rows={2}
                      />
                    </Field>
                  </>
                )}
                {action.endsWith("status.write") && (
                  <>
                    <Field label={t("變更後狀態", "Requested state")}>
                      <select
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                      >
                        <option value="active">{t("啟用", "Active")}</option>
                        <option
                          value={type === "users" ? "frozen" : "suspended"}
                        >
                          {t("暫停使用", "Suspend access")}
                        </option>
                        <option value="closed">
                          {t("關閉帳戶", "Close account")}
                        </option>
                      </select>
                    </Field>
                    <Field label={t("進行中的工作", "Tasks in progress")}>
                      <select name="inflight" defaultValue="stop_new">
                        <option value="stop_new">
                          {t("停止新的使用", "Stop new usage")}
                        </option>
                        <option value="request_cancel">
                          {t(
                            "同時請求取消進行中的工作",
                            "Also request cancellation of work in progress",
                          )}
                        </option>
                      </select>
                    </Field>
                    <p className="form-footnote">
                      {t(
                        "已發生或待確認的費用須繼續結算。關閉前須移交企業擁有權並完成費用對帳。",
                        "Accepted or uncertain charges still require settlement. Transfer ownership and resolve outstanding usage before closure.",
                      )}
                    </p>
                  </>
                )}
                {action === "users.sessions.revoke" && (
                  <p className="notice">
                    {t(
                      "用戶須重新登入所有裝置；帳戶狀態及企業成員權限保留。",
                      "The user must sign in again on every device. Account state and workspace memberships are retained.",
                    )}
                  </p>
                )}
                <Field label={t("原因", "Reason")}>
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    rows={3}
                  />
                </Field>
              </AsyncForm>
            ) : (
              <p className="muted">
                {t(
                  "目前沒有可用的帳戶管理權限。",
                  "Your current permissions do not allow account changes.",
                )}
              </p>
            ))}
        </>
      )}
    </Modal>
  );
}
