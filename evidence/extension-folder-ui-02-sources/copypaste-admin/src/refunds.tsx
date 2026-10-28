import { useState } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";
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

type Money = { currency: "HKD"; amount_micros: string };
type Refund = {
  id: string;
  billing_account_id: string;
  operation_id: string;
  original_entry_id: string;
  destination: "payment_method" | "paid_balance";
  amount: Money;
  confirmed_paid: Money;
  held: Money;
  state: string;
  version: number;
  created_by: string;
  created_at: string;
  data_mode: string;
  payment_record_id: string | null;
};
type Access = {
  me: { user: { id: string } };
  has: (permission: string) => boolean;
};
type Detail = { refund: Refund; source_parts: any[]; events: any[] };
const root = "/v1/admin/billing/refunds",
  uuidPattern = "[a-fA-F0-9-]{36}";

function useRefundName() {
  const { t } = useI18n();
  return (s: string) =>
    ({
      compensated: t("已按原來源補償", "Compensated to original sources"),
      awaiting_evidence: t("等待付款核實", "Awaiting payout verification"),
      partially_paid: t(
        "部分已付款，餘額仍預留",
        "Partially paid; remainder reserved",
      ),
      reconciling_unknown: t("付款結果待確認", "Payout outcome unknown"),
      reconciling_mismatch: t(
        "金額不符，待對帳",
        "Amount mismatch; reconciling",
      ),
      paid: t("全部付款已核實", "Full payout verified"),
      not_paid: t("確認未付款，已解除預留", "Not paid; reservation released"),
      partially_paid_closed: t(
        "部分已付款，其餘已解除預留",
        "Partial payout; remainder released",
      ),
      unknown: t("結果未知", "Unknown"),
      mismatch: t("金額不符", "Mismatch"),
    })[s] ?? s;
}
export function RefundsPanel({
  access,
  refreshVersion,
  onChanged,
}: {
  access: Access;
  refreshVersion: number;
  onChanged: () => void;
}) {
  const { t } = useI18n(),
    name = useRefundName(),
    [revision, setRevision] = useState(0),
    [account, setAccount] = useState(""),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [selected, setSelected] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: "10" });
  if (account) query.set("billing_account_id", account);
  if (cursors.at(-1)) query.set("cursor", cursors.at(-1)!);
  const list = useData<{ items: Refund[]; next_cursor: string | null }>(
    access.has("admin.billing.read") ? `${root}?${query}` : null,
    revision + refreshVersion,
  );
  if (!access.has("admin.billing.read")) return null;
  return (
    <section
      className="panel fee-related"
      aria-label={t("退款記錄", "Refund records")}
    >
      <div className="payment-heading">
        <div>
          <h2>{t("退款記錄", "Refund records")}</h2>
          <p>
            {t(
              "核對消費補償的原資金來源，以及原付款退款的實際付款與預留餘額。",
              "Review original sources for consumption compensation, and verified payouts and remaining holds for cash refunds.",
            )}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} />
          {t("更新退款", "Refresh refunds")}
        </button>
      </div>
      <form
        className="fee-review-search"
        onSubmit={(e) => {
          e.preventDefault();
          setAccount(
            String(new FormData(e.currentTarget).get("account") ?? "").trim(),
          );
          setCursors([null]);
        }}
      >
        <Field label={t("退款帳戶 ID", "Refund account ID")}>
          <input
            name="account"
            pattern={uuidPattern}
            placeholder={t(
              "留空顯示全部授權帳戶",
              "All authorized accounts when empty",
            )}
          />
        </Field>
        <button type="submit" className="button secondary">
          {t("篩選退款", "Filter refunds")}
        </button>
      </form>
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
                  <th>{t("退款 / 帳戶", "Refund / account")}</th>
                  <th>{t("方式與狀態", "Destination / state")}</th>
                  <th>
                    {t("申請 / 已付款 / 仍預留", "Requested / paid / reserved")}
                  </th>
                  <th>{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code className="fee-id">{r.id}</code>
                      <code className="fee-id">{r.billing_account_id}</code>
                      <DateText value={r.created_at} />
                    </td>
                    <td>
                      <strong>
                        {r.destination === "payment_method"
                          ? t("原付款途徑", "Original payment method")
                          : t("消費補償", "Consumption compensation")}
                      </strong>
                      <p className="refund-state">{name(r.state)}</p>
                    </td>
                    <td>
                      {[r.amount, r.confirmed_paid, r.held].map((m, i) => (
                        <span className="refund-amount number" key={i}>
                          {formatHKD(m.amount_micros)}
                        </span>
                      ))}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(r.id)}
                      >
                        {t("核對退款", "Review refund")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={RotateCcw}
            title={t("尚無可讀取退款", "No visible refunds")}
            body={t(
              "由費用操作提交與原交易綁定的退款或消費補償。",
              "Submit a refund or consumption compensation linked to its original transaction from the financial actions.",
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
          setSelected(String(new FormData(e.currentTarget).get("refund")));
        }}
      >
        <Field label={t("退款記錄 ID", "Refund record ID")}>
          <input name="refund" required pattern={uuidPattern} />
        </Field>
        <button type="submit" className="button secondary">
          {t("開啟退款記錄", "Open refund record")}
        </button>
      </form>
      {selected && (
        <ReviewRefund
          key={selected}
          id={selected}
          access={access}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setRevision((v) => v + 1);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function ReviewRefund({
  id,
  access,
  onClose,
  onChanged,
}: {
  id: string;
  access: Access;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n(),
    name = useRefundName(),
    [revision, setRevision] = useState(0),
    [outcome, setOutcome] = useState("unknown"),
    [draft, setDraft] = useState<any>(null),
    [receipt, setReceipt] = useState<string | null>(null),
    detail = useData<Detail>(`${root}/${id}`, revision),
    d = detail.data,
    r = d?.refund;
  const outcomeName = (s: string) =>
    ({
      paid: t("本次實付已核實", "This payout verified"),
      not_paid: t("剩餘未付款", "Remainder not paid"),
      unknown: t("結果未知", "Unknown"),
      mismatch: t("金額不符", "Amount mismatch"),
    })[s] ?? s;
  const refresh = () => {
    setDraft(null);
    setRevision((v) => v + 1);
  };
  return (
    <Modal
      title={t("核對退款與實際付款", "Review refund and actual payout")}
      onClose={onClose}
    >
      <ErrorNotice error={detail.error} />
      {detail.loading && <Loading />}
      {d && r && (
        <>
          <p className="notice refund-state" role="status">
            {name(r.state)}
          </p>
          <Badge value={r.data_mode} />
          <dl className="preview-details">
            <dt>{t("退款記錄", "Refund record")}</dt>
            <dd>
              <code className="fee-id">{r.id}</code>
            </dd>
            <dt>{t("帳戶", "Account")}</dt>
            <dd>
              <code className="fee-id">{r.billing_account_id}</code>
            </dd>
            <dt>{t("原始交易流水", "Original transaction entry")}</dt>
            <dd>
              <code className="fee-id">{r.original_entry_id}</code>
            </dd>
            <dt>{t("申請金額", "Requested amount")}</dt>
            <dd>{formatHKD(r.amount.amount_micros)}</dd>
            {r.destination === "payment_method" && (
              <>
                <dt>{t("已核實實際付款", "Verified actual payout")}</dt>
                <dd>{formatHKD(r.confirmed_paid.amount_micros)}</dd>
                <dt>{t("仍然預留", "Still reserved")}</dt>
                <dd>{formatHKD(r.held.amount_micros)}</dd>
                <dt>{t("原付款記錄", "Original payment record")}</dt>
                <dd>
                  <code className="fee-id">{r.payment_record_id}</code>
                </dd>
              </>
            )}
            <dt>{t("申請管理員", "Requested by")}</dt>
            <dd>
              <code className="fee-id">{r.created_by}</code>
            </dd>
            <dt>{t("原始操作", "Original operation")}</dt>
            <dd>
              <code className="fee-id">{r.operation_id}</code>
            </dd>
            <dt>{t("記錄版本", "Record revision")}</dt>
            <dd>v{r.version}</dd>
          </dl>
          {d.source_parts.length > 0 && (
            <section aria-label={t("補償資金來源", "Compensation sources")}>
              <h3>{t("補償資金來源", "Compensation sources")}</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("原來源", "Original source")}</th>
                      <th>{t("金額 / 處理", "Amount / treatment")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.source_parts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <code className="fee-id">{p.source_id}</code>
                          <code className="fee-id">
                            {p.restored_lot_id ?? p.cancellation_id}
                          </code>
                        </td>
                        <td>
                          <span className="number">
                            {formatHKD(p.amount_micros)}
                          </span>
                          <p>
                            {p.expiry_journal_id
                              ? t(
                                  "原贈額已到期，保留補償與到期記錄",
                                  "Original gift expired; compensation and expiry recorded",
                                )
                              : p.restored_kind === "gift"
                                ? t(
                                    "返還原贈額，到期時間保留",
                                    "Original gift restored; expiry preserved",
                                  )
                                : p.restored_kind === "paid"
                                  ? t(
                                      "返還原付費來源",
                                      "Original paid source restored",
                                    )
                                  : t(
                                      "註銷此消費的未償授信",
                                      "Unpaid credit for this consumption cancelled",
                                    )}
                          </p>
                          {p.expires_at && <DateText value={p.expires_at} />}
                          <code className="fee-id">{p.journal_id}</code>
                          {p.expiry_journal_id && (
                            <code className="fee-id">
                              {p.expiry_journal_id}
                            </code>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {d.events.length > 0 && (
            <section aria-label={t("付款核實歷史", "Payout review history")}>
              <h3>{t("付款核實歷史", "Payout review history")}</h3>
              {d.events.map((e) => (
                <article key={e.id} className="refund-event">
                  <strong>{outcomeName(e.outcome)}</strong>
                  <span className="number">
                    {e.observed_amount_micros === null
                      ? t("未確認金額", "Amount unconfirmed")
                      : formatHKD(e.observed_amount_micros)}
                  </span>
                  <p>{e.reason}</p>
                  {e.external_reference && <p>{e.external_reference}</p>}
                  <code className="fee-id">{e.verified_by}</code>
                  {e.occurred_at && <DateText value={e.occurred_at} />}
                  {e.evidence_asset_version_id && (
                    <>
                      <code className="fee-id">
                        {e.evidence_asset_version_id}
                      </code>
                      <code className="fee-id">{e.evidence_sha256}</code>
                    </>
                  )}
                  <code className="fee-id">{e.operation_id}</code>
                </article>
              ))}
            </section>
          )}
          {receipt && (
            <p className="notice" role="status">
              {t(
                "核實記錄已保存。請核對下方更新的實際付款與預留金額。",
                "Review recorded. Check the updated actual payout and reserved amount.",
              )}
              <code className="fee-id">{receipt}</code>
            </p>
          )}
          {r.destination === "payment_method" &&
            BigInt(r.held.amount_micros) > 0n &&
            (r.created_by === access.me.user.id ? (
              <p className="notice">
                {t(
                  "請另一位同時具備退款及對帳權限的管理員核實實際付款。",
                  "Ask another administrator with both refund and reconciliation permissions to verify the actual payout.",
                )}
              </p>
            ) : access.has("admin.billing.refund") &&
              access.has("admin.billing.reconcile") ? (
              draft ? (
                <>
                  <h3>{t("核對本次觀察", "Review this observation")}</h3>
                  <dl className="preview-details">
                    <dt>{t("付款結果", "Payout outcome")}</dt>
                    <dd>{outcomeName(draft.outcome)}</dd>
                    <dt>{t("實際金額", "Actual amount")}</dt>
                    <dd>
                      {draft.observed_amount
                        ? formatHKD(draft.observed_amount.amount_micros)
                        : t("未確認", "Unconfirmed")}
                    </dd>
                    <dt>{t("外部編號", "External reference")}</dt>
                    <dd>{draft.external_reference ?? "—"}</dd>
                    <dt>{t("憑據版本", "Evidence version")}</dt>
                    <dd>
                      <code className="fee-id">
                        {draft.evidence_asset_version_id ?? "—"}
                      </code>
                    </dd>
                    <dt>{t("實際發生時間", "Actual occurrence time")}</dt>
                    <dd>
                      {draft.occurred_at ? (
                        <DateText value={draft.occurred_at} />
                      ) : (
                        "—"
                      )}
                    </dd>
                    <dt>{t("原因", "Reason")}</dt>
                    <dd>{draft.reason}</dd>
                  </dl>
                  <AsyncForm
                    submitLabel={t(
                      "保存獨立付款核實",
                      "Save independent payout review",
                    )}
                    onSubmit={async () => {
                      const action = `refund.outcome:${id}`,
                        k = await operationKey(
                          access.me.user.id,
                          action,
                          draft,
                        );
                      const result = await api<any>(`${root}/${id}/outcomes`, {
                        method: "POST",
                        body: JSON.stringify(draft),
                        headers: { "Idempotency-Key": k },
                      });
                      await completeOperation(access.me.user.id, action, draft);
                      setReceipt(result.id);
                      setDraft(null);
                      setOutcome("unknown");
                      setRevision((v) => v + 1);
                      onChanged();
                    }}
                  >
                    <p>
                      {t(
                        "只記錄本次實際付款；分次付款可逐次核實。確認剩餘未付款會解除剩餘預留。結果未知或金額不符會繼續待對帳。",
                        "Record only this actual payout; installments can be verified separately. Confirming the remainder was not paid releases its hold. Unknown or mismatched outcomes remain in reconciliation.",
                      )}
                    </p>
                    <label className="payment-check">
                      <input type="checkbox" required />
                      {t(
                        "已核對本次原始憑據與實際外部結果。",
                        "I checked this original evidence and the actual external outcome.",
                      )}
                    </label>
                  </AsyncForm>
                  <button
                    className="text-button"
                    onClick={() => setDraft(null)}
                  >
                    {t("返回修改", "Edit details")}
                  </button>
                </>
              ) : (
                <AsyncForm
                  key={`${id}:${r.version}`}
                  submitLabel={t("核對付款結果", "Review payout outcome")}
                  onSubmit={async (f) => {
                    const known = outcome !== "unknown",
                      observed = String(f.get("amount") ?? "").trim();
                    setDraft({
                      expected_version: r.version,
                      reason: String(f.get("reason")),
                      outcome,
                      observed_amount: observed
                        ? {
                            currency: "HKD",
                            amount_micros: parseHKD(
                              observed,
                              outcome !== "paid",
                            ),
                          }
                        : null,
                      external_reference:
                        String(f.get("reference") ?? "") || null,
                      evidence_asset_version_id:
                        String(f.get("evidence") ?? "") || null,
                      occurred_at: String(f.get("occurred") ?? "")
                        ? new Date(String(f.get("occurred"))).toISOString()
                        : null,
                    });
                    if (known && !observed) {
                      setDraft(null);
                      throw new Error(
                        t(
                          "請填入本次實際金額。",
                          "Enter this actual observed amount.",
                        ),
                      );
                    }
                  }}
                >
                  <Field label={t("付款結果", "Payout outcome")}>
                    <select
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                    >
                      <option value="unknown">
                        {t("結果未知，繼續待對帳", "Unknown; keep reconciling")}
                      </option>
                      <option value="paid">
                        {t("本次已實際付款", "Actual payout made")}
                      </option>
                      <option value="not_paid">
                        {t("確認剩餘未付款", "Remainder confirmed not paid")}
                      </option>
                    </select>
                  </Field>
                  <Field
                    label={t("本次實際金額（HKD）", "This actual amount (HKD)")}
                    hint={t(
                      "已付款填本次實付金額；確認未付款填 0。",
                      "For a payout, enter this installment only. For confirmed non-payment, enter 0.",
                    )}
                  >
                    <input
                      name="amount"
                      required={outcome !== "unknown"}
                      inputMode="decimal"
                      pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?"
                    />
                  </Field>
                  <Field label={t("外部退款編號", "External refund reference")}>
                    <input
                      name="reference"
                      required={outcome !== "unknown"}
                      maxLength={512}
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label={t("退款憑據版本 ID", "Refund evidence version ID")}
                    hint={t(
                      "使用此帳戶主體已上傳的有效憑據版本。",
                      "Use an active uploaded evidence version belonging to this account subject.",
                    )}
                  >
                    <input
                      name="evidence"
                      required={outcome !== "unknown"}
                      pattern={uuidPattern}
                    />
                  </Field>
                  <Field label={t("實際發生時間", "Actual occurrence time")}>
                    <input
                      name="occurred"
                      type="datetime-local"
                      required={outcome !== "unknown"}
                    />
                  </Field>
                  <Field label={t("核實原因", "Review reason")}>
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={1000}
                      rows={3}
                      required
                    />
                  </Field>
                </AsyncForm>
              )
            ) : (
              <p className="notice">
                {t(
                  "核實付款需要同時具備退款及對帳權限。",
                  "Both refund and reconciliation permissions are required to verify a payout.",
                )}
              </p>
            ))}
          <button className="button secondary" onClick={refresh}>
            <RefreshCw size={16} />
            {t("更新退款記錄", "Reload refund record")}
          </button>
        </>
      )}
    </Modal>
  );
}
