import { PaymentsPanel } from "./payments";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
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
  PageHeader,
  useData,
  useI18n,
} from "./ui";

type Money = { currency: "HKD"; amount_micros: string };
type Account = {
  id: string;
  subject: { kind: "user" | "tenant"; id: string };
  version: number;
  paid_balance: Money;
  promotional_balance: Money;
  reserved: Money;
  credit_limit: Money;
  debt: Money;
  as_of: string;
};
type Entry = {
  id: string;
  operation_id: string;
  actor_id: string;
  kind: string;
  direction: string;
  bucket: string;
  amount: Money;
  reason: string;
  created_at: string;
  source_entry_id?: string;
};
type List<T> = { items: T[]; next_cursor: string | null };
type Access = {
  me: { user: { id: string } };
  has: (permission: string) => boolean;
};
type FeeAction = "top_up" | "gift" | "debit" | "credit_limit";
const root = "/v1/admin/billing/accounts";
const actions: FeeAction[] = ["top_up", "gift", "debit", "credit_limit"];
const permission = (a: FeeAction) =>
  a === "credit_limit"
    ? "admin.billing.credit_limit.write"
    : `admin.billing.${a}`;
const path = (a: FeeAction) =>
  a === "credit_limit" ? "credit-limit" : a === "top_up" ? "top-up" : a;
export const canonicalFeeAction = (a: string) =>
  [
    "billing.top_up",
    "billing.gift",
    "billing.debit",
    "billing.credit_limit.write",
  ].includes(a);
const actionOf = (a: string): FeeAction =>
  a === "billing.credit_limit.write"
    ? "credit_limit"
    : (a.replace("billing.", "") as FeeAction);

