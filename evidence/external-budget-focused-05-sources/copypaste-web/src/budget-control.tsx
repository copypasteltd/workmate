import { useEffect, useRef, useState } from "react";
import { ShieldCheck, RefreshCw, ArrowRight, Check, X } from "lucide-react";
import { api } from "./api";
import { ErrorNotice, Field, useData, useI18n } from "./ui";
import "./budget-control.css";

export type BudgetAccount = {
  account_id: string;
  name: string;
  currency: string | null;
};
type Policy = {
  id: string;
  version: number;
  policy: {
    enabled: boolean;
    currency: string;
    budget_ids: string[];
    maximum_average_daily_micros: string;
    maximum_change_micros: string;
    confirmation: string;
    expires_at: string;
  };
};
type Operation = {
  id: string;
  connection_id: string;
  account_id: string;
  budget_id: string;
  state: string;
  version: number;
  payload_sha256: string;
  data_mode: string;
  created_by: string;
  error_code: string | null;
  request_sha256: string | null;
  specification: {
    before: { name: string; currency: string; amount_micros: string };
    desired_average_daily_micros: string;
  };
  observation: any;
  resolution: any;
  created_at: string;
};
type Detail = {
  operation: Operation;
  receipts: { id: string; outcome: string; body_sha256: string; body: any }[];
  events: { id: string; version: number; state: string; created_at: string }[];
};
export function budgetMoney(micros: string) {
  const n = BigInt(micros),
    whole = n / 1000000n,
    fraction = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return whole.toString() + (fraction ? "." + fraction : "");
}
export function budgetAmount(value: string) {
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(value))
    throw new Error(
      "請輸入最多六位小數的金額 / Enter an amount with at most six decimal places",
    );
  const [a, b = ""] = value.split(".");
  return (BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"))).toString();
}
const states: Record<string, [string, string]> = {
  awaiting_confirmation: ["待客戶確認", "Awaiting customer confirmation"],
  queued: ["已排隊", "Queued"],
  checking: ["核對授權與現值", "Checking authority and source"],
  dispatched: ["已發送，等待回執", "Dispatched; awaiting receipt"],
  succeeded: ["供應商回執確認", "Confirmed by provider receipt"],
  failed: ["未完成", "Failed"],
  cancelled: ["已取消", "Cancelled"],
  expired: ["已過期", "Expired"],
  unknown: ["結果未知 · 不會重發", "Unknown outcome · no resend"],
  closed_unknown: [
    "人工關閉 · 歸因仍未知",
    "Manually closed · attribution unknown",
  ],
  no_change: ["現值相同，未發送修改", "Already equal; no mutation sent"],
};
export function BudgetState({ state }: { state: string }) {
  const { t } = useI18n();
  return (
    <span className={"budget-state " + state}>
      {states[state] ? t(...states[state]) : state}
    </span>
  );
}
export function BudgetControl({
  root,
  connection,
  accounts,
  actorId,
  admin = false,
  policyAccess,
  resolveAccess,
}: {
  root: string;
  connection: string;
  accounts: BudgetAccount[];
  actorId: string;
  admin?: boolean;
  policyAccess?: boolean;
  resolveAccess?: boolean;
}) {
  const { t } = useI18n(),
    [account, setAccount] = useState(accounts[0]?.account_id ?? ""),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const chosen = accounts.find((a) => a.account_id === account),
    policy = useData<{
      policy: Policy | null;
      can_manage?: boolean;
      data_mode: string;
    }>(
      account
        ? `${root}/policy?connection_id=${connection}&account_id=${account}`
        : null,
      refresh,
      5000,
    );
  const history = useData<{
    items: Operation[];
    next_cursor: string | null;
    data_mode: string;
  }>(
    `${root}/operations?limit=10${cursor ? "&cursor=" + cursor : ""}`,
    refresh,
    2500,
  );
  const [preview, setPreview] = useState<any>(null),
    [budget, setBudget] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [edit, setEdit] = useState(false);
  const inFlight = useRef(false),
    proposalKey = useRef(crypto.randomUUID()),
    p = policy.error ? null : policy.data?.policy;
  const manage = policyAccess ?? !!policy.data?.can_manage,
    resolve = resolveAccess ?? manage;
  useEffect(() => {
    setPreview(null);
    setError(null);
    setEdit(false);
    setSelected(null);
    setCursor(null);
  }, [root, connection, account]);
  useEffect(() => {
    if (policy.error || history.error) setPreview(null);
  }, [policy.error, history.error]);
  function invalidate() {
    setPreview(null);
    proposalKey.current = crypto.randomUUID();
  }
  async function run(fn: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  const active =
    !!p?.policy.enabled && Date.parse(p.policy.expires_at) > Date.now();
  return (
    <div
      className="budget-control"
      aria-label={t("廣告預算操作", "Advertising budget operations")}
    >
      <header className="budget-intro">
        <span className="eyebrow">
          GOOGLE ADS · {t("有範圍的執行", "SCOPED EXECUTION")}
        </span>
        <h2>{t("每一筆修改，都有依據", "A clear record for every change")}</h2>
        <p>
          {t(
            "先設定可用範圍，再核對確切金額。平均每日預算不是每日最高扣款；廣告費由 Google 向廣告帳戶收取。",
            "Set the allowed scope, then review the exact amount. An average daily budget is not a maximum daily charge. Google bills advertising spend to the advertiser account.",
          )}
        </p>
      </header>
      {policy.data?.data_mode === "simulated" && (
        <p className="notice">
          {t(
            "合成帳戶與模擬操作，沒有真實廣告支出。",
            "Synthetic accounts and simulated operations; no real advertising spend.",
          )}
        </p>
      )}
      <Field label={t("授權廣告帳戶", "Authorized advertiser account")}>
        <select
          value={account}
          onChange={(e) => {
            invalidate();
            setAccount(e.target.value);
          }}
        >
          {accounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {a.name} · {a.account_id} · {a.currency}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={error ?? policy.error ?? history.error} />
      {!history.error && (
        <>
          {chosen && !policy.error && (
            <section className="budget-section">
              <div className="budget-section-heading">
                <div>
                  <h3>{t("01 · 執行策略", "01 · Execution policy")}</h3>
                  <p>
                    {p
                      ? `${t("版本", "Version")} ${p.version} · ${p.policy.enabled ? t("已啟用", "Enabled") : t("已停用", "Disabled")}`
                      : t(
                          "尚未允許預算修改。",
                          "Budget changes have not been authorized.",
                        )}
                  </p>
                </div>
                {manage && (
                  <button
                    className="button secondary small"
                    onClick={() => setEdit((v) => !v)}
                  >
                    {t("設定策略", "Configure policy")}
                  </button>
                )}
              </div>
              {p && (
                <dl className="budget-facts">
                  <div>
                    <dt>{t("預算 ID 範圍", "Allowed budget IDs")}</dt>
                    <dd>{p.policy.budget_ids.join(", ")}</dd>
                  </div>
                  <div>
                    <dt>
                      {t("平均每日預算上限", "Average daily budget limit")}
                    </dt>
                    <dd>
                      {p.policy.currency}{" "}
                      {budgetMoney(p.policy.maximum_average_daily_micros)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t("每次變更幅度上限", "Maximum change per operation")}
                    </dt>
                    <dd>
                      {p.policy.currency}{" "}
                      {budgetMoney(p.policy.maximum_change_micros)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("確認方式與到期", "Confirmation and expiry")}</dt>
                    <dd>
                      {p.policy.confirmation === "each_operation"
                        ? t(
                            "每次由客戶管理員確認",
                            "Customer manager confirms each change",
                          )
                        : t(
                            "已明確允許策略範圍內執行",
                            "Explicit execution within policy",
                          )}{" "}
                      · {new Date(p.policy.expires_at).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              )}
              {edit && manage && (
                <BudgetPolicyEditor
                  key={`${account}:${p?.version ?? 0}`}
                  policy={p ?? null}
                  currency={chosen.currency ?? "HKD"}
                  busy={busy}
                  save={(b, key) =>
                    run(async () => {
                      await api(`${root}/policy/${connection}/${account}`, {
                        method: "PUT",
                        headers: { "Idempotency-Key": key },
                        body: JSON.stringify(b),
                      });
                      proposalKey.current = crypto.randomUUID();
                      setEdit(false);
                      invalidate();
                    })
                  }
                />
              )}
            </section>
          )}
          {!admin && active && (
            <section className="budget-section">
              <h3>{t("02 · 預覽確切修改", "02 · Preview the exact change")}</h3>
              <form
                className="budget-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const value = budgetAmount(amount);
                    setPreview(
                      await api(root + "/previews", {
                        method: "POST",
                        body: JSON.stringify({
                          connection_id: connection,
                          account_id: account,
                          budget_id: budget,
                          new_average_daily_micros: value,
                        }),
                      }),
                    );
                    proposalKey.current = crypto.randomUUID();
                  });
                }}
              >
                <Field label={t("指定預算 ID", "Exact budget ID")}>
                  <input
                    required
                    pattern="[1-9][0-9]{0,19}"
                    value={budget}
                    onChange={(e) => {
                      setBudget(e.target.value);
                      invalidate();
                    }}
                    placeholder={p?.policy.budget_ids.join(", ")}
                  />
                </Field>
                <Field
                  label={
                    t("新的平均每日預算", "New average daily budget") +
                    ` (${chosen?.currency})`
                  }
                >
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      invalidate();
                    }}
                    placeholder="125.00"
                  />
                </Field>
                <button
                  className="button secondary"
                  disabled={busy}
                  type="submit"
                >
                  <RefreshCw size={16} />
                  {t("讀取現值並預覽", "Read current value & preview")}
                </button>
              </form>
              {preview && (
                <div className="budget-preview">
                  <span className="eyebrow">
                    {t("確切預覽 · 尚未修改", "EXACT PREVIEW · NO CHANGE SENT")}
                  </span>
                  <h3>{preview.before.name}</h3>
                  <div className="budget-amount-change">
                    <strong>
                      {preview.before.currency}{" "}
                      {budgetMoney(preview.before.amount_micros)}
                    </strong>
                    <ArrowRight size={20} />
                    <strong>
                      {preview.before.currency}{" "}
                      {budgetMoney(preview.desired_average_daily_micros)}
                    </strong>
                  </div>
                  <p>
                    {t("帳戶", "Account")} {preview.before.account_id} ·{" "}
                    {t("預算", "Budget")} {preview.before.budget_id} ·{" "}
                    {t("策略版本", "Policy version")} {preview.policy.version}
                  </p>
                  <small>
                    {t("預覽有效至", "Preview valid until")}{" "}
                    {new Date(preview.expires_at).toLocaleString()}
                  </small>
                  <button
                    className="button primary"
                    disabled={
                      busy || Date.parse(preview.expires_at) <= Date.now()
                    }
                    onClick={() =>
                      void run(async () => {
                        const op = await api<Operation>(root + "/operations", {
                          method: "POST",
                          headers: { "Idempotency-Key": proposalKey.current },
                          body: JSON.stringify({
                            connection_id: connection,
                            account_id: account,
                            budget_id: preview.before.budget_id,
                            new_average_daily_micros:
                              preview.desired_average_daily_micros,
                            preview_id: preview.preview_id,
                            expected_source_sha256: preview.source_sha256,
                          }),
                        });
                        setSelected(op.id);
                        invalidate();
                      })
                    }
                  >
                    <ShieldCheck size={16} />
                    {p?.policy.confirmation === "within_policy"
                      ? t(
                          "按已授權策略排隊執行",
                          "Queue under authorized policy",
                        )
                      : t(
                          "提交確切修改，等待確認",
                          "Submit exact change for confirmation",
                        )}
                  </button>
                </div>
              )}
            </section>
          )}
          <section className="budget-section">
            <div className="budget-section-heading">
              <h3>{t("項目操作記錄", "Project operation history")}</h3>
              <button
                className="icon-button"
                title={t("重新整理", "Refresh")}
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <p className="muted">
              {t(
                "顯示此項目各連接的操作；結果未知不會自動重發。沒有額外 AI 費用。",
                "Operations from all connections in this project. Unknown outcomes are never automatically resent. No additional AI charge.",
              )}
            </p>
            <div className="budget-history">
              {history.data?.items.map((o) => (
                <button
                  key={o.id}
                  className={
                    "budget-history-row " +
                    (selected === o.id ? "selected" : "")
                  }
                  onClick={() => {
                    setSelected(o.id);
                    setError(null);
                  }}
                >
                  <span>
                    <strong>{o.specification.before.name}</strong>
                    <small>
                      {o.account_id} / {o.budget_id} · {o.id.slice(0, 8)}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {o.specification.before.currency}{" "}
                      {budgetMoney(
                        o.specification.desired_average_daily_micros,
                      )}
                    </strong>
                    <BudgetState state={o.state} />
                  </span>
                </button>
              ))}
              {!history.data?.items.length && (
                <p className="muted">
                  {t("尚無預算操作。", "No budget operations yet.")}
                </p>
              )}
            </div>
            <div className="row-actions">
              {cursor && (
                <button className="text-button" onClick={() => setCursor(null)}>
                  {t("回到最新列表", "Return to first page")}
                </button>
              )}
              {history.data?.next_cursor && (
                <button
                  className="text-button"
                  onClick={() => setCursor(history.data!.next_cursor)}
                >
                  {t("下一頁", "Next page")}
                </button>
              )}
            </div>
          </section>
          {selected && (
            <BudgetOperationDetail
              key={selected}
              root={root}
              id={selected}
              actorId={actorId}
              manage={resolve}
              admin={admin}
              connection={connection}
              refresh={refresh}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
        </>
      )}
    </div>
  );
}
function BudgetPolicyEditor({
  policy,
  currency,
  busy,
  save,
}: {
  policy: Policy | null;
  currency: string;
  busy: boolean;
  save: (b: unknown, key: string) => Promise<unknown>;
}) {
  const { t } = useI18n(),
    p = policy?.policy,
    [ids, setIds] = useState(p?.budget_ids.join(", ") ?? ""),
    [max, setMax] = useState(
      p ? budgetMoney(p.maximum_average_daily_micros) : "200",
    ),
    [delta, setDelta] = useState(
      p ? budgetMoney(p.maximum_change_micros) : "50",
    ),
    [enabled, setEnabled] = useState(p?.enabled ?? false),
    [confirmation, setConfirmation] = useState(
      p?.confirmation ?? "each_operation",
    ),
    [consent, setConsent] = useState(false),
    [days, setDays] = useState("7"),
    [error, setError] = useState<unknown>(null);
  const attempt = useRef<{
    fingerprint: string;
    body: unknown;
    key: string;
  } | null>(null);
  return (
    <form
      className="budget-policy"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        try {
          const fingerprint = JSON.stringify([
            policy?.version ?? 0,
            enabled,
            currency,
            ids,
            max,
            delta,
            confirmation,
            days,
          ]);
          const b = {
            expected_version: policy?.version ?? 0,
            policy: {
              enabled,
              currency,
              budget_ids: ids
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
              maximum_average_daily_micros: budgetAmount(max),
              maximum_change_micros: budgetAmount(delta),
              confirmation,
              expires_at: new Date(
                Date.now() + Number(days) * 86400000,
              ).toISOString(),
            },
          };
          if (attempt.current?.fingerprint !== fingerprint) {
            attempt.current = {
              fingerprint,
              body: b,
              key: crypto.randomUUID(),
            };
          }
          void save(attempt.current.body, attempt.current.key).catch(setError);
        } catch (e) {
          setError(e);
        }
      }}
    >
      <label className="budget-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t(
          "啟用此帳戶和項目的預算修改",
          "Enable budget changes for this account and project",
        )}
      </label>
      <Field
        label={t(
          "允許的預算 ID（逗號分隔）",
          "Allowed budget IDs (comma separated)",
        )}
      >
        <input
          required
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="700, 701"
        />
      </Field>
      <div className="budget-form">
        <Field
          label={
            t("平均每日預算上限", "Average daily budget limit") +
            ` (${currency})`
          }
        >
          <input
            required
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </Field>
        <Field
          label={
            t("每次變更幅度上限", "Maximum change per operation") +
            ` (${currency})`
          }
        >
          <input
            required
            inputMode="decimal"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("確認方式", "Confirmation mode")}>
        <select
          value={confirmation}
          onChange={(e) => {
            setConfirmation(e.target.value);
            setConsent(false);
          }}
        >
          <option value="each_operation">
            {t(
              "每一次修改由客戶管理員確認",
              "Customer manager confirms each operation",
            )}
          </option>
          <option value="within_policy">
            {t(
              "明確允許策略範圍內自動執行",
              "Explicitly allow execution within policy",
            )}
          </option>
        </select>
      </Field>
      <Field
        label={t(
          "從本次儲存起有效天數（1–30）",
          "Days valid from this save (1–30)",
        )}
      >
        <input
          required
          type="number"
          min="1"
          max="30"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </Field>
      {enabled && confirmation === "within_policy" && (
        <label className="budget-check">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t(
            "我明確允許有項目寫入權限的用戶在以上範圍內排隊修改，不再逐次確認。",
            "I explicitly authorize users with project write access to queue changes within these limits without confirming each operation.",
          )}
        </label>
      )}
      <p className="muted">
        {t(
          "新版本會取消尚未發送的舊操作。已發送的請求可能仍在外部執行，無法撤回。",
          "A new version cancels older operations that have not been dispatched. An already dispatched external request may still execute and cannot be recalled.",
        )}
      </p>
      <ErrorNotice error={error} />
      <button
        className="button primary"
        disabled={
          busy || (enabled && confirmation === "within_policy" && !consent)
        }
        type="submit"
      >
        {t("儲存確切策略版本", "Save exact policy version")}
      </button>
    </form>
  );
}
export function BudgetOperationDetail({
  root,
  id,
  actorId,
  manage,
  admin = false,
  connection,
  refresh,
  onChanged,
}: {
  root: string;
  id: string;
  actorId: string;
  manage: boolean;
  admin?: boolean;
  connection: string;
  refresh: number;
  onChanged: () => void;
}) {
  const { t } = useI18n(),
    detail = useData<Detail>(`${root}/operations/${id}`, refresh, 2500),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    guard = useRef(false);
  const d = detail.error ? null : detail.data,
    o = d?.operation;
  async function action(name: string, body: unknown) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(`${root}/operations/${id}/${name}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onChanged();
      setAck(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  return (
    <section
      className="budget-section budget-operation-detail"
      aria-label={t("確切操作詳情", "Exact operation detail")}
    >
      <h3>{t("確切操作與證據", "Exact operation and evidence")}</h3>
      <ErrorNotice error={error ?? detail.error} />
      {o && (
        <>
          <BudgetState state={o.state} />
          <div className="budget-amount-change">
            <strong>
              {o.specification.before.currency}{" "}
              {budgetMoney(o.specification.before.amount_micros)}
            </strong>
            <ArrowRight size={20} />
            <strong>
              {o.specification.before.currency}{" "}
              {budgetMoney(o.specification.desired_average_daily_micros)}
            </strong>
          </div>
          <p>
            {t("帳戶 / 預算", "Account / budget")} {o.account_id} /{" "}
            {o.budget_id}
          </p>
          <small className="budget-digest">
            {t("操作", "Operation")}: {o.id}
            <br />
            SHA-256: {o.payload_sha256}
          </small>
          {o.error_code && <p className="notice">{o.error_code}</p>}
          {!admin && manage && o.state === "awaiting_confirmation" && (
            <div className="row-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void action("decision", {
                    expected_version: o.version,
                    payload_sha256: o.payload_sha256,
                    decision: "confirm",
                  })
                }
              >
                <Check size={16} />
                {t("確認這筆確切修改", "Confirm this exact change")}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action("decision", {
                    expected_version: o.version,
                    payload_sha256: o.payload_sha256,
                    decision: "reject",
                  })
                }
              >
                <X size={16} />
                {t("拒絕", "Reject")}
              </button>
            </div>
          )}
          {(manage || o.created_by === actorId) &&
            ["awaiting_confirmation", "queued", "checking"].includes(
              o.state,
            ) && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  void action("cancel", { expected_version: o.version })
                }
              >
                {t("取消尚未發送的操作", "Cancel before dispatch")}
              </button>
            )}
          {o.state === "unknown" && (
            <div className="budget-unknown">
              <p>
                {t(
                  "本次請求可能已生效。平台不會重發；目前的外部現值也不能證明是哪次請求造成修改。",
                  "This request may have applied. It will not be resent. The current remote value cannot prove which request caused a change.",
                )}
              </p>
              {manage && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action("observe", {
                      expected_version: o.version,
                      ...(connection ? { connection_id: connection } : {}),
                    })
                  }
                >
                  {t("讀取目前外部現值", "Observe current remote value")}
                </button>
              )}
              {o.observation && (
                <>
                  <p>
                    {t("觀察現值", "Observed value")}:{" "}
                    {o.observation.snapshot.currency}{" "}
                    {budgetMoney(o.observation.snapshot.amount_micros)} ·{" "}
                    {new Date(o.observation.observed_at).toLocaleString()}
                  </p>
                  <p className="muted">
                    {t(
                      "歸因仍未知；觀察有效期為十分鐘。",
                      "Attribution remains unknown. Observation is valid for ten minutes.",
                    )}
                  </p>
                  {manage && (
                    <>
                      <Field
                        label={t("人工核對原因", "Reason for manual closure")}
                      >
                        <textarea
                          minLength={5}
                          maxLength={1000}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </Field>
                      <label className="budget-check">
                        <input
                          type="checkbox"
                          checked={ack}
                          onChange={(e) => setAck(e.target.checked)}
                        />
                        {t(
                          "我已核對，接受歸因仍未知；此操作不會重發。",
                          "I have reviewed this and accept unknown attribution. This operation will not be resent.",
                        )}
                      </label>
                      <button
                        className="button secondary"
                        disabled={busy || !ack || reason.trim().length < 5}
                        onClick={() =>
                          void action("close-unknown", {
                            expected_version: o.version,
                            observation_sha256: o.observation.sha256,
                            reason,
                            acknowledge_unknown_attribution: true,
                          })
                        }
                      >
                        {t(
                          "記錄核對並關閉未知操作",
                          "Record review & close unknown operation",
                        )}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {!!d?.receipts.length && (
            <div className="budget-receipts">
              <h4>{t("不可變回執", "Immutable receipts")}</h4>
              {d.receipts.map((r) => (
                <p key={r.id}>
                  <strong>{r.outcome}</strong>
                  <code>{r.body_sha256}</code>
                </p>
              ))}
            </div>
          )}
          <details>
            <summary>{t("完整狀態歷程", "Full state history")}</summary>
            <ol className="budget-events">
              {d?.events.map((e) => (
                <li key={e.id}>
                  <BudgetState state={e.state} />
                  <small>
                    v{e.version} · {new Date(e.created_at).toLocaleString()}
                  </small>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
