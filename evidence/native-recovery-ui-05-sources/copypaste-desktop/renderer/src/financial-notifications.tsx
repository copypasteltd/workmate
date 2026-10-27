import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api";
import { DateText, ErrorNotice, Loading, useI18n } from "./ui";
import {
  exactHKD,
  financialLabels,
  financialExplanation,
  type FinancialNotice,
} from "./financial-notice";

type Account = {
  id: string;
  paid_balance: { amount_micros: string };
  promotional_balance: { amount_micros: string };
  reserved: { amount_micros: string };
  credit_limit: { amount_micros: string };
  debt: { amount_micros: string };
  as_of: string;
};
type Inbox = { items: FinancialNotice[]; next_cursor: string | null };

export function FinancialInbox({ tenant }: { tenant: string }) {
  const { t } = useI18n(),
    [data, setData] = useState<Inbox | null>(null),
    [accounts, setAccounts] = useState<Account[] | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string | null>(null),
    [unread, setUnread] = useState(false),
    [all, setAll] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setData(null);
    setAccounts(null);
    setError(null);
    setLoading(true);
    const load = async () => {
      try {
        const params = new URLSearchParams({
          category: all ? "all" : "account_updates",
          limit: "10",
        });
        if (unread) params.set("unread", "true");
        if (cursor) params.set("cursor", cursor);
        const [inbox, funds] = await Promise.all([
          api<Inbox>("/v1/financial-notifications?" + params, {
            headers: { "X-Tenant-ID": tenant },
            signal: controller.signal,
          }),
          api<{ items: Account[] }>("/v1/me/billing-accounts", {
            signal: controller.signal,
          }),
        ]);
        if (live) {
          setData(inbox);
          setAccounts(funds.items);
          setError(null);
        }
      } catch (e) {
        if (live) {
          setData(null);
          setAccounts(null);
          setError(e as Error);
        }
      } finally {
        if (live) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };
    void load();
    return () => {
      live = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [tenant, all, unread, cursor, revision]);
  return (
    <section
      className="section-block financial-inbox"
      aria-labelledby="financial-inbox-heading"
    >
      <div className="section-title">
        <div>
          <span className="eyebrow">{t("帳戶與資金", "Accounts & funds")}</span>
          <h2 id="financial-inbox-heading">
            {t("費用與帳戶通知", "Financial account notifications")}
          </h2>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => {
            setCursor(null);
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t("更新帳戶與通知", "Refresh accounts and notices")}
        </button>
      </div>
      <ErrorNotice error={error} />
      {loading && !data ? <Loading /> : null}
      {accounts?.map((account) => (
        <div
          className="card"
          key={account.id}
          data-financial-account={account.id}
        >
          <h3>{t("我的個人帳戶", "My personal account")}</h3>
          <dl className="financial-balances">
            {(
              [
                [
                  t("實付餘額", "Paid balance"),
                  account.paid_balance.amount_micros,
                ],
                [
                  t("贈送餘額", "Promotional balance"),
                  account.promotional_balance.amount_micros,
                ],
                [t("已預留", "Reserved"), account.reserved.amount_micros],
                [
                  t("授信上限", "Credit limit"),
                  account.credit_limit.amount_micros,
                ],
                [t("已用授信", "Credit debt"), account.debt.amount_micros],
              ] as const
            ).map(([label, amount]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{exactHKD(amount)}</dd>
              </div>
            ))}
          </dl>
          <small className="muted">
            {t("確認於", "Confirmed at")} <DateText value={account.as_of} />
          </small>
        </div>
      ))}
      <p className="muted">
        {t(
          "企業帳戶通知只對目前具備企業財務權限的 Owner 或 Admin 顯示。通知保留歷史變更，不能用通知金額相加計算目前餘額。",
          "Workspace account notices are available to current owners and admins. Notices record historical events; their amounts do not add up to a current balance.",
        )}
      </p>
      <div className="button-row financial-filters">
        <label>
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => {
              setUnread(e.target.checked);
              setCursor(null);
            }}
          />{" "}
          {t("只看未讀", "Unread only")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
              setCursor(null);
            }}
          />{" "}
          {t("包含工作預留與消費", "Include task reservations and charges")}
        </label>
      </div>
      {data ? (
        <p role="status" aria-atomic="true" className="muted">
          {t(
            `本頁 ${data.items.length} 條通知，${data.items.filter((n) => !n.read).length} 條未讀。`,
            `${data.items.length} notices on this page, ${data.items.filter((n) => !n.read).length} unread.`,
          )}
        </p>
      ) : null}
      {data?.items.length === 0 ? (
        <p className="muted">
          {t(
            "目前沒有符合條件的費用通知。",
            "No financial notices match these filters.",
          )}
        </p>
      ) : null}
      {data?.items.map((notice) => {
        const title =
          financialLabels[notice.event_type] ??
          ([notice.event_type, notice.event_type] as const);
        return (
          <article
            className="card financial-notice"
            key={notice.id}
            data-financial-notification={notice.id}
          >
            <div className="financial-notice-title">
              <h3>{t(...title)}</h3>
              <span className="badge">
                {notice.read ? t("已讀", "Read") : t("未讀", "Unread")}
              </span>
            </div>
            <p>
              <strong>
                {notice.amount
                  ? exactHKD(notice.amount.amount_micros)
                  : t("金額待核對", "Amount unknown")}
              </strong>
              <span className="muted">
                {" "}
                ·{" "}
                {notice.subject.kind === "user"
                  ? t("個人帳戶", "Personal account")
                  : t("企業帳戶", "Workspace account")}
              </span>
            </p>
            {notice.requested_amount ? (
              <p>
                {t("原退款要求", "Original refund request")}:{" "}
                {exactHKD(notice.requested_amount.amount_micros)}
              </p>
            ) : null}
            <p>{t(...financialExplanation(notice.event_type))}</p>
            <p className="muted">
              <DateText value={notice.recorded_at} />
            </p>
            <details>
              <summary>
                {t("查看原始記錄參考", "Original record references")}
              </summary>
              <p className="financial-reference">{notice.source_id}</p>
              <p className="financial-reference">{notice.operation_id}</p>
            </details>
            <button
              className="button secondary"
              disabled={busy !== null}
              aria-label={`${notice.read ? t("標示未讀", "Mark unread") : t("標示已讀", "Mark read")}: ${t(...title)}`}
              onClick={async () => {
                setBusy(notice.id);
                setError(null);
                try {
                  await api("/v1/financial-notifications/" + notice.id, {
                    method: "PATCH",
                    headers: { "X-Tenant-ID": tenant },
                    body: JSON.stringify({ read: !notice.read }),
                  });
                  setRevision((n) => n + 1);
                } catch (e) {
                  setData(null);
                  setAccounts(null);
                  setError(e as Error);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === notice.id
                ? t("正在更新…", "Updating…")
                : notice.read
                  ? t("標示未讀", "Mark unread")
                  : t("標示已讀", "Mark read")}
            </button>
          </article>
        );
      })}
      <div className="button-row">
        <button
          className="button secondary"
          disabled={!cursor || loading}
          onClick={() => setCursor(null)}
        >
          {t("最新通知", "Latest notices")}
        </button>
        <button
          className="button secondary"
          disabled={!data?.next_cursor || loading}
          onClick={() => setCursor(data!.next_cursor)}
        >
          {t("較早通知", "Older notices")}
        </button>
      </div>
    </section>
  );
}
