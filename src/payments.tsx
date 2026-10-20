import { useState } from "react";
import { FileCheck2, Plus, RefreshCw } from "lucide-react";
import { api } from "./api";
import { operationKey, completeOperation } from "./operation-key";
import { formatHKD, parseHKD } from "./financial-money";
import {
  AsyncForm,
  Badge,
  DateText,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  useData,
  useI18n,
} from "./ui";

type Receipt = {
  id: string;
  billing_account_id: string;
  external_reference: string;
  amount: { currency: "HKD"; amount_micros: string };
  state: string;
  version: number;
  received_at: string;
};
type Detail = {
  payment: Receipt;
  evidence_asset_version_id: string;
  evidence_sha256: string;
  recorded_by: string;
  verified_by: string | null;
  confirmed_at: string | null;
  posted_entry_id: string | null;
  posted_at: string | null;
  data_mode: string;
};
type Access = { me: { user: { id: string } }; has: (key: string) => boolean };
const root = "/v1/admin/billing/payments";
const uuidPattern = "[a-fA-F0-9-]{36}";
async function send(
  operator: string,
  action: string,
  url: string,
  body: unknown,
) {
  const key = await operationKey(operator, action, body);
  const result = await api<any>(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": key },
  });
  await completeOperation(operator, action, body);
  return result;
}
export function PaymentsPanel({
  access,
  onTopUp,
  refreshVersion,
}: {
  access: Access;
  refreshVersion: number;
  onTopUp: (account: string, payment: string) => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const list = useData<{ items: Receipt[]; next_cursor: string | null }>(
    access.has("admin.billing.read")
      ? `${root}?limit=10${cursors.at(-1) ? `&cursor=${encodeURIComponent(cursors.at(-1)!)}` : ""}`
      : null,
    revision + refreshVersion,
  );
  const refresh = () => setRevision((v) => v + 1);
  return (
    <section
      className="panel fee-related"
      aria-label={t("付款記錄", "Payment records")}
    >
      <div className="payment-heading">
        <div>
          <h2>{t("付款記錄", "Payment records")}</h2>
          <p>
            {t(
              "先登記憑據，由另一位管理員核實，再預覽並入帳。",
              "Record evidence, have another administrator verify it, then preview and post credit.",
            )}
          </p>
        </div>
        <div className="fee-actions">
          <button className="button secondary" onClick={refresh}>
            <RefreshCw size={16} />
            {t("更新付款", "Refresh payments")}
          </button>
          {access.has("admin.billing.reconcile") && (
            <button
              className="button primary"
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              {t("登記付款", "Record payment")}
            </button>
          )}
        </div>
      </div>
      <ErrorNotice error={list.error} />
      {list.loading ? (
        <Loading />
      ) : (
        list.data &&
        (list.data.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("付款與外部編號", "Payment / external reference")}</th>
                  <th>{t("帳戶 / 金額", "Account / amount")}</th>
                  <th>{t("核實 / 入帳", "Verification / posting")}</th>
                  <th>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.external_reference}</strong>
                      <code className="fee-id">{p.id}</code>
                      <DateText value={p.received_at} />
                    </td>
                    <td>
                      <code className="fee-id">{p.billing_account_id}</code>
                      <span className="number">
                        {formatHKD(p.amount.amount_micros)}
                      </span>
                    </td>
                    <td>
                      <Badge value={p.state} />
                      <p>
                        {p.version >= 3
                          ? t("已入帳", "Posted")
                          : t("尚未入帳", "Not posted")}
                      </p>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(p.id)}
                      >
                        {t("核對付款", "Review payment")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={FileCheck2}
            title={t("尚無可讀取付款", "No visible payments")}
            body={t(
              "登記實際收到的付款並保留原始憑據版本。",
              "Record received payments with their original evidence version.",
            )}
          />
        ))
      )}
      {list.data && (
        <div className="fee-actions">
          <button
            className="button secondary"
            disabled={cursors.length === 1}
            onClick={() => setCursors((v) => v.slice(0, -1))}
          >
            {t("上一頁", "Previous")}
          </button>
          <button
            className="button secondary"
            disabled={!list.data.next_cursor}
            onClick={() => setCursors((v) => [...v, list.data!.next_cursor])}
          >
            {t("下一頁", "Next")}
          </button>
        </div>
      )}
      <form
        className="fee-review-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(String(new FormData(e.currentTarget).get("payment")));
        }}
      >
        <Field label={t("付款記錄 ID", "Payment record ID")}>
          <input name="payment" required pattern={uuidPattern} />
        </Field>
        <button className="button secondary" type="submit">
          {t("開啟付款", "Open payment")}
        </button>
      </form>
      {creating && (
        <RecordPayment
          operator={access.me.user.id}
          onClose={() => setCreating(false)}
          onRecorded={(id) => {
            setCreating(false);
            setSelected(id);
            refresh();
          }}
        />
      )}
      {selected && (
        <ReviewPayment
          id={selected}
          access={access}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onTopUp={onTopUp}
        />
      )}
    </section>
  );
}
function RecordPayment({
  operator,
  onClose,
  onRecorded,
}: {
  operator: string;
  onClose: () => void;
  onRecorded: (id: string) => void;
}) {
  const { t } = useI18n(),
    [draft, setDraft] = useState<any>(null);
  return (
    <Modal
      title={t("登記收到的付款", "Record a received payment")}
      onClose={onClose}
    >
      {draft ? (
        <>
          <dl className="preview-details">
            <dt>{t("帳戶", "Account")}</dt>
            <dd>
              <code>{draft.billing_account_id}</code>
            </dd>
            <dt>{t("外部付款編號", "External payment reference")}</dt>
            <dd>{draft.external_reference}</dd>
            <dt>{t("實收金額", "Received amount")}</dt>
            <dd>{formatHKD(draft.amount.amount_micros)}</dd>
            <dt>{t("收到時間", "Received at")}</dt>
            <dd>
              <DateText value={draft.received_at} />
            </dd>
            <dt>{t("憑據版本", "Evidence version")}</dt>
            <dd>
              <code>{draft.evidence_asset_version_id}</code>
            </dd>
            <dt>{t("原因", "Reason")}</dt>
            <dd>{draft.reason}</dd>
          </dl>
          <AsyncForm
            submitLabel={t("確認登記憑據", "Confirm evidence record")}
            onSubmit={async () => {
              const r = await send(operator, "payment.record", root, draft);
              onRecorded(r.result_ids[0]);
            }}
          >
            <p>
              {t(
                "登記後仍需另一位管理員核實；本步不增加可用餘額。",
                "Another administrator must verify this record. Registration does not increase available credit.",
              )}
            </p>
          </AsyncForm>
          <button className="text-button" onClick={() => setDraft(null)}>
            {t("返回修改", "Edit details")}
          </button>
        </>
      ) : (
        <AsyncForm
          submitLabel={t("核對登記內容", "Review record details")}
          onSubmit={async (f) =>
            setDraft({
              billing_account_id: String(f.get("account")),
              external_reference: String(f.get("reference")),
              amount: {
                currency: "HKD",
                amount_micros: parseHKD(String(f.get("amount"))),
              },
              received_at: new Date(String(f.get("received"))).toISOString(),
              evidence_asset_version_id: String(f.get("evidence")),
              reason: String(f.get("reason")),
            })
          }
        >
          <Field label={t("帳務帳戶 ID", "Billing account ID")}>
            <input name="account" required pattern={uuidPattern} />
          </Field>
          <Field
            label={t("外部付款編號", "External payment reference")}
            hint={t(
              "請輸入銀行或付款機構的完整原始編號。",
              "Enter the exact original bank or payment provider reference.",
            )}
          >
            <input name="reference" required autoComplete="off" />
          </Field>
          <Field label={t("實收金額（HKD）", "Received amount (HKD)")}>
            <input
              name="amount"
              inputMode="decimal"
              pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?"
              required
            />
          </Field>
          <Field label={t("收到時間", "Received at")}>
            <input name="received" type="datetime-local" required />
          </Field>
          <Field
            label={t("憑據素材版本 ID", "Evidence asset version ID")}
            hint={t(
              "使用此帳戶主體已上傳的有效憑據版本。",
              "Use an active uploaded evidence version belonging to this account subject.",
            )}
          >
            <input name="evidence" required pattern={uuidPattern} />
          </Field>
          <Field label={t("登記原因", "Record reason")}>
            <textarea
              name="reason"
              minLength={3}
              maxLength={1000}
              required
              rows={3}
            />
          </Field>
        </AsyncForm>
      )}
    </Modal>
  );
}
function ReviewPayment({
  id,
  access,
  onClose,
  onChanged,
  onTopUp,
}: {
  id: string;
  access: Access;
  onClose: () => void;
  onChanged: () => void;
  onTopUp: (account: string, payment: string) => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<string | null>(null),
    detail = useData<Detail>(`${root}/${id}`, revision);
  const d = detail.data,
    p = d?.payment;
  return (
    <Modal
      title={t("核對付款與入帳", "Review payment and posting")}
      onClose={onClose}
    >
      <ErrorNotice error={detail.error} />
      {detail.loading && <Loading />}
      {d && p && (
        <>
          <Badge value={p.state} />
          <Badge value={d.data_mode} />
          <dl className="preview-details">
            <dt>{t("付款記錄", "Payment record")}</dt>
            <dd>
              <code>{p.id}</code>
            </dd>
            <dt>{t("外部付款編號", "External reference")}</dt>
            <dd>{p.external_reference}</dd>
            <dt>{t("實收金額", "Received amount")}</dt>
            <dd>{formatHKD(p.amount.amount_micros)}</dd>
            <dt>{t("帳戶", "Account")}</dt>
            <dd>
              <code>{p.billing_account_id}</code>
            </dd>
            <dt>{t("收到時間", "Received at")}</dt>
            <dd>
              <DateText value={p.received_at} />
            </dd>
            <dt>{t("憑據版本 / SHA-256", "Evidence version / SHA-256")}</dt>
            <dd>
              <code className="fee-id">{d.evidence_asset_version_id}</code>
              <code className="fee-id">{d.evidence_sha256}</code>
            </dd>
            <dt>{t("登記管理員", "Recorded by")}</dt>
            <dd>
              <code>{d.recorded_by}</code>
            </dd>
            <dt>{t("核實管理員", "Verified by")}</dt>
            <dd>
              {d.verified_by ? (
                <>
                  <code className="fee-id">{d.verified_by}</code>
                  <DateText value={d.confirmed_at!} />
                </>
              ) : (
                t("等待獨立核實", "Awaiting independent verification")
              )}
            </dd>
            <dt>{t("入帳流水", "Posted ledger entry")}</dt>
            <dd>
              {d.posted_entry_id ? (
                <code>{d.posted_entry_id}</code>
              ) : (
                t("尚未入帳", "Not posted")
              )}
            </dd>
          </dl>
          {result && (
            <p className="notice" role="status">
              {t(
                "核實記錄已保存。餘額須完成充值預覽及入帳才會更新。",
                "Verification saved. Credit changes only after the top-up preview and posting.",
              )}
              <code className="fee-id">{result}</code>
            </p>
          )}
          {p.state === "recorded" &&
            (d.recorded_by === access.me.user.id ? (
              <p className="notice">
                {t(
                  "請另一位具備對帳權限的管理員核實此付款。",
                  "Ask another administrator with reconciliation access to verify this payment.",
                )}
              </p>
            ) : (
              access.has("admin.billing.reconcile") && (
                <AsyncForm
                  submitLabel={t(
                    "保存獨立核實記錄",
                    "Save independent verification",
                  )}
                  onSubmit={async (f) => {
                    if (!confirmed)
                      throw new Error(
                        t(
                          "請先核對外部憑據。",
                          "Check the external evidence first.",
                        ),
                      );
                    const b = {
                      expected_version: p.version,
                      verified_reference: String(f.get("verified")),
                      reason: String(f.get("reason")),
                    };
                    const r = await send(
                      access.me.user.id,
                      `payment.confirm:${id}`,
                      `${root}/${id}/confirmations`,
                      b,
                    );
                    setResult(r.id);
                    setRevision((v) => v + 1);
                    onChanged();
                  }}
                >
                  <Field
                    label={t(
                      "獨立核對的外部編號",
                      "Independently verified reference",
                    )}
                  >
                    <input name="verified" required autoComplete="off" />
                  </Field>
                  <Field label={t("核實原因", "Verification reason")}>
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      required
                      rows={3}
                    />
                  </Field>
                  <label className="payment-check">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    {t(
                      "已核對外部付款資料及本次憑據版本。",
                      "I checked the external payment information and this evidence version.",
                    )}
                  </label>
                </AsyncForm>
              )
            ))}
          {p.state === "confirmed" &&
            !d.posted_entry_id &&
            access.has("admin.billing.top_up") && (
              <button
                className="button primary"
                onClick={() => {
                  onTopUp(p.billing_account_id, p.id);
                  onClose();
                }}
              >
                {t("預覽並入帳", "Preview and post credit")}
              </button>
            )}
        </>
      )}
    </Modal>
  );
}
