import { useState } from "react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { AccountChangeFacts } from "./accounts";
import { MembershipChangeFacts } from "./memberships";
import { PlanPublicationFacts } from "./plans";
import { CapabilityPublicationFacts } from "./capabilities";
import { VipChangeFacts, VipCreditFacts, vipPermission } from "./vip";
import { FeeReview, canonicalFeeAction } from "./fees";
import {
  AsyncForm,
  DateText,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  Badge as Status,
  useI18n,
  useData,
} from "./ui";

export function ApprovalReview({
  id,
  operator,
  has,
  onClose,
  onDone,
}: {
  id: string;
  operator: string;
  has: (permission: string) => boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    { data, error, loading } = useData(
      `/v1/admin/approvals/${id}/review`,
      revision,
    );
  if (data && canonicalFeeAction(data.operation.action))
    return (
      <FeeReview
        id={data.operation.id}
        operator={operator}
        has={has}
        onClose={onClose}
        onDone={onDone}
      />
    );
  const operation = data?.operation,
    approval = data?.approval,
    command = data?.command;
  const permission = operation
    ? operation.action === "entitlements.grant_with_credit"
      ? "admin.entitlements.grant"
      : operation.action.startsWith("entitlements.")
        ? vipPermission(operation.action)
        : "admin." +
          (["entitlements.suspend", "entitlements.resume"].includes(
            operation.action,
          )
            ? "entitlements.extend"
            : operation.action)
    : "";
  const pending =
    approval?.state === "pending" && operation?.state === "pending_approval";
  const labels: Record<string, [string, string]> = {
    amount_micros: ["金額（HKD 微元）", "Amount (HKD micros)"],
    actual_micros: ["核對消耗（HKD 微元）", "Reconciled charge (HKD micros)"],
    tenant_id: ["企業", "Workspace"],
    user_id: ["用戶", "User"],
    task_id: ["工作", "Task"],
    source_id: ["原始來源", "Original source"],
    reference: ["付款參考", "Payment reference"],
    reason: ["原操作原因", "Original reason"],
    plan: ["方案", "Plan"],
    starts_at: ["生效時間", "Starts"],
    ends_at: ["截止時間", "Ends"],
  };
  return (
    <Modal title={t("獨立審批", "Independent review")} onClose={onClose}>
      <ErrorNotice error={error} />
      {loading && <Loading />}
      {data && (
        <>
          <dl className="key-value">
            <dt>{t("審批請求", "Approval request")}</dt>
            <dd>
              <code>{approval.id}</code>
            </dd>
            <dt>{t("操作", "Operation")}</dt>
            <dd>
              {operation.action}
              <small>
                <code>{operation.id}</code>
              </small>
            </dd>
            <dt>{t("申請人", "Requester")}</dt>
            <dd>
              <code>{approval.requester_id}</code>
            </dd>
            <dt>{t("狀態", "Status")}</dt>
            <dd>
              <Status value={approval.state} />
            </dd>
            <dt>{t("審批期限", "Approval deadline")}</dt>
            <dd>
              <DateText value={approval.expires_at} />
            </dd>
          </dl>
          {operation.action === "plans.publish" ? (
            <PlanPublicationFacts before={data.before} />
          ) : ["catalog.publish", "catalog.rollback"].includes(
              operation.action,
            ) && data.before?.proposed?.document?.kernel === "codex" ? (
            <CapabilityPublicationFacts before={data.before} />
          ) : operation.action === "entitlements.grant_with_credit" ? (
            <VipCreditFacts command={command} before={data.before} />
          ) : operation.action.startsWith("entitlements.") ? (
            <VipChangeFacts command={command} before={data.before} />
          ) : operation.action === "tenants.members.write" ? (
            <MembershipChangeFacts
              tenant={operation.target_ids[0]}
              command={command}
              before={data.before}
            />
          ) : [
              "users.profile.write",
              "users.status.write",
              "users.sessions.revoke",
              "tenants.status.write",
            ].includes(operation.action) ? (
            <AccountChangeFacts
              target={operation.target_ids[0]}
              command={command}
              before={data.before}
            />
          ) : (
            <dl className="key-value">
              {Object.entries(command)
                .filter(([key]) => key !== "action")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{labels[key] ? t(...labels[key]) : key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
          )}
          {pending &&
            (approval.requester_id === operator ? (
              <p className="notice">
                {t(
                  "此操作需由另一位管理員審批。",
                  "Another administrator must review this operation.",
                )}
              </p>
            ) : has("admin.approvals.decide") &&
              has(permission) &&
              (operation.action !== "entitlements.grant_with_credit" ||
                has("admin.billing.gift")) ? (
              <AsyncForm
                submitLabel={t("確認審批決定", "Confirm review decision")}
                onSubmit={async (f) => {
                  const body = {
                      expected_version: approval.version,
                      payload_hash: approval.payload_hash,
                      decision: String(f.get("decision")),
                      reason: String(f.get("reason")),
                    },
                    action = `admin.approval.decision:${approval.id}`;
                  await api(`/v1/admin/approvals/${approval.id}/decisions`, {
                    method: "POST",
                    body: JSON.stringify(body),
                    headers: {
                      "Idempotency-Key": await operationKey(
                        operator,
                        action,
                        body,
                      ),
                    },
                  });
                  await completeOperation(operator, action, body);
                  setRevision((n) => n + 1);
                  onDone();
                  onClose();
                }}
              >
                <Field label={t("審批決定", "Decision")}>
                  <select name="decision">
                    <option value="reject">{t("拒絕", "Reject")}</option>
                    <option value="approve">{t("批准", "Approve")}</option>
                  </select>
                </Field>
                <Field label={t("審批原因", "Review reason")}>
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </Field>
              </AsyncForm>
            ) : (
              <p className="notice">
                {t(
                  "需要同時具備此項業務操作及審批權限。",
                  "Both business action and approval permissions are required.",
                )}
              </p>
            ))}
        </>
      )}
    </Modal>
  );
}