function useFeeName() {
  const { t } = useI18n();
  return (a: FeeAction) =>
    a === "top_up"
      ? t("核實付款入帳", "Post verified payment")
      : a === "gift"
        ? t("贈送額度", "Gift credit")
        : a === "debit"
          ? t("扣回原始額度", "Debit original credit")
          : t("變更信用上限", "Change credit limit");
}
function Amount({ value }: { value: Money }) {
  return <span className="number">{formatHKD(value.amount_micros)}</span>;
}
function Subject({ account }: { account: Account }) {
  const { t } = useI18n();
  return (
    <>
      <span className="badge">
        {account.subject.kind === "user"
          ? t("個人", "Personal")
          : t("企業", "Workspace")}
      </span>
      <code className="fee-id">{account.subject.id}</code>
    </>
  );
}
function AccountFacts({ account }: { account: Account }) {
  const { t } = useI18n();
  return (
    <dl className="fee-balances">
      {[
        [t("付費餘額", "Paid balance"), account.paid_balance],
        [t("贈送餘額", "Promotional balance"), account.promotional_balance],
        [t("已預留", "Reserved"), account.reserved],
        [t("信用上限", "Credit limit"), account.credit_limit],
        [t("已用信用", "Credit debt"), account.debt],
      ].map(([label, value]) => (
        <div key={String(label)}>
          <dt>{String(label)}</dt>
          <dd>
            <Amount value={value as Money} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function AdminBilling({
  access,
  onLegacy,
}: {
  access: Access;
  onLegacy: (action: string) => void;
}) {
  const { t } = useI18n(),
    name = useFeeName();
  const [filter, setFilter] = useState(""),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<{
      id?: string;
      action: FeeAction;
      payment?: string;
    } | null>(null),
    [ledger, setLedger] = useState<string | null>(null),
    [review, setReview] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: "25" });
  if (filter) query.set("subject_id", filter);
  if (cursors[page]) query.set("cursor", cursors[page]!);
  const list = useData<List<Account>>(
    access.has("admin.billing.read") ? `${root}?${query}` : null,
    revision,
  );
  const bump = () => setRevision((v) => v + 1);
  return (
    <>
      <PageHeader
        eyebrow="EVERY CREDIT, ACCOUNTED FOR."
        title={t("費用與帳務", "Billing accounts")}
        description={t(
          "按個人或企業核對餘額、預留與原始流水，再提交費用變更。",
          "Review personal and workspace balances, holds and original entries before making a change.",
        )}
        action={
          <button className="button secondary" onClick={bump}>
            <RefreshCw size={16} />
            {t("更新資料", "Refresh")}
          </button>
        }
      />
      <div className="fee-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setFilter(String(f.get("subject") ?? "").trim());
            setCursors([null]);
            setPage(0);
          }}
        >
          <Field label={t("用戶 / 企業 ID", "User / workspace ID")}>
            <input
              name="subject"
              placeholder={t(
                "留空顯示全部授權帳戶",
                "All authorized accounts when empty",
              )}
              pattern="[a-fA-F0-9-]{36}"
            />
          </Field>
          <button className="button secondary" type="submit">
            {t("套用篩選", "Apply filter")}
          </button>
        </form>
        <div className="fee-actions">
          {actions
            .filter((a) => access.has(permission(a)))
            .map((a) => (
              <button
                key={a}
                className="button secondary"
                onClick={() => setEdit({ action: a })}
              >
                {name(a)}
                <ArrowUpRight size={15} />
              </button>
            ))}
        </div>
      </div>
      <ErrorNotice error={list.error} />
      {!access.has("admin.billing.read") ? (
        <Empty
          title={t("需要帳務讀取權限", "Billing read access required")}
          body={t(
            "請聯絡權限管理員分配適當的帳務範圍。",
            "Ask an access administrator to assign the appropriate billing scope.",
          )}
        />
      ) : list.loading ? (
        <Loading />
      ) : (
        list.data && (
          <>
            {!list.data.items.length ? (
              <Empty
                icon={Wallet}
                title={t(
                  "沒有符合的授權帳戶",
                  "No matching authorized accounts",
                )}
                body={t(
                  "請檢查主體 ID 或更新帳務範圍。",
                  "Check the subject ID or your billing scope.",
                )}
              />
            ) : (
              <section className="panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("帳務主體 / 帳戶", "Subject / account")}</th>
                        <th>{t("付費 / 贈送餘額", "Paid / promotional")}</th>
                        <th>{t("預留 / 信用債務", "Reserved / debt")}</th>
                        <th>{t("信用上限", "Credit limit")}</th>
                        <th>{t("操作", "Actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Subject account={w} />
                            <code className="fee-id">{w.id}</code>
                            <small className="muted">
                              v{w.version} · <DateText value={w.as_of} />
                            </small>
                          </td>
                          <td>
                            <Amount value={w.paid_balance} />
                            <br />
                            <span className="muted">
                              <Amount value={w.promotional_balance} />
                            </span>
                          </td>
                          <td>
                            <Amount value={w.reserved} />
                            <br />
                            <span className="muted">
                              <Amount value={w.debt} />
                            </span>
                          </td>
                          <td>
                            <Amount value={w.credit_limit} />
                          </td>
                          <td>
                            <div className="fee-actions">
                              <button
                                className="text-button"
                                onClick={() => setLedger(w.id)}
                              >
                                {t("流水", "Ledger")}
                              </button>
                              {actions
                                .filter((a) => access.has(permission(a)))
                                .map((a) => (
                                  <button
                                    key={a}
                                    className="text-button"
                                    onClick={() =>
                                      setEdit({ id: w.id, action: a })
                                    }
                                  >
                                    {name(a)}
                                  </button>
                                ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <div className="pagination">
              <span>
                {t("第", "Page")} {page + 1} · {t("每頁 25 筆", "25 per page")}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label={t("上一頁", "Previous page")}
                  disabled={page === 0 || list.loading}
                  onClick={() => setPage((v) => v - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t("下一頁", "Next page")}
                  disabled={!list.data.next_cursor || list.loading}
                  onClick={() => {
                    setCursors((v) => [
                      ...v.slice(0, page + 1),
                      list.data!.next_cursor,
                    ]);
                    setPage((v) => v + 1);
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        )
      )}
      <PaymentsPanel
        access={access}
        refreshVersion={revision}
        onTopUp={(id, payment) => setEdit({ id, payment, action: "top_up" })}
      />
      <section className="panel fee-related">
        <h2>{t("相關操作", "Related actions")}</h2>
        <div className="fee-actions">
          {access.has("admin.billing.refund") && (
            <button
              className="text-button"
              onClick={() => onLegacy("billing.refund")}
            >
              {t("核對退款", "Review a refund")}
            </button>
          )}
          <Link className="text-link" to="/entitlements">
            {t("VIP 權益", "VIP entitlements")}
          </Link>
          <Link className="text-link" to="/audit?view=approvals">
            {t("待獨立審批", "Pending independent reviews")}
          </Link>
        </div>
        <form
          className="fee-review-search"
          onSubmit={(e) => {
            e.preventDefault();
            setReview(String(new FormData(e.currentTarget).get("operation")));
          }}
        >
          <Field label={t("費用操作 ID", "Financial operation ID")}>
            <input name="operation" required pattern="[a-fA-F0-9-]{36}" />
          </Field>
          <button className="button secondary" type="submit">
            {t("查看操作與審批", "Open operation review")}
          </button>
        </form>
      </section>
      {edit && (
        <CanonicalFeeModal
          operator={access.me.user.id}
          initialAction={edit.action}
          initialAccount={edit.id}
          initialPayment={edit.payment}
          has={access.has}
          onClose={() => setEdit(null)}
          onDone={bump}
        />
      )}
      {ledger && <LedgerModal id={ledger} onClose={() => setLedger(null)} />}
      {review && (
        <FeeReview
          id={review}
          operator={access.me.user.id}
          has={access.has}
          onClose={() => setReview(null)}
          onDone={bump}
        />
      )}
    </>
  );
}

function LedgerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n(),
    [cursor, setCursor] = useState<(string | null)[]>([null]);
  const account = useData<Account>(`${root}/${id}`),
    list = useData<List<Entry>>(
      `${root}/${id}/ledger?limit=25${cursor.at(-1) ? `&cursor=${encodeURIComponent(cursor.at(-1)!)}` : ""}`,
    );
  return (
    <Modal title={t("帳戶流水", "Account ledger")} onClose={onClose}>
      <code className="fee-id">{id}</code>
      <ErrorNotice error={account.error ?? list.error} />
      {account.data && <AccountFacts account={account.data} />}
      {list.loading ? (
        <Loading />
      ) : (
        list.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("流水與來源", "Entry and source")}</th>
                    <th>{t("金額 / 類別", "Amount / bucket")}</th>
                    <th>{t("原因與執行者", "Reason and actor")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Badge value={j.kind} />
                        <code className="fee-id">{j.id}</code>
                        {j.source_entry_id && (
                          <code className="fee-id">← {j.source_entry_id}</code>
                        )}
                        <DateText value={j.created_at} />
                      </td>
                      <td>
                        {j.direction === "debit"
                          ? "− "
                          : j.direction === "credit"
                            ? "+ "
                            : ""}
                        <Amount value={j.amount} />
                        <br />
                        {j.bucket}
                      </td>
                      <td>
                        {j.reason}
                        <code className="fee-id">{j.actor_id}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fee-actions">
              <button
                className="button secondary"
                disabled={cursor.length === 1}
                onClick={() => setCursor((v) => v.slice(0, -1))}
              >
                {t("上一頁", "Previous")}
              </button>
              <button
                className="button secondary"
                disabled={!list.data.next_cursor}
                onClick={() => setCursor((v) => [...v, list.data!.next_cursor])}
              >
                {t("下一頁", "Next")}
              </button>
            </div>
          </>
        )
      )}
    </Modal>
  );
}

export function CanonicalFeeModal({
  operator,
  initialAction,
  initialAccount,
  initialPayment,
  subject,
  has,
  onClose,
  onDone,
}: {
  operator: string;
  initialAction: FeeAction;
  initialAccount?: string;
  initialPayment?: string;
  subject?: string;
  has: (key: string) => boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    name = useFeeName();
  const [selected, setSelected] = useState(initialAccount ?? ""),
    [accountInput, setAccountInput] = useState(initialAccount ?? ""),
    [action, setAction] = useState(initialAction),
    [revision, setRevision] = useState(0),
    [snapshot, setSnapshot] = useState<{ command: any; preview: any } | null>(
      null,
    ),
    [result, setResult] = useState<any>(null);
  const query = new URLSearchParams({ limit: "50" });
  if (subject) query.set("subject_id", subject);
  const accounts = useData<List<Account>>(
      !initialAccount ? `${root}?${query}` : null,
      revision,
    ),
    account = useData<Account>(
      selected ? `${root}/${selected}` : null,
      revision,
    );
  const ledger = useData<List<Entry>>(
    selected && action === "debit"
      ? `${root}/${selected}/ledger?limit=100`
      : null,
    revision,
  );
  useEffect(() => {
    setSnapshot(null);
  }, [selected, action]);
  return (
    <Modal title={name(action)} onClose={onClose}>
      <ErrorNotice error={accounts.error ?? account.error ?? ledger.error} />
      {result ? (
        <div className="operation-result">
          <ShieldCheck size={32} />
          <h2>
            {result.state === "pending_approval"
              ? t("已提交獨立審批", "Submitted for independent review")
              : t("操作已完成", "Operation completed")}
          </h2>
          <p>
            {result.state === "pending_approval"
              ? t(
                  "另一位同時具備費用操作與審批權限的管理員需核對此項操作。",
                  "A different administrator with both financial and approval permissions must review this operation.",
                )
              : t(
                  "帳戶已更新，原始流水及審計記錄已保留。",
                  "The account is updated and the original ledger and audit records are retained.",
                )}
          </p>
          <code className="fee-id" data-testid="fee-operation-id">
            {result.id}
          </code>
          <p>
            <Link to="/audit?view=approvals" onClick={onClose}>
              {t("查看審批列表", "View approval queue")}
            </Link>
          </p>
          <button className="button primary" onClick={onClose}>
            {t("完成", "Done")}
          </button>
        </div>
      ) : snapshot ? (
        <>
          <div className="notice">
            <ShieldCheck size={19} />
            {t(
              "請核對已凍結的帳戶、金額及來源。預覽不會改動餘額。",
              "Review the frozen account, amount and source. A preview does not change balances.",
            )}
          </div>
          <FeeCommandFacts id={selected} command={snapshot.command} />
          <dl className="preview-details">
            <dt>{t("策略版本", "Policy version")}</dt>
            <dd>
              <code>{snapshot.preview.policy_version_id}</code>
            </dd>
            <dt>{t("有效至", "Expires at")}</dt>
            <dd>
              <DateText value={snapshot.preview.expires_at} />
            </dd>
            <dt>{t("核准方式", "Approval")}</dt>
            <dd>
              {snapshot.preview.decision === "independent_approval"
                ? t("另一位管理員獨立審批", "Independent administrator review")
                : t("近期 MFA 驗證", "Recent MFA verification")}
            </dd>
          </dl>
          <AsyncForm
            submitLabel={
              snapshot.preview.decision === "independent_approval"
                ? t("提交獨立審批", "Submit for independent review")
                : t("確認執行", "Confirm change")
            }
            onSubmit={async () => {
              const b = snapshot.command,
                keyAction = `fee.${action}:${selected}`,
                key = await operationKey(operator, keyAction, b);
              const r = await api(`${root}/${selected}/${path(action)}`, {
                method: "POST",
                body: JSON.stringify(b),
                headers: {
                  "Idempotency-Key": key,
                  "X-Admin-Preview-ID": snapshot.preview.preview_id,
                },
              });
              await completeOperation(operator, keyAction, b);
              setResult(r);
              onDone();
            }}
          >
            <p className="form-footnote">
              {t(
                "遇到連線錯誤可重試同一操作；回執恢復不會重複入帳。",
                "Retry this same operation after a connection error; receipt recovery does not credit twice.",
              )}
            </p>
          </AsyncForm>
          <button
            className="text-button"
            onClick={() => {
              setSnapshot(null);
              setRevision((v) => v + 1);
            }}
          >
            {t("返回修改並更新帳戶", "Edit and refresh account")}
          </button>
        </>
      ) : (
        <>
          {!initialAccount && (
            <Field
              label={t("帳務帳戶", "Billing account")}
              hint={t(
                "輸入帳戶 ID 可選取列表之外的授權帳戶。",
                "Enter an account ID to select an authorized account outside this page.",
              )}
            >
              <input
                list="fee-accounts"
                aria-label={t("帳務帳戶", "Billing account")}
                value={accountInput}
                onChange={(e) => {
                  setAccountInput(e.target.value);
                  setSelected(
                    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                      e.target.value,
                    )
                      ? e.target.value
                      : "",
                  );
                }}
                placeholder={t(
                  "選擇或輸入帳戶 ID",
                  "Choose or enter an account ID",
                )}
              />
              <datalist id="fee-accounts">
                {accounts.data?.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.subject.kind} · {w.subject.id}
                  </option>
                ))}
              </datalist>
            </Field>
          )}
          {account.loading || accounts.loading ? <Loading /> : null}
          {account.data && (
            <>
              <Subject account={account.data} />
              <code className="fee-id">{account.data.id}</code>
              <AccountFacts account={account.data} />
              <AsyncForm
                key={`${selected}:${action}:${revision}`}
                submitLabel={t("預覽操作", "Preview change")}
                onSubmit={async (f) => {
                  if (!has(permission(action)))
                    throw new Error(
                      t("缺少費用操作權限", "Financial permission required"),
                    );
                  const amount = {
                    currency: "HKD",
                    amount_micros: parseHKD(
                      String(f.get("amount")),
                      action === "credit_limit",
                    ),
                  };
                  const b = {
                    expected_version: account.data!.version,
                    reason: String(f.get("reason")),
                    action,
                    ...(action === "credit_limit"
                      ? { new_limit: amount }
                      : { amount }),
                    ...(action === "gift"
                      ? {
                          expires_at: new Date(
                            String(f.get("expiry")),
                          ).toISOString(),
                        }
                      : {}),
                    ...(action === "top_up"
                      ? { payment_record_id: String(f.get("payment")) }
                      : {}),
                    ...(action === "debit"
                      ? { original_entry_id: String(f.get("source")) }
                      : {}),
                  };
                  const preview = await api(`${root}/${selected}/previews`, {
                    method: "POST",
                    body: JSON.stringify(b),
                  });
                  setSnapshot({ command: b, preview });
                }}
              >
                <Field label={t("操作類型", "Operation")}>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as FeeAction)}
                  >
                    {actions
                      .filter((a) => has(permission(a)))
                      .map((a) => (
                        <option key={a} value={a}>
                          {name(a)}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label={
                    action === "credit_limit"
                      ? t("新信用上限（HKD）", "New credit limit (HKD)")
                      : t("金額（HKD）", "Amount (HKD)")
                  }
                  hint={t(
                    "支援最多六位小數；信用上限可設為 0。",
                    "Up to six decimal places; credit limits may be zero.",
                  )}
                >
                  <input
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?"
                    required
                  />
                </Field>
                {action === "top_up" && (
                  <Field
                    label={t("已核實付款記錄 ID", "Verified payment record ID")}
                    hint={t(
                      "必須使用此帳戶中尚未入帳的已核實付款，金額與實收完全一致。",
                      "Use an unposted verified payment in this account, with the exact received amount.",
                    )}
                  >
                    <input
                      name="payment"
                      defaultValue={initialPayment}
                      required
                      pattern="[a-fA-F0-9-]{36}"
                    />
                  </Field>
                )}
                {action === "gift" && (
                  <Field
                    label={t("贈送額度到期時間", "Promotional credit expiry")}
                  >
                    <input name="expiry" type="datetime-local" required />
                  </Field>
                )}
                {action === "debit" && (
                  <Field
                    label={t("原始入帳流水 ID", "Original funding entry ID")}
                    hint={t(
                      "只可扣回同一帳戶中尚未使用、未被預留及未過期的原始額度。",
                      "Only unspent, unreserved and unexpired original funding in this account can be debited.",
                    )}
                  >
                    <input
                      name="source"
                      aria-label={t(
                        "原始入帳流水 ID",
                        "Original funding entry ID",
                      )}
                      list="fee-sources"
                      pattern="[a-fA-F0-9-]{36}"
                      required
                    />
                    <datalist id="fee-sources">
                      {ledger.data?.items
                        .filter((j) => ["gift", "top_up"].includes(j.kind))
                        .map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.kind} · {formatHKD(j.amount.amount_micros)}
                          </option>
                        ))}
                    </datalist>
                  </Field>
                )}
                <Field label={t("操作原因", "Reason")}>
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    rows={3}
                    required
                  />
                </Field>
              </AsyncForm>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export function FeeCommandFacts({ id, command }: { id: string; command: any }) {
  const { t } = useI18n(),
    name = useFeeName();
  return (
    <dl className="preview-details">
      <dt>{t("帳務帳戶", "Billing account")}</dt>
      <dd>
        <code>{id}</code>
      </dd>
      <dt>{t("操作", "Operation")}</dt>
      <dd>{name(command.action)}</dd>
      <dt>{t("金額", "Amount")}</dt>
      <dd>
        <Amount value={command.amount ?? command.new_limit} />
      </dd>
      <dt>{t("帳戶版本", "Account revision")}</dt>
      <dd>v{command.expected_version}</dd>
      {command.payment_record_id && (
        <>
          <dt>{t("已核實付款記錄", "Verified payment record")}</dt>
          <dd>
            <code>{command.payment_record_id}</code>
          </dd>
        </>
      )}
      {command.original_entry_id && (
        <>
          <dt>{t("原始入帳流水", "Original funding entry")}</dt>
          <dd>
            <code>{command.original_entry_id}</code>
          </dd>
        </>
      )}
      {command.expires_at && (
        <>
          <dt>{t("額度到期時間", "Credit expiry")}</dt>
          <dd>
            <DateText value={command.expires_at} />
          </dd>
        </>
      )}
      <dt>{t("原因", "Reason")}</dt>
      <dd>{command.reason}</dd>
    </dl>
  );
}

export function FeeReview({
  id,
  operator,
  has,
  onClose,
  onDone,
}: {
  id: string;
  operator: string;
  has: (key: string) => boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    review = useData<any>(
      `/v1/admin/billing/operations/${id}/review`,
      revision,
    );
  const v = review.data;
  return (
    <Modal
      title={t("費用操作與獨立審批", "Financial operation review")}
      onClose={onClose}
    >
      <ErrorNotice error={review.error} />
      {review.loading && <Loading />}
      {v && (
        <>
          <Badge value={v.operation.state} />
          <FeeCommandFacts id={v.billing_account_id} command={v.command} />
          <dl className="preview-details">
            <dt>{t("提交者", "Submitted by")}</dt>
            <dd>
              <code>{v.operation.actor_id}</code>
            </dd>
            {v.approval && (
              <>
                <dt>{t("審批請求", "Approval request")}</dt>
                <dd>
                  <code>{v.approval.id}</code>
                </dd>
              </>
            )}
            <dt>{t("策略版本", "Policy version")}</dt>
            <dd>
              <code>{v.operation.policy_version_id}</code>
            </dd>
            <dt>{t("凍結內容摘要", "Frozen payload hash")}</dt>
            <dd>
              <code className="fee-id">{v.operation.payload_hash}</code>
            </dd>
            <dt>{t("審批有效至", "Approval expires")}</dt>
            <dd>
              <DateText value={v.expires_at} />
            </dd>
          </dl>
          {v.operation.state === "pending_approval" &&
            (operator === v.operation.actor_id ? (
              <p className="notice">
                {t(
                  "此操作需由另一位管理員審批。",
                  "Another administrator must review this operation.",
                )}
              </p>
            ) : v.approval &&
              has("admin.approvals.decide") &&
              has(permission(v.command.action)) ? (
              <AsyncForm
                submitLabel={t("確認審批決定", "Confirm review decision")}
                onSubmit={async (f) => {
                  const b = {
                      expected_version: v.approval.version,
                      payload_hash: v.operation.payload_hash,
                      decision: String(f.get("decision")),
                      reason: String(f.get("reason")),
                    },
                    action = `fee.decision:${v.approval.id}`;
                  await api(`/v1/admin/approvals/${v.approval.id}/decisions`, {
                    method: "POST",
                    body: JSON.stringify(b),
                    headers: {
                      "Idempotency-Key": await operationKey(
                        operator,
                        action,
                        b,
                      ),
                    },
                  });
                  await completeOperation(operator, action, b);
                  setRevision((n) => n + 1);
                  onDone();
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
                  "需要同時具備此項費用操作及審批權限。",
                  "Both financial action and approval permissions are required.",
                )}
              </p>
            ))}
        </>
      )}
    </Modal>
  );
}

export const feeActionFromLegacy = actionOf;
